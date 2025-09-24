const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const User = require('../models/User');

const router = express.Router();

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Validation schemas
const registerSchema = Joi.object({
  fullName: Joi.string().min(2).max(50).required().trim(),
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().min(6).max(128).required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
    'any.only': 'Passwords do not match'
  }),
  avatar: Joi.object({
    id: Joi.string().required(),
    icon: Joi.string().required(),
    color: Joi.string().required()
  }).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().required()
});

// Helper function to generate JWT token
const generateToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    adminAllowed: user.adminAllowed || false
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    console.log('📝 Registration attempt:', { 
      email: req.body.email, 
      fullName: req.body.fullName,
      avatar: req.body.avatar 
    });
    
    // Validate input
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      console.log('❌ Validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { fullName, email, password, avatar } = value;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      console.log('❌ User already exists:', email);
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Create new user
    const userData = {
      fullName,
      email,
      password,
      avatar: avatar || {
        id: 'avatar1',
        icon: 'person-circle',
        color: '#007AFF'
      }
    };

    const user = new User(userData);
    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    console.log('✅ User registered successfully:', user.email);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: user.toJSON(),
        token
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: validationErrors[0] // Return first validation error
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create account. Please try again.'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user and get token
// @access  Public
router.post('/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt:', { email: req.body.email });
    
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { email, password } = value;

    // Find user and include password for comparison
    const user = await User.findByEmail(email);
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account deactivated:', email);
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    console.log('✅ User logged in successfully:', user.email);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        token
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/admin-login
// @desc    Authenticate admin user and get token
// @access  Public
router.post('/admin-login', async (req, res) => {
  try {
    console.log('🔐 Admin login attempt:', { email: req.body.email });
    
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { email, password } = value;

    // Find user and include password for comparison
    const user = await User.findByEmail(email);
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account deactivated:', email);
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Check if user has admin privileges
    if (!user.adminAllowed) {
      console.log('❌ Admin access denied for user:', email);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token with admin privileges
    const token = generateToken(user);

    console.log('✅ Admin logged in successfully:', user.email);

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: user.toJSON(),
        token
      }
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({
      success: false,
      error: 'Admin login failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/verify-token
// @desc    Verify JWT token
// @access  Public
router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token or user not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    console.error('❌ Token verification error:', error.message);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
});

// @route   POST /api/auth/verify-admin-token
// @desc    Verify JWT token and check admin privileges
// @access  Public
router.post('/verify-admin-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token or user not found'
      });
    }

    // Check if user has admin privileges
    if (!user.adminAllowed) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    console.error('❌ Admin token verification error:', error.message);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
});

// @route   GET /api/auth/users
// @desc    Get all users (admin only)
// @access  Private/Admin
router.get('/users', async (req, res) => {
  try {
    console.log('📋 Admin fetching all users');

    // Find all users, excluding sensitive fields
    const users = await User.find({}, {
      password: 0, // Exclude password
      resetPasswordToken: 0, // Exclude reset token
      resetPasswordExpires: 0, // Exclude reset expires
      __v: 0 // Exclude version key
    }).sort({ createdAt: -1 }); // Sort by newest first

    console.log(`✅ Found ${users.length} users`);

    res.json({
      success: true,
      data: {
        users: users,
        count: users.length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id
// @desc    Update user information (admin only)
// @access  Private/Admin
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, isActive, adminAllowed } = req.body;

    console.log('🔄 Admin updating user:', id, { fullName, email, isActive, adminAllowed });

    if (!fullName || !email || isActive === undefined || adminAllowed === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Full name, email, active status, and admin status are required'
      });
    }

    // Check if email is already taken by another user
    const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Email is already taken by another user'
      });
    }

    // Find and update user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    user.fullName = fullName;
    user.email = email.toLowerCase();
    user.isActive = isActive;
    user.adminAllowed = adminAllowed;
    user.updatedAt = new Date();

    await user.save();

    console.log('✅ User updated successfully:', user.email);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user. Please try again.'
    });
  }
});

// @route   PUT /api/auth/users/:id/reset-password
// @desc    Reset user password to 123456 (admin only)
// @access  Private/Admin
router.put('/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🔄 Admin resetting password for user:', id);

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Reset password to 123456
    user.password = '123456'; // This will be hashed by the pre-save middleware
    user.updatedAt = new Date();

    await user.save();

    console.log('✅ Password reset successfully for user:', user.email);

    res.json({
      success: true,
      message: 'Password reset to "123456" successfully'
    });

  } catch (error) {
    console.error('❌ Error resetting password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password. Please try again.'
    });
  }
});

// @route   POST /api/auth/add-user
// @desc    Add new user (admin only)
// @access  Private/Admin
router.post('/add-user', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    console.log('🔄 Admin adding new user:', { fullName, email });

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Full name, email, and password are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      console.log('❌ User already exists:', email);
      return res.status(409).json({
        success: false,
        error: 'A user with this email already exists'
      });
    }

    // Create new user with default settings
    const userData = {
      fullName,
      email,
      password, // This will be hashed by the pre-save middleware
      isActive: true,
      adminAllowed: false,
      planStatus: 'free',
      userUsage: 0,
      avatar: {
        id: 'avatar1',
        icon: 'person-circle',
        color: '#007AFF'
      }
    };

    const user = new User(userData);
    await user.save();

    console.log('✅ User created successfully:', user.email);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    console.error('❌ Error creating user:', error);
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'A user with this email already exists'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: validationErrors[0] // Return first validation error
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create user. Please try again.'
    });
  }
});

// @route   DELETE /api/auth/users/:id
// @desc    Delete user (admin only)
// @access  Private/Admin
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🗑️ Admin deleting user:', id);

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find the user to be deleted
    const user = await User.findById(id);
    if (!user) {
      console.log('❌ User not found:', id);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Store user info for logging
    const userInfo = {
      id: user._id,
      email: user.email,
      fullName: user.fullName
    };

    // Delete the user
    await User.findByIdAndDelete(id);

    console.log('✅ User deleted successfully:', userInfo.email);

    res.json({
      success: true,
      message: `User ${userInfo.fullName} (${userInfo.email}) has been deleted successfully`,
      data: {
        deletedUser: userInfo
      }
    });

  } catch (error) {
    console.error('❌ Error deleting user:', error);
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete user. Please try again.'
    });
  }
});

module.exports = router; 