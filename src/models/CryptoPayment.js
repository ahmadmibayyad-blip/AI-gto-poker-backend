const mongoose = require('mongoose');

const cryptoPaymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentPlan',
    required: true
  },
  network: {
    type: String,
    required: true,
    enum: ['BEP20', 'SOL'],
    index: true
  },
  token: {
    type: String,
    required: true,
    enum: ['USDT', 'USDC', 'SOL']
  },
  amount: {
    type: Number,
    required: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  memo: {
    type: String,
    required: true,
    index: true
  },
  transactionHash: {
    type: String,
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'confirmed', 'failed', 'expired'],
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  
  // Blockchain verification data
  verifiedAmount: {
    type: Number,
    default: null
  },
  verifiedFromAddress: {
    type: String,
    default: null
  },
  confirmationCount: {
    type: Number,
    default: 0
  },
  
  // Error handling
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for finding pending payments
cryptoPaymentSchema.index({ userId: 1, status: 1 });
cryptoPaymentSchema.index({ expiresAt: 1 });

// Check if payment has expired
cryptoPaymentSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

// Mark as confirmed
cryptoPaymentSchema.methods.confirm = function(verifiedAmount, verifiedFromAddress, confirmationCount, transactionHash) {
  this.status = 'confirmed';
  this.confirmedAt = new Date();
  this.verifiedAmount = verifiedAmount;
  this.verifiedFromAddress = verifiedFromAddress;
  this.confirmationCount = confirmationCount;
  this.transactionHash = transactionHash;
};

// Mark as failed
cryptoPaymentSchema.methods.fail = function(errorMessage) {
  this.status = 'failed';
  this.errorMessage = errorMessage;
};

// Find payment by paymentId
cryptoPaymentSchema.statics.findByPaymentId = function(paymentId) {
  return this.findOne({ paymentId });
};

// Find user's pending payments
cryptoPaymentSchema.statics.findPendingPayments = function(userId) {
  return this.find({
    userId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  });
};

// Clean up expired payments
cryptoPaymentSchema.statics.cleanupExpired = async function() {
  const result = await this.updateMany(
    { 
      status: 'pending',
      expiresAt: { $lt: new Date() }
    },
    { 
      status: 'expired' 
    }
  );
  return result.modifiedCount;
};

module.exports = mongoose.model('CryptoPayment', cryptoPaymentSchema);

