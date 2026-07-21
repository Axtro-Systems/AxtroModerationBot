import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { checkPermissions, canActOnMember, botHasPermissions, requiredPerms } from '../../utils/permissions.js';
import { logAudit } from '../../utils/caseUtils.js';
import { successEmbed, errorEmbed } from '../../utils/embed.js';
import { withConcurrencyLimit, chunkArray } from '../../utils/concurrency.js';
import { GuildModel } from '../../models/Guild.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage member roles')
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Add a role to a user')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('Role to add').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for the action'))
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove a role from a user')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for the action'))
  )
  .addSubcommand(sub =>
    sub.setName('addall')
      .setDescription('Add a role to all matching members')
      .addRoleOption(opt => opt.setName('role').setDescription('Role to add').setRequired(true))
      .addStringOption(opt =>
        opt.setName('filter')
          .setDescription('Filter members')
          .setRequired(true)
          .addChoices(
            { name: 'All', value: 'all' },
            { name: 'Humans', value: 'humans' },
            { name: 'Bots', value: 'bots' },
          )
      )
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for the action'))
  )
  .addSubcommand(sub =>
    sub.setName('removeall')
      .setDescription('Remove a role from all matching members')
      .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true))
      .addStringOption(opt =>
        opt.setName('filter')
          .setDescription('Filter members')
          .setRequired(true)
          .addChoices(
            { name: 'All', value: 'all' },
            { name: 'Humans', value: 'humans' },
            { name: 'Bots', value: 'bots' },
          )
      )
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for the action'))
  );

export const cooldown = 3000;

export async function execute(interaction, client) {

  if (!await checkPermissions(interaction, requiredPerms.manageRoles)) {
    return interaction.editReply({ embeds: [errorEmbed('You need Manage Roles permission.')] });
  }

  if (!botHasPermissions(interaction.guild, requiredPerms.manageRoles)) {
    return interaction.editReply({ embeds: [errorEmbed('I need Manage Roles permission.')] });
  }

  const sub = interaction.options.getSubcommand();
  const role = interaction.options.getRole('role', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (role.managed) {
    return interaction.editReply({ embeds: [errorEmbed('Cannot manage bot-managed roles.')] });
  }

  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    return interaction.editReply({ embeds: [errorEmbed('That role is higher than my highest role.')] });
  }

  if (sub === 'add' || sub === 'remove') {
    const user = interaction.options.getUser('user', true);
    const member = interaction.options.getMember('user') || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
    }

    if (!canActOnMember(interaction.member, member)) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot manage roles for this user.')] });
    }

    if (!canActOnMember(interaction.guild.members.me, member)) {
      return interaction.editReply({ embeds: [errorEmbed('I cannot manage roles for this user due to role hierarchy.')] });
    }

    const hasRole = member.roles.cache.has(role.id);

    if (sub === 'add' && hasRole) {
      return interaction.editReply({ embeds: [errorEmbed(`${member.user.tag} already has that role.`)] });
    }
    if (sub === 'remove' && !hasRole) {
      return interaction.editReply({ embeds: [errorEmbed(`${member.user.tag} does not have that role.`)] });
    }

    try {
      if (sub === 'add') {
        await member.roles.add(role, reason);
      } else {
        await member.roles.remove(role, reason);
      }
    } catch (err) {
      logger.error(`Failed to ${sub} role: ${err.message}`, err);
      return interaction.editReply({ embeds: [errorEmbed(`Failed to ${sub} role. Check bot permissions and try again.`)] });
    }

    await logAudit({
      guildId: interaction.guildId,
      action: `role_${sub}`,
      moderatorId: interaction.user.id,
      targetId: user.id,
      reason,
      details: `Role: ${role.name} (${role.id})`,
    });

    const actionLabel = sub === 'add' ? 'Added' : 'Removed';
    return interaction.editReply({ embeds: [successEmbed(`${actionLabel} **${role.name}** ${sub === 'add' ? 'to' : 'from'} **${member.user.tag}**`)] });
  }

  if (sub === 'addall' || sub === 'removeall') {
    const filter = interaction.options.getString('filter', true);

    if (interaction.guild.memberCount >= 5000) {
      return interaction.editReply({ embeds: [errorEmbed('Server too large for bulk role operations (max 5000 members).')] });
    }

    await interaction.guild.members.fetch();

    let members = [...interaction.guild.members.cache.values()];

    if (filter === 'humans') members = members.filter(m => !m.user.bot);
    if (filter === 'bots') members = members.filter(m => m.user.bot);

    const actionLabel = sub === 'addall' ? 'add' : 'remove';
    const verbLabel = sub === 'addall' ? 'Added' : 'Removed';
    let processed = 0;
    let failed = 0;
    const total = members.length;

    if (total === 0) {
      return interaction.editReply({ embeds: [errorEmbed('No matching members found.')] });
    }

    await interaction.editReply({ embeds: [successEmbed(`Starting bulk role ${actionLabel} for ${total} members...`)] });

    const chunks = chunkArray(members, 25);
    for (const chunk of chunks) {
      await withConcurrencyLimit(chunk, async member => {
        try {
          if (sub === 'addall') {
            if (!member.roles.cache.has(role.id)) {
              await member.roles.add(role, reason);
              processed++;
            }
          } else {
            if (member.roles.cache.has(role.id)) {
              await member.roles.remove(role, reason);
              processed++;
            }
          }
        } catch {
          failed++;
        }
      });

      try {
        await interaction.editReply({
          embeds: [successEmbed(
            `Bulk role ${actionLabel} in progress...\nProcessed: ${processed + failed}/${total}\nCompleted: ${processed} | Failed: ${failed}`
          )],
        });
      } catch { }
    }

    await logAudit({
      guildId: interaction.guildId,
      action: `role_bulk_${actionLabel}`,
      moderatorId: interaction.user.id,
      targetId: role.id,
      reason,
      details: `Filter: ${filter} | Processed: ${processed} | Failed: ${failed} | Total: ${total}`,
    });

    return interaction.editReply({
      embeds: [successEmbed(
        `${verbLabel} **${role.name}** ${actionLabel === 'add' ? 'to' : 'from'} **${processed}** members.\nFailed: ${failed} | Total members checked: ${total}`
      )],
    });
  }
}
