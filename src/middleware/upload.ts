import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import { Request } from 'express';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
