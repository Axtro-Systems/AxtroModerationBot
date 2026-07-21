import { EmbedBuilder, time, TimestampStyles } from 'discord.js';
import { config } from '../config.js';

let discordClient = null;

export function setClient(client) {
  discordClient = client;
}

export function getLogoUrl() {
  if (discordClient) {
    const emoji = discordClient.emojis.cache.find(e => e.name.toLowerCase() === 'axtropvp');
    if (emoji) return emoji.imageURL();
  }
  return 'attachment://logo.png';
}

export function modLogEmbed(caseEntry) {
  const color = config.colors[caseEntry.type] || config.colors.default;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Case #${caseEntry.caseNumber} | ${caseEntry.type.toUpperCase()}`)
    .setDescription('\u200b')
    .addFields(
      { name: 'Target', value: `${caseEntry.targetTag} (${caseEntry.targetId})`, inline: false },
      { name: 'Moderator', value: `${caseEntry.moderatorTag} (${caseEntry.moderatorId})`, inline: false },
      { name: 'Reason', value: caseEntry.reason || 'No reason provided', inline: false },
    )
    .setFooter({ text: 'AxtroPvP Moderation', iconURL: getLogoUrl() })
    .setTimestamp();

  if (caseEntry.duration) {
    embed.addFields({ name: 'Duration', value: msToDuration(caseEntry.duration), inline: true });
  }
  if (caseEntry.expiresAt) {
    embed.addFields({ name: 'Expires', value: time(new Date(caseEntry.expiresAt), TimestampStyles.RelativeTime), inline: true });
  }

  return embed;
}

export function simpleEmbed({ color, title, description, fields, footer, timestamp }) {
  const embed = new EmbedBuilder()
    .setColor(color || config.colors.default);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields) embed.addFields(fields);
  
  if (footer) {
    if (typeof footer === 'string') {
      embed.setFooter({ text: footer, iconURL: getLogoUrl() });
    } else if (typeof footer === 'object') {
      embed.setFooter({
        text: footer.text,
        iconURL: footer.iconURL || getLogoUrl()
      });
    }
  } else {
    embed.setFooter({ text: 'Axtro Systems', iconURL: getLogoUrl() });
  }
  
  if (timestamp) embed.setTimestamp(timestamp);
  return embed;
}

export function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('Error')
    .setDescription(message)
    .setFooter({ text: 'Axtro Systems', iconURL: getLogoUrl() })
    .setTimestamp();
}

export function successEmbed(message) {
  return new EmbedBuilder()
    .setColor(0x00FF7F)
    .setTitle('Success')
    .setDescription(message)
    .setFooter({ text: 'Axtro Systems', iconURL: getLogoUrl() })
    .setTimestamp();
}

export function paginatedEmbed(items, page, totalPages, title, formatFn) {
  const start = page * 10;
  const pageItems = items.slice(start, start + 10);

  const embed = new EmbedBuilder()
    .setColor(config.colors.default)
    .setTitle(title)
    .setDescription(pageItems.map(formatFn).join('\n') || 'No entries found.')
    .setFooter({
      text: `Page ${page + 1} / ${totalPages} | Total: ${items.length}`,
      iconURL: getLogoUrl()
    });

  return embed;
}

function msToDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0) parts.push(`${seconds % 60}s`);
  return parts.join(' ') || '0s';
}

export { msToDuration };
