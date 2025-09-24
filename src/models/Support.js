const mongoose = require('mongoose');

const supportSchema = new mongoose.Schema({
  type: {
    type: String,
    required: [true, 'Support type is required'],
    enum: ['general', 'feature_request'],
    lowercase: true,
    default: 'general'
  },
  priority: {
    type: String,
    required: [true, 'Priority is required'],
    enum: ['low', 'medium', 'high', 'urgent'],
    lowercase: true,
    default: 'medium'
  },
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: ['open', 'closed'],
    lowercase: true,
    default: 'open'
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true,
    minlength: [5, 'Subject must be at least 5 characters long'],
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    minlength: [10, 'Description must be at least 10 characters long'],
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  
  // User Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userEmail: {
    type: String,
    required: [true, 'User email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  userFullName: {
    type: String,
    required: false,
    trim: true,
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },
  
  // Response and Resolution
  responses: [{
    responseId: {
      type: String,
      required: true,
      unique: true
    },
    message: {
      type: String,
      required: [true, 'Response message is required'],
      maxlength: [5000, 'Response message cannot exceed 5000 characters']
    },
    isFromAgent: {
      type: Boolean,
      required: true,
      default: false
    },
    authorName: {
      type: String,
      required: [true, 'Author name is required'],
      maxlength: [100, 'Author name cannot exceed 100 characters']
    },
    authorEmail: {
      type: String,
      required: [true, 'Author email is required'],
      lowercase: true,
      maxlength: [100, 'Author email cannot exceed 100 characters']
    },
    isInternal: {
      type: Boolean,
      default: false
    },
    attachments: [{
      filename: String,
      url: String,
      size: Number
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Timestamps and Tracking
  closedAt: {
    type: Date,
    required: false
  }
}, {
  timestamps: true // This adds createdAt and updatedAt automatically
});

// Pre-save middleware to ensure ticketId is never included
supportSchema.pre('save', function(next) {
  // Explicitly remove ticketId field if it exists
  if (this.ticketId !== undefined) {
    delete this.ticketId;
  }
  next();
});

// Pre-validate middleware to ensure no ticketId field
supportSchema.pre('validate', function(next) {
  if (this.ticketId !== undefined) {
    delete this.ticketId;
  }
  next();
});

// Instance methods
supportSchema.methods.getPublicInfo = function() {
  return {
    _id: this._id,
    type: this.type,
    priority: this.priority,
    status: this.status,
    subject: this.subject,
    description: this.description,
    userEmail: this.userEmail,
    userFullName: this.userFullName,
    responses: this.responses.map(response => ({
      responseId: response.responseId,
      message: response.message,
      isFromAgent: response.isFromAgent,
      authorName: response.authorName,
      authorEmail: response.authorEmail,
      isInternal: response.isInternal,
      attachments: response.attachments,
      createdAt: response.createdAt
    })),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    closedAt: this.closedAt
  };
};

supportSchema.methods.addResponse = function(responseData) {
  const responseId = 'RESP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  
  const response = {
    responseId,
    message: responseData.message,
    isFromAgent: responseData.isFromAgent || false,
    authorName: responseData.authorName,
    authorEmail: responseData.authorEmail,
    isInternal: responseData.isInternal || false,
    attachments: responseData.attachments || [],
    createdAt: new Date()
  };
  
  this.responses.push(response);
  return response;
};

supportSchema.methods.closeTicket = function() {
  this.status = 'closed';
  this.closedAt = new Date();
};

// Static methods
supportSchema.statics.getAnalytics = async function(startDate, endDate) {
  const matchStage = {};
  
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }
  
  return await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalTickets: { $sum: 1 },
        openTickets: {
          $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] }
        },
        closedTickets: {
          $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
        },
        featureRequests: {
          $sum: { $cond: [{ $eq: ['$type', 'feature_request'] }, 1, 0] }
        },
        generalSupport: {
          $sum: { $cond: [{ $eq: ['$type', 'general'] }, 1, 0] }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Support', supportSchema);
