import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types/index';
import { verifyAccessToken } from '../utils/jwt';
import { sendError } from '../utils/response';
import User from '../models/User';

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      sendError(res, 'Authentication required. Please log in.', 401);
      return;
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select('+password');

    if (!user) {
      sendError(res, 'User no longer exists.', 401);
      return;
    }

    if (user.status === 'suspended') {
      sendError(res, 'Your account has been suspended. Please contact support.', 403);
      return;
    }

    if (!user.isEmailVerified) {
      sendError(res, 'Please verify your email address to continue.', 403);
      return;
    }

    // Update last active
    await User.findByIdAndUpdate(user._id, { lastActive: new Date() });

    req.user = user;
    next();
  } catch (err) {
    sendError(res, 'Invalid or expired token. Please log in again.', 401);
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.id);
      if (user && user.status !== 'suspended' && user.isEmailVerified) {
        req.user = user;
      }
    }
  } catch {
    // Silent — optional auth
  }
  next();
};

export const authorize = (...roles: UserRole[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required.', 401);
      return;
    }
    if (!roles.includes(req.user.role)) {
      sendError(res, 'You do not have permission to perform this action.', 403);
      return;
    }
    next();
  };

export const requireCounselor = authorize('counselor', 'department_admin', 'super_admin');
export const requireAdmin = authorize('department_admin', 'super_admin');
export const requireSuperAdmin = authorize('super_admin');
