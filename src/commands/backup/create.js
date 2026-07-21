import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { createBackup } from '../../utils/backup.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('backup-create')
  .setDescription('Create a full server backup')
  .addStringOption(opt => opt.setName('name').setDescription('Name for the backup').setRequired(false));

export const cooldown = 60000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to create a backup.')] });
  }

  const name = interaction.options.getString('name');

  try {
    const backup = await createBackup(interaction.guild, interaction.user.id, name);

    const embed = new EmbedBuilder()
      .setColor(0x00FF7F)
      .setTitle('Backup Created')
      .setDescription(`Successfully created backup **${backup.name}**`)
      .addFields(
        { name: 'Backup ID', value: `\`${backup.backupId}\``, inline: false },
        { name: 'Server Snapshot', value: [
          `Roles: ${backup.snapshot.roles.length}`,
          `Channels: ${backup.snapshot.channels.length}`,
          `Emojis: ${backup.snapshot.emojis.length}`,
          `Stickers: ${backup.snapshot.stickers.length}`,
          `Bans: ${backup.snapshot.bans.length}`,
          `Webhooks: ${backup.snapshot.webhooks.length}`,
        ].join('\n'), inline: true },
        { name: 'Creator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date', value: `<t:${Math.floor(backup.createdAt.getTime() / 1000)}:F>`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error(`Failed to create backup: ${err.message}`, err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to create backup. Check bot permissions and try again.')] });
  }
}
