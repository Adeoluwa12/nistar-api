import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import { IDepartment } from '../types';

const DepartmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, maxlength: 1000 },
    slug: { type: String, unique: true },
    icon: { type: String },
    color: { type: String, default: '#9CAF88' },
    headAdmin: { type: Schema.Types.ObjectId, ref: 'User' },
    counselors: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { transform(_doc, ret: Record<string, unknown>) { ret.__v = undefined; return ret; } },
  }
);

DepartmentSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

export default mongoose.model<IDepartment>('Department', DepartmentSchema);
