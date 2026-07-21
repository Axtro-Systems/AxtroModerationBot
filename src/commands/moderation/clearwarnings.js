import { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { WarnModel } from '../../models/Warn.js';

export const data = new SlashCommandBuilder()
  .setName('clearwarnings')
  .setDescription('Clear all active warnings for a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to clear warnings for').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for clearing warnings').setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage warnings.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  const count = await WarnModel.countDocuments({ guildId: interaction.guildId, userId: targetUser.id, active: true });

  if (count === 0) {
    return interaction.editReply({ embeds: [successEmbed(`**${targetUser.tag}** has no active warnings.`)] });
  }

  const confirmBtn = new ButtonBuilder()
    .setCustomId('confirm')
    .setLabel(`Yes, clear ${count} warning(s)`)
    .setStyle(ButtonStyle.Danger);

  const cancelBtn = new ButtonBuilder()
    .setCustomId('cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

  const msg = await interaction.editReply({
    embeds: [successEmbed(`Are you sure you want to clear all **${count}** warning(s) for **${targetUser.tag}**?`)],
    components: [row],
  });

  const filter = i => i.user.id === interaction.user.id && ['confirm', 'cancel'].includes(i.customId);
  const collected = await msg.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

  if (!collected) {
    confirmBtn.setDisabled(true);
    cancelBtn.setDisabled(true);
    return interaction.editReply({ embeds: [errorEmbed('Confirmation timed out.')], components: [] });
  }

  if (collected.customId === 'cancel') {
    confirmBtn.setDisabled(true);
    cancelBtn.setDisabled(true);
    return collected.update({ embeds: [errorEmbed('Cancelled.')], components: [] });
  }

  await WarnModel.updateMany(
    { guildId: interaction.guildId, userId: targetUser.id, active: true },
    { active: false }
  );

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'note',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: `Cleared ${count} warning(s) | ${reason}`,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'clearwarnings',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
    details: `Cleared ${count} warnings`,
  });

  confirmBtn.setDisabled(true);
  cancelBtn.setDisabled(true);

  await collected.update({ embeds: [successEmbed(`Cleared **${count}** warning(s) for **${targetUser.tag}** | Case #${caseEntry.caseNumber}`)], components: [] });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }
}
