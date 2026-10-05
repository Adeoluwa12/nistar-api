import { Request, Response } from 'express';
import Post from '../models/Post';
import User from '../models/User';
import { Comment, Notification } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// GET /api/posts — public feed
export const getPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { tag, category, search, sort = 'latest' } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { status: 'published', visibility: 'public' };
    if (tag) filter.tags = tag.toLowerCase();
    if (category) filter.category = category;
    if (search) filter.$text = { $search: search };

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      latest: { createdAt: -1 },
      popular: { likeCount: -1, viewCount: -1 },
      commented: { commentCount: -1 },
    };
    const sortQuery = sortMap[sort] || sortMap.latest;

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('author', 'name avatar role isAuthor')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .select('-likes'),
      Post.countDocuments(filter),
    ]);

    sendSuccess(res, posts, 'Posts retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch posts.', 500);
  }
};

// GET /api/posts/tags — most-used tags for composer suggestions
export const getTags = async (_req: Request, res: Response): Promise<void> => {
  try {
    const tags = await Post.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 40 },
      { $project: { _id: 0, tag: '$_id', count: 1 } },
    ]);
    sendSuccess(res, tags);
  } catch (err) {
    sendError(res, 'Failed to fetch tags.', 500);
  }
};

// GET /api/posts/:slug
export const getPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const post = await Post.findOne({ slug: req.params.slug })
      .populate('author', 'name avatar bio role isAuthor assignedCounselor');

    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    const userId = req.user?._id?.toString();
    const isAuthor = post.author._id.toString() === userId;
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user?.role ?? '');

    // Non-published posts are only visible to their author and admins
    if (post.status !== 'published' && !isAuthor && !isAdmin) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    // Private posts are only visible to the author, their assigned counselor, and admins
    if (post.visibility === 'private') {
      const isAssignedCounselor = (post.author as any).assignedCounselor?.toString() === userId;

      if (!isAuthor && !isAssignedCounselor && !isAdmin) {
        sendError(res, 'Post not found.', 404);
        return;
      }
    }

    // Increment view count — author and admin previews don't count as views
    if (!isAuthor && !isAdmin) {
      await Post.findByIdAndUpdate(post._id, { $inc: { viewCount: 1 } });
    }

    const comments = post.status === 'published'
      ? await Comment.find({ post: post._id, status: 'approved', parentComment: null })
          .populate('author', 'name avatar')
          .sort({ createdAt: -1 })
          .limit(20)
      : [];

    sendSuccess(res, { post, comments });
  } catch (err) {
    sendError(res, 'Failed to fetch post.', 500);
  }
};

// POST /api/posts
export const createPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, excerpt, tags, category, isAnonymous, allowComments, visibility, status } = req.body;

    // Drafts save as-is. Non-draft submissions auto-publish for Authors and
    // queue for admin review for everyone else.
    const isAuthor = !!req.user!.isAuthor;
    const postStatus = status === 'draft' ? 'draft' : isAuthor ? 'published' : 'pending';
    const autoPublished = postStatus === 'published';

    const post = await Post.create({
      title,
      content,
      excerpt,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
      category,
      status: postStatus,
      isAnonymous: isAnonymous ?? false,
      allowComments: allowComments ?? true,
      author: req.user!._id,
      coverImage: req.file ? (req.file as any).path : req.body.coverImage,
      autoPublished,
      visibility: visibility === 'private' ? 'private' : 'public',
    });

    await post.populate('author', 'name avatar role isAuthor');
    let message = postStatus === 'draft'
      ? 'Draft saved'
      : postStatus === 'pending'
        ? 'Post submitted for review'
        : 'Post created successfully';
    if ((req as any).imageUploadFailed) {
      message += ' — image upload failed, please try uploading again later.';
    }
    sendSuccess(res, post, message, 201);
  } catch (err) {
    sendError(res, 'Failed to create post.', 500);
  }
};

// PUT /api/posts/:id
export const updatePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    const isOwner = post.author.toString() === req.user!._id.toString();
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user!.role);

    if (!isOwner && !isAdmin) {
      sendError(res, 'You are not authorised to edit this post.', 403);
      return;
    }

    const allowed = ['title', 'content', 'excerpt', 'tags', 'category', 'isAnonymous', 'allowComments', 'coverImage', 'visibility'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        (post as unknown as Record<string, unknown>)[key] = req.body[key];
      }
    });

    // Status transitions: admins may set any status; authors publish directly;
    // anyone else publishing/submitting goes (back) to the review queue.
    if (req.body.status !== undefined && req.body.status !== post.status) {
      if (isAdmin) {
        post.status = req.body.status;
      } else if (req.body.status === 'draft') {
        post.status = 'draft';
      } else {
        post.status = req.user!.isAuthor ? 'published' : 'pending';
        if (post.status === 'published') post.autoPublished = true;
      }
    }

    if (req.file) post.coverImage = (req.file as any).path;

    await post.save();
    await post.populate('author', 'name avatar role isAuthor');
    const message = (req as any).imageUploadFailed
      ? 'Post updated — image upload failed, please try uploading again later.'
      : 'Post updated successfully';
    sendSuccess(res, post, message);
  } catch (err) {
    sendError(res, 'Failed to update post.', 500);
  }
};

// DELETE /api/posts/:id
export const deletePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    const isOwner = post.author.toString() === req.user!._id.toString();
    const isAdmin = ['department_admin', 'super_admin'].includes(req.user!.role);

    if (!isOwner && !isAdmin) {
      sendError(res, 'You are not authorised to delete this post.', 403);
      return;
    }

    await Promise.all([
      post.deleteOne(),
      Comment.deleteMany({ post: post._id }),
    ]);

    sendSuccess(res, null, 'Post deleted successfully');
  } catch (err) {
    sendError(res, 'Failed to delete post.', 500);
  }
};

// POST /api/posts/:id/like
export const toggleLike = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || post.status !== 'published') {
      sendError(res, 'Post not found.', 404);
      return;
    }

    const userId = req.user!._id;
    const liked = post.likes.some((id) => id.toString() === userId.toString());

    if (liked) {
      post.likes = post.likes.filter((id) => id.toString() !== userId.toString());
      post.likeCount = Math.max(0, post.likeCount - 1);
    } else {
      post.likes.push(userId);
      post.likeCount += 1;

      // Notify author (not self)
      if (post.author.toString() !== userId.toString()) {
        await Notification.create({
          recipient: post.author,
          type: 'post_like',
          title: 'New like on your post',
          message: `${req.user!.name} liked your post "${post.title}"`,
          data: { postId: post._id, postSlug: post.slug },
        });
      }
    }

    await post.save();
    sendSuccess(res, { liked: !liked, likeCount: post.likeCount });
  } catch (err) {
    sendError(res, 'Failed to process like.', 500);
  }
};

// POST /api/posts/:id/share
export const sharePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { shareCount: 1 } },
      { new: true }
    );
    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }
    sendSuccess(res, { shareCount: post.shareCount }, 'Share recorded');
  } catch (err) {
    sendError(res, 'Failed to record share.', 500);
  }
};

// GET /api/posts/my-posts
export const getMyPosts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;

    const filter: Record<string, unknown> = { author: req.user!._id };
    if (status) filter.status = status;

    const [posts, total] = await Promise.all([
      Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Post.countDocuments(filter),
    ]);

    sendSuccess(res, posts, 'My posts retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch your posts.', 500);
  }
};
