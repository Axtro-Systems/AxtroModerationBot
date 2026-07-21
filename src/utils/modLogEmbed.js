import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { getLogoUrl } from './embed.js';

export const modLogColors = {
  warn: 0xFFCC00,      // Yellow
  automod_violation: 0xFFCC00, // Yellow
  timeout: 0xFF6600,   // Orange
  mute: 0xFF6600,      // Orange
  tempmute: 0xFF6600,  // Orange
  kick: 0xFF6600,      // Orange
  ban: 0xCC0000,       // Red
  tempban: 0xCC0000,   // Red
  softban: 0xCC0000,   // Red
  lockdown: 0xCC0000,  // Red
  antinuke: 0xCC0000,  // Red
  antiraid: 0xCC0000,  // Red
  unban: 0x00FF7F,     // Green
  unlock: 0x00FF7F,
  unmute: 0x00FF7F
};

export function createUnifiedModEmbed({ title, description, colorType, fields = [], thumbnail = true }) {
  const color = modLogColors[colorType] || 0xFFCC00;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setFooter({ text: config.brandingFooter || 'Axtro Systems' })
    .setTimestamp();

  if (thumbnail) {
    embed.setThumbnail(getLogoUrl());
  }
  return embed;
}
