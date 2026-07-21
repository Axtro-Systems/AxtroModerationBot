import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, time, TimestampStyles } from 'discord.js';
import mongoose from 'mongoose';
import { GiveawayModel } from '../models/Giveaway.js';
import { GuildModel } from '../models/Guild.js';
import { logger } from './logger.js';
import { simpleEmbed, errorEmbed, successEmbed, getLogoUrl } from './embed.js';

class GiveawayManager {
  constructor() {
    this.client = null;
    this.isTicking = false;
    this.lastEmbedUpdate = new Map(); 
    this.pendingUpdates = new Map(); // messageId -> Timeout handle
  }

  init(client) {
    this.client = client;
    
    setInterval(() => this.runMaintenanceTick().catch(err => logger.error(`Maintenance tick error: ${err.message}`)), 10000);
    logger.info('GiveawayManager initialized');
    
    
    setTimeout(() => this.recoverActiveGiveaways().catch(err => logger.error(`Recovery error: ${err.message}`)), 5000);
  }

  async recoverActiveGiveaways() {
    if (!this.client) return;
    const active = await GiveawayModel.find({ status: { $in: ['active', 'paused', 'scheduled'] } });
    logger.info(`GiveawayManager recovery: Found ${active.length} active/paused/scheduled giveaways to resume.`);
  }

  
  selectWinners(entries, count, excludeUserIds = []) {
    const pool = entries.filter(e => !excludeUserIds.includes(e.userId));
    if (pool.length === 0) return [];
    
    const scored = pool.map(e => {
      const u = Math.random();
      const key = Math.pow(u, 1 / (e.weight || 1));
      return { userId: e.userId, key };
    });
    
    scored.sort((a, b) => b.key - a.key);
    return scored.slice(0, Math.min(count, scored.length)).map(s => s.userId);
  }

  async checkUserEligibility(member, giveaway) {
    
    if (giveaway.whitelistRoles && giveaway.whitelistRoles.length > 0) {
      const hasWhitelist = member.roles.cache.some(r => giveaway.whitelistRoles.includes(r.id));
      if (hasWhitelist) return true; // Bypasses all other requirements
    }

    
    if (giveaway.blacklistRoles && giveaway.blacklistRoles.length > 0) {
      const hasBlacklist = member.roles.cache.some(r => giveaway.blacklistRoles.includes(r.id));
      if (hasBlacklist) return false;
    }

    
    if (giveaway.requiredRoles && giveaway.requiredRoles.length > 0) {
      const hasRequired = member.roles.cache.some(r => giveaway.requiredRoles.includes(r.id));
      if (!hasRequired) return false;
    }

    
    if (giveaway.minAccountAge) {
      const accountAge = Date.now() - member.user.createdTimestamp;
      if (accountAge < giveaway.minAccountAge) return false;
    }

    
    if (giveaway.minJoinDate && member.joinedTimestamp) {
      const joinDuration = Date.now() - member.joinedTimestamp;
      if (joinDuration < giveaway.minJoinDate) return false;
    }

    return true;
  }

  calculateUserWeight(member, giveaway) {
    let weight = 1;

    
    if (giveaway.boosterBonus && member.premiumSince) {
      weight += giveaway.boosterBonus;
    }

   
    if (giveaway.bonusRoles && giveaway.bonusRoles.length > 0) {
      for (const bonus of giveaway.bonusRoles) {
        if (member.roles.cache.has(bonus.roleId)) {
          weight += bonus.weight;
        }
      }
    }

    return weight;
  }

  buildGiveawayEmbed(giveaway, customStatusText = null) {
    const embedColor = giveaway.embedColor ? parseInt(giveaway.embedColor.replace('#', ''), 16) : 0x5865F2;
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`🎉 ${giveaway.prize} 🎉`)
      .setFooter({ text: giveaway.footerText || 'AxtroPvP Giveaways', iconURL: getLogoUrl() })
      .setTimestamp(giveaway.createdAt);

    if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
    if (giveaway.thumbnailUrl) embed.setThumbnail(giveaway.thumbnailUrl);

    const hostStr = `<@${giveaway.hostId}>`;
    const endTimeUnix = Math.floor(giveaway.endTime.getTime() / 1000);
    const timeStr = `<t:${endTimeUnix}:R> (<t:${endTimeUnix}:f>)`;

    if (giveaway.status === 'scheduled') {
      const startTimeUnix = Math.floor(giveaway.startTime.getTime() / 1000);
      embed.setDescription(
        `This giveaway is scheduled to start at <t:${startTimeUnix}:f>.\n\n` +
        `**Prize:** ${giveaway.prize}\n` +
        `**Winners:** ${giveaway.winnerCount}\n` +
        `**Hosted By:** ${hostStr}`
      );
      return embed;
    }

    if (giveaway.status === 'paused') {
      embed.setDescription(
        `**Giveaway Paused** ⏸️\n\n` +
        `**Prize:** ${giveaway.prize}\n` +
        `**Winners:** ${giveaway.winnerCount}\n` +
        `**Hosted By:** ${hostStr}\n\n` +
        `Entries: **${giveaway.entries.length}**`
      );
      return embed;
    }

    if (giveaway.status === 'ended') {
      let winnerList = giveaway.winners.length > 0
        ? giveaway.winners.map(w => {
            const isClaimed = giveaway.claimed.includes(w);
            return `<@${w}>${isClaimed ? ' (Claimed ✅)' : ''}`;
          }).join(', ')
        : 'No winners (no eligible entries)';

      if (customStatusText) {
        winnerList += `\n\n*${customStatusText}*`;
      } else if (giveaway.claimTimeLimit && giveaway.winners.length > 0 && giveaway.claimed.length < giveaway.winners.length) {
        const claimExpiryUnix = Math.floor(giveaway.claimExpiresAt.getTime() / 1000);
        winnerList += `\n\n⚠️ Winners have until <t:${claimExpiryUnix}:f> (<t:${claimExpiryUnix}:R>) to claim their prize!`;
      }

      embed.setTitle(`🎉 GIVEAWAY ENDED: ${giveaway.prize} 🎉`)
        .setDescription(
          `**Winners:** ${winnerList}\n` +
          `**Hosted By:** ${hostStr}\n\n` +
          `Total Entries: **${giveaway.entries.length}**`
        );
      return embed;
    }

    
    // Active Status
    let desc = `**Time Remaining:** ${timeStr}\n` +
      `**Winners:** ${giveaway.winnerCount}\n` +
      `**Hosted By:** ${hostStr}\n\n` +
      `Entries: **${giveaway.entries.length}**`;

    const reqs = [];
    if (giveaway.requiredRoles && giveaway.requiredRoles.length > 0) {
      reqs.push(`- Required Roles: ${giveaway.requiredRoles.map(r => `<@&${r}>`).join(', ')}`);
    }
    if (giveaway.blacklistRoles && giveaway.blacklistRoles.length > 0) {
      reqs.push(`- Blacklisted Roles: ${giveaway.blacklistRoles.map(r => `<@&${r}>`).join(', ')}`);
    }
    if (giveaway.minAccountAge) {
      const days = Math.round(giveaway.minAccountAge / (24 * 60 * 60 * 1000));
      reqs.push(`- Min Account Age: **${days} days**`);
    }
    if (giveaway.minJoinDate) {
      const days = Math.round(giveaway.minJoinDate / (24 * 60 * 60 * 1000));
      reqs.push(`- Min Server Membership: **${days} days**`);
    }

    if (reqs.length > 0) {
      desc += `\n\n**Entry Requirements:**\n${reqs.join('\n')}`;
    }

    const bonus = [];
    if (giveaway.boosterBonus) {
      bonus.push(`- Server Boosters: **+${giveaway.boosterBonus} entries**`);
    }
    if (giveaway.bonusRoles && giveaway.bonusRoles.length > 0) {
      for (const b of giveaway.bonusRoles) {
        bonus.push(`- <@&${b.roleId}>: **+${b.weight} entries**`);
      }
    }

    if (bonus.length > 0) {
      desc += `\n\n**Bonus Entries:**\n${bonus.join('\n')}`;
    }

    desc += `\n\n👉 Click the **Join** button below to enter!`;

    embed.setDescription(desc);
    return embed;
  }

  async startGiveaway(giveaway) {
    if (!this.client) return;

    const guild = this.client.guilds.cache.get(giveaway.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(giveaway.channelId);
    if (!channel?.isTextBased()) return;

    const embed = this.buildGiveawayEmbed(giveaway);
    const row = new ActionRowBuilder();

    const button = new ButtonBuilder()
      .setCustomId(`giveaway_entry_${giveaway.giveawayId}`)
      .setEmoji('🎉')
      .setLabel(`Join (${giveaway.entries.length})`)
      .setStyle(ButtonStyle.Primary);
    row.addComponents(button);

    if (giveaway.showParticipants) {
      const listButton = new ButtonBuilder()
        .setCustomId(`giveaway_list_users_${giveaway.giveawayId}`)
        .setEmoji('👥')
        .setLabel('View Participants')
        .setStyle(ButtonStyle.Secondary);
      row.addComponents(listButton);
    }

    const msg = await channel.send({ embeds: [embed], components: [row] });

    giveaway.messageId = msg.id;
    giveaway.status = 'active';
    await giveaway.save();

    await this.logGiveawayAction(giveaway, 'started');
    logger.info(`Giveaway started: ${giveaway.prize} in channel ${giveaway.channelId}`);
  }

  async endGiveaway(giveawayId, force = false) {
    const pending = this.pendingUpdates.get(giveawayId);
    if (pending) {
      clearTimeout(pending);
      this.pendingUpdates.delete(giveawayId);
    }

    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway || giveaway.status === 'ended') return;

    
    if (giveaway.rerollInProgress) return;

    giveaway.status = 'ended';
    giveaway.endTime = new Date();

    
    const winners = this.selectWinners(giveaway.entries, giveaway.winnerCount);
    giveaway.winners = winners;

    if (giveaway.claimTimeLimit && winners.length > 0) {
      giveaway.claimExpiresAt = new Date(Date.now() + giveaway.claimTimeLimit);
    }

    await giveaway.save();

    await this.updateGiveawayMessage(giveaway);
    await this.notifyWinners(giveaway);
    await this.logGiveawayAction(giveaway, 'ended');
    logger.info(`Giveaway ended: ${giveaway.prize} (${giveaway.giveawayId})`);
  }

  async rerollGiveaway(giveawayId, count = 1, targetUserIds = null) {
    
    const giveaway = await GiveawayModel.findOneAndUpdate(
      { giveawayId, status: 'ended', rerollInProgress: false },
      { $set: { rerollInProgress: true } },
      { new: true }
    );

    if (!giveaway) {
      throw new Error('Giveaway not found, not ended, or a reroll is already in progress.');
    }

    try {
      const guild = this.client.guilds.cache.get(giveaway.guildId);
      if (!guild) throw new Error('Guild not found.');

      
      let currentWinners = [...giveaway.winners];
      let usersToReroll = [];

      if (targetUserIds && targetUserIds.length > 0) {
        usersToReroll = targetUserIds.filter(id => currentWinners.includes(id));
      } else {
        
        usersToReroll = currentWinners.filter(w => !giveaway.claimed.includes(w));
      }

      if (usersToReroll.length === 0 && !targetUserIds) {
        
        usersToReroll = [...currentWinners];
      }

      if (usersToReroll.length === 0) {
        giveaway.rerollInProgress = false;
        await giveaway.save();
        throw new Error('No eligible winners found to reroll.');
      }

      
      for (const id of usersToReroll) {
        if (!giveaway.disqualifiedWinners.includes(id)) {
          giveaway.disqualifiedWinners.push(id);
        }
        const idx = currentWinners.indexOf(id);
        if (idx !== -1) currentWinners.splice(idx, 1);
      }

      const exclude = [...currentWinners, ...giveaway.disqualifiedWinners];
      const rerollCount = Math.min(count || usersToReroll.length, giveaway.entries.length - exclude.length);

      if (rerollCount <= 0) {
        giveaway.rerollInProgress = false;
        await giveaway.save();
        throw new Error('No remaining eligible entries to draw from.');
      }

      
      const drawnWinners = [];
      let tempExclude = [...exclude];

      while (drawnWinners.length < rerollCount) {
        const potential = this.selectWinners(giveaway.entries, rerollCount - drawnWinners.length, tempExclude);
        if (potential.length === 0) break;

        for (const userId of potential) {
          tempExclude.push(userId);
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) {
            giveaway.disqualifiedWinners.push(userId);
            continue;
          }

          const eligible = await this.checkUserEligibility(member, giveaway);
          if (!eligible) {
            giveaway.disqualifiedWinners.push(userId);
            continue;
          }

          drawnWinners.push(userId);
        }
      }

      if (drawnWinners.length === 0) {
        giveaway.rerollInProgress = false;
        await giveaway.save();
        throw new Error('Failed to find eligible replacement winners in the entries pool.');
      }

      
      const newWinners = [...currentWinners, ...drawnWinners];
      giveaway.winners = newWinners;

      
      if (giveaway.claimTimeLimit) {
        giveaway.claimExpiresAt = new Date(Date.now() + giveaway.claimTimeLimit);
      }

      giveaway.rerollInProgress = false;
      await giveaway.save();

      await this.updateGiveawayMessage(giveaway);

      const channel = guild.channels.cache.get(giveaway.channelId);
      if (channel) {
        const mentions = drawnWinners.map(w => `<@${w}>`).join(', ');
        const rerollEmbed = successEmbed(`**Reroll Draw Complete!**\nNew Winner(s): ${mentions}\nPrize: **${giveaway.prize}**`);
        await channel.send({ content: mentions, embeds: [rerollEmbed] });
      }

      
      for (const w of drawnWinners) {
        if (giveaway.dmNotify) {
          const user = await this.client.users.fetch(w).catch(() => null);
          if (user) {
            await user.send(`🎉 **You won a reroll!** You are the new winner of **${giveaway.prize}** in **${guild.name}**!\nClick "Claim" in the giveaway message to claim your prize!`).catch(() => {});
          }
        }
      }

      await this.logGiveawayAction(giveaway, 'rerolled', `New winners: ${drawnWinners.join(', ')}`);
      return drawnWinners;
    } catch (err) {
      giveaway.rerollInProgress = false;
      await giveaway.save();
      throw err;
    }
  }

  async claimGiveaway(giveawayId, userId) {
    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway) throw new Error('Giveaway not found.');

    if (giveaway.status !== 'ended') throw new Error('Giveaway has not ended yet.');
    if (!giveaway.winners.includes(userId)) throw new Error('You are not a winner of this giveaway.');
    if (giveaway.claimed.includes(userId)) throw new Error('You have already claimed this prize!');
    if (giveaway.disqualifiedWinners.includes(userId)) throw new Error('You were disqualified from claiming this prize.');

    if (giveaway.claimExpiresAt && Date.now() > giveaway.claimExpiresAt.getTime()) {
      throw new Error('The claim window for this giveaway has expired.');
    }

    giveaway.claimed.push(userId);
    await giveaway.save();

    await this.updateGiveawayMessage(giveaway);
    await this.logGiveawayAction(giveaway, 'claimed', `<@${userId}> claimed the prize.`);

    return giveaway;
  }

  async pauseGiveaway(giveawayId) {
    const giveaway = await GiveawayModel.findOne({ giveawayId, status: 'active' });
    if (!giveaway) throw new Error('Active giveaway not found.');

    giveaway.status = 'paused';
    giveaway.pausedAt = new Date();
    await giveaway.save();

    await this.updateGiveawayMessage(giveaway);
    await this.logGiveawayAction(giveaway, 'paused');
    logger.info(`Giveaway paused: ${giveaway.giveawayId}`);
  }

  async resumeGiveaway(giveawayId) {
    const giveaway = await GiveawayModel.findOne({ giveawayId, status: 'paused' });
    if (!giveaway) throw new Error('Paused giveaway not found.');

    const pauseDuration = Date.now() - giveaway.pausedAt.getTime();
    giveaway.status = 'active';
    giveaway.pausedAt = null;
    giveaway.cumulativePauseDuration += pauseDuration;
    giveaway.endTime = new Date(giveaway.endTime.getTime() + pauseDuration);
    await giveaway.save();

    await this.updateGiveawayMessage(giveaway);
    await this.logGiveawayAction(giveaway, 'resumed');
    logger.info(`Giveaway resumed: ${giveaway.giveawayId}`);
  }

  async deleteGiveaway(giveawayId) {
    const pending = this.pendingUpdates.get(giveawayId);
    if (pending) {
      clearTimeout(pending);
      this.pendingUpdates.delete(giveawayId);
    }

    const giveaway = await GiveawayModel.findOne({ giveawayId });
    if (!giveaway) throw new Error('Giveaway not found.');

    const guild = this.client.guilds.cache.get(giveaway.guildId);
    if (guild) {
      const channel = guild.channels.cache.get(giveaway.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }

    await this.logGiveawayAction(giveaway, 'deleted');
    await GiveawayModel.deleteOne({ giveawayId });
    logger.info(`Giveaway deleted: ${giveawayId}`);
  }

  async updateGiveawayMessage(giveaway) {
    if (!this.client) return;

    const guild = this.client.guilds.cache.get(giveaway.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(giveaway.channelId);
    if (!channel) return;

    const msg = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!msg) return;

    const embed = this.buildGiveawayEmbed(giveaway);
    
    const row = new ActionRowBuilder();
    if (giveaway.status === 'active') {
      const button = new ButtonBuilder()
        .setCustomId(`giveaway_entry_${giveaway.giveawayId}`)
        .setEmoji('🎉')
        .setLabel(`Join (${giveaway.entries.length})`)
        .setStyle(ButtonStyle.Primary);
      row.addComponents(button);

      if (giveaway.showParticipants) {
        const listButton = new ButtonBuilder()
          .setCustomId(`giveaway_list_users_${giveaway.giveawayId}`)
          .setEmoji('👥')
          .setLabel('View Participants')
          .setStyle(ButtonStyle.Secondary);
        row.addComponents(listButton);
      }
    } else if (giveaway.status === 'paused') {
      const button = new ButtonBuilder()
        .setCustomId(`giveaway_entry_${giveaway.giveawayId}`)
        .setEmoji('🎉')
        .setLabel('Paused')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      row.addComponents(button);

      if (giveaway.showParticipants) {
        const listButton = new ButtonBuilder()
          .setCustomId(`giveaway_list_users_${giveaway.giveawayId}`)
          .setEmoji('👥')
          .setLabel('View Participants')
          .setStyle(ButtonStyle.Secondary);
        row.addComponents(listButton);
      }
    } else if (giveaway.status === 'ended') {
      if (giveaway.claimTimeLimit && giveaway.winners.length > 0 && giveaway.claimed.length < giveaway.winners.length) {
        const button = new ButtonBuilder()
          .setCustomId(`giveaway_claim_${giveaway.giveawayId}`)
          .setLabel('Claim Prize')
          .setStyle(ButtonStyle.Success);
        row.addComponents(button);
      } else {
        const button = new ButtonBuilder()
          .setCustomId(`giveaway_entry_${giveaway.giveawayId}`)
          .setEmoji('🎉')
          .setLabel('Ended')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
        row.addComponents(button);
      }

      if (giveaway.showParticipants) {
        const listButton = new ButtonBuilder()
          .setCustomId(`giveaway_list_users_${giveaway.giveawayId}`)
          .setEmoji('👥')
          .setLabel('View Participants')
          .setStyle(ButtonStyle.Secondary);
        row.addComponents(listButton);
      }
    }

    if (row.components.length > 0) {
      await msg.edit({ embeds: [embed], components: [row] }).catch(err => logger.warn(`Failed to edit message: ${err.message}`));
    } else {
      await msg.edit({ embeds: [embed], components: [] }).catch(err => logger.warn(`Failed to edit message: ${err.message}`));
    }

    giveaway.lastUpdatedEntryCount = giveaway.entries.length;
    await GiveawayModel.updateOne({ _id: giveaway._id }, { $set: { lastUpdatedEntryCount: giveaway.entries.length } });
    this.lastEmbedUpdate.set(giveaway.messageId, Date.now());
  }

  requestMessageUpdate(giveaway) {
    const messageId = giveaway.messageId;
    if (this.pendingUpdates.has(messageId)) {
      return;
    }

    const lastUpdate = this.lastEmbedUpdate.get(messageId) || 0;
    const timeSinceLastUpdate = Date.now() - lastUpdate;
    const throttleDelay = 3000; // 3 seconds throttle

    if (timeSinceLastUpdate >= throttleDelay) {
      this.updateGiveawayMessage(giveaway).catch(err => logger.warn(`Immediate update failed: ${err.message}`));
    } else {
      const remainingDelay = throttleDelay - timeSinceLastUpdate;
      const timeout = setTimeout(async () => {
        this.pendingUpdates.delete(messageId);
        const fresh = await GiveawayModel.findOne({ messageId });
        if (fresh) {
          await this.updateGiveawayMessage(fresh).catch(err => logger.warn(`Queued update failed: ${err.message}`));
        }
      }, remainingDelay);
      
      this.pendingUpdates.set(messageId, timeout);
    }
  }

  async notifyWinners(giveaway) {
    if (!this.client || giveaway.winners.length === 0) return;

    const guild = this.client.guilds.cache.get(giveaway.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(giveaway.channelId);
    if (!channel) return;

    const mentions = giveaway.winners.map(w => `<@${w}>`).join(', ');
    const announceEmbed = successEmbed(
      `Congratulations to our winner(s) of **${giveaway.prize}**!\n\n` +
      `Winners: ${mentions}\n` +
      (giveaway.claimTimeLimit ? `Click the **Claim Prize** button below to claim within the limit!` : `Contact <@${giveaway.hostId}> to claim!`)
    );

    await channel.send({ content: mentions, embeds: [announceEmbed] }).catch(() => {});

    
    for (const w of giveaway.winners) {
      if (giveaway.dmNotify) {
        const user = await this.client.users.fetch(w).catch(() => null);
        if (user) {
          await user.send(`🎉 **You won!** You won **${giveaway.prize}** in **${guild.name}**!\nClick "Claim" in the giveaway message to claim your prize!`).catch(() => {});
        }
      }
    }
  }

  async logGiveawayAction(giveaway, action, details = null) {
    if (!this.client) return;

    const guild = this.client.guilds.cache.get(giveaway.guildId);
    if (!guild) return;

    const guildConfig = await GuildModel.findOne({ guildId: giveaway.guildId });
    if (!guildConfig || !guildConfig.modLogChannel) return;

    const logChannel = guild.channels.cache.get(guildConfig.modLogChannel);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(action === 'started' ? 0x00FF7F : action === 'ended' ? 0xFF6B35 : 0x5865F2)
      .setTitle(`Giveaway Log | ${action.toUpperCase()}`)
      .setDescription(
        `**Giveaway ID:** \`${giveaway.giveawayId}\`\n` +
        `**Prize:** ${giveaway.prize}\n` +
        `**Host:** <@${giveaway.hostId}>\n` +
        `**Channel:** <#${giveaway.channelId}>`
      )
      .setTimestamp();

    if (details) {
      embed.addFields({ name: 'Details', value: details });
    }

    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  async runMaintenanceTick() {
    if (mongoose.connection.readyState !== 1) return;
    if (!this.client || !this.client.isReady()) return;
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const now = new Date();

      
      const scheduled = await GiveawayModel.find({ status: 'scheduled', startTime: { $lte: now } });
      for (const g of scheduled) {
        await this.startGiveaway(g).catch(err => logger.error(`Error starting scheduled giveaway ${g.giveawayId}: ${err.message}`));
      }

      // 2. Process active giveaways that need to end
      const active = await GiveawayModel.find({ status: 'active', endTime: { $lte: now } });
      for (const g of active) {
        await this.endGiveaway(g.giveawayId).catch(err => logger.error(`Error ending giveaway ${g.giveawayId}: ${err.message}`));
      }

      
      const endedWithExpiry = await GiveawayModel.find({
        status: 'ended',
        claimExpiresAt: { $lte: now },
        claimTimeLimit: { $exists: true, $ne: null },
        rerollInProgress: false
      });

      for (const g of endedWithExpiry) {
        const unclaimed = g.winners.filter(w => !g.claimed.includes(w));
        if (unclaimed.length > 0) {
          logger.info(`Giveaway ${g.giveawayId} claim window expired. Unclaimed winners: ${unclaimed.join(', ')}. Auto-rerolling...`);
          
          const guild = this.client.guilds.cache.get(g.guildId);
          if (guild) {
            const channel = guild.channels.cache.get(g.channelId);
            if (channel) {
              await channel.send({
                embeds: [errorEmbed(`Claim window expired for: ${unclaimed.map(u => `<@${u}>`).join(', ')}. Disqualifying and drawing new winners...`)]
              }).catch(() => {});
            }
          }

          
          await this.rerollGiveaway(g.giveawayId, unclaimed.length, unclaimed).catch(err =>
            logger.error(`Error auto-rerolling giveaway ${g.giveawayId}: ${err.message}`)
          );
        }
      }

      
      const live = await GiveawayModel.find({ status: 'active' });
      for (const g of live) {
        if (g.entries.length !== g.lastUpdatedEntryCount) {
          const lastUpdate = this.lastEmbedUpdate.get(g.messageId) || 0;
          if (Date.now() - lastUpdate >= 15000) { 
            await this.updateGiveawayMessage(g).catch(err => logger.warn(`Failed to update entries for giveaway ${g.giveawayId}: ${err.message}`));
          }
        }
      }

    } finally {
      this.isTicking = false;
    }
  }
}

export const giveawayManager = new GiveawayManager();
export default giveawayManager;
