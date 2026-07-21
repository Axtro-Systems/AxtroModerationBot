export async function generateTranscript(channel) {
  const messages = [];
  let lastId = null;
  const limit = 100;

  for (let i = 0; i < 5; i++) {
    const fetched = await channel.messages.fetch({ limit, before: lastId }).catch(() => null);
    if (!fetched || fetched.size === 0) break;
    messages.push(...fetched.values());
    lastId = fetched.last()?.id;
    if (fetched.size < limit) break;
  }

  messages.reverse();

  const lines = messages.map(m => {
    const time = m.createdAt?.toISOString()?.replace('T', ' ')?.replace('Z', '') || 'Unknown';
    const author = `${m.author?.tag || 'Unknown'}`;
    let content = m.content || '';
    if (m.attachments?.size > 0) {
      const attachments = m.attachments.map(a => `[Attachment: ${a.url}]`).join(', ');
      content = content ? `${content} ${attachments}` : attachments;
    }
    return `[${time}] ${author}: ${content}`;
  });

  const header = `Ticket Transcript — #${channel.name}\nGuild: ${channel.guild?.name || 'Unknown'}\nDate: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
  return header + lines.join('\n');
}

export async function sendTranscript(channel, ticket, transcript, client) {
  const buffer = Buffer.from(transcript, 'utf-8');
  const file = {
    attachment: buffer,
    name: `transcript-${ticket.ticketId}.txt`,
  };

  return file;
}
