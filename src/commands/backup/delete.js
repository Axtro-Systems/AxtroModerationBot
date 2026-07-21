import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getBackup, deleteBackup } from '../../utils/backup.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('backup-delete')
  .setDescription('Delete a backup')
  .addStringOption(opt => opt.setName('backup_id').setDescription('The backup ID to delete').setRequired(true));

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to delete backups.')] });
  }

  const backupId = interaction.options.getString('backup_id');

  const backup = await getBackup(backupId);
  if (!backup) {
    return interaction.editReply({ embeds: [errorEmbed(`No backup found with ID \`${backupId}\`.`)] });
  }

  if (backup.guildId !== interaction.guildId) {
    return interaction.editReply({ embeds: [errorEmbed('This backup belongs to a different server.')] });
  }

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('Delete Backup')
    .setDescription(`Are you sure you want to delete **${backup.name}**?`)
    .addFields(
      { name: 'Backup ID', value: `\`${backup.backupId}\``, inline: true },
      { name: 'Created', value: `<t:${Math.floor(new Date(backup.createdAt).getTime() / 1000)}:R>`, inline: true },
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('confirm_delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_delete').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const filter = i => i.user.id === interaction.user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

  collector.on('collect', async i => {
    if (i.customId === 'cancel_delete') {
      return i.update({ embeds: [errorEmbed('Deletion cancelled.')], components: [] });
    }

    try {
      const result = await deleteBackup(backupId, interaction.guildId);
      if (result) {
        await i.update({ embeds: [successEmbed(`Backup **${backup.name}** (${backupId}) has been deleted.`)], components: [] });
      } else {
        await i.update({ embeds: [errorEmbed('Failed to delete backup. It may have already been removed.')], components: [] });
      }
    } catch (err) {
      logger.error(`Failed to delete backup: ${err.message}`, err);
      await i.update({ embeds: [errorEmbed('Failed to delete backup. Check bot permissions and try again.')], components: [] });
    }
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time' && collected.size === 0) {
      interaction.editReply({ embeds: [errorEmbed('Deletion timed out.')], components: [] }).catch(() => {});
    }
  });
}
