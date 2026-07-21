import { EmbedBuilder, AuditLogEvent } from 'discord.js';

export const name = 'guildMemberRemove';

export async function execute(member, client) {
  let config = client.guildConfigs?.get(member.guild.id);
  if (!config) {
    const { GuildModel } = await import('../models/Guild.js');
    config = await GuildModel.findOne({ guildId: member.guild.id }).lean().catch(() => null);
  }
  
  const logChannelId = config?.modLogChannel || config?.auditChannel;
  if (!logChannelId) return;

  const channel = member.guild.channels.cache.get(logChannelId);
  if (!channel) return;

  
  const auditLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 }).catch(() => null);
  const entry = auditLogs?.entries.first();
  
  let isKick = false;
  let kicker = null;
  let reason = 'No reason provided';
  
  if (entry && entry.target && entry.target.id === member.user.id) {
    const timeDifference = Date.now() - entry.createdTimestamp;
    if (timeDifference < 10000) {
      isKick = true;
      kicker = entry.executor;
      reason = entry.reason || 'No reason provided';
    }
  }

  const embed = new EmbedBuilder().setTimestamp();

  if (isKick) {
    embed
      .setColor(0xFF0000)
      .setTitle('Member Kicked')
      .addFields(
        { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
        { name: 'Kicked by', value: kicker ? `${kicker.tag} (${kicker.id})` : 'Unknown', inline: true },
        { name: 'Reason', value: reason, inline: false }
      );
  } else {
    embed
      .setColor(0xFF6B35)
      .setTitle('Member Left')
      .setDescription(`${member.user.tag} (${member.user.id})`)
      .addFields(
        { name: 'Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
        { name: 'Created', value: `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Roles', value: `${member.roles.cache.filter(r => r.id !== member.guild.id).size || 'None'}`, inline: true }
      );
  }

  channel.send({ embeds: [embed] }).catch(() => {});
}
