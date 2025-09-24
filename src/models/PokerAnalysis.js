const mongoose = require('mongoose');

const pokerAnalysisSchema = new mongoose.Schema({
  analysisId: {
    type: String,
    required: [true, 'Analysis ID is required'],
    unique: true,
    index: true
  },
  gameFormat: {
    type: String,
    required: [true, 'Game format is required'],
    enum: ['cash', 'tournament'],
    lowercase: true
  },
  recommendedAction: {
    type: String,
    required: [true, 'Recommended action is required']
  },
  analysisNotes: {
    type: String,
    required: [true, 'Analysis notes are required']
  },
  imageBuffer: {
    type: Buffer,
    required: [true, 'Image buffer is required']
  },
  analysisDate: {
    type: Date,
    default: Date.now
  },
  confidence: {
    type: Number,
    required: [true, 'Confidence is required']
  },
  decisions: {
    type: Number,
    requried: [true, 'Decisions is required']
  },
  // Optional: link to user if you want to track who made the analysis
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userEmail: {
    type: String,
    required: false
  },
  userFullName: {
    type: String,
    required: false
  },
  processingTime: {
    type: mongoose.Schema.Types.Decimal128,
    required: false
  }
}, {
  timestamps: true // This adds createdAt and updatedAt automatically
});

module.exports = mongoose.model('PokerAnalysis', pokerAnalysisSchema);