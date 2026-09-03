import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import path from 'path';

import authRoutes from './routes/auth.routes';
import {
  postRouter,
  commentRouter,
  counselorRouter,
  sessionRouter,
  chatRouter,
  userRouter,
  adminRouter,
  categoryRouter,
  libraryRouter,
  subscribeRouter,
} from './routes/index';
import { errorHandler, notFound } from './middleware/error';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// ─── SECURITY ─────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(mongoSanitize());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const configuredOrigins = [
  process.env.CLIENT_URL,
  process.env.ADMIN_URL,
  process.env.CORS_ORIGINS,
]
  .filter(Boolean) as string[]

const allowedOrigins = configuredOrigins
  .flatMap(s => s.split(',').map(o => o.trim()).filter(Boolean))
  .map(o => o.replace(/^http:/, 'https:'))

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    const originNormalized = origin.replace(/^http:/, 'https:')
    if (originNormalized.endsWith('.vercel.app')) return callback(null, true)
    callback(null, allowedOrigins.includes(originNormalized))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many auth attempts. Please wait 15 minutes.' },
});

app.use('/api', limiter);
app.use('/api/auth', authLimiter);

// ─── PARSING ──────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());

// ─── LOGGING ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg: string) => logger.http(msg.trim()) },
  }));
}

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_PATH || 'uploads')));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Nistar API is running', timestamp: new Date().toISOString() });
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRouter);
app.use('/api/comments', commentRouter);
app.use('/api/counselors', counselorRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/chat', chatRouter);
app.use('/api/users', userRouter);
app.use('/api/admin', adminRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/library', libraryRouter);
app.use('/api/subscribe', subscribeRouter);

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
