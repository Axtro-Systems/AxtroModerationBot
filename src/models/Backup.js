import mongoose from 'mongoose';

const BackupSchema = new mongoose.Schema({
  guildId: String,
  backupId: { type: String, unique: true },
  name: String,
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  autoTriggered: { type: Boolean, default: false },
  triggerReason: String,
});

export const BackupModel = mongoose.model('Backup', BackupSchema);
