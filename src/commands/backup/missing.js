import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { getBackup } from '../../utils/backup.js';
import { errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('backup-missing')
  .setDescription('Find and restore missing roles/channels from a backup')
  .addStringOption(opt => opt.setName('backup_id').setDescription('The backup ID to scan').setRequired(true));

export const cooldown = 60000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need admin permissions.')] });
  }

  const backupId = interaction.options.getString('backup_id');
  const backup = await getBackup(backupId);
  if (!backup) {
    return interaction.editReply({ embeds: [errorEmbed(`No backup found with ID \`${backupId}\`.`)] });
  }

  if (backup.guildId !== interaction.guildId) {
    return interaction.editReply({ embeds: [errorEmbed('This backup belongs to a different server.')] });
  }

  const guild = interaction.guild;
  const existingRoles = guild.roles.cache;
  const existingChannels = guild.channels.cache;

  const missingRoles = (backup.snapshot.roles || []).filter(r =>
    !existingRoles.some(er => er.name === r.name && !er.managed)
  );

  const missingChannels = (backup.snapshot.channels || []).filter(c =>
    !existingChannels.some(ec => ec.name === c.name && ec.type === c.type)
  );

  if (missingRoles.length === 0 && missingChannels.length === 0) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF7F).setTitle('No Missing Items').setDescription('All roles and channels from this backup already exist in the server.').setTimestamp()] });
  }

  const embed = new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle('Missing Items Found')
    .setDescription(`Backup **${backup.name}** has ${missingRoles.length + missingChannels.length} items not found in this server.`)
    .addFields(
      { name: 'Missing Roles', value: `${missingRoles.length}`, inline: true },
      { name: 'Missing Channels', value: `${missingChannels.length}`, inline: true },
    );

  if (missingRoles.length > 0) {
    embed.addFields({ name: 'Roles', value: missingRoles.slice(0, 10).map(r => `• ${r.name}`).join('\n') + (missingRoles.length > 10 ? `\n...and ${missingRoles.length - 10} more` : ''), inline: false });
  }

  if (missingChannels.length > 0) {
    embed.addFields({ name: 'Channels', value: missingChannels.slice(0, 10).map(c => `• ${c.name} (${ChannelType[c.type] || c.type})`).join('\n') + (missingChannels.length > 10 ? `\n...and ${missingChannels.length - 10} more` : ''), inline: false });
  }

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('restore_missing').setLabel('Restore Missing').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cancel_missing').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const filter = i => i.user.id === interaction.user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

  collector.on('collect', async i => {
    if (i.customId === 'cancel_missing') {
      return i.update({ embeds: [errorEmbed('Cancelled.')], components: [] });
    }

    await i.update({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription('Restoring missing items...')], components: [] });

    const created = { roles: 0, channels: 0, errors: [] };

    const categories = missingChannels.filter(c => c.type === ChannelType.GuildCategory);

    for (const cat of categories) {
      try {
        await guild.channels.create({
          name: cat.name,
          type: ChannelType.GuildCategory,
          position: cat.position,
          permissionOverwrites: cat.permissionOverwrites?.map(o => ({
            id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
          })) || [],
        });
        created.channels++;
      } catch (err) {
        created.errors.push(`Category ${cat.name}: ${err.message}`);
      }
    }

    const nonCategories = missingChannels.filter(c => c.type !== ChannelType.GuildCategory);

    for (const ch of nonCategories) {
      try {
        const parentCatName = ch.parentId
          ? backup.snapshot.channels.find(sc => sc.id === ch.parentId)?.name
          : null;
        const parent = parentCatName
          ? guild.channels.cache.find(c => c.name === parentCatName && c.type === ChannelType.GuildCategory)
          : null;

        const options = {
          name: ch.name,
          type: ch.type,
          position: ch.position,
          topic: ch.topic,
          nsfw: ch.nsfw,
          rateLimitPerUser: ch.rateLimitPerUser,
          parent: parent || null,
          permissionOverwrites: ch.permissionOverwrites?.map(o => ({
            id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny),
          })) || [],
        };

        if (ch.bitrate) options.bitrate = ch.bitrate;
        if (ch.userLimit) options.userLimit = ch.userLimit;
        if (ch.defaultAutoArchiveDuration) options.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration;

        await guild.channels.create(options);
        created.channels++;
      } catch (err) {
        created.errors.push(`Channel ${ch.name}: ${err.message}`);
      }
    }

    for (const role of missingRoles) {
      try {
        await guild.roles.create({
          name: role.name,
          color: role.color,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: BigInt(role.permissions),
          icon: role.icon || null,
          unicodeEmoji: role.unicodeEmoji || null,
        });
        created.roles++;
      } catch (err) {
        created.errors.push(`Role ${role.name}: ${err.message}`);
      }
    }

    const result = new EmbedBuilder()
      .setColor(created.errors.length > 0 ? 0xFF6B35 : 0x00FF7F)
      .setTitle('Restoration Complete')
      .addFields(
        { name: 'Roles Created', value: `${created.roles}`, inline: true },
        { name: 'Channels Created', value: `${created.channels}`, inline: true },
      );

    if (created.errors.length > 0) {
      result.addFields({ name: 'Errors', value: created.errors.slice(0, 5).map(e => `• ${e}`).join('\n') + (created.errors.length > 5 ? `\n...and ${created.errors.length - 5} more` : ''), inline: false });
    }

    result.setTimestamp();
    await interaction.editReply({ embeds: [result], components: [] });
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time' && collected.size === 0) {
      interaction.editReply({ embeds: [errorEmbed('Timed out.')], components: [] }).catch(() => {});
    }
  });
}
