import { SlashCommandBuilder } from 'discord.js';
import { checkPermissions, isAdmin } from '../../utils/permissions.js';
import { CaseModel } from '../../models/Case.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('case')
  .setDescription('Manage moderation cases')
  .addSubcommand(sub => sub
    .setName('view')
    .setDescription('View a specific case')
    .addIntegerOption(opt => opt.setName('number').setDescription('Case number').setMinValue(1).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('edit')
    .setDescription('Edit the reason on a case')
    .addIntegerOption(opt => opt.setName('number').setDescription('Case number').setMinValue(1).setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('New reason').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('delete')
    .setDescription('Soft-delete a case')
    .addIntegerOption(opt => opt.setName('number').setDescription('Case number').setMinValue(1).setRequired(true)));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have staff permissions.')] });
  }

  const subcommand = interaction.options.getSubcommand();
  const caseNumber = interaction.options.getInteger('number', true);

  if (subcommand === 'view') {
    const caseEntry = await CaseModel.findOne({ guildId: interaction.guildId, caseNumber, deleted: { $ne: true } });
    if (!caseEntry) {
      return interaction.editReply({ embeds: [errorEmbed(`Case #${caseNumber} not found.`)] });
    }
    const embed = modLogEmbed(caseEntry.toObject());
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'edit') {
    if (!await isAdmin(interaction)) {
      return interaction.editReply({ embeds: [errorEmbed('Only admins can edit cases.')] });
    }
    const newReason = interaction.options.getString('reason', true);
    const caseEntry = await CaseModel.findOneAndUpdate(
      { guildId: interaction.guildId, caseNumber, deleted: { $ne: true } },
      { reason: newReason },
      { new: true }
    );
    if (!caseEntry) {
      return interaction.editReply({ embeds: [errorEmbed(`Case #${caseNumber} not found.`)] });
    }
    await logAudit({
      guildId: interaction.guildId,
      action: 'case_edit',
      moderatorId: interaction.user.id,
      targetId: caseEntry.targetId,
      reason: `Edited case #${caseNumber}: ${newReason}`,
    });
    return interaction.editReply({ embeds: [successEmbed(`Case #${caseNumber} reason updated.`)] });
  }

  if (subcommand === 'delete') {
    if (!await isAdmin(interaction)) {
      return interaction.editReply({ embeds: [errorEmbed('Only admins can delete cases.')] });
    }
    const caseEntry = await CaseModel.findOneAndUpdate(
      { guildId: interaction.guildId, caseNumber },
      { deleted: true },
      { new: true }
    );
    if (!caseEntry) {
      return interaction.editReply({ embeds: [errorEmbed(`Case #${caseNumber} not found.`)] });
    }
    await logAudit({
      guildId: interaction.guildId,
      action: 'case_delete',
      moderatorId: interaction.user.id,
      targetId: caseEntry.targetId,
      reason: `Deleted case #${caseNumber}`,
    });
    return interaction.editReply({ embeds: [successEmbed(`Case #${caseNumber} has been deleted.`)] });
  }
}
