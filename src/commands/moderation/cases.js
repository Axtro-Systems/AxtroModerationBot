import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time, TimestampStyles } from 'discord.js';
import { checkPermissions } from '../../utils/permissions.js';
import { CaseModel } from '../../models/Case.js';
import { paginatedEmbed, errorEmbed } from '../../utils/embed.js';

export const data = new SlashCommandBuilder()
  .setName('cases')
  .setDescription('View case history for a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to look up').setRequired(true))
  .addStringOption(opt => opt.setName('type').setDescription('Filter by case type').setRequired(false))
  .addIntegerOption(opt => opt.setName('page').setDescription('Page number').setMinValue(1).setRequired(false));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have staff permissions.')] });
  }

  const user = interaction.options.getUser('user', true);
  const typeFilter = interaction.options.getString('type');
  const pageInput = interaction.options.getInteger('page') || 1;

  const filter = { guildId: interaction.guildId, targetId: user.id };
  if (typeFilter) filter.type = typeFilter.toLowerCase();

  const cases = await CaseModel.find(filter).sort({ caseNumber: -1 }).lean();
  if (cases.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed(`No cases found for ${user.tag}.`)] });
  }

  const perPage = 10;
  const totalPages = Math.ceil(cases.length / perPage);
  let page = Math.min(Math.max(pageInput, 1), totalPages);

  const formatFn = c => {
    const status = c.active ? '🟢' : '🔴';
    const date = time(new Date(c.createdAt), TimestampStyles.ShortDate);
    return `**#${c.caseNumber}** ${status} \`${c.type}\` — ${c.reason || 'No reason'} (${date})`;
  };

  const embed = paginatedEmbed(cases, page - 1, totalPages, `Case History — ${user.tag}`, formatFn);

  if (totalPages <= 1) {
    return interaction.editReply({ embeds: [embed] });
  }

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('◀')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 1),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages),
    );

  const msg = await interaction.editReply({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({ time: 60000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'You cannot interact with this pagination.', ephemeral: true });
    }

    if (i.customId === 'prev') page = Math.max(page - 1, 1);
    else if (i.customId === 'next') page = Math.min(page + 1, totalPages);

    const newEmbed = paginatedEmbed(cases, page - 1, totalPages, `Case History — ${user.tag}`, formatFn);

    const newRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('◀')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages),
      );

    await i.update({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on('end', async () => {
    try {
      await msg.edit({ components: [] });
    } catch { }
  });
}
