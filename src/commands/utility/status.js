import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, version as djsVersion } from 'discord.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { errorEmbed } from '../../utils/embed.js';
import { GuildModel } from '../../models/Guild.js';
import mongoose from 'mongoose';
import os from 'os';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('View the bot\'s advanced system status and statistics');

export const cooldown = 5000;

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.admin)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to use this command.')] });
  }

  const wsPing = client.ws.ping;
  const dbStart = Date.now();
  let dbPing = -1;
  try {
    if (mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      dbPing = Date.now() - dbStart;
    }
  } catch {}

  const dbStates = {
    0: '🔴 Disconnected',
    1: '🟢 Connected',
    2: '🟡 Connecting',
    3: '🟡 Disconnecting'
  };
  const dbStatus = dbStates[mongoose.connection.readyState] || '⚪ Unknown';

  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = totalMemBytes - freeMemBytes;
  const sysMemory = `${(usedMemBytes / (1024 ** 3)).toFixed(2)} GB / ${(totalMemBytes / (1024 ** 3)).toFixed(2)} GB`;

  const processMemory = process.memoryUsage();
  const heapUsed = `${(processMemory.heapUsed / (1024 ** 2)).toFixed(2)} MB`;
  const heapTotal = `${(processMemory.heapTotal / (1024 ** 2)).toFixed(2)} MB`;

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'Unknown CPU';
  const cpuCount = cpus.length;

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId }).lean();
  const antinukeState = guildConfig?.antiNuke?.enabled ? '🟢 Enabled' : '🔴 Disabled';
  const automodState = guildConfig?.automod?.enabled ? '🟢 Enabled' : '🔴 Disabled';
  const antiraidState = guildConfig?.antiRaid?.enabled ? '🟢 Enabled' : '🔴 Disabled';

  const guildsCount = client.guilds.cache.size;
  const usersCount = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
  const channelsCount = client.channels.cache.size;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Axtro Moderation - Advanced Status Panel')
    .setThumbnail(client.user.displayAvatarURL())
    .setDescription('System hardware metrics, API statistics, and guild configurations.')
    .addFields(
      {
        name: '🤖 Bot Instance',
        value: [
          `**Uptime:** \`${formatUptime(process.uptime())}\``,
          `**WS Ping:** \`${wsPing}ms\``,
          `**Discord.js:** \`v${djsVersion}\``,
          `**Node.js:** \`${process.version}\``
        ].join('\n'),
        inline: true
      },
      {
        name: '💾 System Performance',
        value: [
          `**OS:** \`${os.platform()} ${os.arch()}\``,
          `**CPU:** \`${cpuCount}x\` ${cpuModel.slice(0, 35)}`,
          `**Sys RAM:** \`${sysMemory}\``,
          `**Node Heap:** \`${heapUsed} / ${heapTotal}\``
        ].join('\n'),
        inline: true
      },
      {
        name: '📁 Database Status',
        value: [
          `**MongoDB:** ${dbStatus}`,
          `**DB Ping:** \`${dbPing !== -1 ? `${dbPing}ms` : 'N/A'}\``
        ].join('\n'),
        inline: false
      },
      {
        name: '📊 Global Statistics',
        value: [
          `**Servers:** \`${guildsCount}\``,
          `**Users:** \`${usersCount}\``,
          `**Channels:** \`${channelsCount}\``
        ].join('\n'),
        inline: true
      },
      {
        name: '🛡️ Guild Security Config',
        value: [
          `**Anti-Nuke:** ${antinukeState}`,
          `**AutoMod:** ${automodState}`,
          `**Anti-Raid:** ${antiraidState}`
        ].join('\n'),
        inline: true
      }
    )
    .setFooter({ text: 'Axtro Systems · Admin only access' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
