import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';
import { CaseModel } from '../../models/Case.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embed.js';

export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('userinfo')
  .setDescription('Get information about a user')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to get info about')
      .setRequired(false));

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction)) { return interaction.editReply({ embeds: [errorEmbed('You do not have staff permissions.')] }); }

  const user = interaction.options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const avatarUrl = user.displayAvatarURL({ size: 4096 });

  const embed = new EmbedBuilder()
    .setColor(member?.displayColor || 0x5865F2)
    .setAuthor({ name: user.tag, iconURL: avatarUrl })
    .setThumbnail(avatarUrl)
    .addFields(
      { name: 'ID', value: user.id, inline: true },
      { name: 'Tag', value: user.tag, inline: true },
      { name: 'Created', value: time(user.createdAt, TimestampStyles.LongDate), inline: true },
    );

  if (member) {
    const joinedDate = member.joinedAt ? time(member.joinedAt, TimestampStyles.LongDate) : 'Unknown';
    const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
    const rolesList = roles.size > 0 ? roles.map(r => r.toString()).join(' ') : 'None';
    const highestRole = member.roles.highest.id !== interaction.guild.id ? member.roles.highest.toString() : 'None';
    const booster = member.premiumSince ? time(member.premiumSince, TimestampStyles.LongDate) : 'No';
    const timeout = member.isCommunicationDisabled()
      ? time(member.communicationDisabledUntil, TimestampStyles.LongDate)
      : 'No';

    const cases = await CaseModel.find({ guildId: interaction.guildId, targetId: user.id, deleted: false });
    const warns = cases.filter(c => c.type === 'warn').length;
    const bans = cases.filter(c => ['ban', 'tempban', 'softban'].includes(c.type)).length;
    const kicks = cases.filter(c => c.type === 'kick').length;
    const mutes = cases.filter(c => ['mute', 'tempmute'].includes(c.type)).length;

    embed.addFields(
      { name: 'Joined', value: joinedDate, inline: true },
      { name: 'Booster', value: booster, inline: true },
      { name: 'Timeout', value: timeout, inline: true },
      { name: `Roles [${roles.size}]`, value: rolesList, inline: false },
      { name: 'Highest Role', value: highestRole, inline: true },
      { name: 'Warns', value: String(warns), inline: true },
      { name: 'Kicks', value: String(kicks), inline: true },
      { name: 'Bans', value: String(bans), inline: true },
      { name: 'Mutes', value: String(mutes), inline: true },
    );
  }

  embed.setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
