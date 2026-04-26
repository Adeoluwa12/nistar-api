import { Request, Response } from 'express';
import User from '../models/User';
import { Conversation, Session, Notification } from '../models/index';
import { AuthRequest } from '../types';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import { sendCounselorAssignmentEmail, sendSessionReminderEmail } from '../utils/email';

// GET /api/counselors — public list
export const getCounselors = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { department, available } = req.query;

    const filter: Record<string, unknown> = {
      role: 'counselor',
      status: 'active',
      isEmailVerified: true,
    };
    if (department) filter.department = department;
    if (available === 'true') filter.isAvailable = true;

    const [counselors, total] = await Promise.all([
      User.find(filter)
        .populate('department', 'name slug color icon')
        .select('name avatar bio specializations qualifications rating sessionCount isAvailable department')
        .sort({ rating: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    sendSuccess(res, counselors, 'Counselors retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch counselors.', 500);
  }
};

// GET /api/counselors/:id
export const getCounselor = async (req: Request, res: Response): Promise<void> => {
  try {
    const counselor = await User.findOne({ _id: req.params.id, role: 'counselor', status: 'active' })
      .populate('department', 'name slug color icon')
      .select('name avatar bio specializations qualifications rating sessionCount isAvailable department');

    if (!counselor) {
      sendError(res, 'Counselor not found.', 404);
      return;
    }
    sendSuccess(res, counselor);
  } catch (err) {
    sendError(res, 'Failed to fetch counselor.', 500);
  }
};

// POST /api/counselors/request — user requests a counselor
export const requestCounselor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user!.assignedCounselor) {
      sendError(res, 'You already have an assigned counselor.', 400);
      return;
    }

    const { counselorId, departmentId } = req.body;

    let counselor;
    if (counselorId) {
      counselor = await User.findOne({ _id: counselorId, role: 'counselor', status: 'active', isAvailable: true });
    } else if (departmentId) {
      // Auto-assign: pick counselor with fewest sessions from department
      counselor = await User.findOne({
        department: departmentId,
        role: 'counselor',
        status: 'active',
        isAvailable: true,
      }).sort({ sessionCount: 1 });
    }

    if (!counselor) {
      sendError(res, 'No available counselors found. Please try again later.', 404);
      return;
    }

    await User.findByIdAndUpdate(req.user!._id, { assignedCounselor: counselor._id });

    // Create conversation
    const existingConv = await Conversation.findOne({ user: req.user!._id, counselor: counselor._id });
    if (!existingConv) {
      await Conversation.create({ user: req.user!._id, counselor: counselor._id });
    }

    // Notify counselor
    await Notification.create({
      recipient: counselor._id,
      type: 'new_user_assigned',
      title: 'New user assigned',
      message: `${req.user!.name} has been assigned to you.`,
      data: { userId: req.user!._id },
    });

    // Email user
    await sendCounselorAssignmentEmail(req.user!.email, req.user!.name, counselor.name);

    sendSuccess(res, {
      counselor: {
        _id: counselor._id,
        name: counselor.name,
        avatar: counselor.avatar,
        bio: counselor.bio,
        specializations: counselor.specializations,
      },
    }, 'Counselor assigned successfully');
  } catch (err) {
    sendError(res, 'Failed to assign counselor.', 500);
  }
};

// GET /api/counselors/my-users — counselor views their assigned users
export const getMyUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [users, total] = await Promise.all([
      User.find({ assignedCounselor: req.user!._id, status: 'active' })
        .select('name avatar bio lastActive createdAt')
        .sort({ lastActive: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments({ assignedCounselor: req.user!._id }),
    ]);

    sendSuccess(res, users, 'Users retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch users.', 500);
  }
};

// POST /api/sessions — schedule session
export const scheduleSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { counselorId, scheduledAt, duration, notes } = req.body;

    const counselor = await User.findOne({ _id: counselorId, role: 'counselor', status: 'active' });
    if (!counselor) {
      sendError(res, 'Counselor not found.', 404);
      return;
    }

    const date = new Date(scheduledAt);
    if (date <= new Date()) {
      sendError(res, 'Session must be scheduled in the future.', 400);
      return;
    }

    // Check for conflicts
    const conflict = await Session.findOne({
      counselor: counselorId,
      status: { $in: ['scheduled', 'active'] },
      scheduledAt: {
        $gte: new Date(date.getTime() - 60 * 60 * 1000),
        $lte: new Date(date.getTime() + 60 * 60 * 1000),
      },
    });

    if (conflict) {
      sendError(res, 'This time slot conflicts with an existing session. Please choose another.', 409);
      return;
    }

    const session = await Session.create({
      user: req.user!._id,
      counselor: counselorId,
      scheduledAt: date,
      duration: duration || 60,
      notes,
    });

    await session.populate('counselor', 'name avatar');
    await session.populate('user', 'name avatar');

    // Notifications
    await Notification.create({
      recipient: counselorId,
      type: 'session_scheduled',
      title: 'New session scheduled',
      message: `${req.user!.name} scheduled a session for ${date.toLocaleDateString()}`,
      data: { sessionId: session._id },
    });

    await sendSessionReminderEmail(req.user!.email, req.user!.name, counselor.name, date);

    sendSuccess(res, session, 'Session scheduled successfully', 201);
  } catch (err) {
    sendError(res, 'Failed to schedule session.', 500);
  }
};

// GET /api/sessions/my — get user sessions
export const getMySessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;

    const isUser = req.user!.role === 'user';
    const filter: Record<string, unknown> = isUser
      ? { user: req.user!._id }
      : { counselor: req.user!._id };
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .populate('user', 'name avatar')
        .populate('counselor', 'name avatar')
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit),
      Session.countDocuments(filter),
    ]);

    sendSuccess(res, sessions, 'Sessions retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch sessions.', 500);
  }
};

// PUT /api/sessions/:id/cancel
export const cancelSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      sendError(res, 'Session not found.', 404);
      return;
    }

    const isParticipant = [session.user.toString(), session.counselor.toString()].includes(
      req.user!._id.toString()
    );
    if (!isParticipant) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    if (!['scheduled', 'active'].includes(session.status)) {
      sendError(res, 'This session cannot be cancelled.', 400);
      return;
    }

    session.status = 'cancelled';
    session.cancelledBy = req.user!._id;
    session.cancelReason = req.body.reason;
    await session.save();

    // Notify the other party
    const notifyId =
      session.user.toString() === req.user!._id.toString() ? session.counselor : session.user;
    await Notification.create({
      recipient: notifyId,
      type: 'session_cancelled',
      title: 'Session cancelled',
      message: `${req.user!.name} cancelled the session scheduled for ${session.scheduledAt.toLocaleDateString()}`,
      data: { sessionId: session._id },
    });

    sendSuccess(res, session, 'Session cancelled');
  } catch (err) {
    sendError(res, 'Failed to cancel session.', 500);
  }
};

// PUT /api/sessions/:id/rate
export const rateSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rating, feedback } = req.body;
    const session = await Session.findOne({ _id: req.params.id, user: req.user!._id, status: 'completed' });

    if (!session) {
      sendError(res, 'Session not found or not completed.', 404);
      return;
    }

    session.rating = rating;
    session.feedback = feedback;
    await session.save();

    // Update counselor avg rating
    const sessions = await Session.find({ counselor: session.counselor, rating: { $exists: true } });
    const avgRating = sessions.reduce((sum, s) => sum + (s.rating || 0), 0) / sessions.length;
    await User.findByIdAndUpdate(session.counselor, { rating: Math.round(avgRating * 10) / 10 });

    sendSuccess(res, session, 'Session rated successfully');
  } catch (err) {
    sendError(res, 'Failed to rate session.', 500);
  }
};
