const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters long'],
    maxlength: [50, 'Full name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    index: true
  },
  password: {
    type: String,
    required: function() {
      return !this.googleId; // Password required only if not Google user
    },
    minlength: [6, 'Password must be at least 6 characters long']
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allows multiple null values
  },
  googleEmail: {
    type: String,
    sparse: true
  },
  avatar: {
    id: {
      type: String,
      default: 'avatar1'
    },
    icon: {
      type: String,
      default: 'person-circle'
    },
    color: {
      type: String,
      default: '#007AFF'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  adminAllowed: {
    type: Boolean,
    default: false
  },
  planStatus: {
    type: String,
    default: 'free' //premium, basic, free
  },
  rating: {
    type: Number,
    default: 0 //1-5
  },
  userUsage: {
    type: Number,
    default: 0 //high, medium, low
  },
  availableUsage: {
    type: Number,
    default: 40 //high, medium, low
  },
  recentSessionCash: {
    type: Object,
    default: {
      date: null,
      gamePot: null,
      recommendedAction: null,
      confidence: null,
      analysisNotes: null
    }
  },
  recentSessionSpinAndGo: {
    type: Object,
    default: {
      date: null,
      gamePot: null,
      recommendedAction: null,
      confidence: null,
      analysisNotes: null
    }
  },
  // User preferences for game settings
  preferences: {
    gameFormat: {
      type: String,
      enum: ['cash', 'tournaments'],
      default: 'cash'
    },
    stackSize: {
      type: String,
      enum: ['50bb', '100bb', '200bb', '300bb+'],
      default: '100bb'
    },
    analysisSpeed: {
      type: String,
      enum: ['slow', 'fast', 'instant', 'adaptive'],
      default: 'fast'
    },
    difficultyLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'expert'],
      default: 'advanced'
    },
    sessionLength: {
      type: String,
      enum: ['15min', '30min', '45min', '60min', 'custom'],
      default: '30min'
    },
    focusAreas: {
      type: [String],
      enum: ['preflop', 'flop', 'turn', 'river', 'bluffing', 'value_betting', 'position', 'stack_sizes'],
      default: ['preflop', 'turn']
    }
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date
}, {
  timestamps: true // This adds createdAt and updatedAt automatically
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Instance method to get public profile
userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  delete userObject.__v;
  return userObject;
};

// Static method to find user by email
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

// Virtual for user ID as string
userSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.password;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema); 