import { Request, Response } from 'express';
import User from '../models/User';
import Post from '../models/Post';
import { Comment, Session, Notification, Conversation } from '../models/index';
import Department from '../models/Department';
import { AuthRequest } from '../types';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import {
  sendVerificationEmail,
} from '../utils/email';

// GET /api/admin/dashboard
export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = req.user!.role === 'super_admin';

    const [
      totalUsers,
      totalCounselors,
      totalPosts,
      totalSessions,
      pendingComments,
      activeSessions,
      newUsersThisWeek,
    ] = await Promise.all([
      User.countDocuments({ role: 'user', status: 'active' }),
      User.countDocuments({ role: 'counselor', status: 'active' }),
      Post.countDocuments({ status: 'published' }),
      Session.countDocuments({ status: 'completed' }),
      Comment.countDocuments({ status: 'pending' }),
      Session.countDocuments({ status: 'active' }),
      User.countDocuments({
        role: 'user',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    const stats: Record<string, unknown> = {
      users: { total: totalUsers, newThisWeek: newUsersThisWeek },
      counselors: { total: totalCounselors },
      posts: { total: totalPosts },
      sessions: { total: totalSessions, active: activeSessions },
      comments: { pending: pendingComments },
    };

    if (isSuperAdmin) {
      const [totalDepartments, adminUsers, suspendedUsers] = await Promise.all([
        Department.countDocuments({ isActive: true }),
        User.countDocuments({ role: { $in: ['department_admin', 'super_admin'] } }),
        User.countDocuments({ status: 'suspended' }),
      ]);
      stats.departments = { total: totalDepartments };
      stats.adminUsers = { total: adminUsers };
      stats.suspended = { total: suspendedUsers };
    }

    // Recent posts
    const recentPosts = await Post.find({ status: 'published' })
      .populate('author', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title slug likeCount commentCount viewCount createdAt');

    sendSuccess(res, { stats, recentPosts });
  } catch (err) {
    sendError(res, 'Failed to load dashboard.', 500);
  }
};

// GET /api/admin/users
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { role, status, search } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Department admins can only see their department's counselors and users
    if (req.user!.role === 'department_admin') {
      filter.$or = [
        { role: 'user' },
        { role: 'counselor', department: req.user!.department },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .populate('department', 'name slug')
        .populate('assignedCounselor', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    sendSuccess(res, users, 'Users retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch users.', 500);
  }
};

// PUT /api/admin/users/:id/status
export const updateUserStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      sendError(res, 'User not found.', 404);
      return;
    }

    // Prevent modifying super admin
    if (user.role === 'super_admin') {
      sendError(res, 'Cannot modify super admin.', 403);
      return;
    }

    user.status = status;
    await user.save();

    if (status === 'suspended' && reason) {
      await Notification.create({
        recipient: user._id,
        type: 'account_suspended',
        title: 'Account suspended',
        message: `Your account has been suspended. Reason: ${reason}`,
      });
    }

    sendSuccess(res, user, `User status updated to ${status}`);
  } catch (err) {
    sendError(res, 'Failed to update user status.', 500);
  }
};

// POST /api/admin/counselors — super admin creates a counselor
export const createCounselor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password, departmentId, specializations, qualifications, bio } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      sendError(res, 'A user with this email already exists.', 409);
      return;
    }

    const counselor = new User({
      name,
      email,
      password,
      role: 'counselor',
      department: departmentId,
      specializations: specializations || [],
      qualifications: qualifications || [],
      bio,
      isEmailVerified: false,
      status: 'pending_verification',
    });

    const verificationToken = counselor.generateEmailVerificationToken();
    await counselor.save();

    // Add to department
    if (departmentId) {
      await Department.findByIdAndUpdate(departmentId, {
        $addToSet: { counselors: counselor._id },
      });
    }

    await sendVerificationEmail(email, name, verificationToken);

    sendSuccess(
      res,
      { _id: counselor._id, name: counselor.name, email: counselor.email, role: counselor.role },
      'Counselor created. Verification email sent.',
      201
    );
  } catch (err) {
    sendError(res, 'Failed to create counselor.', 500);
  }
};

// POST /api/admin/department-admins — super admin only
export const createDepartmentAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password, departmentId } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      sendError(res, 'A user with this email already exists.', 409);
      return;
    }

    const admin = new User({
      name,
      email,
      password,
      role: 'department_admin',
      department: departmentId,
      isEmailVerified: false,
      status: 'pending_verification',
    });

    const token = admin.generateEmailVerificationToken();
    await admin.save();

    if (departmentId) {
      await Department.findByIdAndUpdate(departmentId, { headAdmin: admin._id });
    }

    await sendVerificationEmail(email, name, token);

    sendSuccess(res, admin, 'Department admin created.', 201);
  } catch (err) {
    sendError(res, 'Failed to create department admin.', 500);
  }
};

// DELETE /api/admin/users/:id — super admin only
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      sendError(res, 'User not found.', 404);
      return;
    }
    if (user.role === 'super_admin') {
      sendError(res, 'Cannot delete super admin.', 403);
      return;
    }

    await Promise.all([
      user.deleteOne(),
      Post.updateMany({ author: user._id }, { status: 'archived' }),
      User.updateMany({ assignedCounselor: user._id }, { $unset: { assignedCounselor: 1 } }),
    ]);

    sendSuccess(res, null, 'User deleted successfully');
  } catch (err) {
    sendError(res, 'Failed to delete user.', 500);
  }
};

// GET /api/admin/posts
export const getAllPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, author } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (author) filter.author = author;

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('author', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments(filter),
    ]);

    sendSuccess(res, posts, 'Posts retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch posts.', 500);
  }
};

// PUT /api/admin/posts/:id/status
export const updatePostStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    ).populate('author', 'name email');

    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    sendSuccess(res, post, 'Post status updated');
  } catch (err) {
    sendError(res, 'Failed to update post status.', 500);
  }
};

// GET /api/admin/comments/pending
export const getPendingComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [comments, total] = await Promise.all([
      Comment.find({ status: 'pending' })
        .populate('author', 'name avatar')
        .populate('post', 'title slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Comment.countDocuments({ status: 'pending' }),
    ]);

    sendSuccess(res, comments, 'Pending comments retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch pending comments.', 500);
  }
};

// PUT /api/admin/comments/:id/moderate
export const moderateComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.body; // 'approved' | 'rejected'
    const comment = await Comment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('author', 'name');

    if (!comment) {
      sendError(res, 'Comment not found.', 404);
      return;
    }

    if (status === 'rejected') {
      await Post.findByIdAndUpdate(comment.post, { $inc: { commentCount: -1 } });
    }

    sendSuccess(res, comment, `Comment ${status}`);
  } catch (err) {
    sendError(res, 'Failed to moderate comment.', 500);
  }
};

// GET /api/admin/departments
export const getDepartments = async (_req: Request, res: Response): Promise<void> => {
  try {
    const departments = await Department.find()
      .populate('headAdmin', 'name avatar email')
      .populate('counselors', 'name avatar email isAvailable')
      .sort({ createdAt: -1 });

    sendSuccess(res, departments);
  } catch (err) {
    sendError(res, 'Failed to fetch departments.', 500);
  }
};

// POST /api/admin/departments
export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, icon, color } = req.body;
    const department = await Department.create({ name, description, icon, color });
    sendSuccess(res, department, 'Department created', 201);
  } catch (err) {
    sendError(res, 'Failed to create department.', 500);
  }
};

// PUT /api/admin/departments/:id
export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!department) {
      sendError(res, 'Department not found.', 404);
      return;
    }
    sendSuccess(res, department, 'Department updated');
  } catch (err) {
    sendError(res, 'Failed to update department.', 500);
  }
};
