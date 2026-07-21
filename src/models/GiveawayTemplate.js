import mongoose from 'mongoose';

const GiveawayTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  guildId: { type: String, required: true },
  requiredRoles: [String],
  blacklistRoles: [String],
  whitelistRoles: [String],
  minAccountAge: Number, // in ms
  minJoinDate: Number, // in ms
  bonusRoles: [{
    roleId: { type: String, required: true },
    weight: { type: Number, required: true, default: 1 }
  }],
  boosterBonus: { type: Number, default: 0 },
  claimTimeLimit: Number, // in ms
  embedColor: String,
  thumbnailUrl: String,
  footerText: String,
  dmNotify: { type: Boolean, default: true },
  showParticipants: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Index
GiveawayTemplateSchema.index({ guildId: 1, name: 1 }, { unique: true });

export const GiveawayTemplateModel = mongoose.model('GiveawayTemplate', GiveawayTemplateSchema);
