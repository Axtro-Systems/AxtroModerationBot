import mongoose from 'mongoose';

const GiveawaySchema = new mongoose.Schema({
  giveawayId: { type: String, required: true, unique: true }, // unique identifier, matches messageId
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  prize: { type: String, required: true },
  winnerCount: { type: Number, required: true, default: 1 },
  hostId: { type: String, required: true },
  
  startTime: { type: Date, required: true, default: Date.now },
  endTime: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'active', 'paused', 'ended'], default: 'active' },
  pausedAt: Date,
  cumulativePauseDuration: { type: Number, default: 0 }, // in ms
  
  // Entry Requirements
  requiredRoles: [String],
  blacklistRoles: [String],
  whitelistRoles: [String],
  minAccountAge: Number, // in ms
  minJoinDate: Number, // in ms
  
  // Bonus Entries
  bonusRoles: [{
    roleId: { type: String, required: true },
    weight: { type: Number, required: true, default: 1 }
  }],
  boosterBonus: { type: Number, default: 0 }, // extra entries/weight for boosters
  
  // Entries tracker
  entries: [{
    userId: { type: String, required: true },
    weight: { type: Number, required: true, default: 1 }
  }],
  
  // Winners & Claims
  winners: [String],
  claimed: [String],
  disqualifiedWinners: [String], // for unclaimed auto-rerolls and manual disqualifications
  claimTimeLimit: Number, // in ms
  claimExpiresAt: Date,
  
  // Embed & Aesthetics
  embedColor: String,
  imageUrl: String,
  thumbnailUrl: String,
  footerText: String,
  dmNotify: { type: Boolean, default: true },
  showParticipants: { type: Boolean, default: true },
  
  lastUpdatedEntryCount: { type: Number, default: 0 },
  rerollInProgress: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now }
});

// Indexes
GiveawaySchema.index({ status: 1, endTime: 1 });
GiveawaySchema.index({ guildId: 1, messageId: 1 }, { unique: true });

export const GiveawayModel = mongoose.model('Giveaway', GiveawaySchema);
