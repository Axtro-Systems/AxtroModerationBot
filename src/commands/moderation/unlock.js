import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, closeActiveCases, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Unlock a channel')
  .addChannelOption(opt => opt.setName('channel').setDescription('Channel to unlock').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for unlocking').setRequired(false));

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

  if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
    return interaction.editReply({ embeds: [errorEmbed('This command can only be used on text-based channels.')] });
  }

  const everyoneRole = interaction.guild.roles.everyone;

  try {
    await targetChannel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: null,
    });
  } catch (err) {
    logger.error(`Failed to unlock channel: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to unlock channel. Check bot permissions and try again.')] });
  }

  await closeActiveCases(interaction.guildId, targetChannel.id, 'lock');

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'unlock',
    targetId: targetChannel.id,
    targetTag: `#${targetChannel.name}`,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'unlock',
    moderatorId: interaction.user.id,
    targetId: targetChannel.id,
    reason,
    details: `Channel: #${targetChannel.name}`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Unlocked **#${targetChannel.name}** | Case #${caseEntry.caseNumber}`)] });
}
