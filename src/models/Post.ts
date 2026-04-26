import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import { IPost } from '../types';

const PostSchema = new Schema<IPost>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, unique: true },
    content: { type: String, required: true },
    excerpt: { type: String, maxlength: 500 },
    coverImage: { type: String },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    tags: [{ type: String, lowercase: true, trim: true }],
    category: { type: String, trim: true },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    isAnonymous: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { transform(_doc, ret: Record<string, unknown>) { ret.__v = undefined; return ret; } },
  }
);

PostSchema.index({ slug: 1 });
PostSchema.index({ author: 1, status: 1 });
PostSchema.index({ status: 1, createdAt: -1 });
PostSchema.index({ tags: 1 });
PostSchema.index({ title: 'text', content: 'text', tags: 'text' });

PostSchema.pre('save', async function (next) {
  if (this.isModified('title') && !this.slug) {
    const baseSlug = slugify(this.title, { lower: true, strict: true });
    const exists = await mongoose.model('Post').findOne({ slug: baseSlug });
    this.slug = exists ? `${baseSlug}-${Date.now()}` : baseSlug;
  }
  next();
});

export default mongoose.model<IPost>('Post', PostSchema);
