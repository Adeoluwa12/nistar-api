import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import * as auth from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/error';

const router = Router();
const rh = (fn: unknown): RequestHandler => fn as RequestHandler;

router.post('/register',
  [body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
   body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
   body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')],
  validate, auth.register);

router.post('/login',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
   body('password').notEmpty().withMessage('Password is required')],
  validate, auth.login);

router.post('/google',
  [body('idToken').notEmpty().withMessage('Google ID token is required')],
  validate, auth.googleAuth);

router.get('/verify-email', auth.verifyEmail);

router.post('/resend-verification',
  [body('email').isEmail().normalizeEmail()],
  validate, auth.resendVerification);

router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email is required')],
  validate, auth.forgotPassword);

router.post('/reset-password',
  [body('token').notEmpty().withMessage('Token is required'),
   body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')],
  validate, auth.resetPassword);

router.post('/refresh', auth.refreshToken);
router.post('/logout', rh(authenticate), rh(auth.logout));
router.get('/me', rh(authenticate), rh(auth.getMe));

router.put('/change-password',
  rh(authenticate),
  [body('currentPassword').notEmpty().withMessage('Current password is required'),
   body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')],
  validate, rh(auth.changePassword));

export default router;
