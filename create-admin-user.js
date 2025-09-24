// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./src/models/User');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gto-poker-ai', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
    console.log('Database URI:', process.env.MONGODB_URI || 'mongodb://localhost:27017/gto-poker-ai (default)');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const createAdminUser = async () => {
  try {
    await connectDB();

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: 'admin@gto-poker.com' });
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log('Email:', existingAdmin.email);
      console.log('Admin Allowed:', existingAdmin.adminAllowed);
      process.exit(0);
    }

    // Create admin user
    const adminUser = new User({
      fullName: 'Admin User',
      email: 'admin@gto-poker.com',
      password: 'admin123', // This will be hashed by the pre-save middleware
      adminAllowed: true,
      isActive: true
    });

    await adminUser.save();
    console.log('✅ Admin user created successfully');
    console.log('Email:', adminUser.email);
    console.log('Password: admin123');
    console.log('Admin Allowed:', adminUser.adminAllowed);

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    mongoose.connection.close();
  }
};

createAdminUser();