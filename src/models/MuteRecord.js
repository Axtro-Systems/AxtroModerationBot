import mongoose from 'mongoose';

const MuteRecordSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  moderatorId: String,
  moderatorTag: String,
  reason: String,
  duration: Number,
  expiresAt: Date,
  caseNumber: Number,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

MuteRecordSchema.index({ guildId: 1, userId: 1 });
MuteRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MuteRecordModel = mongoose.model('MuteRecord', MuteRecordSchema);
