import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { sendError } from '../utils/response';
import logger from '../utils/logger';

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg).join(', ');
    sendError(res, messages, 422);
    return;
  }
  next();
};

export const errorHandler = (
  err: Error & { statusCode?: number; code?: number },
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error(`${err.message}`, { stack: err.stack, url: req.url, method: req.method });

  // Mongoose duplicate key
  if (err.code === 11000) {
    sendError(res, 'A record with this information already exists.', 409);
    return;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    sendError(res, err.message, 400);
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'Invalid token.', 401);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    sendError(res, 'Token expired. Please log in again.', 401);
    return;
  }

  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'An unexpected error occurred. Please try again.'
      : err.message;

  sendError(res, message, statusCode);
};

export const notFound = (req: Request, res: Response): void => {
  sendError(res, `Route ${req.originalUrl} not found.`, 404);
};
