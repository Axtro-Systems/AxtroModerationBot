import { WarnModel } from '../models/Warn.js';
import { AntiNukeModel } from '../models/AntiNuke.js';
import { GuildModel } from '../models/Guild.js';
import { StrikeModel } from '../models/Strike.js';
import { PermissionFlagsBits } from 'discord.js';
import { createCase } from './caseUtils.js';
import { logger } from './logger.js';
import { createUnifiedModEmbed } from './modLogEmbed.js';

/**
 * Checks and handles the warning escalation system.
 * Tiers:
 * - 2 warnings: 1-day timeout
 * - 3 warnings: 6-hour timeout
 * - 4 warnings: 3-day timeout
 * - 5 warnings: 28-day timeout (Discord cap). Reset counter to 0/5 + Strike +1.
 * - 2nd strike (strikes >= 2): Ban the user.
 */
export async function checkWarningEscalation(guild, member, moderatorUser, channel = null) {
  try {
    const activeWarnings = await WarnModel.find({ guildId: guild.id, userId: member.id, active: true }).lean();
    const activePoints = activeWarnings.reduce((sum, w) => sum + (w.points || 1), 0);

    if (!member.manageable) {
      logger.info(`Warning escalation skipped for ${member.user.tag} (ID: ${member.id}) because they are not manageable (owner or higher hierarchy).`);
      return null;
    }

    const guildConfig = await GuildModel.findOne({ guildId: guild.id }) || {};
    const tiers = guildConfig.warningTiers || {
      tier2Duration: 86400000,   // 1 day
      tier3Duration: 21600000,   // 6 hours
      tier4Duration: 259200000,  // 3 days
      tier5Duration: 2419200000  // 28 days
    };

    let tierApplied = 0;
    let tierDuration = 0;
    let tierName = '';

    // Descending checks to handle point jumps (overshoots) cleanly
    if (activePoints >= 5) {
      tierApplied = 5;
      tierDuration = tiers.tier5Duration ?? 2419200000;
      tierName = 'Tier 5';
    } else if (activePoints >= 4) {
      tierApplied = 4;
      tierDuration = tiers.tier4Duration ?? 259200000;
      tierName = 'Tier 4';
    } else if (activePoints >= 3) {
      tierApplied = 3;
      tierDuration = tiers.tier3Duration ?? 21600000;
      tierName = 'Tier 3';
    } else if (activePoints >= 2) {
      tierApplied = 2;
      tierDuration = tiers.tier2Duration ?? 86400000;
      tierName = 'Tier 2';
    }

    if (tierApplied > 0) {
      const now = Date.now();
      const currentTimeoutEnd = member.communicationDisabledUntilTimestamp || 0;
      const proposedTimeoutEnd = now + tierDuration;

      // Only apply if the proposed timeout duration is longer than the active one
      if (proposedTimeoutEnd > currentTimeoutEnd) {
        await member.timeout(tierDuration, `Warning escalation: Reached ${tierName} threshold (${activePoints} points)`);
      }

      // Create case log
      const muteCase = await createCase({
        guildId: guild.id,
        type: 'tempmute',
        targetId: member.id,
        targetTag: member.user.tag,
        moderatorId: moderatorUser.id,
        moderatorTag: moderatorUser.tag,
        reason: `Reached Warning ${tierName} threshold (${activePoints} points). Automatic mute.`,
        duration: tierDuration,
        expiresAt: new Date(now + tierDuration),
      });

      // Send to unified mod-log
      await sendModLog(guild, muteCase, 'timeout');

      // Send public warning notice in the chat
      if (channel?.isTextBased()) {
        const publicEmbed = createUnifiedModEmbed({
          title: '🔇 Warning Escalation Mute',
          description: `**${member.user.tag}** has been automatically muted for **${formatDuration(tierDuration)}** (Warning ${tierName} reached).`,
          colorType: 'timeout'
        });
        await channel.send({ embeds: [publicEmbed] }).catch(() => {});
      }

      // Send DM to user
      try {
        const userEmbed = createUnifiedModEmbed({
          title: `Muted in ${guild.name}`,
          description: `You have been automatically muted for **${formatDuration(tierDuration)}** because you reached warning **${tierName}** (${activePoints} points).`,
          colorType: 'timeout'
        });
        await member.send({ embeds: [userEmbed] }).catch(() => {});
      } catch {}

      // Tier 5 Specific: Increment strikes, reset warnings, check strike ban limit
      if (tierApplied === 5) {
        // Upsert strikes securely using findOneAndUpdate to avoid race conditions
        const strikeDoc = await StrikeModel.findOneAndUpdate(
          { guildId: guild.id, userId: member.id },
          { $inc: { strikes: 1 } },
          { upsert: true, new: true }
        );

        // Reset active warnings count
        await WarnModel.updateMany(
          { guildId: guild.id, userId: member.id, active: true },
          { $set: { active: false } }
        );

        if (strikeDoc.strikes >= 2) {
          // Ban attacker immediately!
          const botMember = guild.members.me;
          if (botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            await guild.bans.create(member.id, { deleteMessageSeconds: 86400, reason: `Warning escalation: Reached Strike Limit (2/2)` }).catch(() => {});
            
            const banCase = await createCase({
              guildId: guild.id,
              type: 'ban',
              targetId: member.id,
              targetTag: member.user.tag,
              moderatorId: moderatorUser.id,
              moderatorTag: moderatorUser.tag,
              reason: `Reached Strike Limit (2/2). Permanent Ban.`,
            });
            await sendModLog(guild, banCase, 'ban');

            if (channel?.isTextBased()) {
              const publicBanEmbed = createUnifiedModEmbed({
                title: '🔨 Permanent Ban',
                description: `**${member.user.tag}** has reached **2 strikes** (two Tier-5 warning milestones) and has been permanently banned!`,
                colorType: 'ban'
              });
              await channel.send({ embeds: [publicBanEmbed] }).catch(() => {});
            }
          }
          return `banned (strike limit 2/2 reached)`;
        }
        return `muted for ${formatDuration(tierDuration)} and issued a strike (1/2 strikes)`;
      }

      return `muted for ${formatDuration(tierDuration)} (${activePoints}/5 warning points reached)`;
    }
  } catch (err) {
    logger.error(`Failed warning escalation for ${member.id}: ${err.message}`);
  }
  return null;
}

async function sendModLog(guild, caseEntry, colorType) {
  try {
    const guildConfig = await GuildModel.findOne({ guildId: guild.id });
    const logChannelId = guildConfig?.modLogChannel || guildConfig?.auditChannel;
    if (logChannelId) {
      const logChannel = guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const fields = [
          { name: 'Target', value: `<@${caseEntry.targetId}> (\`${caseEntry.targetId}\`)`, inline: true },
          { name: 'Moderator', value: `<@${caseEntry.moderatorId}>`, inline: true },
          { name: 'Reason', value: caseEntry.reason, inline: false },
        ];
        if (caseEntry.duration) {
          fields.push({ name: 'Duration', value: formatDuration(caseEntry.duration), inline: true });
        }
        const embed = createUnifiedModEmbed({
          title: `Case #${caseEntry.caseNumber} | ${caseEntry.type.toUpperCase()}`,
          description: `Action applied automatically by warning escalation.`,
          colorType,
          fields
        });
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch {}
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Runs warning decay logic. Checks warning documents against guild-specific thresholds
 * and sets active to false for expired ones.
 */
export async function runWarningDecay(client) {
  try {
    const guilds = await GuildModel.find({}).lean();
    for (const g of guilds) {
      const decayDays = g.antiRaid?.decayDays || 14;
      const cutoff = new Date(Date.now() - decayDays * 24 * 60 * 60 * 1000);
      const expiredCount = await WarnModel.countDocuments({
        guildId: g.guildId,
        active: true,
        createdAt: { $lte: cutoff }
      });
      if (expiredCount > 0) {
        await WarnModel.updateMany(
          { guildId: g.guildId, active: true, createdAt: { $lte: cutoff } },
          { $set: { active: false } }
        );
        logger.info(`Decayed ${expiredCount} warnings in guild ${g.guildId}.`);
      }
    }
  } catch (err) {
    logger.error(`runWarningDecay error: ${err.message}`);
  }
}

/**
 * Checks if a user has flagged security systems (AutoMod / AntiNuke) and been punished > 3 times.
 * If so, logs a report alert to the log/audit channel.
 */
export async function checkSecurityViolations(guild, userId) {
  try {
    const guildConfig = await GuildModel.findOne({ guildId: guild.id });
    const logChannelId = guildConfig?.auditChannel || guildConfig?.modLogChannel;
    if (!logChannelId) return;

    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const automodCount = await WarnModel.countDocuments({
      guildId: guild.id,
      userId,
      reason: /^AutoMod:/
    });

    const antinukeCount = await AntiNukeModel.countDocuments({
      guildId: guild.id,
      userId,
      flagged: true
    });

    const totalPunishments = automodCount + antinukeCount;

    if (totalPunishments > 3) {
      const embed = createUnifiedModEmbed({
        title: '🚨 Critical Security Alert: Repeated Violator',
        description: `User <@${userId}> has triggered bot security filters and been punished multiple times.`,
        colorType: 'antinuke',
        fields: [
          { name: 'User', value: `<@${userId}> (\`${userId}\`)`, inline: true },
          { name: 'Total Security Punishments', value: `**${totalPunishments}**`, inline: true },
          { name: 'Breakdown', value: `- AutoMod Violations: \`${automodCount}\`\n- Anti-Nuke Triggers: \`${antinukeCount}\``, inline: false }
        ]
      });

      await logChannel.send({ embeds: [embed] }).catch(() => {});
      logger.warn(`Security alert: User ${userId} has >3 security punishments in guild ${guild.id}. Alert logged.`);
    }
  } catch (err) {
    logger.error(`checkSecurityViolations error for ${userId}: ${err.message}`);
  }
}
