import { Response } from 'express';
import { Complaint, Notification } from '../models/index';
import { AuthRequest } from '../types/index';
import { sendSuccess, sendError, parsePagination, paginate } from '../utils/response';

// POST /api/complaints - submit a complaint/support request (auth optional)
export const submitComplaint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subject, message, category, name, email } = req.body;

    if (!req.user && !email) {
      sendError(res, 'An email address is required so we can follow up.', 400);
      return;
    }

    const complaint = await Complaint.create({
      user: req.user?._id,
      name: req.user ? req.user.name : name,
      email: req.user ? req.user.email : email,
      category,
      subject,
      message,
    });

    sendSuccess(res, complaint, 'Your complaint has been received. Our team will review it shortly.', 201);
  } catch (err) {
    sendError(res, 'Failed to submit complaint.', 500);
  }
};

// GET /api/complaints/my - the current user's own complaints
export const getMyComplaints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const complaints = await Complaint.find({ user: req.user!._id }).sort({ createdAt: -1 }).limit(50);
    sendSuccess(res, complaints);
  } catch (err) {
    sendError(res, 'Failed to fetch your complaints.', 500);
  }
};

// GET /api/admin/complaints - admin list
export const getComplaints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [complaints, total] = await Promise.all([
      Complaint.find(filter)
        .populate('user', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Complaint.countDocuments(filter),
    ]);

    sendSuccess(res, complaints, 'Complaints retrieved', 200, paginate(page, limit, total));
  } catch (err) {
    sendError(res, 'Failed to fetch complaints.', 500);
  }
};

// PUT /api/admin/complaints/:id - update status / resolution note
export const updateComplaint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, resolutionNote } = req.body;
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      sendError(res, 'Complaint not found.', 404);
      return;
    }

    if (status) {
      complaint.status = status;
      if (status === 'resolved') complaint.resolvedBy = req.user!._id;
    }
    if (resolutionNote !== undefined) complaint.resolutionNote = resolutionNote;
    await complaint.save();

    // Notify the complainant when they have an account
    if (complaint.user && status && status !== 'open') {
      await Notification.create({
        recipient: complaint.user,
        type: 'complaint_update',
        title: `Complaint ${status === 'resolved' ? 'resolved' : 'being reviewed'}`,
        message: status === 'resolved'
          ? `Your complaint "${complaint.subject}" has been resolved.${resolutionNote ? ` Note: ${resolutionNote}` : ''}`
          : `Your complaint "${complaint.subject}" is being reviewed by our team.`,
        data: { complaintId: complaint._id },
      });
    }

    sendSuccess(res, complaint, 'Complaint updated');
  } catch (err) {
    sendError(res, 'Failed to update complaint.', 500);
  }
};
