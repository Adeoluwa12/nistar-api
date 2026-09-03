import { Request, Response } from 'express';
import User from '../models/User';
import Post from '../models/Post';
import { Comment, Session, Notification, Conversation, CounselorApplication, LiteraryWork, Subscriber, AuditLog } from '../models/index';
import Department from '../models/Department';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import { sendVerificationEmail } from '../utils/email';
import { logAudit } from '../utils/audit';
import { AUTHOR_APPROVAL_THRESHOLD } from '../config/constants';

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

// POST /api/admin/promote — any admin can promote an existing user to department_admin
export const promoteToAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const raw = String(req.body.email || req.body.identifier || '').trim();
    if (!raw) {
      sendError(res, 'Provide the user\'s email or name.', 400);
      return;
    }

    // Look up by email or (case-insensitive) exact name.
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const target = await User.findOne({
      $or: [
        { email: raw.toLowerCase() },
        { name: { $regex: `^${escaped}$`, $options: 'i' } },
      ],
    });

    if (!target) {
      sendError(res, 'User not found.', 404);
      return;
    }

    if (['super_admin', 'department_admin'].includes(target.role)) {
      sendError(res, 'User is already an admin.', 409);
      return;
    }

    target.role = 'department_admin';
    await target.save();

    await Notification.create({
      recipient: target._id,
      type: 'role_changed',
      title: 'You have been promoted',
      message: 'You are now a department admin.',
      data: { newRole: 'department_admin', promotedBy: req.user!._id },
    });

    sendSuccess(res, { _id: target._id, name: target.name, email: target.email, role: target.role }, 'User promoted to department admin.');
  } catch (err) {
    sendError(res, 'Failed to promote user.', 500);
  }
};

// GET /api/admin/posts
export const getAllPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, author, autoPublished } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (author) filter.author = author;
    if (autoPublished !== undefined) filter.autoPublished = autoPublished === 'true';

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('author', 'name email avatar isAuthor')
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
export const updatePostStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const post = await Post.findById(req.params.id).populate('author', '_id');

    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    const previousStatus = post.status;

    post.status = status;
    await post.save();
    await post.populate('author', 'name email isAuthor consecutiveApprovals');

    // Author progression: manual admin approvals count toward author status
    if (status === 'published' && previousStatus !== 'published' && !post.autoPublished) {
      const author = await User.findById(post.author._id);
      if (author && !author.isAuthor) {
        author.consecutiveApprovals = (author.consecutiveApprovals || 0) + 1;

        if (author.consecutiveApprovals >= AUTHOR_APPROVAL_THRESHOLD) {
          author.isAuthor = true;
          author.consecutiveApprovals = 0;

          await Notification.create({
            recipient: author._id,
            type: 'author_promotion',
            title: 'You are now a Nistar Author',
            message: `Congratulations! After ${AUTHOR_APPROVAL_THRESHOLD} approved posts, you can now publish without admin review.`,
            data: { threshold: AUTHOR_APPROVAL_THRESHOLD },
          });
        }

        await author.save();
      }
    }

    if (status === 'rejected' && previousStatus !== 'rejected') {
      const author = await User.findById(post.author._id);
      if (author && !author.isAuthor) {
        author.consecutiveApprovals = 0;
        await author.save();
      }
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

// GET /api/admin/sessions/queue
export const getSessionQueue = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(_req.query);

    const [sessions, total] = await Promise.all([
      Session.find({ status: 'pending' })
        .populate('user', 'name avatar email')
        .select('-emotionalState -availability -preferredSupportType -notes -userNotes')
        .sort({ requestedDate: -1 })
        .skip(skip)
        .limit(limit),
      Session.countDocuments({ status: 'pending' }),
    ]);

    sendSuccess(res, sessions, 'Session queue retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch session queue.', 500);
  }
};

// PUT /api/admin/sessions/:id/assign
export const assignSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { counselorId } = req.body;
    const session = await Session.findById(req.params.id).populate('user', 'name email');

    if (!session) {
      sendError(res, 'Session not found.', 404);
      return;
    }

    if (session.status !== 'pending') {
      sendError(res, 'Session has already been processed.', 400);
      return;
    }

    const counselor = await User.findOne({ _id: counselorId, role: 'counselor', status: 'active' });
    if (!counselor) {
      sendError(res, 'Counselor not found.', 404);
      return;
    }

    session.counselor = counselor._id as any;
    session.status = 'approved';
    session.scheduledAt = session.requestedDate;
    await session.save();

    // Ensure conversation thread exists
    const existingConv = await Conversation.findOne({ user: session.user, counselor: counselor._id });
    if (!existingConv) {
      await Conversation.create({ user: session.user, counselor: counselor._id });
    }

    // Notify user and counselor
    await Notification.create({
      recipient: session.user,
      type: 'session_approved',
      title: 'Appointment approved',
      message: `Your appointment on ${session.requestedDate.toLocaleDateString()} was approved. ${counselor.name} will be with you.`,
      data: { sessionId: session._id, counselorId: counselor._id },
    });

    await Notification.create({
      recipient: counselor._id,
      type: 'session_assigned',
      title: 'New appointment assigned',
      message: `A new appointment on ${session.requestedDate.toLocaleDateString()} has been assigned to you.`,
      data: { sessionId: session._id, userId: session.user },
    });

    await session.populate('counselor', 'name avatar');
    await session.populate('user', 'name avatar');

    sendSuccess(res, session, 'Session assigned and approved');
  } catch (err) {
    sendError(res, 'Failed to assign session.', 500);
  }
};

// GET /api/admin/applications
export const getApplications = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(_req.query);
    const { status } = _req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [applications, total] = await Promise.all([
      CounselorApplication.find(filter)
        .populate('user', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CounselorApplication.countDocuments(filter),
    ]);

    sendSuccess(res, applications, 'Applications retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch applications.', 500);
  }
};

// PUT /api/admin/applications/:id/review
export const reviewApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, note } = req.body;
    const application = await CounselorApplication.findById(req.params.id).populate('user', '_id name email');

    if (!application) {
      sendError(res, 'Application not found.', 404);
      return;
    }

    if (!['approved', 'rejected'].includes(status)) {
      sendError(res, 'Invalid review status.', 400);
      return;
    }

    application.status = status;
    application.reviewedBy = req.user!._id;
    application.reviewNote = note;
    await application.save();

    if (status === 'approved' && application.user) {
      await User.findByIdAndUpdate((application.user as any)._id, { role: 'counselor' });

      await Notification.create({
        recipient: (application.user as any)._id,
        type: 'application_approved',
        title: 'Counselor application approved',
        message: 'Your counselor application has been approved. Welcome to the team.',
        data: { applicationId: application._id },
      });
    }

    if (status === 'rejected' && application.user) {
      await Notification.create({
        recipient: (application.user as any)._id,
        type: 'application_rejected',
        title: 'Counselor application not approved',
        message: note ? `Reason: ${note}` : 'Your counselor application was not approved at this time.',
        data: { applicationId: application._id },
      });
    }

    sendSuccess(res, application, `Application ${status}`);
  } catch (err) {
    sendError(res, 'Failed to review application.', 500);
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

// GET /api/admin/analytics — super admin only, platform-wide analytics
export const getAnalytics = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [usersByRole, postsByStatus, downloadAgg, subscribers, totalWorks, topPosts] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      Post.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      LiteraryWork.aggregate([{ $group: { _id: null, total: { $sum: '$downloadCount' } } }]),
      Subscriber.countDocuments(),
      LiteraryWork.countDocuments(),
      Post.find({ status: 'published' })
        .sort({ viewCount: -1 })
        .limit(5)
        .select('title slug viewCount likeCount commentCount'),
    ]);

    const usersByRoleMap: Record<string, number> = {};
    usersByRole.forEach((r: { _id: string; count: number }) => { usersByRoleMap[r._id] = r.count; });
    const postsByStatusMap: Record<string, number> = {};
    postsByStatus.forEach((r: { _id: string; count: number }) => { postsByStatusMap[r._id] = r.count; });

    sendSuccess(res, {
      usersByRole: usersByRoleMap,
      postsByStatus: postsByStatusMap,
      totalDownloads: downloadAgg[0]?.total || 0,
      subscribers,
      totalWorks,
      topPosts,
    });
  } catch (err) {
    sendError(res, 'Failed to load analytics.', 500);
  }
};

// GET /api/admin/conversations — super admin only. Returns metadata ONLY
// (participants, timestamps, counts) — never message content — and is audited.
export const getConversationsMeta = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [items, total] = await Promise.all([
      Conversation.find()
        .populate('user', 'name email')
        .populate('counselor', 'name email')
        .select('user counselor type lastMessageAt isActive unreadCountUser unreadCountCounselor createdAt')
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit),
      Conversation.countDocuments(),
    ]);

    await logAudit(req.user!._id, 'view_conversation_metadata', {
      targetType: 'Conversation',
      meta: { page, count: items.length },
    });

    sendSuccess(res, items, 'Conversation metadata retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch conversation metadata.', 500);
  }
};

// GET /api/admin/audit-logs — super admin only
export const getAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [logs, total] = await Promise.all([
      AuditLog.find().populate('actor', 'name email role').sort({ createdAt: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(),
    ]);
    sendSuccess(res, logs, 'Audit logs retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch audit logs.', 500);
  }
};
