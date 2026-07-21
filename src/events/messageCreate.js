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
} catch {
  // Fallback
}

const SEVERE_PROFANITIES = ['nigger', 'faggot', 'retard', 'kike', 'cunt', 'chink', 'dyke'];
const profanityRegexCache = new Map();

function getProfanityRegex(guildId, customList) {
  const words = customList && customList.length > 0 ? customList : DEFAULT_PROFANITY;
  const cached = profanityRegexCache.get(guildId);
  
  if (cached && cached.list.join(',') === words.join(',')) return cached.regex;
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`\\b(${pattern})\\b`, 'i');
  profanityRegexCache.set(guildId, { list: words, regex });
  return regex;
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

  if (isStaff && (!isOwner || !automod.filterProfanity)) return;

  const shouldScanAll = !isStaff;
  const shouldScanProfanity = !isStaff || (isOwner && automod.filterProfanity);

  const dryRun = automod.dryRun || false;
  const violations = [];
  let timeoutDuration = 0;
  let warnPoints = 1;
  let isSevereProfanity = false;

  // 1. Spam scan
  if (shouldScanAll && automod.spamThreshold && automod.spamInterval) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    
    // We log message timestamps dynamically in AutoModTrackerModel
    const newSpamTracker = new AutoModTrackerModel({
      guildId: message.guild.id,
      userId: message.author.id,
      type: 'message_timestamp',
      expiresAt: new Date(now + (automod.spamInterval || 5000))
    });
    await newSpamTracker.save();

    const recentMessagesCount = await AutoModTrackerModel.countDocuments({
      guildId: message.guild.id,
      userId: message.author.id,
      type: 'message_timestamp'
    });

    if (recentMessagesCount >= automod.spamThreshold) {
      violations.push('spam');
      
      if (!dryRun) {
        // Query the number of spam violations in the last 10 minutes to choose escalating timeout ladder
        const priorSpamViolations = await AutoModTrackerModel.countDocuments({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'spam_violation'
        });

        let spamTimeout = 300000; // 1st: 5 min
        if (priorSpamViolations === 1) {
          spamTimeout = 900000; // 2nd: 15 min
        } else if (priorSpamViolations >= 2) {
          spamTimeout = 3600000; // 3rd: 1 hour
        }

        timeoutDuration = Math.max(timeoutDuration, spamTimeout);

        // Record this spam violation
        const newSpamViolation = new AutoModTrackerModel({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'spam_violation',
          expiresAt: new Date(now + 600000) // 10-minute window
        });
        await newSpamViolation.save();
      }
    }
  }

  // 2. Mass Mentions scan
  if (shouldScanAll && automod.maxMentions) {
    const userMentions = (message.content.match(/<@!?\d+>/g) || []).length;
    const roleMentions = (message.content.match(/<@&\d+>/g) || []).length;
    const everyone = message.mentions.everyone ? 1 : 0;
    const mentionCount = userMentions + roleMentions + everyone;
    
    if (mentionCount > automod.maxMentions) {
      violations.push('mass mention');
      if (!dryRun && mentionCount > 10) {
        timeoutDuration = Math.max(timeoutDuration, 600000); // 10-minute timeout for >10 mentions
      }
    }
  }

  // 3. Invite Links scan
  if (shouldScanAll && automod.filterInvites) {
    const invitePattern = /discord(?:app)?\.(?:gg|io|me|li|com\/invite)\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?|discord\.com\/invite\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/i;
    const hasInvite = invitePattern.test(message.content);
    if (hasInvite) {
      violations.push('invite link');

      if (!dryRun) {
        const priorInvites = await AutoModTrackerModel.countDocuments({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'invite_violation'
        });

        if (priorInvites >= 1) {
          timeoutDuration = Math.max(timeoutDuration, 600000); // 10-minute timeout on 2nd offence in 24 hours
        }

        const newInviteViolation = new AutoModTrackerModel({
          guildId: message.guild.id,
          userId: message.author.id,
          type: 'invite_violation',
          expiresAt: new Date(Date.now() + 86400000) // 24-hour tracking
        });
        await newInviteViolation.save();
      }
    }
  }

  // 4. External Links scan
  if (shouldScanAll && automod.filterLinks && !violations.includes('invite link')) {
    const allowlist = automod.linkAllowlist || [];
    const linkMatches = message.content.match(/https?:\/\/[^\s]+/gi) || [];
    for (const link of linkMatches) {
      try {
        const hostname = new URL(link).hostname.replace(/^www\./, '');
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

  // 5. Caps Lock scan
  if (shouldScanAll && automod.capsPercent) {
    const letters = message.content.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 5) {
      const capsCount = letters.split('').filter(c => c >= 'A' && c <= 'Z').length;
      if ((capsCount / letters.length) * 100 > automod.capsPercent) {
        violations.push('excessive caps');
      }
    }
  }

  // 6. Emoji Spam scan
  if (shouldScanAll && automod.maxEmojis) {
    const emojiRegex = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;
    const emojiCount = (message.content.match(emojiRegex) || []).length;
    if (emojiCount > automod.maxEmojis) {
      violations.push('emoji spam');
    }
  }

  // 7. Profanity scan
  if (shouldScanProfanity && automod.filterProfanity) {
    const profanityRegex = getProfanityRegex(message.guild.id, automod.profanityList);
    const match = message.content.match(profanityRegex);
    if (match) {
      violations.push('profanity');
      const matchedWord = match[0].toLowerCase();
      isSevereProfanity = SEVERE_PROFANITIES.includes(matchedWord);

      if (!dryRun) {
        if (isSevereProfanity) {
          timeoutDuration = Math.max(timeoutDuration, 3600000); // 1-hour timeout
          warnPoints = 2; // 2 warning points
        } else {
          timeoutDuration = Math.max(timeoutDuration, 300000); // 5-minute timeout
          warnPoints = 1;
        }
      }
    }
  }

  if (violations.length > 0) {
    // Delete message unless in dry-run mode
    if (!dryRun) {
      try {
        await message.delete();
      } catch (err) {
        logger.warn(`AutoMod: failed to delete message ${message.id}: ${err.message}`);
      }
    }

    const cooldownKey = `${message.guild.id}:${message.author.id}`;
    
    // Check rolling counter loophole protection: 5+ triggers in 10 minutes triggers 1 formal warning
    const now = Date.now();
    const newTriggerLog = new AutoModTrackerModel({
      guildId: message.guild.id,
      userId: message.author.id,
      type: 'rule_trigger',
      expiresAt: new Date(now + 600000)
    });
    await newTriggerLog.save();

    const triggerCount = await AutoModTrackerModel.countDocuments({
      guildId: message.guild.id,
      userId: message.author.id,
      type: 'rule_trigger'
    });

    let autoEscalated = false;
    if (triggerCount >= 5) {
      autoEscalated = true;
      // Reset the counter
      await AutoModTrackerModel.deleteMany({
        guildId: message.guild.id,
        userId: message.author.id,
        type: 'rule_trigger'
      });
    }

    // Apply punishment cooldown to prevent double-warning on simultaneous messages
    const lastPunish = client.cooldowns.get(`punish-${cooldownKey}`);
    const cooldownMs = automod.punishmentCooldown || 30000;
    
    if (!autoEscalated && lastPunish && now - lastPunish < cooldownMs) return;
    client.cooldowns.set(`punish-${cooldownKey}`, now);

    const violationReason = `AutoMod: ${violations.join(', ')}${autoEscalated ? ' (Escalated: 5+ trigger triggers)' : ''}`;

    if (dryRun) {
      logger.info(`[AutoMod Dry-Run] User ${message.author.tag} in ${message.guild.id} violated: ${violationReason}. No action taken.`);
      return;
    }

    // Determine warning points to add
    const finalPoints = autoEscalated ? 1 : warnPoints;

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

    // Check active timeout comparison: proposed timeout duration should only apply if it is longer than existing
    if (timeoutDuration > 0 && member.manageable) {
      const currentTimeoutEnd = member.communicationDisabledUntilTimestamp || 0;
      const proposedTimeoutEnd = now + timeoutDuration;
      
      if (proposedTimeoutEnd > currentTimeoutEnd) {
        await member.timeout(timeoutDuration, violationReason).catch(() => {});
      }
    }

    // Run Warning Escalations (will handle Tier durations)
    await checkWarningEscalation(message.guild, message.member, client.user, message.channel);
    await checkSecurityViolations(message.guild, message.author.id);

    const caseEntry = await createCase({
      guildId: message.guild.id,
      type: 'warn',
      targetId: message.author.id,
      targetTag: message.author.tag,
      moderatorId: client.user.id,
      moderatorTag: client.user.tag,
      reason: violationReason,
    });

    // Log to audit trail so automod actions appear alongside manual moderator actions
    await logAudit({
      guildId: message.guild.id,
      action: 'automod_violation',
      moderatorId: client.user.id,
      targetId: message.author.id,
      reason: violationReason,
      details: `Channel: #${message.channel.name} | Message ID: ${message.id} | Points: ${finalPoints}`,
    }).catch(() => {});

    try {
      const activeWarnings = await WarnModel.find({ guildId: message.guild.id, userId: message.author.id, active: true }).lean();
      const warningCount = activeWarnings.reduce((sum, w) => sum + (w.points || 1), 0);

      let dmMsg = `⚠️ **AutoMod Warning Notice**\nYour message in **${message.guild.name}** was deleted and you were warned for: **${violations.join(', ')}** (Case **#${caseEntry.caseNumber}**).\n\n**Current Warnings:** ${warningCount}/5 points\n\n*If you wish to appeal this warning, run the slash command:* \`/appeal case-id: ${caseEntry.caseNumber} reason: <your reason>\` *in the server.*`;
      if (warningCount === 1) {
        dmMsg += `\n*Note: Your next warning will result in an automatic 1-day mute!*`;
      } else if (warningCount === 4) {
        dmMsg += `\n*Note: Your next warning will result in an automatic 30-day mute!*`;
      }
      await message.author.send(dmMsg).catch(() => {});
    } catch { }
  }
}
