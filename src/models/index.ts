import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import {
  IComment, IConversation, IMessage, ISession, INotification, ICounselorApplication,
  ICategory, ISubscriber, ILiteraryWork, IAuditLog,
} from '../types';

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
    type: { type: String, enum: ['support', 'therapy'], default: 'support' },
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
    counselor: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'approved', 'scheduled', 'active', 'completed', 'cancelled'], default: 'pending' },
    requestedDate: { type: Date, required: true },
    scheduledAt: { type: Date },
    duration: { type: Number, default: 60 },
    description: { type: String, maxlength: 2000 },
    emotionalState: { type: String, maxlength: 5000 },
    preferredSupportType: { type: String, enum: ['call', 'chat', 'follow-up'] },
    availability: { type: String, maxlength: 500 },
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

// Counselor Application
const CounselorApplicationSchema = new Schema<ICounselorApplication>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    statement: { type: String, maxlength: 5000 },
    documents: [{ type: String }],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String },
  },
  { timestamps: true, toJSON: { transform } }
);
CounselorApplicationSchema.index({ user: 1 });
CounselorApplicationSchema.index({ status: 1 });

// Category
const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, unique: true },
    description: { type: String, maxlength: 300 },
    icon: { type: String },
    color: { type: String, default: '#9CAF88' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { transform } }
);
CategorySchema.pre('save', function (next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// Mailing-list subscriber
const SubscriberSchema = new Schema<ISubscriber>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    source: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { transform } }
);

// Literary work (EPUB library)
const LiteraryWorkSchema = new Schema<ILiteraryWork>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, unique: true },
    description: { type: String, maxlength: 2000 },
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
    category: { type: String, trim: true },
    coverImage: { type: String },
    epubFile: { type: String, required: true },
    downloadCount: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { transform } }
);
LiteraryWorkSchema.pre('save', async function (next) {
  if (this.isModified('title') && !this.slug) {
    const base = slugify(this.title, { lower: true, strict: true });
    const exists = await mongoose.model('LiteraryWork').findOne({ slug: base });
    this.slug = exists ? `${base}-${Date.now()}` : base;
  }
  next();
});

// Audit log (super-admin sensitive access, etc.)
const AuditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { transform } }
);
AuditLogSchema.index({ actor: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1 });

export const Comment = mongoose.model<IComment>('Comment', CommentSchema);
export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);
export const Message = mongoose.model<IMessage>('Message', MessageSchema);
export const Session = mongoose.model<ISession>('Session', SessionSchema);
export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
export const CounselorApplication = mongoose.model<ICounselorApplication>('CounselorApplication', CounselorApplicationSchema);
export const Category = mongoose.model<ICategory>('Category', CategorySchema);
export const Subscriber = mongoose.model<ISubscriber>('Subscriber', SubscriberSchema);
export const LiteraryWork = mongoose.model<ILiteraryWork>('LiteraryWork', LiteraryWorkSchema);
export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);