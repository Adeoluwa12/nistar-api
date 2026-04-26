import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User';
import Department from '../models/Department';
import logger from '../utils/logger';

const departments = [
  { name: 'Anxiety & Stress', description: 'Support for anxiety, panic attacks, and stress management', icon: '🧘', color: '#9CAF88' },
  { name: 'Depression & Mood', description: 'Help for depression, low mood, and emotional wellbeing', icon: '💛', color: '#D2B48C' },
  { name: 'Trauma & PTSD', description: 'Specialised support for trauma, PTSD, and grief', icon: '🌱', color: '#B8C5A6' },
  { name: 'Relationships', description: 'Counselling for relationship challenges and social wellbeing', icon: '❤️', color: '#E6D7C3' },
  { name: 'Self-Worth & Identity', description: 'Support for self-esteem, identity, and personal growth', icon: '✨', color: '#6B8E5A' },
];

const setup = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    logger.info('Connected to MongoDB');

    // Super Admin
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@nistar.app';
    const existing = await User.findOne({ email: superAdminEmail });

    if (!existing) {
      const superAdmin = new User({
        name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
        email: superAdminEmail,
        password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecurePass123!',
        role: 'super_admin',
        isEmailVerified: true,
        status: 'active',
      });
      await superAdmin.save();
      logger.info(`✅ Super admin created: ${superAdminEmail}`);
    } else {
      logger.info('ℹ️  Super admin already exists');
    }

    // Departments
    for (const dept of departments) {
      const exists = await Department.findOne({ name: dept.name });
      if (!exists) {
        await Department.create(dept);
        logger.info(`✅ Department created: ${dept.name}`);
      }
    }

    logger.info('🌿 Nistar setup complete!');
    process.exit(0);
  } catch (err) {
    logger.error('Setup failed:', err);
    process.exit(1);
  }
};

setup();
