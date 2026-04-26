import { Server as HTTPServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import User from '../models/User';
import { Conversation, Message } from '../models/index';
import logger from '../utils/logger';

interface AuthSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export const initSocket = (httpServer: HTTPServer): SocketServer => {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: [process.env.CLIENT_URL || 'http://localhost:3000', process.env.ADMIN_URL || 'http://localhost:3001'],
      credentials: true,
    },
  });

  // Auth middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.id);

      if (!user || user.status === 'suspended') {
        return next(new Error('Unauthorised'));
      }

      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Track online users
  const onlineUsers = new Map<string, string>(); // userId -> socketId

  io.on('connection', (socket: AuthSocket) => {
    const userId = socket.userId!;
    onlineUsers.set(userId, socket.id);

    logger.info(`User connected: ${userId} (${socket.id})`);

    // Join personal room for notifications
    socket.join(`user:${userId}`);

    // Broadcast online status
    socket.broadcast.emit('user:online', { userId });

    // ─── JOIN CONVERSATION ROOM ───────────────────────────────────────────
    socket.on('conversation:join', async (conversationId: string) => {
      try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;

        const isParticipant = [conversation.user.toString(), conversation.counselor.toString()].includes(userId);
        if (!isParticipant) return;

        socket.join(`conv:${conversationId}`);
        socket.emit('conversation:joined', { conversationId });
      } catch (err) {
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    socket.on('conversation:leave', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // ─── SEND MESSAGE ─────────────────────────────────────────────────────
    socket.on('message:send', async (data: { conversationId: string; content: string; type?: string }) => {
      try {
        const conversation = await Conversation.findById(data.conversationId);
        if (!conversation) return;

        const isParticipant = [conversation.user.toString(), conversation.counselor.toString()].includes(userId);
        if (!isParticipant) return;

        const message = await Message.create({
          conversation: data.conversationId,
          sender: userId,
          content: data.content,
          type: data.type || 'text',
        });

        await message.populate('sender', 'name avatar role');

        // Update conversation
        const isUserSender = conversation.user.toString() === userId;
        await Conversation.findByIdAndUpdate(data.conversationId, {
          lastMessage: message._id,
          lastMessageAt: new Date(),
          $inc: isUserSender ? { unreadCountCounselor: 1 } : { unreadCountUser: 1 },
        });

        // Emit to conversation room
        io.to(`conv:${data.conversationId}`).emit('message:new', message);

        // Emit notification to recipient's personal room
        const recipientId = isUserSender ? conversation.counselor.toString() : conversation.user.toString();
        io.to(`user:${recipientId}`).emit('notification:message', {
          conversationId: data.conversationId,
          message: { _id: message._id, content: data.content, sender: { _id: userId } },
        });
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── TYPING INDICATORS ────────────────────────────────────────────────
    socket.on('typing:start', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit('typing:start', { userId, conversationId });
    });

    socket.on('typing:stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit('typing:stop', { userId, conversationId });
    });

    // ─── READ RECEIPT ─────────────────────────────────────────────────────
    socket.on('messages:read', async ({ conversationId }: { conversationId: string }) => {
      try {
        await Message.updateMany(
          { conversation: conversationId, sender: { $ne: userId }, isRead: false },
          { isRead: true, readAt: new Date() }
        );
        socket.to(`conv:${conversationId}`).emit('messages:read', { conversationId, readBy: userId });
      } catch {
        // silent
      }
    });

    // ─── CALL SIGNALING ───────────────────────────────────────────────────
    socket.on('call:initiate', ({ conversationId, offer }: { conversationId: string; offer: unknown }) => {
      socket.to(`conv:${conversationId}`).emit('call:incoming', { from: userId, offer, conversationId });
    });

    socket.on('call:answer', ({ conversationId, answer }: { conversationId: string; answer: unknown }) => {
      socket.to(`conv:${conversationId}`).emit('call:answered', { answer, conversationId });
    });

    socket.on('call:ice-candidate', ({ conversationId, candidate }: { conversationId: string; candidate: unknown }) => {
      socket.to(`conv:${conversationId}`).emit('call:ice-candidate', { candidate, from: userId });
    });

    socket.on('call:end', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit('call:ended', { by: userId });
    });

    // ─── DISCONNECT ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      socket.broadcast.emit('user:offline', { userId });
      logger.info(`User disconnected: ${userId}`);
    });
  });

  return io;
};
