import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import { authenticate, optionalAuth, requireCounselor, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import { uploadImage } from '../middleware/upload';
import { validate } from '../middleware/error';

import * as post from '../controllers/post.controller';
import * as comment from '../controllers/comment.controller';
import * as counselor from '../controllers/counselor.controller';
import * as chat from '../controllers/chat.controller';
import * as user from '../controllers/user.controller';
import * as admin from '../controllers/admin.controller';

// Cast to handle AuthRequest vs Request typing
const rh = (fn: unknown): RequestHandler => fn as RequestHandler;

// ─── POST ROUTES ─────────────────────────────────────────────────────────────
export const postRouter = Router();
postRouter.get('/', rh(optionalAuth), rh(post.getPosts));
postRouter.get('/my-posts', rh(authenticate), rh(post.getMyPosts));
postRouter.get('/:slug', rh(optionalAuth), rh(post.getPost));
postRouter.post('/', rh(authenticate), uploadImage,
  [body('title').trim().notEmpty().withMessage('Title is required'),
   body('content').trim().notEmpty().withMessage('Content is required')],
  validate, rh(post.createPost));
postRouter.put('/:id', rh(authenticate), uploadImage, rh(post.updatePost));
postRouter.delete('/:id', rh(authenticate), rh(post.deletePost));
postRouter.post('/:id/like', rh(authenticate), rh(post.toggleLike));
postRouter.post('/:id/share', rh(optionalAuth), rh(post.sharePost));

// ─── COMMENT ROUTES ───────────────────────────────────────────────────────────
export const commentRouter = Router();
commentRouter.get('/post/:postId', comment.getPostComments);
commentRouter.post('/', rh(authenticate),
  [body('postId').notEmpty().withMessage('Post ID is required'),
   body('content').trim().notEmpty().withMessage('Content is required').isLength({ max: 2000 })],
  validate, rh(comment.addComment));
commentRouter.post('/:id/like', rh(authenticate), rh(comment.toggleCommentLike));
commentRouter.delete('/:id', rh(authenticate), rh(comment.deleteComment));

// ─── COUNSELOR ROUTES ─────────────────────────────────────────────────────────
export const counselorRouter = Router();
counselorRouter.get('/', counselor.getCounselors);
counselorRouter.get('/my-users', rh(authenticate), rh(requireCounselor), rh(counselor.getMyUsers));
counselorRouter.get('/:id', counselor.getCounselor);
counselorRouter.post('/request', rh(authenticate),
  [body('counselorId').optional().isMongoId(), body('departmentId').optional().isMongoId()],
  validate, rh(counselor.requestCounselor));

// ─── SESSION ROUTES ────────────────────────────────────────────────────────────
export const sessionRouter = Router();
sessionRouter.get('/my', rh(authenticate), rh(counselor.getMySessions));
sessionRouter.post('/', rh(authenticate),
  [body('counselorId').isMongoId().withMessage('Valid counselor ID required'),
   body('scheduledAt').isISO8601().withMessage('Valid date required'),
   body('duration').optional().isInt({ min: 15, max: 180 })],
  validate, rh(counselor.scheduleSession));
sessionRouter.put('/:id/cancel', rh(authenticate), rh(counselor.cancelSession));
sessionRouter.put('/:id/rate', rh(authenticate),
  [body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')],
  validate, rh(counselor.rateSession));

// ─── CHAT ROUTES ───────────────────────────────────────────────────────────────
export const chatRouter = Router();
chatRouter.get('/conversations', rh(authenticate), rh(chat.getConversations));
chatRouter.get('/conversations/:id/messages', rh(authenticate), rh(chat.getMessages));
chatRouter.post('/conversations/:id/messages', rh(authenticate), uploadImage,
  [body('content').trim().notEmpty().withMessage('Message cannot be empty')],
  validate, rh(chat.sendMessage));

// ─── USER ROUTES ───────────────────────────────────────────────────────────────
export const userRouter = Router();
userRouter.put('/profile', rh(authenticate), uploadImage, rh(user.updateProfile));
userRouter.put('/counselor-profile', rh(authenticate), rh(requireCounselor), uploadImage, rh(user.updateCounselorProfile));
userRouter.get('/notifications', rh(authenticate), rh(user.getNotifications));
userRouter.put('/notifications/read-all', rh(authenticate), rh(user.markAllNotificationsRead));
userRouter.put('/notifications/:id/read', rh(authenticate), rh(user.markNotificationRead));

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────
export const adminRouter = Router();
adminRouter.get('/dashboard', rh(authenticate), rh(requireAdmin), rh(admin.getDashboard));
adminRouter.get('/users', rh(authenticate), rh(requireAdmin), rh(admin.getUsers));
adminRouter.put('/users/:id/status', rh(authenticate), rh(requireAdmin),
  [body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status')],
  validate, rh(admin.updateUserStatus));
adminRouter.delete('/users/:id', rh(authenticate), rh(requireSuperAdmin), rh(admin.deleteUser));

adminRouter.post('/counselors', rh(authenticate), rh(requireSuperAdmin),
  [body('name').trim().notEmpty(), body('email').isEmail().normalizeEmail(),
   body('password').isLength({ min: 8 }), body('departmentId').optional().isMongoId()],
  validate, rh(admin.createCounselor));

adminRouter.post('/department-admins', rh(authenticate), rh(requireSuperAdmin),
  [body('name').trim().notEmpty(), body('email').isEmail().normalizeEmail(),
   body('password').isLength({ min: 8 }), body('departmentId').optional().isMongoId()],
  validate, rh(admin.createDepartmentAdmin));

adminRouter.get('/posts', rh(authenticate), rh(requireAdmin), admin.getAllPosts);
adminRouter.put('/posts/:id/status', rh(authenticate), rh(requireAdmin),
  [body('status').isIn(['draft', 'published', 'archived']).withMessage('Invalid status')],
  validate, admin.updatePostStatus);

adminRouter.get('/comments/pending', rh(authenticate), rh(requireAdmin), admin.getPendingComments);
adminRouter.put('/comments/:id/moderate', rh(authenticate), rh(requireAdmin),
  [body('status').isIn(['approved', 'rejected']).withMessage('Invalid status')],
  validate, admin.moderateComment);

adminRouter.get('/departments', rh(authenticate), rh(requireAdmin), admin.getDepartments);
adminRouter.post('/departments', rh(authenticate), rh(requireSuperAdmin),
  [body('name').trim().notEmpty().withMessage('Department name is required')],
  validate, admin.createDepartment);
adminRouter.put('/departments/:id', rh(authenticate), rh(requireSuperAdmin), admin.updateDepartment);
