import 'dotenv/config';
import app from '../src/app';
import connectDB from '../src/config/database';

// Connect to DB once (Vercel reuses warm instances)
connectDB().catch((err) => {
  console.error('DB connection failed:', err);
});

// Export the Express app as the Vercel serverless handler
export default app;
