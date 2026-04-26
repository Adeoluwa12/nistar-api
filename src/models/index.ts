import mongoose, { Schema } from 'mongoose';
import { IComment, IConversation, IMessage, ISession, INotification } from '../types';

const transform = (_doc: any, ret: Record<string, unknown>) => { 
  delete ret.__v; 
  return ret; 
};

// Comment
const CommentSchema = new Schema<IComment>(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    parentComment: { type: Schema.Types.ObjectId, ref: 'Comment' },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    likeCount: { type: Number, default: 0 },
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { transform } }
);
CommentSchema.index({ post: 1, status: 1, createdAt: -1 });
CommentSchema.index({ author: 1 });

// Conversation
const ConversationSchema = new Schema<IConversation>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counselor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
    lastMessageAt: { type: Date },
    isActive: { type: Boolean, default: true },
    unreadCountUser: { type: Number, default: 0 },
    unreadCountCounselor: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { transform } }
);
ConversationSchema.index({ user: 1, counselor: 1 }, { unique: true });
ConversationSchema.index({ counselor: 1, lastMessageAt: -1 });

// Message
const MessageSchema = new Schema<IMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 5000 },
    type: { type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' },
    fileUrl: { type: String },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true, toJSON: { transform } }
);
MessageSchema.index({ conversation: 1, createdAt: -1 });

// Session
const SessionSchema = new Schema<ISession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counselor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['scheduled', 'active', 'completed', 'cancelled'], default: 'scheduled' },
    scheduledAt: { type: Date, required: true },
    duration: { type: Number, default: 60 },
    notes: { type: String, maxlength: 2000 },
    userNotes: { type: String, maxlength: 2000 },
    meetingLink: { type: String },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String },
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, maxlength: 1000 },
  },
  { timestamps: true, toJSON: { transform } }
);
SessionSchema.index({ user: 1, status: 1 });
SessionSchema.index({ counselor: 1, scheduledAt: 1 });

// Notification
const NotificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { transform } }
);
NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export const Comment = mongoose.model<IComment>('Comment', CommentSchema);
export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);
export const Message = mongoose.model<IMessage>('Message', MessageSchema);
export const Session = mongoose.model<ISession>('Session', SessionSchema);
export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);