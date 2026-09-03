import { Request, Response } from 'express';
import { Subscriber } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// POST /api/subscribe — public mailing-list signup
export const subscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      sendError(res, 'A valid email is required.', 400);
      return;
    }

    // Idempotent: signing up twice is a success, not an error.
    await Subscriber.updateOne(
      { email },
      { $setOnInsert: { email, source: req.body.source || 'web' } },
      { upsert: true }
    );

    sendSuccess(res, { email }, "You're on the list. Thank you for subscribing.", 201);
  } catch {
    sendError(res, 'Failed to subscribe.', 500);
  }
};

// GET /api/admin/subscribers — admin
export const listSubscribers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [subscribers, total] = await Promise.all([
      Subscriber.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Subscriber.countDocuments(),
    ]);
    sendSuccess(res, subscribers, 'Subscribers retrieved', 200, paginate(page, limit, total));
  } catch {
    sendError(res, 'Failed to fetch subscribers.', 500);
  }
};
