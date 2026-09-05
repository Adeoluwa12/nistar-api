import 'dotenv/config';
import http from 'http';
import app from './app';
import connectDB from './config/database';
import { initSocket } from './services/socket.service';
import logger from './utils/logger';

const PORT = parseInt(process.env.PORT || '5000');

const bootstrap = async () => {
  await connectDB();

  const server = http.createServer(app);
  initSocket(server);




  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`🌿 Nistar API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    logger.info(`📡 WebSocket server ready`);
    logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      logger.info('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
  });
};

bootstrap().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
