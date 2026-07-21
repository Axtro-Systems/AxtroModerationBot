import mongoose from 'mongoose';

const CaseSchema = new mongoose.Schema({
  guildId: String,
  caseNumber: Number,
  type: {
    type: String,
    enum: ['warn','mute','unmute','kick','ban','unban','softban','tempban','tempmute','lock','unlock','note','antinuke','lockdown','unlockdown'],
  },
  targetId: String,
  targetTag: String,
  moderatorId: String,
  moderatorTag: String,
  reason: String,
  duration: Number,
  expiresAt: Date,
  active: { type: Boolean, default: true },
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

CaseSchema.index({ guildId: 1, caseNumber: 1 });
CaseSchema.index({ guildId: 1, targetId: 1 });

export const CaseModel = mongoose.model('Case', CaseSchema);
