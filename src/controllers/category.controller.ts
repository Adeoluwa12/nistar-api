import { Request, Response } from 'express';
import slugify from 'slugify';
import { Category } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError } from '../utils/response';

// GET /api/categories — public, active only
export const listCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    sendSuccess(res, categories);
  } catch {
    sendError(res, 'Failed to fetch categories.', 500);
  }
};

// GET /api/admin/categories — admins see all
export const listAllCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    sendSuccess(res, categories);
  } catch {
    sendError(res, 'Failed to fetch categories.', 500);
  }
};

// POST /api/admin/categories — super admin
export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, icon, color } = req.body;
    const slug = slugify(String(name), { lower: true, strict: true });

    const existing = await Category.findOne({ slug });
    if (existing) {
      sendError(res, 'A category with this name already exists.', 409);
      return;
    }

    const category = await Category.create({ name, slug, description, icon, color });
    sendSuccess(res, category, 'Category created', 201);
  } catch {
    sendError(res, 'Failed to create category.', 500);
  }
};

// PUT /api/admin/categories/:id — super admin
export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const updates: Record<string, unknown> = {};
    ['name', 'description', 'icon', 'color', 'isActive'].forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (typeof updates.name === 'string') {
      updates.slug = slugify(updates.name, { lower: true, strict: true });
    }

    const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!category) {
      sendError(res, 'Category not found.', 404);
      return;
    }
    sendSuccess(res, category, 'Category updated');
  } catch {
    sendError(res, 'Failed to update category.', 500);
  }
};

// DELETE /api/admin/categories/:id — super admin
export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      sendError(res, 'Category not found.', 404);
      return;
    }
    sendSuccess(res, null, 'Category deleted');
  } catch {
    sendError(res, 'Failed to delete category.', 500);
  }
};
