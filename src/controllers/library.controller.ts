import { Request, Response } from 'express';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import { LiteraryWork } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';
import { watermarkEpub } from '../utils/epub';

function getPublicIdFromUrl(url: string): string {
  const match = url.match(/\/upload\/v\d+\/(.+)$/);
  return match ? match[1] : url;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
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
      epubFile: (epub as any).path,
      coverImage: cover ? (cover as any).path : undefined,
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
    try {
      if (work.epubFile) {
        const epubPublicId = getPublicIdFromUrl(work.epubFile);
        await cloudinary.uploader.destroy(epubPublicId, { resource_type: 'raw', invalidate: true });
      }
      if (work.coverImage) {
        const coverPublicId = getPublicIdFromUrl(work.coverImage);
        await cloudinary.uploader.destroy(coverPublicId, { invalidate: true });
      }
    } catch { /* ignore cleanup errors */ }
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
      sendError(res, 'Book file is unavailable.', 404);
      return;
    }

    const original = await downloadBuffer(work.epubFile);
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
