import 'dotenv/config';
import type { Request, Response } from 'express';
import app from './app';
import connectDB from './config/database';

export default async function handler(req: Request, res: Response) {
  await connectDB();
  return app(req, res);
}
