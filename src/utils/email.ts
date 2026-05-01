import nodemailer from 'nodemailer';
import logger from './logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const createTransporter = () =>
  nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465', 10),
    // This ensures it treats "true" as a boolean
    secure: process.env.EMAIL_SECURE === 'true' || process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // Add a timeout setting to help debug if it still fails
    connectionTimeout: 10000, 
  });

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'Nistar <noreply@nistar.app>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    logger.info(`Email sent to ${options.to}: ${options.subject}`);
  } catch (err) {
    logger.error('Email send failed:', err);
    throw new Error('Email could not be sent');
  }
};

const baseTemplate = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@300;400;500;600;700&display=swap');
    body { margin: 0; padding: 0; background: #F5F5DC; font-family: 'Spectral', Georgia, serif; color: #2C2C2C; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #9CAF88; padding: 40px 32px; text-align: center; }
    .header h1 { color: #FFFFFF; font-size: 28px; font-weight: 600; margin: 0; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0; }
    .body { padding: 40px 32px; }
    .body p { font-size: 16px; line-height: 1.7; color: #5A5A5A; margin: 0 0 16px; }
    .btn { display: inline-block; background: #9CAF88; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; margin: 24px 0; }
    .btn:hover { background: #6B8E5A; }
    .divider { border: none; border-top: 1px solid #E6D7C3; margin: 24px 0; }
    .footer { padding: 24px 32px; background: #F5F5DC; text-align: center; }
    .footer p { font-size: 13px; color: #8A8A8A; margin: 0; line-height: 1.6; }
    .highlight { color: #6B8E5A; font-weight: 600; }
    .warning { font-size: 13px; color: #8A8A8A; font-style: italic; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Nistar</h1>
      <p>Mental Health & Community Support</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Nistar. All rights reserved.<br/>
      You received this email because you have an account with Nistar.<br/>
      If you did not request this, please ignore this email.</p>
    </div>
  </div>
</body>
</html>
`;

export const sendVerificationEmail = async (email: string, name: string, token: string) => {
  const url = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Verify your Nistar account',
    html: baseTemplate(`
      <p>Hello <span class="highlight">${name}</span>,</p>
      <p>Welcome to Nistar — a safe space where you belong. We're so glad you're here.</p>
      <p>Please verify your email address to get started on your journey:</p>
      <a href="${url}" class="btn">Verify Email Address</a>
      <hr class="divider"/>
      <p class="warning">This link expires in 24 hours. If you did not create an account, please disregard this email.</p>
    `),
  });
};

export const sendPasswordResetEmail = async (email: string, name: string, token: string) => {
  const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Reset your Nistar password',
    html: baseTemplate(`
      <p>Hello <span class="highlight">${name}</span>,</p>
      <p>We received a request to reset the password for your Nistar account.</p>
      <a href="${url}" class="btn">Reset Password</a>
      <hr class="divider"/>
      <p class="warning">This link expires in 1 hour. If you did not request a password reset, please ignore this email — your password will remain unchanged.</p>
    `),
  });
};

export const sendCounselorAssignmentEmail = async (
  userEmail: string,
  userName: string,
  counselorName: string
) => {
  await sendEmail({
    to: userEmail,
    subject: 'Your counselor has been assigned — Nistar',
    html: baseTemplate(`
      <p>Hello <span class="highlight">${userName}</span>,</p>
      <p>We're pleased to let you know that a counselor has been assigned to support you on your journey.</p>
      <p>Your counselor, <span class="highlight">${counselorName}</span>, is here to listen, guide, and walk alongside you.</p>
      <p>You can start a conversation or schedule a session directly from your Nistar dashboard.</p>
      <a href="${process.env.CLIENT_URL}/dashboard" class="btn">Go to Dashboard</a>
      <hr class="divider"/>
      <p>Remember — reaching out takes courage. We're proud of you for taking this step. 💚</p>
    `),
  });
};

export const sendSessionReminderEmail = async (
  email: string,
  name: string,
  counselorName: string,
  scheduledAt: Date
) => {
  const dateStr = scheduledAt.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  await sendEmail({
    to: email,
    subject: 'Session reminder — Nistar',
    html: baseTemplate(`
      <p>Hello <span class="highlight">${name}</span>,</p>
      <p>This is a reminder that you have an upcoming session with <span class="highlight">${counselorName}</span>.</p>
      <p><strong>Scheduled for:</strong> ${dateStr}</p>
      <a href="${process.env.CLIENT_URL}/sessions" class="btn">View Session Details</a>
    `),
  });
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  await sendEmail({
    to: email,
    subject: 'Welcome to Nistar 💚',
    html: baseTemplate(`
      <p>Hello <span class="highlight">${name}</span>,</p>
      <p>Your email has been verified and your Nistar account is ready.</p>
      <p>Nistar is your safe space — a community built on empathy, understanding, and hope. You can:</p>
      <ul style="color:#5A5A5A; line-height:1.9; font-size:16px;">
        <li>Share your story and connect with others who understand</li>
        <li>Access professional counselors for guidance and support</li>
        <li>Engage with a caring, moderated community</li>
      </ul>
      <a href="${process.env.CLIENT_URL}" class="btn">Explore Nistar</a>
      <hr class="divider"/>
      <p>You are not alone. We're here with you every step of the way. 💚</p>
    `),
  });
};
