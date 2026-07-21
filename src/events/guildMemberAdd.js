import { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { GuildModel } from '../models/Guild.js';
import { WelcomeSettingsModel } from '../models/WelcomeSettings.js';
import { QuarantineModel } from '../models/Quarantine.js';
import { logger } from '../utils/logger.js';
import { createWelcomeCard } from '../utils/welcomeCard.js';
import { config as appConfig } from '../config.js';
import { getGuildQueue } from '../utils/rateLimitQueue.js';
import { createUnifiedModEmbed } from '../utils/modLogEmbed.js';
import { createCase, logAudit } from '../utils/caseUtils.js';

export const name = 'guildMemberAdd';

const joinTracker = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [guildId, entries] of joinTracker) {
    const recent = entries.filter(e => now - e.joinedAt < 60000);
    if (recent.length === 0) {
      joinTracker.delete(guildId);
    } else {
      joinTracker.set(guildId, recent);
    }
  }
}, 60000).unref();

export async function execute(member, client) {
  if (member.user.bot) return; // Exempt bots from gateway checks

  const guildData = await GuildModel.findOne({ guildId: member.guild.id }).lean();

  if (guildData?.raidMode?.active) {
    // If raid mode is active, quarantine all new joins immediately for 15 minutes
    try {
      await quarantineMember(member, true);
      return;
    } catch (err) {
      logger.error(`Raid quarantine failed for ${member.id} in ${member.guild.id}: ${err.message}`);
    }
  }

  const antiRaid = guildData?.antiRaid;
  if (antiRaid?.enabled) {
    const now = Date.now();
    const guildJoins = joinTracker.get(member.guild.id) || [];
    const recent = guildJoins.filter(e => now - e.joinedAt < 60000);
    recent.push({ userId: member.id, joinedAt: now, createdAt: member.user.createdTimestamp });
    joinTracker.set(member.guild.id, recent);

    const maxJoins = antiRaid.maxJoinsPerMinute || 5;
    const youngAccounts = recent.filter(j => now - j.createdAt < (antiRaid.accountAgeMinutes || 1440) * 60000).length;

    // Combined Signal: Hard Raid Mode Trigger
    if (recent.length > maxJoins && youngAccounts >= 3) {
      logger.warn(`Hard Raid Mode triggered in ${member.guild.id}! Joins: ${recent.length}/min | Young Accounts: ${youngAccounts}`);
      await triggerHardRaidMode(member.guild, member.user.tag);
      await quarantineMember(member, true);
      return;
    }

    // Default Avatar Heuristic Risk Calculation
    let riskPoints = 0;
    const hasDefaultAvatar = !member.user.avatar;
    if (hasDefaultAvatar) riskPoints += 1;

    const accountAge = now - member.user.createdTimestamp;
    const minAge = (antiRaid.accountAgeMinutes || 1440) * 60 * 1000;
    if (accountAge < minAge) riskPoints += 2;

    // soft quarantine check: riskPoints >= 2 (default avatar + young account, or just very young account)
    if (riskPoints >= 2) {
      await quarantineMember(member, false);
      return;
    }
  }

  // If no raid triggers or quarantine occurred, run normal welcomer and join roles
  const clientConfig = client.guildConfigs?.get(member.guild.id);
  const joinRoleId = clientConfig?.joinRole || guildData?.joinRole;
  if (joinRoleId) {
    const role = member.guild.roles.cache.get(joinRoleId);
    if (role) {
      try {
        await member.roles.add(role);
      } catch { }
    }
  }

  await handleWelcomer(member, client);
  await handleAutoRole(member, client);
}

async function getOrCreateQuarantineRole(guild) {
  const guildData = await GuildModel.findOne({ guildId: guild.id });
  const cachedRole = guildData?.antiRaid?.quarantineRole;
  if (cachedRole) {
    const role = guild.roles.cache.get(cachedRole);
    if (role) return role;
  }

  // Create a new Quarantined role
  const role = await guild.roles.create({
    name: 'Quarantined',
    color: '#808080',
    permissions: [],
    reason: '[Anti-Raid] Automatic quarantine role creation'
  });

  // Cache in database
  await GuildModel.findOneAndUpdate(
    { guildId: guild.id },
    { 'antiRaid.quarantineRole': role.id }
  );
  guild.client.eventHandler?.invalidateGuildConfig(guild.id);

  // Set overrides in channels (via rate-limit queue)
  const queue = getGuildQueue(guild.id);
  guild.channels.cache.forEach(channel => {
    if (channel.manageable) {
      queue.addTask(async () => {
        await channel.permissionOverwrites.edit(role.id, {
          ViewChannel: false,
          SendMessages: false,
          Connect: false
        }, { reason: '[Anti-Raid] Auto Quarantine Overrides' });
      });
    }
  });

  return role;
}

async function quarantineMember(member, isHardRaid = false) {
  const guild = member.guild;
  const role = await getOrCreateQuarantineRole(guild);
  const dryRun = (await GuildModel.findOne({ guildId: guild.id }).lean())?.antiRaid?.dryRun || false;

  if (!dryRun) {
    await member.roles.add(role, `[Anti-Raid] Quarantined due to ${isHardRaid ? 'Hard Raid' : 'Soft Flag'}`).catch(() => {});
  }

  const duration = isHardRaid ? 900000 : 600000; // 15 mins vs 10 mins
  
  await new QuarantineModel({
    guildId: guild.id,
    userId: member.id,
    expiresAt: new Date(Date.now() + duration)
  }).save();

  logger.warn(`Quarantined user ${member.user.tag} (${member.id}) in ${guild.id} (Hard: ${isHardRaid} | Dry-run: ${dryRun}).`);

  // Log to Audit Log and modLog channel
  const caseEntry = await createCase({
    guildId: guild.id,
    type: 'automod_violation',
    targetId: member.id,
    targetTag: member.user.tag,
    moderatorId: guild.members.me.id,
    moderatorTag: guild.members.me.user.tag,
    reason: `[Anti-Raid] Quarantined due to ${isHardRaid ? 'Hard Raid Mode' : 'Soft Flag'}. Duration: ${duration / 60000} mins. ${dryRun ? '(DRY-RUN)' : ''}`,
  });

  const guildConfig = await GuildModel.findOne({ guildId: guild.id });
  const logChannelId = guildConfig?.modLogChannel || guildConfig?.auditChannel;
  if (logChannelId) {
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel) {
      const embed = createUnifiedModEmbed({
        title: `Case #${caseEntry.caseNumber} | QUARANTINE`,
        description: `User placed in quarantine hold.`,
        colorType: 'antiraid',
        fields: [
          { name: 'Target', value: `<@${member.id}> (\`${member.id}\`)`, inline: true },
          { name: 'Duration', value: `${duration / 60000} minutes`, inline: true },
          { name: 'Reason', value: caseEntry.reason, inline: false },
        ]
      });
      await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  await logAudit({
    guildId: guild.id,
    action: 'quarantine',
    moderatorId: guild.members.me.id,
    targetId: member.id,
    reason: caseEntry.reason,
  });
}

async function triggerHardRaidMode(guild, joinerTag) {
  try {
    const textChannels = guild.channels.cache.filter(
      ch => ch.isTextBased() && ch.permissionsFor(guild.id)?.has('SendMessages')
    );

    const lockedChannels = [];
    const queue = getGuildQueue(guild.id);
    
    textChannels.forEach(ch => {
      queue.addTask(async () => {
        await ch.permissionOverwrites.edit(guild.id, { SendMessages: false });
        lockedChannels.push(ch.id);
      });
    });

    await guild.edit({ verificationLevel: 3 }).catch(() => {});

    await GuildModel.findOneAndUpdate(
      { guildId: guild.id },
      {
        'raidMode.active': true,
        'raidMode.triggeredAt': new Date(),
        'raidMode.triggeredBy': `Hard Raid Mode triggered by joining flood`,
        'raidMode.previousVerificationLevel': guild.verificationLevel,
        'raidMode.lockedChannels': lockedChannels,
      }
    );

    // Send Alert to Mod channel
    const guildConfig = await GuildModel.findOne({ guildId: guild.id });
    const alertChannel = guild.channels.cache.get(guildConfig?.modLogChannel || guildConfig?.auditChannel);
    if (alertChannel?.isTextBased()) {
      const embed = createUnifiedModEmbed({
        title: '🚨 EMERGENCY HARD RAID MODE ENABLED',
        description: `Server is under a heavy joining raid! Enabling emergency lockdowns.`,
        colorType: 'antiraid',
        fields: [
          { name: 'Verification Level', value: 'High (Level 3)', inline: true },
          { name: 'Channel Locks', value: `Locked public sending in **${textChannels.size}** channels`, inline: true },
        ]
      });
      await alertChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    logger.error(`triggerHardRaidMode error in ${guild.id}: ${err.message}`);
  }
}

export async function runQuarantineRelease(client) {
  try {
    const now = new Date();
    const expired = await QuarantineModel.find({ released: false, expiresAt: { $lte: now } });
    for (const entry of expired) {
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) continue;
      
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      if (member) {
        const guildData = await GuildModel.findOne({ guildId: guild.id }).lean();
        const roleId = guildData?.antiRaid?.quarantineRole;
        if (roleId) {
          const role = guild.roles.cache.get(roleId);
          if (role && member.roles.cache.has(roleId)) {
            await member.roles.remove(role, '[Anti-Raid] Quarantine expired').catch(() => {});
            logger.info(`Released user ${member.user.tag} in guild ${guild.id} from quarantine.`);
          }
        }
      }
      entry.released = true;
      await entry.save();
    }
  } catch (err) {
    logger.error(`runQuarantineRelease error: ${err.message}`);
  }
}

async function handleWelcomer(member, client) {
  try {
    const welcomeSettings = await WelcomeSettingsModel.findOne({ guildId: member.guild.id });
    if (!welcomeSettings?.enabled || !welcomeSettings.channelId) return;

    const channel = member.guild.channels.cache.get(welcomeSettings.channelId);
    if (!channel?.isTextBased()) return;

    const memberCount = member.guild.memberCount;
    const rulesChannel = member.guild.channels.cache.find(c => c.name && c.name.toLowerCase().includes('rules'));
    const rulesMention = rulesChannel ? `${rulesChannel}` : '#rules';

    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const cardBuffer = await createWelcomeCard(member.user.username, memberCount, avatarUrl);
    const filename = `welcome-${Date.now()}.png`;
    const attachment = new AttachmentBuilder(cardBuffer, { name: filename });

    const serverName = member.guild.name;
    const rawTemplate = welcomeSettings.messageTemplate || appConfig.welcomeTemplate;
    const formattedMessage = rawTemplate
      .replace(/{user}/g, `${member.user}`)
      .replace(/{username}/g, member.user.username)
      .replace(/{server}/g, serverName)
      .replace(/{membercount}/g, memberCount.toString())
      .replace(/{rules}/g, rulesMention);

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`Welcome ${member.user.username} to ${serverName}!`)
      .setDescription(formattedMessage)
      .setImage(`attachment://${filename}`);

    const customImg = welcomeSettings.welcomeImageUrl || appConfig.welcomeImageUrl;
    if (customImg) {
      embed.setThumbnail(customImg);
    }

    await channel.send({ embeds: [embed], files: [attachment] });
  } catch (err) {
    logger.error(`Welcome embed failed for ${member.guild.id}: ${err.message}`);
  }
}

async function handleAutoRole(member, client) {
  try {
    const welcomeSettings = await WelcomeSettingsModel.findOne({ guildId: member.guild.id }).catch(() => null);
    if (!welcomeSettings?.enabled) return;

    const roleId = welcomeSettings.roleId;
    if (!roleId) return;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) return;

    await member.roles.add(role);
  } catch (err) {
    logger.error(`Failed to assign welcome role to ${member.id} in ${member.guild.id}: ${err.message}`);
    try {
      const settings = await WelcomeSettingsModel.findOne({ guildId: member.guild.id }).catch(() => null);
      const welcomeChannel = settings?.channelId ? member.guild.channels.cache.get(settings.channelId) : null;
      if (welcomeChannel?.isTextBased()) {
        await welcomeChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('⚠ Auto-Role Failed')
              .setDescription(`Failed to assign the welcome role to ${member.user}.\n\n**Possible reasons:**\n- I lack the \`Manage Roles\` permission\n- The role is above my highest role\n- The role no longer exists\n\nPlease check my permissions and role position.`)
              .setTimestamp(),
          ],
        });
      }
    } catch { }
  }
}
