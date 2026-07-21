import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { logger } from './logger.js';

function hasManagePerms(botMember) {
  return botMember?.permissions?.has(PermissionFlagsBits.ManageChannels) &&
         botMember?.permissions?.has(PermissionFlagsBits.ManageRoles) &&
         botMember?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

export async function restoreServer(guild, snapshot, destructive = false) {
  const botMember = guild.members.me;
  if (!botMember) return { errors: ['Bot member not found in guild'] };
  if (!hasManagePerms(botMember)) return { errors: ['Bot lacks ManageChannels/ManageRoles/ManageGuild permissions'] };

  const results = { roles: { created: 0, updated: 0, deleted: 0 }, channels: { created: 0, updated: 0, deleted: 0 }, errors: [] };

  const savedRoles = (snapshot.roles || []).sort((a, b) => a.position - b.position);

  for (const roleData of savedRoles) {
    try {
      const existing = guild.roles.cache.find(r => r.name === roleData.name && !r.managed);
      if (existing) {
        await existing.edit({
          color: roleData.color,
          hoist: roleData.hoist,
          mentionable: roleData.mentionable,
          permissions: BigInt(roleData.permissions),
          icon: roleData.icon || null,
          unicodeEmoji: roleData.unicodeEmoji || null,
          position: roleData.position,
        });
        results.roles.updated++;
      } else {
        await guild.roles.create({
          name: roleData.name,
          color: roleData.color,
          hoist: roleData.hoist,
          mentionable: roleData.mentionable,
          permissions: BigInt(roleData.permissions),
          icon: roleData.icon || null,
          unicodeEmoji: roleData.unicodeEmoji || null,
          position: roleData.position,
        });
        results.roles.created++;
      }
    } catch (err) {
      results.errors.push(`Role ${roleData.name}: ${err.message}`);
    }
  }

  if (destructive) {
    for (const role of guild.roles.cache.values()) {
      if (role.id === guild.id) continue;
      if (role.managed) continue;
      if (botMember && role.id === botMember.roles.highest?.id) continue;
      if (savedRoles.some(r => r.name === role.name)) continue;
      try {
        await role.delete('Backup restore: role not in backup');
        results.roles.deleted++;
      } catch (err) {
        results.errors.push(`Role delete ${role.name}: ${err.message}`);
      }
    }
  }

  const categories = snapshot.channels.filter(c => c.type === ChannelType.GuildCategory);

  for (const catData of categories) {
    try {
      const existing = guild.channels.cache.find(c => c.name === catData.name && c.type === ChannelType.GuildCategory);
      if (existing) {
        await existing.edit({ position: catData.position });
        if (catData.permissionOverwrites?.length) {
          await existing.permissionOverwrites.set(
            catData.permissionOverwrites.map(o => ({
              id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
            }))
          );
        }
        results.channels.updated++;
      } else {
        await guild.channels.create({
          name: catData.name,
          type: ChannelType.GuildCategory,
          position: catData.position,
          permissionOverwrites: catData.permissionOverwrites?.map(o => ({
            id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
          })) || [],
        });
        results.channels.created++;
      }
    } catch (err) {
      results.errors.push(`Category ${catData.name}: ${err.message}`);
    }
  }

  const categoryNameById = {};
  for (const cat of categories) {
    categoryNameById[cat.id] = cat.name;
  }

  const nonCategories = snapshot.channels.filter(c => c.type !== ChannelType.GuildCategory && c.type !== undefined);

  for (const chData of nonCategories) {
    try {
      const parent = chData.parentId
        ? guild.channels.cache.find(c => c.id === chData.parentId || c.name === categoryNameById[chData.parentId])
        : null;

      const existing = guild.channels.cache.find(c => c.name === chData.name && c.type === chData.type);
      if (existing) {
        await existing.edit({
          position: chData.position,
          topic: chData.topic,
          nsfw: chData.nsfw,
          rateLimitPerUser: chData.rateLimitPerUser,
          parent: parent || null,
        });
        if (chData.permissionOverwrites?.length) {
          await existing.permissionOverwrites.set(
            chData.permissionOverwrites.map(o => ({
              id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
            }))
          );
        }
        results.channels.updated++;
      } else {
        const createOptions = {
          name: chData.name,
          type: chData.type,
          position: chData.position,
          topic: chData.topic,
          nsfw: chData.nsfw,
          rateLimitPerUser: chData.rateLimitPerUser,
          parent: parent || null,
          permissionOverwrites: chData.permissionOverwrites?.map(o => ({
            id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
          })) || [],
        };
        if (chData.bitrate) createOptions.bitrate = chData.bitrate;
        if (chData.userLimit) createOptions.userLimit = chData.userLimit;
        if (chData.defaultAutoArchiveDuration) createOptions.defaultAutoArchiveDuration = chData.defaultAutoArchiveDuration;

        await guild.channels.create(createOptions);
        results.channels.created++;
      }
    } catch (err) {
      results.errors.push(`Channel ${chData.name}: ${err.message}`);
    }
  }

  if (destructive) {
    const allSavedChannels = [...categories, ...nonCategories];
    for (const channel of guild.channels.cache.values()) {
      if (channel.id === guild.rulesChannelId || channel.id === guild.publicUpdatesChannelId) continue;
      if (allSavedChannels.some(c => c.name === channel.name && c.type === channel.type)) continue;
      try {
        await channel.delete('Backup restore: channel not in backup');
        results.channels.deleted++;
      } catch (err) {
        results.errors.push(`Channel delete ${channel.name}: ${err.message}`);
      }
    }
  }

  if (snapshot.name) {
    try {
      await guild.edit({ name: snapshot.name });
    } catch (err) {
      results.errors.push(`Server name: ${err.message}`);
    }
  }

  if (snapshot.verificationLevel !== undefined) {
    try {
      await guild.edit({ verificationLevel: snapshot.verificationLevel });
    } catch (err) {
      results.errors.push(`Verification level: ${err.message}`);
    }
  }

  if (snapshot.bans && snapshot.bans.length > 0) {
    for (const banData of snapshot.bans) {
      try {
        await guild.bans.create(banData.userId, { reason: banData.reason || 'Backup restore' });
      } catch (err) {
        results.errors.push(`Ban ${banData.userId}: ${err.message}`);
      }
    }
  }

  logger.info(`Restore complete for guild ${guild.id}: ${JSON.stringify(results)}`);
  return results;
}

export async function restoreSingleChannel(guild, channelData) {
  try {
    const existing = guild.channels.cache.find(c => c.name === channelData.name && c.type === channelData.type);
    if (existing) return existing;

    const parent = channelData.parentId ? guild.channels.cache.get(channelData.parentId) : null;
    const channel = await guild.channels.create({
      name: channelData.name,
      type: channelData.type,
      position: channelData.position,
      topic: channelData.topic,
      nsfw: channelData.nsfw,
      rateLimitPerUser: channelData.rateLimitPerUser,
      parent: parent || null,
      permissionOverwrites: channelData.permissionOverwrites?.map(o => ({
        id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
      })) || [],
    });
    return channel;
  } catch (err) {
    logger.error(`Restore single channel failed: ${err.message}`);
    return null;
  }
}

export async function restoreSingleRole(guild, roleData) {
  try {
    const existing = guild.roles.cache.find(r => r.name === roleData.name && !r.managed);
    if (existing) return existing;

    const role = await guild.roles.create({
      name: roleData.name,
      color: roleData.color,
      hoist: roleData.hoist,
      mentionable: roleData.mentionable,
      permissions: BigInt(roleData.permissions),
      icon: roleData.icon || null,
      unicodeEmoji: roleData.unicodeEmoji || null,
    });
    return role;
  } catch (err) {
    logger.error(`Restore single role failed: ${err.message}`);
    return null;
  }
}
