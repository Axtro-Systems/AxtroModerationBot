import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { createCase, logAudit } from '../../utils/caseUtils.js';
import { modLogEmbed, successEmbed, errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('softban')
  .setDescription('Ban a user and immediately unban to purge their messages')
  .addUserOption(opt => opt.setName('user').setDescription('User to softban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the softban').setRequired(false));

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.ban)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to ban members.')] });
  }

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.BanMembers])) {
    return interaction.editReply({ embeds: [errorEmbed('I do not have permission to ban members.')] });
  }

  if (targetUser.id === interaction.client.user.id) {
    return interaction.editReply({ embeds: [errorEmbed('I cannot softban myself.')] });
  }

  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
    if (!canActOnMember(interaction.member, targetMember)) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot softban this user.')] });
    }
    if (!canActOnMember(interaction.guild.members.me, targetMember)) {
      return interaction.editReply({ embeds: [errorEmbed('I cannot softban this user — their highest role is above mine.')] });
    }
  } catch {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot softban this user.')] });
    }
  }

  try {
    await interaction.guild.bans.create(targetUser.id, { reason: `Softban by ${interaction.user.tag}: ${reason}` });
    await interaction.guild.bans.remove(targetUser.id, 'Softban complete');
  } catch (err) {
    logger.error(`Failed to softban user: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to softban user. Check bot permissions and try again.')] });
  }

  const caseEntry = await createCase({
    guildId: interaction.guildId,
    type: 'softban',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
  });

  await logAudit({
    guildId: interaction.guildId,
    action: 'softban',
    moderatorId: interaction.user.id,
    targetId: targetUser.id,
    reason,
  });

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
  if (guildConfig?.modLogChannel) {
    const logChannel = interaction.guild.channels.cache.get(guildConfig.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [modLogEmbed(caseEntry)] });
    }
  }

  return interaction.editReply({ embeds: [successEmbed(`Softbanned **${targetUser.tag}** | Case #${caseEntry.caseNumber}`)] });
}
