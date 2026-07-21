import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('nuke')
  .setDescription('Clone and delete a channel (nuke it)')
  .addStringOption(opt => opt.setName('confirm').setDescription('Type the channel name to confirm').setRequired(true))
  .addChannelOption(opt => opt.setName('channel').setDescription('Channel to nuke').setRequired(false));

export const cooldown = 10000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage channels.')] });
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to manage channels.')] });
  }

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const confirm = interaction.options.getString('confirm', true);

  if (confirm !== targetChannel.name) {
    return interaction.editReply({ embeds: [errorEmbed('Confirmation does not match the channel name.')] });
  }

  if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
    return interaction.editReply({ embeds: [errorEmbed('Only text-based channels can be nuked.')] });
  }

  const channelData = {
    name: targetChannel.name,
    type: targetChannel.type,
    topic: targetChannel.topic,
    nsfw: targetChannel.nsfw,
    rateLimitPerUser: targetChannel.rateLimitPerUser,
    parent: targetChannel.parentId,
    position: targetChannel.position,
    permissionOverwrites: targetChannel.permissionOverwrites.cache.map(o => ({
      id: o.id,
      allow: o.allow.bitfield,
      deny: o.deny.bitfield,
      type: o.type,
    })),
  };

  try {
    await targetChannel.delete('Channel nuked');
  } catch (err) {
    logger.error(`Failed to delete channel: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to delete channel. Check bot permissions and try again.')] });
  }

  let newChannel;
  try {
    newChannel = await interaction.guild.channels.create(channelData);
  } catch (err) {
    logger.error(`Failed to recreate channel: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to recreate channel. Check bot permissions and try again.')] });
  }

  await logAudit({
    guildId: interaction.guildId,
    action: 'nuke',
    moderatorId: interaction.user.id,
    targetId: newChannel.id,
    reason: 'Channel nuked',
    details: `Channel: #${newChannel.name}`,
  });

  return interaction.editReply({ embeds: [successEmbed(`Nuked **#${newChannel.name}** — channel has been recreated.`)] });
}
