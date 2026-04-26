import { Response } from 'express';
import User from '../models/User';
import { Notification } from '../models/index';
import { AuthRequest } from '../types';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// PUT /api/users/profile
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const allowed = ['name', 'bio', 'phone'];
    const updates: Record<string, unknown> = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (req.file) updates.avatar = `/uploads/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(req.user!._id, updates, { new: true, runValidators: true });
    sendSuccess(res, user, 'Profile updated');
  } catch (err) {
    sendError(res, 'Failed to update profile.', 500);
  }
};

// PUT /api/users/counselor-profile — counselor updates their professional info
export const updateCounselorProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!['counselor', 'department_admin'].includes(req.user!.role)) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    const allowed = ['bio', 'specializations', 'qualifications', 'isAvailable', 'phone'];
    const updates: Record<string, unknown> = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (req.file) updates.avatar = `/uploads/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(req.user!._id, updates, { new: true });
    sendSuccess(res, user, 'Counselor profile updated');
  } catch (err) {
    sendError(res, 'Failed to update counselor profile.', 500);
  }
};

// GET /api/notifications
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user!._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ recipient: req.user!._id }),
      Notification.countDocuments({ recipient: req.user!._id, isRead: false }),
    ]);

    sendSuccess(
      res,
      { notifications, unreadCount },
      'Notifications retrieved',
      200,
      paginate(page, limit, total)
    );
  } catch (err) {
    sendError(res, 'Failed to fetch notifications.', 500);
  }
};

// PUT /api/notifications/read-all
export const markAllNotificationsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await Notification.updateMany({ recipient: req.user!._id, isRead: false }, { isRead: true });
    sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) {
    sendError(res, 'Failed to mark notifications.', 500);
  }
};

// PUT /api/notifications/:id/read
export const markNotificationRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user!._id },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      sendError(res, 'Notification not found.', 404);
      return;
    }
    sendSuccess(res, notification);
  } catch (err) {
    sendError(res, 'Failed to mark notification.', 500);
  }
};
