import { GuildModel } from '../models/Guild.js';
import { CaseModel } from '../models/Case.js';
import { AuditModel } from '../models/Audit.js';

export async function getNextCaseNumber(guildId) {
  const guild = await GuildModel.findOneAndUpdate(
    { guildId },
    { $inc: { caseCounter: 1 } },
    { new: true, upsert: true }
  );
  return guild.caseCounter;
}

export async function createCase({ guildId, type, targetId, targetTag, moderatorId, moderatorTag, reason, duration, expiresAt }) {
  const caseNumber = await getNextCaseNumber(guildId);
  const caseEntry = new CaseModel({
    guildId, caseNumber, type, targetId, targetTag,
    moderatorId, moderatorTag, reason, duration, expiresAt,
  });
  await caseEntry.save();
  return caseEntry;
}

export async function closeActiveCases(guildId, targetId, type) {
  return CaseModel.updateMany(
    { guildId, targetId, type, active: true },
    { active: false }
  );
}

export async function logAudit({ guildId, action, moderatorId, targetId, reason, details }) {
  return AuditModel.create({ guildId, action, moderatorId, targetId, reason, details });
}
