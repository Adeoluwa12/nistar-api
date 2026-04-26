import { Request, Response } from 'express';
import Post from '../models/Post';
import { Comment, Notification } from '../models/index';
import { AuthRequest } from '../types';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// GET /api/posts — public feed
export const getPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { tag, category, search, sort = 'latest' } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { status: 'published' };
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
        .populate('author', 'name avatar role')
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

// GET /api/posts/:slug
export const getPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const post = await Post.findOne({ slug: req.params.slug, status: 'published' })
      .populate('author', 'name avatar bio role');

    if (!post) {
      sendError(res, 'Post not found.', 404);
      return;
    }

    // Increment view count
    await Post.findByIdAndUpdate(post._id, { $inc: { viewCount: 1 } });

    const comments = await Comment.find({ post: post._id, status: 'approved', parentComment: null })
      .populate('author', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(20);

    sendSuccess(res, { post, comments });
  } catch (err) {
    sendError(res, 'Failed to fetch post.', 500);
  }
};

// POST /api/posts
export const createPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content, excerpt, tags, category, status, isAnonymous, allowComments } = req.body;

    const post = await Post.create({
      title,
      content,
      excerpt,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
      category,
      status: status || 'draft',
      isAnonymous: isAnonymous ?? false,
      allowComments: allowComments ?? true,
      author: req.user!._id,
      coverImage: req.file ? `/uploads/${req.file.filename}` : req.body.coverImage,
    });

    await post.populate('author', 'name avatar role');
    sendSuccess(res, post, 'Post created successfully', 201);
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

    const allowed = ['title', 'content', 'excerpt', 'tags', 'category', 'status', 'isAnonymous', 'allowComments', 'coverImage'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        (post as unknown as Record<string, unknown>)[key] = req.body[key];
      }
    });

    if (req.file) post.coverImage = `/uploads/${req.file.filename}`;

    await post.save();
    await post.populate('author', 'name avatar role');
    sendSuccess(res, post, 'Post updated successfully');
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
