import { Types } from 'mongoose';
import { AuditLog } from '../models/index';
import logger from './logger';

/**
 * Records a sensitive/administrative action in the audit log. Best-effort:
 * failures are logged but never block the calling request.
 */
export async function logAudit(
  actor: Types.ObjectId | string,
  action: string,
  opts: { targetType?: string; targetId?: Types.ObjectId | string; meta?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await AuditLog.create({
      actor,
      action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      meta: opts.meta,
    });
  } catch (err) {
    logger.error('Audit log write failed:', err);
  }
}
