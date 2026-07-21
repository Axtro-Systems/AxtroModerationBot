import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, closeActiveCases, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Remove a timeout from a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to unmute').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unmute').setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.mute)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to moderate members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.ModerateMembers])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to timeout members.')] });
  }

  const targetMember = interaction.options.getMember('user') || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
  }

  if (!canActOnMember(interaction.member, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot unmute this user.')] });
  }

  if (!canActOnMember(interaction.guild.members.me, targetMember)) {
    return interaction.editReply({ embeds: [errorEmbed('I cannot unmute that user — their highest role is above mine.')] });
  }

  if (!targetMember.isCommunicationDisabled()) {
    return interaction.editReply({ embeds: [errorEmbed('That user is not muted.')] });
  }

  try {
    await targetMember.timeout(null, reason);
  } catch (err) {
    logger.error(`Failed to unmute user: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to unmute user. Check bot permissions and try again.')] });
  }

  await closeActiveCases(interaction.guildId, targetUser.id, 'tempmute');

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'unmute',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'unmute',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Unmuted **${targetUser.tag}** | Case #${caseEntry.caseNumber}`)] });
}
