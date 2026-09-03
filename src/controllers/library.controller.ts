import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { LiteraryWork } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import { watermarkEpub } from '../utils/epub';

const UPLOAD_BASE = process.env.UPLOAD_PATH || './uploads';

function epubDiskPath(epubFile: string): string {
  return path.join(process.cwd(), UPLOAD_BASE, 'epubs', path.basename(epubFile));
}

type MulterFiles = { [field: string]: Express.Multer.File[] };

// GET /api/library — public, published works
export const listWorks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { category, search } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { isPublished: true };
    if (category) filter.category = category;
    if (search) filter.title = { $regex: search, $options: 'i' };

    const [works, total] = await Promise.all([
      LiteraryWork.find(filter)
        .select('-__v')
        .populate('author', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      LiteraryWork.countDocuments(filter),
    ]);

    sendSuccess(res, works, 'Library retrieved', 200, paginate(page, limit, total));
  } catch {
    sendError(res, 'Failed to fetch library.', 500);
  }
};

// GET /api/library/:slug
export const getWork = async (req: Request, res: Response): Promise<void> => {
  try {
    const work = await LiteraryWork.findOne({ slug: req.params.slug, isPublished: true })
      .populate('author', 'name avatar');
    if (!work) {
      sendError(res, 'Work not found.', 404);
      return;
    }
    sendSuccess(res, work);
  } catch {
    sendError(res, 'Failed to fetch work.', 500);
  }
};

// POST /api/admin/library — admin creates a work (epub required, cover optional)
export const createWork = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const files = (req.files as MulterFiles) || {};
    const epub = files.epub?.[0];
    const cover = files.cover?.[0];

    if (!epub) {
      sendError(res, 'An EPUB file is required.', 400);
      return;
    }

    const { title, description, category, authorName } = req.body;

    const work = await LiteraryWork.create({
      title,
      description,
      category,
      authorName,
      author: req.user!._id,
      epubFile: `/uploads/epubs/${epub.filename}`,
      coverImage: cover ? `/uploads/${cover.filename}` : undefined,
    });

    sendSuccess(res, work, 'Literary work published', 201);
  } catch {
    sendError(res, 'Failed to create literary work.', 500);
  }
};

// DELETE /api/admin/library/:id — admin
export const deleteWork = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const work = await LiteraryWork.findByIdAndDelete(req.params.id);
    if (!work) {
      sendError(res, 'Work not found.', 404);
      return;
    }
    // Best-effort file cleanup
    try { fs.unlinkSync(epubDiskPath(work.epubFile)); } catch { /* ignore */ }
    sendSuccess(res, null, 'Work deleted');
  } catch {
    sendError(res, 'Failed to delete work.', 500);
  }
};

// GET /api/library/:slug/download — visitors + authenticated users
// Applies an on-demand personalised watermark before streaming the EPUB.
export const downloadWork = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const work = await LiteraryWork.findOne({ slug: req.params.slug, isPublished: true });
    if (!work) {
      sendError(res, 'Work not found.', 404);
      return;
    }

    const diskPath = epubDiskPath(work.epubFile);
    if (!fs.existsSync(diskPath)) {
      sendError(res, 'Book file is unavailable.', 404);
      return;
    }

    const original = fs.readFileSync(diskPath);
    const watermarked = watermarkEpub(original, {
      readerName: req.user?.name || 'Anonymous Reader',
      email: req.user?.email,
      date: new Date(),
    });

    await LiteraryWork.updateOne({ _id: work._id }, { $inc: { downloadCount: 1 } });

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${work.slug}.epub"`);
    res.send(watermarked);
  } catch {
    sendError(res, 'Failed to download book.', 500);
  }
};
