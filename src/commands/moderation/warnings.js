import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { modLogEmbed, successEmbed, errorEmbed, paginatedEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { WarnModel } from '../../models/Warn.js';

export const data = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('List warnings for a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true));

export const cooldown = 2000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to view warnings.')] });
  }

  const targetUser = interaction.options.getUser('user', true);

  const warnings = await WarnModel.find({ guildId: interaction.guildId, userId: targetUser.id, active: true }).sort({ createdAt: -1 });

  if (warnings.length === 0) {
    return interaction.editReply({ embeds: [successEmbed(`**${targetUser.tag}** has no active warnings.`)] });
  }

  const totalPages = Math.ceil(warnings.length / 10);
  let currentPage = 0;

  const formatFn = (w, i) =>
    `\`#${w.caseNumber || '?'}\` **${w.reason || 'No reason'}** — <t:${Math.floor(new Date(w.createdAt).getTime() / 1000)}:R> by ${w.moderatorTag || 'Unknown'}`;

  const embed = paginatedEmbed(warnings, currentPage, totalPages, `Warnings for ${targetUser.tag}`, formatFn);

  const prevBtn = new ButtonBuilder()
    .setCustomId('prev')
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId('next')
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(totalPages <= 1);

  const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

  const msg = await interaction.editReply({ embeds: [embed], components: [row] });

  if (totalPages <= 1) return;

  const filter = i => i.user.id === interaction.user.id && ['prev', 'next'].includes(i.customId);
  const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

  collector.on('collect', async i => {
    if (i.customId === 'next') {
      currentPage = Math.min(currentPage + 1, totalPages - 1);
    } else {
      currentPage = Math.max(currentPage - 1, 0);
    }

    const pageEmbed = paginatedEmbed(warnings, currentPage, totalPages, `Warnings for ${targetUser.tag}`, formatFn);

    prevBtn.setDisabled(currentPage === 0);
    nextBtn.setDisabled(currentPage === totalPages - 1);

    await i.update({ embeds: [pageEmbed], components: [new ActionRowBuilder().addComponents(prevBtn, nextBtn)] });
  });

  collector.on('end', async () => {
    prevBtn.setDisabled(true);
    nextBtn.setDisabled(true);
    await msg.edit({ components: [new ActionRowBuilder().addComponents(prevBtn, nextBtn)] }).catch(() => null);
  });
}
