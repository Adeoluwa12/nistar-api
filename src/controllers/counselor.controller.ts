import { Request, Response } from 'express';
import User from '../models/User';
import { Conversation, Session, Notification, CounselorApplication } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import { encryptField, decryptField } from '../utils/encryption';
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

// POST /api/counselors/apply — submit a counselor/associate application
export const applyCounselor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await CounselorApplication.findOne({ user: req.user!._id, status: 'pending' });
    if (existing) {
      sendError(res, 'You already have a pending application.', 409);
      return;
    }

    if (req.user!.role === 'counselor') {
      sendError(res, 'You are already a counselor.', 409);
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const documents = files.map((f) => (f as any).path);

    const application = await CounselorApplication.create({
      user: req.user!._id,
      statement: req.body.statement,
      documents,
    });

    sendSuccess(res, application, 'Application submitted', 201);
  } catch (err) {
    sendError(res, 'Failed to submit application.', 500);
  }
};

// POST /api/sessions — request or schedule a session
export const scheduleSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      counselorId, requestedDate, scheduledAt, duration, notes, description,
      emotionalState, preferredSupportType, availability,
    } = req.body;

    const requested = new Date(requestedDate || scheduledAt);
    if (requested <= new Date()) {
      sendError(res, 'Requested date must be in the future.', 400);
      return;
    }

    const encryptedEmotionalState = emotionalState ? encryptField(emotionalState) : undefined;

    // Without a counselor this becomes a pending consultation request
    if (!counselorId) {
      const session = await Session.create({
        user: req.user!._id,
        status: 'pending',
        requestedDate: requested,
        description,
        emotionalState: encryptedEmotionalState,
        preferredSupportType,
        availability,
        duration: duration || 60,
      });
      await session.populate('user', 'name avatar');
      sendSuccess(res, session, 'Appointment request submitted', 201);
      return;
    }

    const counselor = await User.findOne({ _id: counselorId, role: 'counselor', status: 'active' });
    if (!counselor) {
      sendError(res, 'Counselor not found.', 404);
      return;
    }

    // Check for conflicts
    const conflict = await Session.findOne({
      counselor: counselorId,
      status: { $in: ['scheduled', 'active'] },
      scheduledAt: {
        $gte: new Date(requested.getTime() - 60 * 60 * 1000),
        $lte: new Date(requested.getTime() + 60 * 60 * 1000),
      },
    });

    if (conflict) {
      sendError(res, 'This time slot conflicts with an existing session. Please choose another.', 409);
      return;
    }

    const session = await Session.create({
      user: req.user!._id,
      counselor: counselorId,
      status: 'scheduled',
      requestedDate: requested,
      scheduledAt: requested,
      duration: duration || 60,
      notes,
      emotionalState: encryptedEmotionalState,
      preferredSupportType,
      availability,
    });

    await session.populate('counselor', 'name avatar');
    await session.populate('user', 'name avatar');

    // Notifications
    await Notification.create({
      recipient: counselorId,
      type: 'session_scheduled',
      title: 'New session scheduled',
      message: `${req.user!.name} scheduled a session for ${requested.toLocaleDateString()}`,
      data: { sessionId: session._id },
    });

    await sendSessionReminderEmail(req.user!.email, req.user!.name, counselor.name, requested);

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
        .sort({ requestedDate: -1 })
        .skip(skip)
        .limit(limit),
      Session.countDocuments(filter),
    ]);

    const decrypted = sessions.map((s) => {
      const obj = s.toObject();
      if (obj.emotionalState) obj.emotionalState = decryptField(obj.emotionalState);
      return obj;
    });

    sendSuccess(res, decrypted, 'Sessions retrieved', 200, paginate(page, limit, total));
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

    const participants = [session.user.toString()];
    if (session.counselor) participants.push(session.counselor.toString());

    const isParticipant = participants.includes(req.user!._id.toString());
    if (!isParticipant) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    if (!['pending', 'approved', 'scheduled', 'active'].includes(session.status)) {
      sendError(res, 'This session cannot be cancelled.', 400);
      return;
    }

    session.status = 'cancelled';
    session.cancelledBy = req.user!._id;
    session.cancelReason = req.body.reason;
    await session.save();

    // Notify the other party
    if (session.counselor) {
      const notifyId =
        session.user.toString() === req.user!._id.toString() ? session.counselor : session.user;
      await Notification.create({
        recipient: notifyId,
        type: 'session_cancelled',
        title: 'Session cancelled',
        message: `${req.user!.name} cancelled the session requested for ${session.requestedDate.toLocaleDateString()}`,
        data: { sessionId: session._id },
      });
    }

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

// PUT /api/sessions/:id/meeting — counselor/admin attaches a meeting link (e.g. Google Meet)
export const setSessionMeeting = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { meetingLink } = req.body;
    const session = await Session.findById(req.params.id);
    if (!session) {
      sendError(res, 'Session not found.', 404);
      return;
    }

    const isCounselor = !!session.counselor && session.counselor.toString() === req.user!._id.toString();
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user!.role);
    if (!isCounselor && !isAdmin) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    session.meetingLink = meetingLink;
    if (session.status === 'approved') session.status = 'scheduled';
    await session.save();

    await Notification.create({
      recipient: session.user,
      type: 'session_scheduled',
      title: 'Meeting link added',
      message: 'Your counselor added a meeting link to your upcoming session.',
      data: { sessionId: session._id },
    });

    sendSuccess(res, session, 'Meeting link saved');
  } catch (err) {
    sendError(res, 'Failed to save meeting link.', 500);
  }
};

// PUT /api/sessions/:id/complete — counselor/admin marks a session complete
export const completeSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      sendError(res, 'Session not found.', 404);
      return;
    }

    const isCounselor = !!session.counselor && session.counselor.toString() === req.user!._id.toString();
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user!.role);
    if (!isCounselor && !isAdmin) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    if (!['approved', 'scheduled', 'active'].includes(session.status)) {
      sendError(res, 'This session cannot be completed.', 400);
      return;
    }

    session.status = 'completed';
    await session.save();

    await Notification.create({
      recipient: session.user,
      type: 'session_scheduled',
      title: 'Session completed',
      message: 'Your session was marked complete. We\'d love your feedback — please leave a rating.',
      data: { sessionId: session._id },
    });

    sendSuccess(res, session, 'Session completed');
  } catch (err) {
    sendError(res, 'Failed to complete session.', 500);
  }
};
