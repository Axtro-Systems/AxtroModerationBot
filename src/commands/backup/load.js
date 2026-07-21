import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getBackup } from '../../utils/backup.js';
import { restoreServer } from '../../utils/restore.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('backup-load')
  .setDescription('Restore a server from a backup')
  .addStringOption(opt => opt.setName('backup_id').setDescription('The backup ID to restore').setRequired(true))
  .addStringOption(opt => opt.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(true));

export const cooldown = 120000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to load a backup.')] });
  }

  const backupId = interaction.options.getString('backup_id');
  const confirm = interaction.options.getString('confirm');

  if (confirm !== 'CONFIRM') {
    return interaction.editReply({ embeds: [errorEmbed('You must type `CONFIRM` exactly to proceed with restoration.')] });
  }

  const backup = await getBackup(backupId);
  if (!backup) {
    return interaction.editReply({ embeds: [errorEmbed(`No backup found with ID \`${backupId}\`.`)] });
  }

  if (backup.guildId !== interaction.guildId) {
    return interaction.editReply({ embeds: [errorEmbed('This backup was created for a different server.')] });
  }

  const embed = new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle('⚠️ Restore Backup')
    .setDescription(`Are you sure you want to restore **${backup.name}**?\nThis will overwrite existing roles, channels, and server settings.`)
    .addFields(
      { name: 'Backup ID', value: `\`${backup.backupId}\``, inline: true },
      { name: 'Created', value: `<t:${Math.floor(new Date(backup.createdAt).getTime() / 1000)}:R>`, inline: true },
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('confirm_restore').setLabel('Restore').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_restore').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const filter = i => i.user.id === interaction.user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

  collector.on('collect', async i => {
    if (i.customId === 'cancel_restore') {
      return i.update({ embeds: [errorEmbed('Restoration cancelled.')], components: [] });
    }

    await i.update({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription('Restoring backup...')], components: [] });

    try {
      const results = await restoreServer(interaction.guild, backup.snapshot, true);

      const resultEmbed = new EmbedBuilder()
        .setColor(0x00FF7F)
        .setTitle('Backup Restored')
        .setDescription(`Successfully restored **${backup.name}**`)
        .addFields(
          { name: 'Roles', value: `Created: ${results.roles.created}\nUpdated: ${results.roles.updated}\nDeleted: ${results.roles.deleted}`, inline: true },
          { name: 'Channels', value: `Created: ${results.channels.created}\nUpdated: ${results.channels.updated}\nDeleted: ${results.channels.deleted}`, inline: true },
        );

      if (results.errors.length > 0) {
        resultEmbed.addFields({
          name: 'Errors',
          value: results.errors.slice(0, 5).map(e => `• ${e}`).join('\n') + (results.errors.length > 5 ? `\n...and ${results.errors.length - 5} more` : ''),
        });
      }

      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    } catch (err) {
      logger.error(`Restoration failed: ${err.message}`, err);
      await interaction.editReply({ embeds: [errorEmbed('Restoration failed. Check bot permissions and try again.')], components: [] });
    }
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time' && collected.size === 0) {
      interaction.editReply({ embeds: [errorEmbed('Restoration timed out.')], components: [] }).catch(() => {});
    }
  });
}
