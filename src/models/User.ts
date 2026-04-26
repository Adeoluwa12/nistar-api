import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { IUser } from '../types';

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, minlength: 8, select: false },
    role: {
      type: String,
      enum: ['user', 'counselor', 'department_admin', 'super_admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'pending_verification'],
      default: 'pending_verification',
    },
    avatar: { type: String },
    bio: { type: String, maxlength: 500 },
    phone: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    refreshToken: { type: String, select: false },
    // Counselor fields
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    specializations: [{ type: String }],
    qualifications: [{ type: String }],
    isAvailable: { type: Boolean, default: true },
    sessionCount: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    // User fields
    assignedCounselor: { type: Schema.Types.ObjectId, ref: 'User' },
    lastActive: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.password = undefined;
        ret.emailVerificationToken = undefined;
        ret.emailVerificationExpires = undefined;
        ret.passwordResetToken = undefined;
        ret.passwordResetExpires = undefined;
        ret.refreshToken = undefined;
        ret.__v = undefined;
        return ret;
      },
    },
  }
);

UserSchema.index({ email: 1 });
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ department: 1 });
UserSchema.index({ assignedCounselor: 1 });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.generateEmailVerificationToken = function (): string {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return token;
};

UserSchema.methods.generatePasswordResetToken = function (): string {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
  return token;
};

export default mongoose.model<IUser>('User', UserSchema);
