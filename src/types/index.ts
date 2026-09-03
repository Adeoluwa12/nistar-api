import { Request, Response, NextFunction } from 'express';
import { Document, Types } from 'mongoose';

// Enums / Literal Types
export type UserRole = 'user' | 'counselor' | 'department_admin' | 'super_admin';
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification';
export type PostStatus = 'draft' | 'pending' | 'published' | 'rejected' | 'archived';
export type PostVisibility = 'public' | 'private';
export type CommentStatus = 'pending' | 'approved' | 'rejected';
export type SessionStatus = 'pending' | 'approved' | 'scheduled' | 'active' | 'completed' | 'cancelled';
export type MessageType = 'text' | 'image' | 'file' | 'system';
export type ConversationType = 'support' | 'therapy';

// --- Interfaces ---

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  status: UserStatus;
  avatar?: string;
  bio?: string;
  phone?: string;
  googleId?: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  refreshToken?: string;
  department?: Types.ObjectId;
  specializations?: string[];
  qualifications?: string[];
  isAvailable?: boolean;
  sessionCount?: number;
  rating?: number;
  assignedCounselor?: Types.ObjectId;
  lastActive?: Date;
  isAuthor?: boolean;
  consecutiveApprovals?: number;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateEmailVerificationToken(): string;
  generatePasswordResetToken(): string;
}

export interface IDepartment extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  slug: string;
  icon?: string;
  color?: string;
  headAdmin?: Types.ObjectId;
  counselors: Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPost extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  coverImage?: string;
  author: Types.ObjectId;
  status: PostStatus;
  tags: string[];
  category?: string;
  likes: Types.ObjectId[];
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
  isAnonymous: boolean;
  allowComments: boolean;
  autoPublished: boolean;
  visibility: PostVisibility;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComment extends Document {
  _id: Types.ObjectId;
  post: Types.ObjectId;
  author: Types.ObjectId;
  content: string;
  status: CommentStatus;
  parentComment?: Types.ObjectId;
  likes: Types.ObjectId[];
  likeCount: number;
  isAnonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversation: Types.ObjectId;
  sender: Types.ObjectId;
  content: string;
  type: MessageType;
  fileUrl?: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
}

export interface IConversation extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  counselor: Types.ObjectId;
  type: ConversationType;
  lastMessage?: Types.ObjectId;
  lastMessageAt?: Date;
  isActive: boolean;
  unreadCountUser: number;
  unreadCountCounselor: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISession extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  counselor?: Types.ObjectId;
  status: SessionStatus;
  requestedDate: Date;
  scheduledAt?: Date;
  duration?: number;
  description?: string;
  emotionalState?: string;
  preferredSupportType?: 'call' | 'chat' | 'follow-up';
  availability?: string;
  notes?: string;
  userNotes?: string;
  meetingLink?: string;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;
  rating?: number;
  feedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotification extends Document {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

export interface ICounselorApplication extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  statement?: string;
  documents?: string[];
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: Types.ObjectId;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICategory extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubscriber extends Document {
  _id: Types.ObjectId;
  email: string;
  source?: string;
  createdAt: Date;
}

export interface ILiteraryWork extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  description?: string;
  author?: Types.ObjectId;
  authorName?: string;
  category?: string;
  coverImage?: string;
  epubFile: string;
  downloadCount: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  actor: Types.ObjectId;
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

// --- Request & Helper Types ---

/**
 * Custom Request interface to include the authenticated user.
 * We use an Intersection type to ensure Express.Request properties 
 * (body, params, query) are not lost.
 */
export interface AuthRequest extends Request {
  user?: IUser;
  // If your controllers use file/files from multer:
  file?: any; 
  files?: any;
}

/**
 * Helper type for Express middleware/handlers
 */
export type AuthHandler = (
  req: AuthRequest, 
  res: Response, 
  next: NextFunction
) => any;

export interface JwtPayload {
  id: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}