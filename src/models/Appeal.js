import mongoose from 'mongoose';

const AppealSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  caseId: { type: String, required: true }, // Links to Case number/ID
  type: { type: String, enum: ['mute', 'ban', 'warn', 'tempmute', 'tempban'], required: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  resolvedBy: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

AppealSchema.index({ guildId: 1, userId: 1, caseId: 1 }, { unique: true });

export const AppealModel = mongoose.model('Appeal', AppealSchema);
