import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';

const UPLOAD_BASE = process.env.UPLOAD_PATH || './uploads';

// Ensure upload directories exist so diskStorage never fails on a fresh clone.
for (const dir of [UPLOAD_BASE, path.join(UPLOAD_BASE, 'documents'), path.join(UPLOAD_BASE, 'epubs')]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

const imageStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_BASE);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const documentStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, path.join(UPLOAD_BASE, 'documents'));
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

// Storage for the EPUB library: routes the master EPUB to /epubs and the
// optional cover image to the base uploads directory, keyed on field name.
const libraryStorage = multer.diskStorage({
  destination(_req, file, cb) {
    cb(null, file.fieldname === 'epub' ? path.join(UPLOAD_BASE, 'epubs') : UPLOAD_BASE);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname) || (file.fieldname === 'epub' ? '.epub' : '');
    cb(null, `${uuidv4()}${ext}`);
  },
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

export const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
}).single('image');

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

// EPUB (required) + optional cover image, for creating a literary work.
export const uploadLiteraryWork = multer({
  storage: libraryStorage,
  fileFilter: libraryFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_EPUB_SIZE || '31457280', 10) },
}).fields([{ name: 'epub', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);
