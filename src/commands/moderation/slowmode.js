import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('slowmode')
  .setDescription('Set slowmode on a channel')
  .addIntegerOption(opt => opt.setName('seconds').setDescription('Slowmode duration (0-21600 seconds)').setMinValue(0).setMaxValue(21600).setRequired(true))
  .addChannelOption(opt => opt.setName('channel').setDescription('Channel to set slowmode on').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia).setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage channels.')] });
  }

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.ManageChannels])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to manage channels.')] });
  }

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const seconds = interaction.options.getInteger('seconds', true);

  if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
    return interaction.editReply({ embeds: [errorEmbed('Slowmode can only be set on text-based channels.')] });
  }

  try {
    await targetChannel.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Failed to set slowmode: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to set slowmode. Check bot permissions and try again.')] });
  }

  await logAudit({
    guildId: interaction.guildId,
    action: 'slowmode',
    moderatorId: interaction.user.id,
    targetId: targetChannel.id,
    reason: `Set to ${seconds}s`,
    details: `Channel: #${targetChannel.name}`,
  });

  const duration = seconds > 0 ? `set to **${seconds}** second(s)` : 'disabled';
  return interaction.editReply({ embeds: [successEmbed(`Slowmode ${duration} in **#${targetChannel.name}**`)] });
}
