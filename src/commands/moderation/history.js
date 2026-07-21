import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embed.js';
import { CaseModel } from '../../models/Case.js';

const ITEMS_PER_PAGE = 10;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('View moderation history for a user')
  .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to view history.')] });
  }

  const user = interaction.options.getUser('user', true);

  const cases = await CaseModel.find({ guildId: interaction.guildId, targetId: user.id })
    .sort({ createdAt: -1 })
    .lean();

  if (cases.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed(`No moderation history found for **${user.tag}**.`)] });
  }

  const totalPages = Math.ceil(cases.length / ITEMS_PER_PAGE);
  let currentPage = 0;

  function buildEmbed(page) {
    const start = page * ITEMS_PER_PAGE;
    const entries = cases.slice(start, start + ITEMS_PER_PAGE);

    const description = entries.map(c =>
      `**Case #${c.caseNumber}** | ${c.type.toUpperCase()}\n` +
      `Mod: ${c.moderatorTag}\n` +
      `Reason: ${c.reason || 'No reason'}\n` +
      `<t:${Math.floor(new Date(c.createdAt).getTime() / 1000)}:R>\n` +
      `${c.active ? '🟢 Active' : '🔴 Inactive'}\n`
    ).join('\n');

    return {
      embeds: [new EmbedBuilder()
        .setColor(0x00AEFF)
        .setTitle(`Moderation History — ${user.tag}`)
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1}/${totalPages} • Total cases: ${cases.length}` })
        .setTimestamp()],
    };
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(totalPages <= 1),
  );

  const reply = await interaction.editReply({ ...buildEmbed(0), components: [row] });

  if (totalPages <= 1) return;

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on('collect', async (btnInt) => {
    if (btnInt.user.id !== interaction.user.id) {
      return btnInt.reply({ content: 'You cannot interact with this.', ephemeral: true });
    }

    if (btnInt.customId === 'prev') currentPage = Math.max(0, currentPage - 1);
    if (btnInt.customId === 'next') currentPage = Math.min(totalPages - 1, currentPage + 1);

    const prevBtn = row.components[0];
    const nextBtn = row.components[1];
    prevBtn.setDisabled(currentPage === 0);
    nextBtn.setDisabled(currentPage === totalPages - 1);

    await btnInt.update({ ...buildEmbed(currentPage), components: [row] });
  });

  collector.on('end', async () => {
    const disabledRow = new ActionRowBuilder().addComponents(
      row.components[0].setDisabled(true),
      row.components[1].setDisabled(true),
    );
    await interaction.editReply({ components: [disabledRow] }).catch(() => {});
  });
}
