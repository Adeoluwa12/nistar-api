declare module 'multer-storage-cloudinary' {
  import { StorageEngine } from 'multer';

  export interface CloudinaryStorageOptions {
    cloudinary: any;
    params?: Record<string, unknown> | ((req: any, file: Express.Multer.File) => Promise<Record<string, unknown>> | Record<string, unknown>);
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(opts: CloudinaryStorageOptions);
    _handleFile(req: any, file: Express.Multer.File, callback: (error?: any, info?: Partial<Express.Multer.File>) => void): void;
    _removeFile(req: any, file: Express.Multer.File, callback: (error?: any) => void): void;
  }

  export default function createCloudinaryStorage(opts: CloudinaryStorageOptions): CloudinaryStorage;
}
