import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import mongoose from 'mongoose';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { WarnModel } from '../../models/Warn.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('delwarn')
  .setDescription('Remove a warning by its ID')
  .addStringOption(opt => opt.setName('warning_id').setDescription('The warning ID to delete').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing the warning').setRequired(false));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage warnings.')] });
  }

  const warnId = interaction.options.getString('warning_id', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  if (!mongoose.Types.ObjectId.isValid(warnId)) {
    return interaction.editReply({ embeds: [errorEmbed('Invalid warning ID format.')] });
  }

  const warn = await WarnModel.findById(warnId);
  if (!warn || warn.guildId !== interaction.guildId) {
    return interaction.editReply({ embeds: [errorEmbed('Warning not found.')] });
  }

  if (!warn.active) {
    return interaction.editReply({ embeds: [errorEmbed('This warning has already been removed.')] });
  }

  warn.active = false;
  await warn.save();

  const targetUser = await interaction.client.users.fetch(warn.userId).catch(() => null);

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'note',
    targetId: warn.userId,
    targetTag: targetUser?.tag || warn.userId,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: `Warning removed | Original warn #${warn.caseNumber || '?'} | ${warn.reason || ''} | Reason: ${reason}`,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'delwarn',
    moderatorId: interaction.user.id,
    targetId: warn.userId,
    reason,
    details: `Removed warn #${warn.caseNumber || '?'} (${warn._id})`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Removed warning #${warn.caseNumber || '?'} | Case #${caseEntry.caseNumber}`)] });
}
