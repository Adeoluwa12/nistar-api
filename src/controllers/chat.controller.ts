import { Response } from 'express';
import { Conversation, Message, Notification } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// GET /api/conversations — get my conversations
export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isUser = req.user!.role === 'user';
    const filter = isUser
      ? { user: req.user!._id }
      : { counselor: req.user!._id };

    const conversations = await Conversation.find(filter)
      .populate('user', 'name avatar lastActive')
      .populate('counselor', 'name avatar isAvailable')
      .populate('lastMessage', 'content type createdAt sender')
      .sort({ lastMessageAt: -1 });

    sendSuccess(res, conversations);
  } catch (err) {
    sendError(res, 'Failed to fetch conversations.', 500);
  }
};

// GET /api/conversations/:id/messages
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      sendError(res, 'Conversation not found.', 404);
      return;
    }

    const userId = req.user!._id.toString();
    const isParticipant = [conversation.user.toString(), conversation.counselor.toString()].includes(userId);
    if (!isParticipant) {
      sendError(res, 'Access denied.', 403);
      return;
    }

    const [messages, total] = await Promise.all([
      Message.find({ conversation: req.params.id })
        .populate('sender', 'name avatar role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments({ conversation: req.params.id }),
    ]);

    // Mark messages as read
    const isUser = conversation.user.toString() === userId;
    await Message.updateMany(
      { conversation: req.params.id, sender: { $ne: req.user!._id }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    if (isUser) {
      await Conversation.findByIdAndUpdate(req.params.id, { unreadCountUser: 0 });
    } else {
      await Conversation.findByIdAndUpdate(req.params.id, { unreadCountCounselor: 0 });
    }

    sendSuccess(res, messages.reverse(), 'Messages retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch messages.', 500);
  }
};

// POST /api/conversations/:id/messages
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      sendError(res, 'Conversation not found.', 404);
      return;
    }

    const userId = req.user!._id.toString();
    const isParticipant = [conversation.user.toString(), conversation.counselor.toString()].includes(userId);
    if (!isParticipant) {
      sendError(res, 'Access denied.', 403);
      return;
    }

    const { content, type = 'text' } = req.body;

    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user!._id,
      content,
      type,
      fileUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
    });

    await message.populate('sender', 'name avatar role');

    // Update conversation
    const isUser = conversation.user.toString() === userId;
    const updateData: Record<string, unknown> = {
      lastMessage: message._id,
      lastMessageAt: new Date(),
    };
    if (isUser) {
      updateData.unreadCountCounselor = (conversation.unreadCountCounselor || 0) + 1;
    } else {
      updateData.unreadCountUser = (conversation.unreadCountUser || 0) + 1;
    }
    await Conversation.findByIdAndUpdate(conversation._id, updateData);

    // Notify recipient
    const recipientId = isUser ? conversation.counselor : conversation.user;
    await Notification.create({
      recipient: recipientId,
      type: 'new_message',
      title: 'New message',
      message: `${req.user!.name}: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`,
      data: { conversationId: conversation._id, messageId: message._id },
    });

    sendSuccess(res, message, 'Message sent', 201);
  } catch (err) {
    sendError(res, 'Failed to send message.', 500);
  }
};
