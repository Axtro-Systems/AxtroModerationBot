import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('antinuke-disable')
  .setDescription('Disable anti-nuke protection');

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to use this command.')] });
  }

  const confirm = new ButtonBuilder()
    .setCustomId('antinuke_disable_confirm')
    .setLabel('Confirm Disable')
    .setStyle(ButtonStyle.Danger);

  const cancel = new ButtonBuilder()
    .setCustomId('antinuke_disable_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirm, cancel);

  const reply = await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('Confirm Disable')
        .setDescription('Are you sure you want to disable anti-nuke protection? This will leave the server vulnerable to raids.')
        .setTimestamp(),
    ],
    components: [row],
  });

  const filter = i => i.user.id === interaction.user.id;
  const collected = await reply.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

  if (!collected) {
    return interaction.editReply({
      embeds: [errorEmbed('Confirmation timed out.')],
      components: [],
    });
  }

  await collected.deferUpdate();

  if (collected.customId === 'antinuke_disable_cancel') {
    return interaction.editReply({
      embeds: [errorEmbed('Cancelled. Anti-nuke remains **enabled**.')],
      components: [],
    });
  }

  await GuildModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: { 'antiNuke.enabled': false } },
    { upsert: true }
  );

  client.eventHandler?.invalidateGuildConfig(interaction.guildId);

  await logAudit({
    guildId: interaction.guildId,
    action: 'antinuke_disable',
    moderatorId: interaction.user.id,
  });

  await interaction.editReply({
    embeds: [successEmbed('Anti-nuke protection has been **disabled**.')],
    components: [],
  });
}
