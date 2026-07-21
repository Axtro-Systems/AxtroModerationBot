import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk delete messages with optional filters')
  .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to delete (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
  .addUserOption(opt => opt.setName('user').setDescription('Only delete messages from this user').setRequired(false))
  .addStringOption(opt => opt.setName('contains').setDescription('Only delete messages containing this text').setRequired(false))
  .addBooleanOption(opt => opt.setName('bots').setDescription('Only delete bot messages').setRequired(false))
  .addBooleanOption(opt => opt.setName('attachments').setDescription('Only delete messages with attachments').setRequired(false))
  .addBooleanOption(opt => opt.setName('embeds').setDescription('Only delete messages with embeds').setRequired(false));

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageMessages)) {
    return interaction.editReply({ embeds: [errorEmbed('You do not have permission to manage messages.')] });
  }

  if (!botHasPermissions(interaction.guild, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
    return interaction.editReply({ embeds: [errorEmbed('I need Manage Messages and Read Message History permissions.')] });
  }

  const amount = interaction.options.getInteger('amount', true);
  const user = interaction.options.getUser('user');
  const contains = interaction.options.getString('contains');
  const bots = interaction.options.getBoolean('bots');
  const attachments = interaction.options.getBoolean('attachments');
  const embeds = interaction.options.getBoolean('embeds');

  let messages;
  try {
    messages = await interaction.channel.messages.fetch({ limit: Math.min(amount, 100) });
  } catch (err) {
    logger.error(`Failed to fetch messages: ${err.message}`, err);
    return interaction.editReply({ embeds: [errorEmbed('Failed to fetch messages. Check bot permissions and try again.')] });
  }

  let filtered = [...messages.values()];

  if (user) filtered = filtered.filter(m => m.author.id === user.id);
  if (contains) filtered = filtered.filter(m => m.content.toLowerCase().includes(contains.toLowerCase()));
  if (bots) filtered = filtered.filter(m => m.author.bot);
  if (attachments) filtered = filtered.filter(m => m.attachments.size > 0);
  if (embeds) filtered = filtered.filter(m => m.embeds.length > 0);

  if (filtered.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed('No messages matched the filters.')] });
  }

  const bulkDeletable = filtered.filter(m => Date.now() - m.createdTimestamp < 1209600000);
  const olderMessages = filtered.filter(m => Date.now() - m.createdTimestamp >= 1209600000);

  let deletedCount = 0;

  if (bulkDeletable.length > 0) {
    const chunks = [];
    for (let i = 0; i < bulkDeletable.length; i += 100) {
      chunks.push(bulkDeletable.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      try {
        await interaction.channel.bulkDelete(chunk, true);
        deletedCount += chunk.length;
      } catch (err) {
        logger.error(`Failed to delete messages: ${err.message}`, err);
        return interaction.editReply({ embeds: [errorEmbed('Failed to delete messages. Check bot permissions and try again.')] });
      }
    }
  }

  if (olderMessages.length > 0) {
    for (const msg of olderMessages) {
      try {
        await msg.delete();
        deletedCount++;
      } catch { }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  await logAudit({
    guildId: interaction.guildId,
    action: 'purge',
    moderatorId: interaction.user.id,
    targetId: interaction.channel.id,
    reason: `Purged ${deletedCount} messages`,
    details: `Channel: #${interaction.channel.name}`,
  });

  return interaction.editReply({ embeds: [successEmbed(`Deleted **${deletedCount}** message(s) in **#${interaction.channel.name}**`)] });
}
