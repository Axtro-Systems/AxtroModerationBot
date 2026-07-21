import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embed.js';
import { CaseModel } from '../../models/Case.js';

export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Get detailed information about a user including case history')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to investigate')
      .setRequired(true));

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Messages permission to use this.')] });
  }

  const user = interaction.options.getUser('user');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const avatarUrl = user.displayAvatarURL({ size: 4096 });

  const cases = await CaseModel.find({ guildId: interaction.guildId, targetId: user.id, deleted: false })
    .sort({ createdAt: -1 });

  const warns = cases.filter(c => c.type === 'warn').length;
  const bans = cases.filter(c => ['ban', 'tempban', 'softban'].includes(c.type)).length;
  const kicks = cases.filter(c => c.type === 'kick').length;
  const mutes = cases.filter(c => ['mute', 'tempmute'].includes(c.type)).length;

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

    embed.addFields(
      { name: 'Joined', value: joinedDate, inline: true },
      { name: 'Booster', value: booster, inline: true },
      { name: 'Timeout', value: timeout, inline: true },
      { name: `Roles [${roles.size}]`, value: rolesList, inline: false },
      { name: 'Highest Role', value: highestRole, inline: true },
      { name: 'Total Cases', value: String(cases.length), inline: true },
      { name: 'Warns', value: String(warns), inline: true },
      { name: 'Kicks', value: String(kicks), inline: true },
      { name: 'Bans', value: String(bans), inline: true },
      { name: 'Mutes', value: String(mutes), inline: true },
    );
  } else {
    embed.addFields(
      { name: 'Total Cases', value: String(cases.length), inline: true },
      { name: 'Warns', value: String(warns), inline: true },
      { name: 'Kicks', value: String(kicks), inline: true },
      { name: 'Bans', value: String(bans), inline: true },
      { name: 'Mutes', value: String(mutes), inline: true },
    );
  }

  if (cases.length > 0) {
    const recentCases = cases.slice(0, 5);
    const recentText = recentCases.map((c, i) =>
      `\`#${c.caseNumber}\` **${c.type.charAt(0).toUpperCase() + c.type.slice(1)}** - ${c.reason || 'No reason'} ${c.moderatorTag ? `(by ${c.moderatorTag})` : ''}`
    ).join('\n');

    embed.addFields(
      { name: `Recent Cases (${Math.min(5, cases.length)} of ${cases.length})`, value: recentText, inline: false },
    );
  }

  embed.setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
