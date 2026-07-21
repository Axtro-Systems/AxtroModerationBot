import mongoose from 'mongoose';

const GuildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: '!' },
  modLogChannel: String,
  auditChannel: String,
  muteRole: String,
  joinRole: String,
  staffRoles: [String],
  adminRoles: [String],
  antiNuke: {
    enabled: { type: Boolean, default: true },
    whitelist: [String],
    maxBans: { type: Number, default: 3 },
    maxKicks: { type: Number, default: 3 },
    maxChannelCreates: { type: Number, default: 3 },
    maxChannelDeletes: { type: Number, default: 2 },
    maxRoleDeletes: { type: Number, default: 2 },
    maxRoleCreates: { type: Number, default: 3 },
    maxWebhooks: { type: Number, default: 2 },
    maxGuildUpdates: { type: Number, default: 2 },
    maxEmojiCreates: { type: Number, default: 3 },
    maxStickerCreates: { type: Number, default: 3 },
    interval: { type: Number, default: 10000 },
    burstChannelDeletes: { type: Number, default: 3 },
    burstChannelCreates: { type: Number, default: 5 },
    sustainedChannelDeletes: { type: Number, default: 10 },
    sustainedChannelCreates: { type: Number, default: 15 },
    setupModeMultiplier: { type: Number, default: 5 },
    action: { type: String, enum: ['ban', 'kick', 'strip'], default: 'ban' },
    autoRestore: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: false },
  },
  automod: {
    enabled: Boolean,
    filterLinks: Boolean,
    filterInvites: Boolean,
    filterProfanity: Boolean,
    profanityList: [String],
    maxMentions: { type: Number, default: 10 },
    maxEmojis: Number,
    capsPercent: { type: Number, default: 70 },
    spamThreshold: Number,
    spamInterval: Number,
    spamEscalationMinutes: { type: Number, default: 10 },
    punishmentCooldown: { type: Number, default: 30000 },
    linkAllowlist: [String],
    dryRun: { type: Boolean, default: false },
  },
  antiRaid: {
    enabled: { type: Boolean, default: false },
    maxJoinsPerMinute: { type: Number, default: 5 },
    accountAgeMinutes: { type: Number, default: 1440 },
    action: { type: String, enum: ['kick', 'none'], default: 'kick' },
    quarantineRole: { type: String, default: null },
    decayDays: { type: Number, default: 14 },
    dryRun: { type: Boolean, default: false },
  },
  warningTiers: {
    tier2Duration: { type: Number, default: 86400000 },  // 1 day
    tier3Duration: { type: Number, default: 21600000 },  // 6 hours
    tier4Duration: { type: Number, default: 259200000 }, // 3 days
    tier5Duration: { type: Number, default: 2419200000 } // 28 days
  },
  setupMode: {
    enabled: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    enabledBy: { type: String, default: null }
  },
  backupAuto: {
    enabled: { type: Boolean, default: false },
    interval: { type: Number, default: 24 },
    keep: { type: Number, default: 10 },
  },
  raidMode: {
    active: { type: Boolean, default: false },
    triggeredAt: Date,
    triggeredBy: String,
    previousVerificationLevel: Number,
    lockedChannels: [String],
  },
  caseCounter: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export const GuildModel = mongoose.model('Guild', GuildSchema);
