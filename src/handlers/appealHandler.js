import { WarnModel } from '../models/Warn.js';
import { AutoModTrackerModel } from '../models/AutoModTracker.js';
import { createCase, logAudit } from '../utils/caseUtils.js';
import { logger } from '../utils/logger.js';
import { checkWarningEscalation, checkSecurityViolations } from '../utils/securityUtils.js';
import { createUnifiedModEmbed } from '../utils/modLogEmbed.js';
import { GuildModel } from '../models/Guild.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let DEFAULT_PROFANITY = [];
try {
  const raw = readFileSync(join(__dirname, '../assets/profanity_wordlist.txt'), 'utf-8');
  DEFAULT_PROFANITY = raw
    .split(/[\r\n]+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0);
} catch {}

const DEFAULT_SEVERE_PROFANITY = ['nigger', 'faggot', 'retard', 'kike', 'cunt', 'chink', 'dyke'];

const profanityRegexCache = new Map();
const PROFANITY_CACHE_MAX = 100;

const spamTracker = new Map();

function pruneSpamTimestamps(guildId, userId, maxAge) {
  const key = `${guildId}:${userId}`;
  const timestamps = spamTracker.get(key);
  if (!timestamps) return 0;
  const now = Date.now();
  const filtered = timestamps.filter(t => now - t <= maxAge);
  if (filtered.length === 0) {
    spamTracker.delete(key);
    return 0;
  }
  spamTracker.set(key, filtered);
  return filtered.length;
}

function addSpamTimestamp(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (!spamTracker.has(key)) spamTracker.set(key, []);
  spamTracker.get(key).push(Date.now());
}

function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\-_*!?()[\]{}<>"']/g, ' ')
    .toLowerCase();
}

function getProfanityRegex(guildId, customList, severeList) {
  const list = customList?.length ? customList : DEFAULT_PROFANITY;
  const severe = severeList?.length ? severeList : DEFAULT_SEVERE_PROFANITY;
  const allWords = [...list, ...severe];
  const key = guildId;

  const cached = profanityRegexCache.get(key);
  if (cached && cached.words.join(',') === allWords.join(',')) {
    return { regex: cached.regex, severeWords: severe };
  }

  const pattern = allWords
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`\\b(${pattern})\\b`, 'i');

  profanityRegexCache.set(key, { words: allWords, regex, severeWords: severe });

  if (profanityRegexCache.size > PROFANITY_CACHE_MAX) {
    const firstKey = profanityRegexCache.keys().next().value;
    profanityRegexCache.delete(firstKey);
  }

  return { regex, severeWords: severe };
}

function getEscalationNotice(warningCount, guildConfig) {
  const tiers = guildConfig?.warningEscalation || [
    { points: 2, duration: 86400000 },
    { points: 4, duration: 2592000000 },
  ];

  const sorted = tiers.sort((a, b) => a.points - b.points);
  for (const tier of sorted) {
    if (warningCount < tier.points) {
      const hours = Math.round(tier.duration / 3600000);
      return `Your next warning will result in an automatic ${hours}-hour mute!`;
    }
  }
  return '';
}

export const name = 'messageCreate';

export async function execute(message, client) {
  if (message.author.bot) return;

  if (!message.guild) {
    try {
      const { execute: executeAppeal } = await import('../commands/utility/appeal.js');
      const fakeInteraction = {
        user: message.author,
        guildId: null,
        isDirectMessage: true,
        options: { getString: () => null },
        editReply: async (payload) => {
          if (payload?.embeds?.[0]?.data?.description?.includes('No active or recent punishments')) return;
          return message.channel.send(payload);
        },
        reply: async (payload) => {
          if (payload?.embeds?.[0]?.data?.description?.includes('No active or recent punishments')) return;
          return message.channel.send(payload);
        }
      };
      await executeAppeal(fakeInteraction, client);
    } catch (err) {
      logger.error(`DM appeal trigger error: ${err.message}`);
    }
    return;
  }

  const config = client.guildConfigs?.get(message.guild.id);
  if (!config?.automod?.enabled) return;

  const automod = config.automod;
  const member = message.member;
  if (!member) return;

  const isOwner = message.author.id === message.guild.ownerId;
  const isStaff = isOwner || member.roles.cache.some(r =>
    [...(config.staffRoles || []), ...(config.adminRoles || [])].includes(r.id)
  );

  if (isStaff) {
    if (!isOwner) return;
    if (!automod.filterProfanity) return;
  }

  const shouldScanAll = !isStaff;
  const shouldScanProfanity = !isStaff || (isOwner && automod.filterProfanity);

  const dryRun = automod.dryRun || false;

  const violations = [];
  let timeoutDuration = 0;
  let warnPoints = 1;
  let isSevereProfanity = false;
  let matchedSevereWord = null;

  if (shouldScanAll && automod.spamThreshold && automod.spamInterval) {
    const spamInterval = automod.spamInterval || 5000;
    const threshold = automod.spamThreshold || 5;

    addSpamTimestamp(message.guild.id, message.author.id);
    const count = pruneSpamTimestamps(message.guild.id, message.author.id, spamInterval);

    if (count >= threshold) {
      violations.push('spam');
      if (!dryRun) {
        const now = Date.now();
        const priorSpamViolations = await AutoModTrackerModel.countDocuments({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'spam_violation'
        });

        let spamTimeout = 300000;
        if (priorSpamViolations === 1) spamTimeout = 900000;
        else if (priorSpamViolations >= 2) spamTimeout = 3600000;

        timeoutDuration = Math.max(timeoutDuration, spamTimeout);

        await new AutoModTrackerModel({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'spam_violation',
          expiresAt: new Date(now + 600000)
        }).save();
      }
    }
  }

  if (shouldScanAll && automod.maxMentions) {
    const userMentions = (message.content.match(/<@!?\d+>/g) || []).length;
    const roleMentions = (message.content.match(/<@&\d+>/g) || []).length;
    const everyone = message.mentions.everyone ? 1 : 0;
    const mentionCount = userMentions + roleMentions + everyone;

    if (mentionCount > automod.maxMentions) {
      violations.push('mass mention');
      if (!dryRun && mentionCount > 10) {
        timeoutDuration = Math.max(timeoutDuration, 600000);
      }
    }
  }

  if (shouldScanAll && automod.filterInvites) {
    const invitePattern = /discord\.(?:gg|io|me|li|com\/invite)\/[a-zA-Z0-9_-]+/i;
    const inviteMatches = message.content.match(invitePattern);
    if (inviteMatches) {
      violations.push('invite link');

      if (!dryRun) {
        const priorInvites = await AutoModTrackerModel.countDocuments({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'invite_violation'
        });

        if (priorInvites >= 1) {
          timeoutDuration = Math.max(timeoutDuration, 600000);
        }

        await new AutoModTrackerModel({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'invite_violation',
          expiresAt: new Date(Date.now() + 86400000)
        }).save();
      }
    }
  }

  if (shouldScanAll && automod.filterLinks && !violations.includes('invite link')) {
    const allowlist = (automod.linkAllowlist || []).map(x => x.toLowerCase().replace(/^www\./, ''));
    const linkMatches = message.content.match(/https?:\/\/[^\s]+/gi) || [];
    for (const link of linkMatches) {
      try {
        const hostname = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
        if (!allowlist.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed))) {
          violations.push('external link');
          break;
        }
      } catch {
        violations.push('external link');
        break;
      }
    }
  }

  if (shouldScanAll && automod.capsPercent) {
    const letters = message.content.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 5) {
      const capsCount = letters.split('').filter(c => c >= 'A' && c <= 'Z').length;
      if ((capsCount / letters.length) * 100 > automod.capsPercent) {
        violations.push('excessive caps');
      }
    }
  }

  if (shouldScanAll && automod.maxEmojis) {
    const emojiRegex = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;
    const emojiCount = (message.content.match(emojiRegex) || []).length;
    if (emojiCount > automod.maxEmojis) {
      violations.push('emoji spam');
    }
  }

  if (shouldScanProfanity && automod.filterProfanity) {
    const { regex, severeWords } = getProfanityRegex(
      message.guild.id,
      automod.profanityList,
      automod.severeProfanityList
    );
    const normalized = normalizeText(message.content);
    const match = normalized.match(regex);
    if (match) {
      violations.push('profanity');
      const matchedWord = match[0].toLowerCase();
      if (severeWords.some(w => matchedWord.includes(w))) {
        isSevereProfanity = true;
        matchedSevereWord = matchedWord;
      }

      if (!dryRun) {
        if (isSevereProfanity) {
          timeoutDuration = Math.max(timeoutDuration, 3600000);
          warnPoints = 2;
        } else {
          timeoutDuration = Math.max(timeoutDuration, 300000);
          warnPoints = 1;
        }
      }
    }
  }

  if (violations.length === 0) return;

  if (dryRun) {
    logger.info(`[AutoMod Dry-Run] User ${message.author.tag} in ${message.guild.id} violated: ${violations.join(', ')}. No action taken.`);
    return;
  }

  const now = Date.now();

  const escalationDoc = await AutoModTrackerModel.findOneAndUpdate(
    {
      guildId: message.guild.id,
      userId: message.author.id,
      type: 'rule_trigger'
    },
    { $inc: { count: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  let autoEscalated = false;
  let currentCount = escalationDoc.count || 1;

  if (currentCount >= 5) {
    await AutoModTrackerModel.findOneAndUpdate(
      { _id: escalationDoc._id },
      { $set: { count: 0, expiresAt: new Date(now + 600000) } }
    );
    autoEscalated = true;
  }

  if (!autoEscalated) {
    await AutoModTrackerModel.findOneAndUpdate(
      { _id: escalationDoc._id },
      { $set: { expiresAt: new Date(now + 600000) } }
    );
  }

  const finalPoints = autoEscalated ? 1 : warnPoints;
  const violationReason = `AutoMod: ${violations.join(', ')}${autoEscalated ? ' (Escalated: 5+ triggers in 10min)' : ''}`;

  const warn = new WarnModel({
    guildId: message.guild.id,
    userId: message.author.id,
    moderatorId: client.user.id,
    moderatorTag: client.user.tag,
    reason: violationReason,
    points: finalPoints,
    severity: isSevereProfanity ? 'severe' : 'minor',
  });
  await warn.save();

  const caseEntry = await createCase({
    guildId: message.guild.id,
    type: 'warn',
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderatorId: client.user.id,
    moderatorTag: client.user.tag,
    reason: violationReason,
  });

  try {
    await message.delete();
  } catch (err) {
    logger.warn(`AutoMod: failed to delete message ${message.id}: ${err.message}`);
  }

  if (timeoutDuration > 0 && member.manageable) {
    const currentTimeoutEnd = member.communicationDisabledUntilTimestamp || 0;
    const proposedTimeoutEnd = now + timeoutDuration;
    if (proposedTimeoutEnd > currentTimeoutEnd) {
      try {
        await member.timeout(timeoutDuration, violationReason);
      } catch (err) {
        logger.warn(`AutoMod: failed to timeout ${member.id}: ${err.message}`);
      }
    }
  }

  await checkWarningEscalation(message.guild, message.member, client.user, message.channel);
  await checkSecurityViolations(message.guild, message.author.id);

  await logAudit({
    guildId: message.guild.id,
    action: 'automod_violation',
    moderatorId: client.user.id,
    targetId: message.author.id,
    reason: violationReason,
    details: `Channel: #${message.channel.name} | Message ID: ${message.id} | Points: ${finalPoints}`,
  }).catch(err => logger.warn(`AutoMod: audit log error: ${err.message}`));

  try {
    const activeWarnings = await WarnModel.find({
      guildId: message.guild.id,
      userId: message.author.id,
      active: true
    }).lean();
    const warningCount = activeWarnings.reduce((sum, w) => sum + (w.points || 1), 0);

    const guildConfig = await GuildModel.findOne({ guildId: message.guild.id }).lean();
    const nextNotice = getEscalationNotice(warningCount, guildConfig);

    let dmMsg = `⚠️ **AutoMod Warning Notice**\nYour message in **${message.guild.name}** was deleted and you were warned for: **${violations.join(', ')}** (Case **#${caseEntry.caseNumber}**).\n\n**Current Warnings:** ${warningCount}/5 points\n\n*If you wish to appeal this warning, run the slash command:* \`/appeal case-id: ${caseEntry.caseNumber} reason: <your reason>\` *in the server.*`;
    if (nextNotice) {
      dmMsg += `\n*Note: ${nextNotice}*`;
    }
    await message.author.send(dmMsg).catch(() => {});
  } catch (err) {
    logger.warn(`AutoMod: failed to send DM to ${message.author.id}: ${err.message}`);
  }
}