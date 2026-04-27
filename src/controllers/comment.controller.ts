import { Request, Response } from 'express';
import { Comment, Notification } from '../models/index';
import Post from '../models/Post';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// POST /api/comments
export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { postId, content, parentComment, isAnonymous } = req.body;

    const post = await Post.findById(postId);
    if (!post || post.status !== 'published') {
      sendError(res, 'Post not found.', 404);
      return;
    }
    if (!post.allowComments) {
      sendError(res, 'Comments are disabled for this post.', 403);
      return;
    }

    const comment = await Comment.create({
      post: postId,
      author: req.user!._id,
      content,
      parentComment: parentComment || null,
      isAnonymous: isAnonymous ?? false,
      status: 'approved', // Auto-approve; change to 'pending' for moderation
    });

    await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

    // Notify post author
    if (post.author.toString() !== req.user!._id.toString()) {
      await Notification.create({
        recipient: post.author,
        type: 'post_comment',
        title: 'New comment on your post',
        message: `${isAnonymous ? 'Someone' : req.user!.name} commented on "${post.title}"`,
        data: { postId, commentId: comment._id },
      });
    }

    await comment.populate('author', 'name avatar');
    sendSuccess(res, comment, 'Comment added', 201);
  } catch (err) {
    sendError(res, 'Failed to add comment.', 500);
  }
};

// GET /api/comments/post/:postId
export const getPostComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [comments, total] = await Promise.all([
      Comment.find({ post: req.params.postId, status: 'approved', parentComment: null })
        .populate('author', 'name avatar role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Comment.countDocuments({ post: req.params.postId, status: 'approved', parentComment: null }),
    ]);

    // Fetch replies for top-level comments
    const commentIds = comments.map((c) => c._id);
    const replies = await Comment.find({
      parentComment: { $in: commentIds },
      status: 'approved',
    }).populate('author', 'name avatar role');

    const commentsWithReplies = comments.map((c) => ({
      ...c.toJSON(),
      replies: replies.filter((r) => r.parentComment?.toString() === c._id.toString()),
    }));

    sendSuccess(res, commentsWithReplies, 'Comments retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch comments.', 500);
  }
};

// POST /api/comments/:id/like
export const toggleCommentLike = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      sendError(res, 'Comment not found.', 404);
      return;
    }

    const userId = req.user!._id;
    const liked = comment.likes.some((id) => id.toString() === userId.toString());

    if (liked) {
      comment.likes = comment.likes.filter((id) => id.toString() !== userId.toString());
      comment.likeCount = Math.max(0, comment.likeCount - 1);
    } else {
      comment.likes.push(userId);
      comment.likeCount += 1;
    }

    await comment.save();
    sendSuccess(res, { liked: !liked, likeCount: comment.likeCount });
  } catch (err) {
    sendError(res, 'Failed to process like.', 500);
  }
};

// DELETE /api/comments/:id
export const deleteComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      sendError(res, 'Comment not found.', 404);
      return;
    }

    const isOwner = comment.author.toString() === req.user!._id.toString();
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user!.role);

    if (!isOwner && !isAdmin) {
      sendError(res, 'Unauthorised.', 403);
      return;
    }

    await Promise.all([
      comment.deleteOne(),
      Comment.deleteMany({ parentComment: comment._id }),
      Post.findByIdAndUpdate(comment.post, { $inc: { commentCount: -1 } }),
    ]);

    sendSuccess(res, null, 'Comment deleted');
  } catch (err) {
    sendError(res, 'Failed to delete comment.', 500);
  }
};
