import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { scheduleAutoBackup } from '../../utils/backup.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logger } from '../../utils/logger.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('backup-auto')
  .setDescription('Configure automatic backups')
  .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable auto backups').setRequired(true))
  .addIntegerOption(opt => opt.setName('interval').setDescription('Interval in hours between backups').setMinValue(1).setMaxValue(168).setRequired(false))
  .addIntegerOption(opt => opt.setName('keep').setDescription('Number of backups to retain').setMinValue(1).setMaxValue(100).setRequired(false));

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to configure auto backups.')] });
  }

  const enabled = interaction.options.getBoolean('enabled');
  const interval = interaction.options.getInteger('interval');
  const keep = interaction.options.getInteger('keep');

  if (enabled && !interval) {
    return interaction.editReply({ embeds: [errorEmbed('You must specify an interval (in hours) when enabling auto backups.')] });
  }

  if (enabled && !keep) {
    return interaction.editReply({ embeds: [errorEmbed('You must specify how many backups to retain when enabling auto backups.')] });
  }

  try {
    await scheduleAutoBackup(interaction.guildId, enabled, interval || 24, keep || 10);

    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x00FF7F : 0xFF6B35)
      .setTitle(enabled ? 'Auto Backup Enabled' : 'Auto Backup Disabled')
      .setDescription(enabled
        ? `Automatic backups will run every **${interval} hour(s)**.\nUp to **${keep}** backups will be retained.`
        : 'Automatic backups have been disabled.')
      .setTimestamp();

    await logAudit({
      guildId: interaction.guildId,
      action: 'backup_auto_configure',
      moderatorId: interaction.user.id,
      details: `Enabled: ${enabled}, Interval: ${interval}h, Keep: ${keep}`,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error(`Failed to configure auto backups: ${err.message}`, err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to configure auto backups. Check bot permissions and try again.')] });
  }
}
