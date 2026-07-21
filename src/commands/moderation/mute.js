import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

function parseDuration(input) {
  const match = input.match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return value * multipliers[unit];
}

export const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Timeout a user for a specified duration')
  .addUserOption(opt => opt.setName('user').setDescription('User to mute').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 10m, 1h, 1d').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the mute').setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.mute)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to moderate members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const durationStr = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid duration format. Use e.g. 10m, 1h, 1d.')] });
  }

  if (durationMs < 10000) {
    return interaction.editReply({ embeds: [errorEmbed('Duration must be at least 10 seconds.')] });
  }

  if (durationMs > 2419200000) {
    return interaction.editReply({ embeds: [errorEmbed('Duration cannot exceed 28 days (Discord limit).')] });
  }

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.ModerateMembers])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to timeout members.')] });
  }

  const targetMember = interaction.options.getMember('user') || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
  }

  if (!canActOnMember(interaction.member, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot mute this user.')] });
  }

  if (!canActOnMember(interaction.guild.members.me, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('I cannot mute this user due to role hierarchy.')] });
  }

  try {
    await targetMember.timeout(durationMs, reason);
  } catch (err) {
    logger.error(`Failed to mute user: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to mute user. Check bot permissions and try again.')] });
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'tempmute',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
    duration: durationMs,
    expiresAt: new Date(Date.now() + durationMs),
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'mute',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
    details: `Duration: ${durationStr}`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Muted **${targetUser.tag}** for **${durationStr}** | Case #${caseEntry.caseNumber}`)] });
}
