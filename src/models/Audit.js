import mongoose from 'mongoose';

const AuditSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  action: { type: String, required: true },
  moderatorId: String,
  targetId: String,
  reason: String,
  details: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

AuditSchema.index({ guildId: 1, createdAt: -1 });

export const AuditModel = mongoose.model('Audit', AuditSchema);
