import { PermissionFlagsBits } from 'discord.js';

function getCachedConfig(interaction) {
  return interaction.client.guildConfigs?.get(interaction.guildId) || null;
}

const STAFF_FALLBACK_PERMS = [
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
];

export async function checkPermissions(interaction, requiredPerms = []) {
  const member = interaction.member;
  if (!member) return false;

  const ownerId = interaction.client.config?.ownerId;
  if (ownerId && interaction.user.id === ownerId) return true;

  if (member.id === interaction.guild.ownerId) return true;

  let guildConfig = getCachedConfig(interaction);
  if (!guildConfig) {
    const { GuildModel } = await import('../models/Guild.js');
    guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
    if (!guildConfig) {
      guildConfig = await GuildModel.create({ guildId: interaction.guildId });
    }
    if (interaction.client.guildConfigs) {
      interaction.client.guildConfigs.set(interaction.guildId, guildConfig);
    }
  }

  const adminRoles = guildConfig.adminRoles || [];
  const staffRoles = guildConfig.staffRoles || [];
  const allAllowedRoles = [...adminRoles, ...staffRoles];

  if (allAllowedRoles.length > 0) {
    const hasRole = member.roles.cache.some(r => allAllowedRoles.includes(r.id));
    if (!hasRole) {
      if (requiredPerms.length > 0) {
        return member.permissions.has(requiredPerms);
      }
      return STAFF_FALLBACK_PERMS.some(p => member.permissions.has(p));
    }
    if (requiredPerms.length > 0) {
      return member.permissions.has(requiredPerms);
    }
    return true;
  }

  if (requiredPerms.length > 0) {
    return member.permissions.has(requiredPerms);
  }

  return STAFF_FALLBACK_PERMS.some(p => member.permissions.has(p));
}

export async function isAdmin(interaction) {
  const member = interaction.member;
  if (!member) return false;
  const ownerId = interaction.client.config?.ownerId;
  if (ownerId && interaction.user.id === ownerId) return true;
  if (member.id === interaction.guild.ownerId) return true;

  let guildConfig = getCachedConfig(interaction);
  if (!guildConfig) {
    const { GuildModel } = await import('../models/Guild.js');
    guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });
    if (!guildConfig) {
      guildConfig = await GuildModel.create({ guildId: interaction.guildId });
    }
    if (interaction.client.guildConfigs) {
      interaction.client.guildConfigs.set(interaction.guildId, guildConfig);
    }
  }

  const adminRoles = guildConfig.adminRoles || [];
  if (adminRoles.length > 0) {
    return member.roles.cache.some(r => adminRoles.includes(r.id));
  }

  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export function canActOnMember(moderator, target) {
  if (target.id === moderator.id) return false;
  if (target.id === moderator.guild?.ownerId) return false;
  if (target.roles?.highest?.position >= moderator.roles?.highest?.position) return false;
  return true;
}

export function botHasPermissions(guild, permissions = []) {
  const botMember = guild.members.me;
  if (!botMember) return false;
  return permissions.every(p => botMember.permissions.has(p));
}

export const requiredPerms = {
  ban: [PermissionFlagsBits.BanMembers],
  kick: [PermissionFlagsBits.KickMembers],
  mute: [PermissionFlagsBits.ModerateMembers],
  manageChannels: [PermissionFlagsBits.ManageChannels],
  manageRoles: [PermissionFlagsBits.ManageRoles],
  manageMessages: [PermissionFlagsBits.ManageMessages],
  manageGuild: [PermissionFlagsBits.ManageGuild],
  admin: [PermissionFlagsBits.Administrator],
};
