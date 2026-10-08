import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const missingVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
  .filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  logger.error(
    `[upload] Missing Cloudinary env vars: ${missingVars.join(', ')}. ` +
    'Image uploads will fail until these are set.'
  );
}

const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nistar',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 1200, quality: 'auto' }],
  } as Record<string, unknown>,
});

const documentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nistar/documents',
    resource_type: 'raw',
    allowed_formats: ['pdf'],
  } as Record<string, unknown>,
});

const libraryEpubStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nistar/epubs',
    resource_type: 'raw',
    allowed_formats: ['epub', 'zip'],
  } as Record<string, unknown>,
});

const libraryCoverStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nistar/covers',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 1200, quality: 'auto' }],
  } as Record<string, unknown>,
});

const imageFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed.'));
  }
};

const documentFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = ['application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF documents are allowed.'));
  }
};

const libraryFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.fieldname === 'epub') {
    const okMime = ['application/epub+zip', 'application/zip', 'application/octet-stream'].includes(file.mimetype);
    const okExt = file.originalname.toLowerCase().endsWith('.epub');
    return okMime || okExt ? cb(null, true) : cb(new Error('The book file must be an EPUB.'));
  }
  if (file.fieldname === 'cover') {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    return allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Cover must be an image.'));
  }
  return cb(new Error('Unexpected upload field.'));
};

export const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
}).single('image');

export const uploadImageSafe = (req: Request, res: Response, next: NextFunction): void => {
  uploadImage(req, res, (err?: unknown) => {
    if (err) {
      const error = err as Error & { code?: string; http_code?: number };
      // Log the full error so Cloudinary / multer issues are visible in server logs.
      logger.error(
        `[uploadImageSafe] Image upload failed (${error.code ?? error.http_code ?? 'UNKNOWN'}): ${error.message}`,
        { stack: error.stack }
      );
      (req as any).file = undefined;
      (req as any).imageUploadFailed = true;
      (req as any).imageUploadError = error.message;
      next();
    } else {
      next();
    }
  });
};

export const uploadMultiple = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
}).array('images', 5);

export const uploadDocuments = multer({
  storage: documentStorage,
  fileFilter: documentFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_DOC_SIZE || '10485760', 10) },
}).array('documents', 5);

export const uploadLiteraryWork = multer({
  storage: {
    _handleFile(req, file, callback) {
      if (file.fieldname === 'epub') {
        libraryEpubStorage._handleFile(req, file, callback);
      } else if (file.fieldname === 'cover') {
        libraryCoverStorage._handleFile(req, file, callback);
      } else {
        callback(new Error('Unexpected field name.'));
      }
    },
    _removeFile(req, file, callback) {
      if (file.fieldname === 'epub') {
        libraryEpubStorage._removeFile(req, file, callback);
      } else if (file.fieldname === 'cover') {
        libraryCoverStorage._removeFile(req, file, callback);
      } else {
        callback(null);
      }
    },
  },
  fileFilter: libraryFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_EPUB_SIZE || '31457280', 10) },
}).fields([{ name: 'epub', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);
