import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, isAdmin, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { AntiNukeModel } from '../../models/AntiNuke.js';

export const data = new SlashCommandBuilder()
  .setName('antinuke-status')
  .setDescription('Show anti-nuke protection status and configuration');

export const cooldown = 3000;

export async function execute(interaction, client) {
  if (!await isAdmin(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Admin-level permissions to use this command.')] });
  }

  const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });

  if (!guildConfig?.antiNuke) {
    return interaction.editReply({ embeds: [errorEmbed('Anti-nuke configuration not found for this server.')] });
  }

  const defaults = { maxBans: 3, maxKicks: 3, maxChannelCreates: 3, maxChannelDeletes: 2, maxRoleDeletes: 2, maxRoleCreates: 3, maxWebhooks: 3, maxGuildUpdates: 2, maxEmojiCreates: 3, maxStickerCreates: 3, interval: 10000, action: 'ban', enabled: true, autoRestore: false };
  const an = { ...defaults, ...(guildConfig.antiNuke || {}) };
  const whitelistCount = an.whitelist?.length || 0;

  const recentEvents = await AntiNukeModel.find({ guildId: interaction.guildId, flagged: true })
    .sort({ windowStart: -1 })
    .limit(5)
    .lean();

  const embed = new EmbedBuilder()
    .setColor(an.enabled ? 0x00FF7F : 0xFF0000)
    .setTitle('Anti-Nuke Status')
    .addFields(
      { name: 'Status', value: an.enabled ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
      { name: 'Action', value: (an.action ? an.action.charAt(0).toUpperCase() + an.action.slice(1) : 'Ban'), inline: true },
      { name: 'Auto Restore', value: an.autoRestore ? '✅ Yes' : '❌ No', inline: true },
      { name: 'Interval', value: `${(an.interval || 10000).toLocaleString()} ms`, inline: true },
      { name: 'Whitelisted Users', value: `${whitelistCount}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Max Bans', value: `${an.maxBans}`, inline: true },
      { name: 'Max Kicks', value: `${an.maxKicks}`, inline: true },
      { name: 'Max Channel Creates', value: `${an.maxChannelCreates}`, inline: true },
      { name: 'Max Channel Deletes', value: `${an.maxChannelDeletes}`, inline: true },
      { name: 'Max Role Deletes', value: `${an.maxRoleDeletes}`, inline: true },
      { name: 'Max Role Creates', value: `${an.maxRoleCreates}`, inline: true },
      { name: 'Max Webhooks', value: `${an.maxWebhooks}`, inline: true },
      { name: 'Max Guild Updates', value: `${an.maxGuildUpdates}`, inline: true },
      { name: 'Max Emoji Creates', value: `${an.maxEmojiCreates}`, inline: true },
      { name: 'Max Sticker Creates', value: `${an.maxStickerCreates}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
    )
    .setTimestamp();

  if (recentEvents.length > 0) {
    const eventsList = recentEvents.map((e, i) => {
      const time = `<t:${Math.floor(new Date(e.windowStart).getTime() / 1000)}:R>`;
      return `**${i + 1}.** ${e.action.charAt(0).toUpperCase() + e.action.slice(1)} — ${e.count} trigger${e.count !== 1 ? 's' : ''} by <@${e.userId}> ${time}`;
    }).join('\n');

    embed.addFields({ name: 'Recent Triggered Events (Last 5)', value: eventsList, inline: false });
  } else {
    embed.addFields({ name: 'Recent Triggered Events', value: 'No recent events detected.', inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
