import mongoose from 'mongoose';

const WarnSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  moderatorId: String,
  moderatorTag: String,
  reason: String,
  points: { type: Number, default: 1 },
  severity: { type: String, enum: ['minor', 'moderate', 'severe'], default: 'minor' },
  active: { type: Boolean, default: true },
  caseNumber: Number,
  createdAt: { type: Date, default: Date.now },
});

WarnSchema.index({ guildId: 1, userId: 1 });

export const WarnModel = mongoose.model('Warn', WarnSchema);
