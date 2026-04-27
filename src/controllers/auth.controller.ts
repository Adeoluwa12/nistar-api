import { Request, Response } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';
import { AuthRequest } from '../types/index';
import { signAccessToken, signRefreshToken, verifyRefreshToken, cookieOptions } from '../utils/jwt';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '../utils/email';
import { sendSuccess, sendError } from '../utils/response';
import logger from '../utils/logger';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const issueTokens = async (res: Response, userId: string, role: string) => {
  const accessToken = signAccessToken(userId, role as never);
  const refreshToken = signRefreshToken(userId);
  await User.findByIdAndUpdate(userId, { refreshToken });
  res.cookie('refreshToken', refreshToken, cookieOptions);
  return { accessToken, refreshToken };
};

// POST /api/auth/register
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      sendError(res, 'An account with this email already exists.', 409);
      return;
    }

    const user = new User({ name, email, password, role: 'user' });
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    await sendVerificationEmail(email, name, verificationToken);

    sendSuccess(
      res,
      { email: user.email, name: user.name },
      'Registration successful! Please check your email to verify your account.',
      201
    );
  } catch (err) {
    logger.error('Register error:', err);
    sendError(res, 'Registration failed. Please try again.', 500);
  }
};

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.password) {
      sendError(res, 'Invalid email or password.', 401);
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      sendError(res, 'Invalid email or password.', 401);
      return;
    }

    if (!user.isEmailVerified) {
      sendError(res, 'Please verify your email before logging in.', 403);
      return;
    }

    if (user.status === 'suspended') {
      sendError(res, 'Your account has been suspended. Please contact support.', 403);
      return;
    }

    const { accessToken } = await issueTokens(res, user._id.toString(), user.role);

    sendSuccess(res, {
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
      },
    }, 'Login successful');
  } catch (err) {
    logger.error('Login error:', err);
    sendError(res, 'Login failed. Please try again.', 500);
  }
};

// POST /api/auth/google
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      sendError(res, 'Invalid Google token.', 400);
      return;
    }

    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: payload.email }] });

    if (!user) {
      user = await User.create({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email,
        googleId: payload.sub,
        avatar: payload.picture,
        isEmailVerified: true,
        status: 'active',
        role: 'user',
      });
      await sendWelcomeEmail(user.email, user.name);
    } else if (!user.googleId) {
      user.googleId = payload.sub;
      if (!user.avatar && payload.picture) user.avatar = payload.picture;
      user.isEmailVerified = true;
      if (user.status === 'pending_verification') user.status = 'active';
      await user.save();
    }

    if (user.status === 'suspended') {
      sendError(res, 'Your account has been suspended.', 403);
      return;
    }

    const { accessToken } = await issueTokens(res, user._id.toString(), user.role);

    sendSuccess(res, {
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
      },
    }, 'Google authentication successful');
  } catch (err) {
    logger.error('Google auth error:', err);
    sendError(res, 'Google authentication failed.', 500);
  }
};

// GET /api/auth/verify-email?token=...
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      sendError(res, 'Verification token is required.', 400);
      return;
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      sendError(res, 'Invalid or expired verification token.', 400);
      return;
    }

    user.isEmailVerified = true;
    user.status = 'active';
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    await sendWelcomeEmail(user.email, user.name);

    sendSuccess(res, null, 'Email verified successfully! You can now log in.');
  } catch (err) {
    logger.error('Verify email error:', err);
    sendError(res, 'Email verification failed.', 500);
  }
};

// POST /api/auth/resend-verification
export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user || user.isEmailVerified) {
      // Generic response for security
      sendSuccess(res, null, 'If an account with that email exists, a verification email has been sent.');
      return;
    }

    const token = user.generateEmailVerificationToken();
    await user.save();
    await sendVerificationEmail(user.email, user.name, token);

    sendSuccess(res, null, 'Verification email sent successfully.');
  } catch (err) {
    logger.error('Resend verification error:', err);
    sendError(res, 'Failed to resend verification email.', 500);
  }
};

// POST /api/auth/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).select('+passwordResetToken +passwordResetExpires');

    // Always return success for security
    if (user) {
      const token = user.generatePasswordResetToken();
      await user.save();
      await sendPasswordResetEmail(user.email, user.name, token);
    }

    sendSuccess(
      res,
      null,
      'If an account with that email exists, a password reset link has been sent.'
    );
  } catch (err) {
    logger.error('Forgot password error:', err);
    sendError(res, 'Failed to process request.', 500);
  }
};

// POST /api/auth/reset-password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires +password');

    if (!user) {
      sendError(res, 'Invalid or expired reset token. Please request a new one.', 400);
      return;
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    sendSuccess(res, null, 'Password reset successfully. You can now log in.');
  } catch (err) {
    logger.error('Reset password error:', err);
    sendError(res, 'Password reset failed.', 500);
  }
};

// POST /api/auth/refresh
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      sendError(res, 'Refresh token required.', 401);
      return;
    }

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || user.refreshToken !== token) {
      sendError(res, 'Invalid refresh token.', 401);
      return;
    }

    const { accessToken } = await issueTokens(res, user._id.toString(), user.role);
    sendSuccess(res, { accessToken }, 'Token refreshed successfully');
  } catch {
    sendError(res, 'Invalid or expired refresh token.', 401);
  }
};

// POST /api/auth/logout
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    }
    res.clearCookie('refreshToken');
    res.clearCookie('accessToken');
    sendSuccess(res, null, 'Logged out successfully');
  } catch (err) {
    sendError(res, 'Logout failed.', 500);
  }
};

// GET /api/auth/me
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!._id)
      .populate('department', 'name slug color icon')
      .populate('assignedCounselor', 'name avatar bio specializations rating');
    sendSuccess(res, user);
  } catch (err) {
    sendError(res, 'Failed to fetch profile.', 500);
  }
};

// PUT /api/auth/change-password
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user!._id).select('+password');

    if (!user || !user.password) {
      sendError(res, 'Cannot change password for Google accounts.', 400);
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      sendError(res, 'Current password is incorrect.', 400);
      return;
    }

    user.password = newPassword;
    await user.save();

    sendSuccess(res, null, 'Password changed successfully.');
  } catch (err) {
    sendError(res, 'Failed to change password.', 500);
  }
};
