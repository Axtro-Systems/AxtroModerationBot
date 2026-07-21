import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a user from the server')
  .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban'))
  .addIntegerOption(opt => opt.setName('delete_messages').setDescription('Delete messages from (days)').setMinValue(0).setMaxValue(7))
  .addBooleanOption(opt => opt.setName('dm_user').setDescription('DM the user about the ban'));

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('You lack permission to ban members.')] });
  }

  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const deleteDays = interaction.options.getInteger('delete_messages') || 0;
  const dmUser = interaction.options.getBoolean('dm_user') ?? true;

  if (user.id === interaction.user.id) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot ban yourself.')] });
  }

  const member = interaction.options.getMember('user') || await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member && !canActOnMember(interaction.member, member)) {
    return interaction.editReply({ embeds: [errorEmbed('You cannot ban this user.')] });
  }

  if (!botHasPermissions(interaction.guild, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('I lack Ban Members permission.')] });
  }

  if (member && !canActOnMember(interaction.guild.members.me, member)) {
    return interaction.editReply({ embeds: [errorEmbed('I cannot ban this user due to role hierarchy.')] });
  }

  try {
    await interaction.guild.bans.create(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
  } catch (err) {
    logger.error(`Failed to ban user: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to ban user. Check bot permissions and try again.')] });
  }

  if (dmUser) {
    try {
      await user.send(`You have been banned from **${interaction.guild.name}**.\nReason: ${reason}`);
    } catch { }
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'ban',
    targetId: user.id,
    targetTag: user.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'ban',
    moderatorId: interaction.user.id,
    targetId: user.id,
    reason,
  });

  const config = await GuildModel.findOne({ guildId: interaction.guildId });
  if (config?.modLogChannel) {
    const channel = interaction.guild.channels.cache.get(config.modLogChannel);
    if (channel) {
      channel.send({ embeds: [modLogEmbed(caseEntry)] }).catch(() => {});
    }
  }

  await interaction.editReply({ embeds: [successEmbed(`Banned ${user.tag} | Case #${caseEntry.caseNumber}`)] });
}
