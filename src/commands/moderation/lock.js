import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

function parseDuration(input) {
  const match = input.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

export const data = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Lock a channel')
  .addChannelOption(opt => opt.setName('channel').setDescription('Channel to lock').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for locking').setRequired(false))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 10m, 1h, 1d').setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage channels.')] });
  }

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.ManageChannels])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to manage channels.')] });
  }

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const durationStr = interaction.options.getString('duration');

  if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
    return interaction.editReply({ embeds: [errorEmbed('This command can only be used on text-based channels.')] });
  }

  const everyoneRole = interaction.guild.roles.everyone;

  try {
    await targetChannel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
    });
  } catch (err) {
    logger.error(`Failed to lock channel: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to lock channel. Check bot permissions and try again.')] });
  }

  let durationMs = null;
  let expiresAt = null;
  if (durationStr) {
    durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.editReply({ embeds: [errorEmbed('Invalid duration format. Use e.g. 10m, 1h, 1d.')] });
    }
    expiresAt = new Date(Date.now() + durationMs);
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'lock',
    targetId: targetChannel.id,
    targetTag: `#${targetChannel.name}`,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
    duration: durationMs,
    expiresAt,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'lock',
    moderatorId: interaction.user.id,
    targetId: targetChannel.id,
    reason,
    details: `Channel: #${targetChannel.name}${durationStr ? ` | Duration: ${durationStr}` : ''}`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  const durationMsg = durationStr ? ` for **${durationStr}**` : '';
  return interaction.editReply({ embeds: [successEmbed(`Locked **#${targetChannel.name}**${durationMsg} | Case #${caseEntry.caseNumber}`)] });
}
