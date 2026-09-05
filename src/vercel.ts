import 'dotenv/config';
import app from './app';
import connectDB from './config/database';

// Connect to DB on cold start (Vercel reuses warm function instances)
connectDB().catch((err) => {
  console.error('[Vercel] DB connection failed:', err);
});

// Vercel serverless: export the Express app directly (no server.listen)
export default app;
