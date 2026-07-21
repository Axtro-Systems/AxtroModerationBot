import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getBackup } from '../../utils/backup.js';
import { errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('backup-info')
  .setDescription('View detailed information about a backup')
  .addStringOption(opt => opt.setName('backup_id').setDescription('The backup ID to inspect').setRequired(true));

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to view backup info.')] });
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
    .setColor(0x5865F2)
    .setTitle(`Backup: ${backup.name}`)
    .addFields(
      { name: 'Backup ID', value: `\`${backup.backupId}\``, inline: false },
      { name: 'Created By', value: `<@${backup.createdBy}>`, inline: true },
      { name: 'Created At', value: `<t:${Math.floor(new Date(backup.createdAt).getTime() / 1000)}:F>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: false },
      { name: 'Snapshot Summary', value: [
        `Roles: ${backup.snapshot.roles.length}`,
        `Channels: ${backup.snapshot.channels.length}`,
        `Emojis: ${backup.snapshot.emojis.length}`,
        `Stickers: ${backup.snapshot.stickers.length}`,
        `Bans: ${backup.snapshot.bans.length}`,
        `Webhooks: ${backup.snapshot.webhooks.length}`,
      ].join('\n'), inline: true },
      { name: 'Server Info', value: [
        `Name: ${backup.snapshot.name || 'N/A'}`,
        `Verification Level: ${backup.snapshot.verificationLevel ?? 'N/A'}`,
        `Explicit Filter: ${backup.snapshot.explicitContentFilter ?? 'N/A'}`,
      ].join('\n'), inline: true },
    );

  if (backup.autoTriggered) {
    embed.addFields({ name: 'Auto Backup', value: `Triggered: ${backup.triggerReason || 'Scheduled'}`, inline: false });
  }

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
