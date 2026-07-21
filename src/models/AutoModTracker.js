import mongoose from 'mongoose';

const TrackerSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, required: true }, // 'spam' or 'invite' or generic rule triggers
  expiresAt: { type: Date, required: true }
});

// Create a TTL index using the expiresAt field with expireAfterSeconds: 0
TrackerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
TrackerSchema.index({ guildId: 1, userId: 1, type: 1 });

export const AutoModTrackerModel = mongoose.model('AutoModTracker', TrackerSchema);
