const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { OAuth2Client } = require('google-auth-library');
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

const googleAuthSchema = Joi.object({
  googleId: Joi.string().required(),
  email: Joi.string().email().required().trim().lowercase(),
  fullName: Joi.string().min(2).max(50).required().trim(),
  picture: Joi.string().uri().optional()
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

// @route   POST /api/auth/google
// @desc    Authenticate user with Google OAuth
// @access  Public
router.post('/google', async (req, res) => {
  try {
    console.log('🔐 Google OAuth attempt:', { 
      googleId: req.body.googleId, 
      email: req.body.email 
    });
    
    // Validate input
    const { error, value } = googleAuthSchema.validate(req.body);
    if (error) {
      console.log('❌ Google auth validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { googleId, email, fullName, picture } = value;

    // Check if user already exists with this Google ID
    let user = await User.findOne({ googleId });
    
    if (user) {
      // User already exists with Google ID - prevent registration, redirect to login
      console.log('❌ User already exists with Google ID:', user.email);
      return res.status(409).json({
        success: false,
        error: 'This account is already registered. Please login using this account!',
        authType: 'existing_user'
      });
    }

    // Check if user exists with same email but different auth method
    const existingUser = await User.findByEmail(email);
    
    if (existingUser) {
      // User already exists with this email - prevent duplicate registration
      console.log('❌ User already exists with this email:', email);
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists. Please use the login page instead.',
        authType: 'duplicate_email'
      });
    }

    // Only create new user if neither Google ID nor email exists
    const userData = {
      fullName,
      email,
      googleId,
      googleEmail: email,
      isActive: true,
      adminAllowed: false,
      planStatus: 'free',
      userUsage: 0,
      avatar: {
        id: 'avatar1',
        icon: 'person-circle',
        color: '#007AFF'
      },
      lastLogin: new Date()
    };

    // If picture is provided, you could store it or use it for avatar
    if (picture) {
      userData.avatar.icon = 'person-circle'; // You could implement custom avatar logic here
    }

    user = new User(userData);
    await user.save();
    
    console.log('✅ New Google user created:', user.email);

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account deactivated:', user.email);
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Account created successfully with Google',
      authType: 'register',
      data: {
        user: user.toJSON(),
        token
      }
    });

  } catch (error) {
    console.error('❌ Google OAuth error:', error);
    res.status(500).json({
      success: false,
      error: 'Google authentication failed. Please try again.'
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

// @route   POST /api/auth/google-login
// @desc    Login user with Google OAuth (for existing users)
// @access  Public
router.post('/google-login', async (req, res) => {
  try {
    console.log('🔐 Google Login attempt:', { 
      googleId: req.body.googleId, 
      email: req.body.email 
    });
    
    // Validate input
    const { error, value } = googleAuthSchema.validate(req.body);
    if (error) {
      console.log('❌ Google login validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { googleId, email, fullName, picture } = value;

    // Check if user exists with this Google ID
    let user = await User.findOne({ googleId });
    
    if (user) {
      // User exists with Google ID - log them in
      user.lastLogin = new Date();
      await user.save();
      
      console.log('✅ Existing Google user logged in:', user.email);
      
      // Check if account is active
      if (!user.isActive) {
        console.log('❌ Account deactivated:', user.email);
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Generate JWT token
      const token = generateToken(user);

      res.json({
        success: true,
        message: 'Google login successful',
        authType: 'login',
        data: {
          user: user.toJSON(),
          token
        }
      });
      return;
    }

    // Check if user exists with same email but different auth method
    const existingUser = await User.findByEmail(email);
    
    if (existingUser) {
      // User exists with same email but no Google ID - link the account
      existingUser.googleId = googleId;
      existingUser.googleEmail = email;
      existingUser.lastLogin = new Date();
      await existingUser.save();
      
      console.log('✅ Google account linked to existing user:', existingUser.email);
      
      // Check if account is active
      if (!existingUser.isActive) {
        console.log('❌ Account deactivated:', existingUser.email);
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Generate JWT token
      const token = generateToken(existingUser);

      res.json({
        success: true,
        message: 'Google account linked and login successful',
        authType: 'linked',
        data: {
          user: existingUser.toJSON(),
          token
        }
      });
      return;
    }

    // User doesn't exist - they should register first
    console.log('❌ User not found for Google login:', email);
    return res.status(404).json({
      success: false,
      error: 'No account found with this Google account. Please register first.',
      authType: 'not_found'
    });

  } catch (error) {
    console.error('❌ Google Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Google login failed. Please try again.'
    });
  }
});

// Handle preflight requests for Google token exchange
router.options('/google-token-exchange', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.status(200).end();
});

// @route   POST /api/auth/google-token-exchange
// @desc    Exchange Google authorization code for access token
// @access  Public
router.post('/google-token-exchange', async (req, res) => {
  try {
    // Set CORS headers explicitly
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    console.log('🔄 Google token exchange request:', { 
      code: req.body.code ? 'present' : 'missing',
      redirectUri: req.body.redirectUri,
      clientId: req.body.clientId ? 'present' : 'missing',
      origin: req.headers.origin
    });
    
    const { code, redirectUri, clientId } = req.body;
    
    if (!code || !redirectUri || !clientId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: code, redirectUri, clientId'
      });
    }
    
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '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', // This should be set in your .env
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Google token exchange failed:', errorData);
      return res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code for token',
        details: errorData
      });
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Google token exchange successful');
    
    res.json({
      success: true,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type
    });
    
  } catch (error) {
    console.error('❌ Google token exchange error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during token exchange'
    });
  }
});

module.exports = router; 