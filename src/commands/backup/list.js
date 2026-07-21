import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { listBackups } from '../../utils/backup.js';
import { errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('backup-list')
  .setDescription('List all backups for this server');

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions to view backups.')] });
  }

  let currentPage = 0;
  const { backups, total, totalPages } = await listBackups(interaction.guildId, currentPage);

  if (total === 0) {
    return interaction.editReply({ embeds: [errorEmbed('No backups found for this server.')] });
  }

  const generateEmbed = (page) => {
    const start = page * 10;
    const pageBackups = backups.slice(start, start + 10);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Server Backups')
      .setDescription(pageBackups.map(b =>
        `**${b.name}**\nID: \`${b.backupId}\`\nCreator: <@${b.createdBy}> | <t:${Math.floor(new Date(b.createdAt).getTime() / 1000)}:R>${b.autoTriggered ? ' | 🔄 Auto' : ''}`
      ).join('\n\n'))
      .setFooter({ text: `Page ${page + 1} / ${totalPages} | Total backups: ${total}` });

    return embed;
  };

  const canPrevious = currentPage > 0;
  const canNext = currentPage < totalPages - 1;

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('prev_page').setLabel('◀ Previous').setStyle(ButtonStyle.Primary).setDisabled(!canPrevious),
      new ButtonBuilder().setCustomId('next_page').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(!canNext),
    );

  const msg = await interaction.editReply({ embeds: [generateEmbed(currentPage)], components: [row] });

  const filter = i => i.user.id === interaction.user.id;
  const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

  collector.on('collect', async i => {
    if (i.customId === 'prev_page' && currentPage > 0) {
      currentPage--;
    } else if (i.customId === 'next_page' && currentPage < totalPages - 1) {
      currentPage++;
    } else {
      return i.deferUpdate();
    }

    const { backups: newBackups } = await listBackups(interaction.guildId, currentPage);
    backups.length = 0;
    backups.push(...newBackups);

    const canPrev = currentPage > 0;
    const canNxt = currentPage < totalPages - 1;

    const newRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('prev_page').setLabel('◀ Previous').setStyle(ButtonStyle.Primary).setDisabled(!canPrev),
        new ButtonBuilder().setCustomId('next_page').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(!canNxt),
      );

    await i.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
  });

  collector.on('end', () => {
    const disabledRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('prev_page').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('next_page').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
    interaction.editReply({ components: [disabledRow] }).catch(() => {});
  });
}
