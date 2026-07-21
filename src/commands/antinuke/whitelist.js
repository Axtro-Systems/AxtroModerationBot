import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { checkPermissions, requiredPerms } from '../../utils/permissions.js';
import { GuildModel } from '../../models/Guild.js';
import { logAudit } from '../../utils/caseUtils.js';

export const data = new SlashCommandBuilder()
  .setName('antinuke-whitelist')
  .setDescription('Manage the anti-nuke whitelist')
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add a user to the anti-nuke whitelist')
    .addUserOption(opt => opt.setName('user').setDescription('User to whitelist').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a user from the anti-nuke whitelist')
    .addUserOption(opt => opt.setName('user').setDescription('User to remove from whitelist').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List all whitelisted users'));

export const cooldown = 10000;

export async function execute(interaction, client) {

  const subcommand = interaction.options.getSubcommand();

  
  
  
  if (subcommand === 'add' || subcommand === 'remove') {
    const isGuildOwner = interaction.user.id === interaction.guild.ownerId;
    const isBotOwner = client.config?.ownerId && interaction.user.id === client.config.ownerId;
    if (!isGuildOwner && !isBotOwner) {
      return interaction.editReply({ embeds: [errorEmbed('Only the server owner can modify the anti-nuke whitelist.')] });
    }
  } else {
    
    if (!await checkPermissions(interaction, requiredPerms.admin)) {
      return interaction.editReply({ embeds: [errorEmbed('You need Administrator permissions to use this command.')] });
    }
  }

  if (subcommand === 'add') {
    const user = interaction.options.getUser('user', true);

    const ownerId = client.config?.ownerId;
    if (ownerId && user.id === ownerId) {
      return interaction.editReply({ embeds: [errorEmbed('Cannot whitelist the bot owner.')] });
    }

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $addToSet: { 'antiNuke.whitelist': user.id } },
      { upsert: true, new: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'antinuke_whitelist_add',
      moderatorId: interaction.user.id,
      targetId: user.id,
      details: `${user.tag} added to anti-nuke whitelist`,
    });

    return interaction.editReply({
      embeds: [successEmbed(`**${user.tag}** (\`${user.id}\`) has been added to the anti-nuke whitelist.`)],
    });
  }

  if (subcommand === 'remove') {
    const user = interaction.options.getUser('user', true);

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $pull: { 'antiNuke.whitelist': user.id } },
      { upsert: true, new: true }
    );

    client.eventHandler?.invalidateGuildConfig(interaction.guildId);

    await logAudit({
      guildId: interaction.guildId,
      action: 'antinuke_whitelist_remove',
      moderatorId: interaction.user.id,
      targetId: user.id,
      details: `${user.tag} removed from anti-nuke whitelist`,
    });

    return interaction.editReply({
      embeds: [successEmbed(`**${user.tag}** (\`${user.id}\`) has been removed from the anti-nuke whitelist.`)],
    });
  }

  if (subcommand === 'list') {
    const guildConfig = await GuildModel.findOne({ guildId: interaction.guildId });

    const whitelist = guildConfig?.antiNuke?.whitelist || [];

    if (whitelist.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('Anti-Nuke Whitelist')
          .setDescription('No users are currently whitelisted.')
          .setTimestamp(),
        ],
      });
    }

    const list = whitelist.map(id => {
      const user = client.users.cache.get(id);
      return user ? `**${user.tag}** (\`${id}\`)` : `\`${id}\``;
    }).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0x00FF7F)
      .setTitle('Anti-Nuke Whitelist')
      .setDescription(list)
      .setFooter({ text: `${whitelist.length} user${whitelist.length !== 1 ? 's' : ''} whitelisted` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
