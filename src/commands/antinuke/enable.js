import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('antinuke-enable')
  .setDescription('Enable anti-nuke protection');

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to use this command.')] });
  }

  await GuildModel.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: { 'antiNuke.enabled': true } },
    { upsert: true }
  );

  client.eventHandler?.invalidateGuildConfig(interaction.guildId);

  await logAudit({
    guildId: interaction.guildId,
    action: 'antinuke_enable',
    moderatorId: interaction.user.id,
  });

  await interaction.editReply({ embeds: [successEmbed('Anti-nuke protection has been **enabled**.')] });
}
