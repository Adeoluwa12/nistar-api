import { Request, Response, NextFunction } from 'express';
import { Document, Types } from 'mongoose';

export type UserRole = 'user' | 'counselor' | 'department_admin' | 'super_admin';
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification';
export type PostStatus = 'draft' | 'published' | 'archived';
export type CommentStatus = 'pending' | 'approved' | 'rejected';
export type SessionStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type MessageType = 'text' | 'image' | 'file' | 'system';

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
  // Counselor-specific
  department?: Types.ObjectId;
  specializations?: string[];
  qualifications?: string[];
  isAvailable?: boolean;
  sessionCount?: number;
  rating?: number;
  // User-specific
  assignedCounselor?: Types.ObjectId;
  // Timestamps
  lastActive?: Date;
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
  counselor: Types.ObjectId;
  status: SessionStatus;
  scheduledAt: Date;
  duration?: number; // minutes
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

export interface AuthRequest extends Request {
  user?: IUser & { _id: Types.ObjectId };
}

// Helper type for route handlers that need auth
export type AuthHandler = (req: AuthRequest, res: Response, next: NextFunction) => Promise<void> | void;

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
