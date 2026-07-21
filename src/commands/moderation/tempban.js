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
  .setName('tempban')
  .setDescription('Temporarily ban a user from the server')
  .addUserOption(opt => opt.setName('user').setDescription('User to tempban').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 1d, 2h, 30m').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the tempban').setRequired(false));

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to ban members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const durationStr = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid duration format. Use e.g. 1d, 2h, 30m, 10s, 2w.')] });
  }

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.BanMembers])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to ban members.')] });
  }

  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
    if (!canActOnMember(interaction.member, targetMember)) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot ban this user.')] });
    }
    if (!canActOnMember(interaction.guild.members.me, targetMember)) {
      return interaction.editReply({ embeds: [errorEmbed('I cannot ban this user due to role hierarchy.')] });
    }
  } catch {
    
  }

  const expiresAt = new Date(Date.now() + durationMs);

  try {
    await interaction.guild.bans.create(targetUser.id, { reason: `Tempban by ${interaction.user.tag}: ${reason} (expires ${expiresAt.toISOString()})` });
  } catch (err) {
    logger.error(`Failed to tempban user: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to tempban user. Check bot permissions and try again.')] });
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'tempban',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
    duration: durationMs,
    expiresAt,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'tempban',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
    details: `Duration: ${durationStr}, Expires: ${expiresAt.toISOString()}`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Tempbanned **${targetUser.tag}** for **${durationStr}** | Case #${caseEntry.caseNumber}`)] });
}
