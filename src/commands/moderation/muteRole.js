import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { withConcurrencyLimit } from '../../utils/concurrency.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('muterole')
  .setDescription('Manage the mute role')
  .addSubcommandGroup(group =>
    group.setName('set')
      .setDescription('Set the mute role')
      .addSubcommand(sub =>
        sub.setName('role')
          .setDescription('Set a specific role as the mute role')
          .addRoleOption(opt => opt.setName('role').setDescription('Role to use as mute role').setRequired(true))
      )
  )
  .addSubcommandGroup(group =>
    group.setName('create')
      .setDescription('Create a mute role')
      .addSubcommand(sub =>
        sub.setName('role')
          .setDescription('Auto-create a "Muted" role and apply channel overwrites')
      )
  );

export const cooldown = 5000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, [...requiredPerms.manageRoles, ...requiredPerms.manageChannels])) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Roles and Manage Channels permissions.')] });
  }

  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === 'set' && sub === 'role') {
    const role = interaction.options.getRole('role', true);

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { muteRole: role.id },
      { upsert: true }
    );

    await logAudit({
      guildId: interaction.guildId,
      action: 'muterole_set',
      moderatorId: interaction.user.id,
      targetId: role.id,
      reason: 'Mute role configured',
      details: `Role: ${role.name}`,
    });

    return interaction.editReply({ embeds: [successEmbed(`Mute role set to **${role.name}**`)] });
  }

  if (group === 'create' && sub === 'role') {
    if (!botHasPermissions(interaction.guild, [...requiredPerms.manageRoles, ...requiredPerms.manageChannels])) {
      return interaction.editReply({ embeds: [errorEmbed('Bot needs Manage Roles and Manage Channels permissions.')] });
    }

    let muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
    if (!muteRole) {
      try {
        muteRole = await interaction.guild.roles.create({
          name: 'Muted',
          color: 0x808080,
          reason: 'Auto-created mute role',
        });
      } catch (err) {
        logger.error(`Failed to create mute role: ${err.message}`, err);
        return interaction.editReply({ embeds: [errorEmbed('Failed to create mute role. Check bot permissions and try again.')] });
      }
    }

    const textChannels = interaction.guild.channels.cache.filter(ch => ch.isTextBased());

    await withConcurrencyLimit([...textChannels.values()], channel =>
      channel.permissionOverwrites.create(muteRole, {
        SendMessages: false,
        AddReactions: false,
        Speak: false,
      }).catch(() => {})
    );

    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { muteRole: muteRole.id },
      { upsert: true }
    );

    await logAudit({
      guildId: interaction.guildId,
      action: 'muterole_create',
      moderatorId: interaction.user.id,
      targetId: muteRole.id,
      reason: 'Mute role auto-created',
      details: `Role: ${muteRole.name}`,
    });

    return interaction.editReply({ embeds: [successEmbed(`Muted role **${muteRole.name}** created and applied to all channels.`)] });
  }
}
