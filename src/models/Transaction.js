const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  stripePaymentIntentId: {
    type: String,
    required: false // Optional for crypto payments
  },
  stripeSessionId: {
    type: String
  },
  // Crypto payment fields
  cryptoTransactionHash: {
    type: String
  },
  cryptoNetwork: {
    type: String,
    enum: ['SOL', 'USDT', 'USDC', null],
    default: null
  },
  cryptoToken: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'usd',
    uppercase: true
  },
  quotaAmount: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['pending', 'succeeded', 'failed', 'canceled', 'refunded'],
    default: 'pending',
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'apple_pay', 'google_pay', 'crypto', 'other'],
    default: 'card'
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: Map,
    of: String
  },
  failureReason: {
    type: String
  },
  refundedAt: {
    type: Date
  },
  refundAmount: {
    type: Number,
    min: 0
  },
  refundReason: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for better query performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });

// Unique indexes with partial filter expressions to allow multiple nulls
// Note: Cannot use "sparse: true" with "partialFilterExpression" - they're mutually exclusive
// $type: 'string' automatically excludes null values (null is type 10, string is type 2)

// Stripe payment intent - unique only when present, allows multiple nulls
transactionSchema.index(
  { stripePaymentIntentId: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      stripePaymentIntentId: { $type: 'string' } 
    } 
  }
);

// Stripe session - unique only when present, allows multiple nulls
transactionSchema.index(
  { stripeSessionId: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      stripeSessionId: { $type: 'string' } 
    } 
  }
);

// Crypto transaction hash - unique only when present, allows multiple nulls
transactionSchema.index(
  { cryptoTransactionHash: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      cryptoTransactionHash: { $type: 'string' } 
    } 
  }
);

// Virtual for formatted amount
transactionSchema.virtual('formattedAmount').get(function() {
  return (this.amount / 100).toFixed(2);
});

// Instance method to check if transaction is successful
transactionSchema.methods.isSuccessful = function() {
  return this.status === 'succeeded';
};

// Instance method to check if transaction can be refunded
transactionSchema.methods.canBeRefunded = function() {
  return this.status === 'succeeded' && !this.refundedAt;
};

// Static method to get user's transaction history
transactionSchema.statics.getUserTransactions = function(userId, limit = 50, skip = 0) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate('userId', 'fullName email');
};

// Static method to get transaction statistics
transactionSchema.statics.getTransactionStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        totalQuota: { $sum: '$quotaAmount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);

