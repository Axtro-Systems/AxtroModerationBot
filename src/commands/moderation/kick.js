import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a user from the server')
  .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick').setRequired(false))
  .addBooleanOption(opt => opt.setName('dm_user').setDescription('DM the user the reason').setRequired(false));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.kick)) {
    return sendResponse(interaction, { embeds: [errorEmbed('You do not have permission to kick members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const dmUser = interaction.options.getBoolean('dm_user') || false;

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.KickMembers])) {
    return sendResponse(interaction, { embeds: [errorEmbed('I do not have permission to kick members.')] });
  }

  const targetMember = interaction.options.getMember('user') || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return sendResponse(interaction, { embeds: [errorEmbed('That user is not in this server.')] });
  }

  if (!canActOnMember(interaction.member, targetMember)) {
    return sendResponse(interaction, { embeds: [errorEmbed('You cannot kick this user.')] });
  }

  if (!canActOnMember(interaction.guild.members.me, targetMember)) {
    return sendResponse(interaction, { embeds: [errorEmbed('I cannot kick this user due to role hierarchy.')] });
  }

  try {
    await targetMember.kick(reason);
  } catch (err) {
    logger.error(`Failed to kick user: ${err.message}`, err);
    return sendResponse(interaction, { embeds: [errorEmbed('Failed to kick user. Check bot permissions and try again.')] });
  }

  if (dmUser) {
    try {
      await targetMember.send(`You have been kicked from **${interaction.guild.name}**.\nReason: ${reason}`);
    } catch {
      // DM failed, continue anyway
    }
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'kick',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'kick',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
    details: dmUser ? 'User was DMed' : undefined,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return sendResponse(interaction, { embeds: [successEmbed(`Kicked **${targetUser.tag}** | Case #${caseEntry.caseNumber}`)] });
}

async function sendResponse(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    } else {
      return await interaction.reply({ ...options, ephemeral: true });
    }
  } catch (err) {
    try {
      return await interaction.followUp({ ...options, ephemeral: true });
    } catch {
      // Interaction is truly dead
    }
  }
}
