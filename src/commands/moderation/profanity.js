import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('profanity')
  .setDescription('Manage the automod profanity word list')
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add words to the profanity list')
    .addStringOption(opt => opt
      .setName('words')
      .setDescription('Comma-separated words to add (e.g. word1,word2,word3)')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove words from the profanity list')
    .addStringOption(opt => opt
      .setName('words')
      .setDescription('Comma-separated words to remove')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('upload')
    .setDescription('Upload a .txt file with one word per line (replaces entire list)')
    .addAttachmentOption(opt => opt
      .setName('file')
      .setDescription('A .txt file with one word per line')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('View all words currently in the profanity list'))
  .addSubcommand(sub => sub
    .setName('clear')
    .setDescription('Clear the custom list and revert to the built-in defaults'));

export const cooldown = 5000;

export async function execute(interaction, client) {
  if (!await checkPermissions(interaction, requiredPerms.manageGuild)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Server permission to manage the profanity list.')] });
  }

  const sub = interaction.options.getSubcommand();

  
  if (sub === 'add') {
    const raw = interaction.options.getString('words', true);
    const newWords = raw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

    if (newWords.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('No valid words provided.')] });
    }

    const guildDoc = await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $addToSet: { 'automod.profanityList': { $each: newWords } } },
      { upsert: true, new: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'profanity_add',
      moderatorId: interaction.user.id,
      details: `Added ${newWords.length} word(s). Total: ${guildDoc.automod?.profanityList?.length ?? newWords.length}`,
    });

    return interaction.editReply({
      embeds: [successEmbed(`Added **${newWords.length}** word(s) to the profanity list.\nTotal words: **${guildDoc.automod?.profanityList?.length ?? newWords.length}**`)],
    });
  }

  // ── REMOVE ───────────────────────────────────────────────────────────────
  if (sub === 'remove') {
    const raw = interaction.options.getString('words', true);
    const removeWords = raw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

    if (removeWords.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('No valid words provided.')] });
    }

    const guildDoc = await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $pullAll: { 'automod.profanityList': removeWords } },
      { upsert: true, new: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'profanity_remove',
      moderatorId: interaction.user.id,
      details: `Removed ${removeWords.length} word(s). Remaining: ${guildDoc.automod?.profanityList?.length ?? 0}`,
    });

    return interaction.editReply({
      embeds: [successEmbed(`Removed **${removeWords.length}** word(s) from the profanity list.\nRemaining words: **${guildDoc.automod?.profanityList?.length ?? 0}**`)],
    });
  }

  // ── UPLOAD ───────────────────────────────────────────────────────────────
  if (sub === 'upload') {
    const attachment = interaction.options.getAttachment('file', true);

    if (!attachment.name.endsWith('.txt')) {
      return interaction.editReply({ embeds: [errorEmbed('Only `.txt` files are supported. One word per line.')] });
    }

    if (attachment.size > 512 * 1024) {
      return interaction.editReply({ embeds: [errorEmbed('File is too large (max 512 KB).')] });
    }

    let text;
    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(`Failed to download the file: ${err.message}`)] });
    }

    // Accept one word per line OR comma-separated — strip blank lines, lowercase, deduplicate.
    const words = [...new Set(
      text
        .split(/[\r\n,]+/)
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0 && w.length <= 50)
    )];

    if (words.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('The file contained no valid words.')] });
    }

    if (words.length > 5000) {
      return interaction.editReply({ embeds: [errorEmbed(`List too large — found ${words.length} words (max 5000).`)] });
    }

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { 'automod.profanityList': words } },
      { upsert: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'profanity_upload',
      moderatorId: interaction.user.id,
      details: `Uploaded ${words.length} word(s) from ${attachment.name}`,
    });

    return interaction.editReply({
      embeds: [successEmbed(`✅ Profanity list replaced with **${words.length}** word(s) from \`${attachment.name}\`.`)],
    });
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const guildDoc = await GuildModel.findOne({ guildId: interaction.guildId }).lean();
    const list = guildDoc?.automod?.profanityList || [];

    if (list.length === 0) {
      return interaction.editReply({
        embeds: [successEmbed('No custom profanity list set — using the built-in defaults.\nUse `/profanity add` or `/profanity upload` to set a custom list.')],
      });
    }

    // For large lists, send as a .txt file attachment rather than stuffing it in an embed.
    if (list.length > 50) {
      const fileContent = list.join('\n');
      const buffer = Buffer.from(fileContent, 'utf-8');
      const file = new AttachmentBuilder(buffer, { name: 'profanity_list.txt' });
      return interaction.editReply({
        content: `📋 **${list.length}** words in the profanity list (sent as file):`,
        files: [file],
      });
    }

    // Small list — show in embed.
    const { EmbedBuilder } = await import('discord.js');
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`Profanity List (${list.length} words)`)
      .setDescription(`\`\`\`${list.join(', ')}\`\`\``)
      .setFooter({ text: 'Use /profanity add or /profanity upload to expand the list.' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  if (sub === 'clear') {
    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { 'automod.profanityList': [] } },
      { upsert: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'profanity_clear',
      moderatorId: interaction.user.id,
      details: 'Custom profanity list cleared — reverted to built-in defaults',
    });

    return interaction.editReply({
      embeds: [successEmbed('Custom profanity list cleared. The built-in default list is now active.')],
    });
  }
}
