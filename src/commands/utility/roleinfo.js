import { SlashCommandBuilder, EmbedBuilder, time, TimestampStyles } from 'discord.js';

const MEANINGFUL_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageWebhooks',
  'ManageNicknames',
  'ManageEmojisAndStickers',
  'KickMembers',
  'BanMembers',
  'MentionEveryone',
  'ModerateMembers',
  'ViewAuditLog',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'PrioritySpeaker',
  'Stream',
  'Connect',
  'Speak',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
  'UseExternalEmojis',
  'UseExternalStickers',
  'ReadMessageHistory',
  'ViewChannel',
  'UseApplicationCommands',
  'RequestToSpeak',
  'UseVAD',
  'ChangeNickname',
  'CreateInstantInvite',
  'UseEmbeddedActivities',
];

const PERMISSION_LABELS = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Server',
  ManageRoles: 'Manage Roles',
  ManageChannels: 'Manage Channels',
  ManageMessages: 'Manage Messages',
  ManageWebhooks: 'Manage Webhooks',
  ManageNicknames: 'Manage Nicknames',
  ManageEmojisAndStickers: 'Manage Emojis',
  KickMembers: 'Kick Members',
  BanMembers: 'Ban Members',
  MentionEveryone: 'Mention @everyone',
  ModerateMembers: 'Timeout Members',
  ViewAuditLog: 'View Audit Log',
  MuteMembers: 'Mute Members',
  DeafenMembers: 'Deafen Members',
  MoveMembers: 'Move Members',
  PrioritySpeaker: 'Priority Speaker',
  Stream: 'Stream',
  Connect: 'Connect',
  Speak: 'Speak',
  SendMessages: 'Send Messages',
  SendMessagesInThreads: 'Send Messages in Threads',
  CreatePublicThreads: 'Create Public Threads',
  CreatePrivateThreads: 'Create Private Threads',
  EmbedLinks: 'Embed Links',
  AttachFiles: 'Attach Files',
  AddReactions: 'Add Reactions',
  UseExternalEmojis: 'Use External Emojis',
  UseExternalStickers: 'Use External Stickers',
  ReadMessageHistory: 'Read Message History',
  ViewChannel: 'View Channels',
  UseApplicationCommands: 'Use Slash Commands',
  RequestToSpeak: 'Request to Speak',
  UseVAD: 'Use Voice Activity',
  ChangeNickname: 'Change Nickname',
  CreateInstantInvite: 'Create Invite',
  UseEmbeddedActivities: 'Use Activities',
};

export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('roleinfo')
  .setDescription('Get information about a role')
  .addRoleOption(option =>
    option.setName('role')
      .setDescription('The role to get info about')
      .setRequired(true));

export async function execute(interaction, client) {

  const role = interaction.options.getRole('role');

  const permissions = MEANINGFUL_PERMISSIONS.filter(p => role.permissions.has(p));
  const permsList = permissions.length > 0
    ? permissions.map(p => PERMISSION_LABELS[p] || p).join(', ')
    : 'None';

  const hexColor = role.hexColor.toUpperCase();

  const embed = new EmbedBuilder()
    .setColor(role.color || 0x5865F2)
    .setTitle(role.name)
    .addFields(
      { name: 'Name', value: role.name, inline: true },
      { name: 'ID', value: role.id, inline: true },
      { name: 'Color', value: hexColor, inline: true },
      { name: 'Position', value: String(role.position), inline: true },
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Members', value: String(role.members.size), inline: true },
      { name: 'Created', value: time(role.createdAt, TimestampStyles.LongDate), inline: true },
      { name: 'Permissions', value: permsList, inline: false },
    )
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
