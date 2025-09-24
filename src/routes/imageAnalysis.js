const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { 
  analyzePokerImage, 
  validateGameFormat
} = require('../services/analysisService');
const { validateImageUpload } = require('../middleware/validation');
const PokerAnalysis = require('../models/PokerAnalysis');
const User = require('../models/User');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

/**
 * POST /api/analysis/upload
 * Upload and analyze poker table image
 */
router.post('/upload', upload.single('image'), validateImageUpload, async (req, res) => {
  try {
    const { gameFormat, userId, userEmail, userFullName } = req.body;
    const imageBuffer = req.file.buffer;
    const analysisId = uuidv4();

    // Validate game format
    if (!validateGameFormat(gameFormat)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid game format. Must be "cash" or "tournament"'
      });
    }

    console.log(`🎯 Starting analysis for ${gameFormat} game - ID: ${analysisId}`);
    if (userId) {
      console.log(`👤 User: ${userFullName} (${userEmail})`);
    }

    // Check user's available usage before proceeding with analysis
    if (userId) {
      try {
        const user = await User.findById(userId);
        if (user) {
          if (user.availableUsage <= 0) {
            console.log(`❌ User ${userFullName} has no available usage remaining: ${user.availableUsage}`);
            return res.status(403).json({
              success: false,
              error: 'No available usage remaining. Please upgrade your plan or contact support.',
              errorCode: 'INSUFFICIENT_USAGE',
              availableUsage: user.availableUsage,
              userUsage: user.userUsage
            });
          }
          console.log(`✅ User ${userFullName} has ${user.availableUsage} available usage remaining`);
        } else {
          console.log(`⚠️ User not found with ID: ${userId}`);
        }
      } catch (userCheckError) {
        console.error('❌ Error checking user usage:', userCheckError);
        return res.status(500).json({
          success: false,
          error: 'Failed to verify user usage. Please try again.'
        });
      }
    }

    // Start timing the backend analysis
    const backendAnalysisStartTime = Date.now();

    // Start image analysis (async process)
    const analysisImageResult = await analyzePokerImage(imageBuffer, gameFormat, analysisId);
    
    // Calculate backend processing time
    const backendAnalysisEndTime = Date.now();
    const backendProcessingTime = backendAnalysisEndTime - backendAnalysisStartTime;
    const processingTimeSeconds = (backendProcessingTime / 1000).toFixed(2);
    
    console.log(`⏱️ Backend analysis completed in ${processingTimeSeconds} seconds`);
    
    // Return immediate response with analysis ID and processing time
    res.json({
      success: true,
      analysisId: analysisId,
      recommenedeAction: analysisImageResult.recommended_action,
      analysisNotes: analysisImageResult.analysis_notes,
      processingTime: processingTimeSeconds
    });

    console.log(`✅ Analysis completed for ID ${analysisId}:`, analysisImageResult);

    // Save analysis results to database (after sending response)
    try {
      let analysisDecisions = await PokerAnalysis.find();

      const analysisData = new PokerAnalysis({
        analysisId: analysisId,
        gameFormat: gameFormat,
        recommendedAction: analysisImageResult.recommended_action,
        analysisNotes: analysisImageResult.analysis_notes,
        imageBuffer: imageBuffer,
        confidence: analysisImageResult.confidence,
        decisions: analysisDecisions.length + 1,
        // Save user information from request body
        userId: userId || null,
        userEmail: userEmail || null,
        userFullName: userFullName || null,
        // Save processing time for performance tracking
        processingTime: processingTimeSeconds
      });

      await analysisData.save();
      console.log(`💾 Analysis saved to database for ID: ${analysisId}`);

      // Update user's recent session data, increment usage, and decrement available usage if userId is provided
      if (userId) {
        try {
          const user = await User.findById(userId);
          if (user) {
            // Increment user usage counter
            user.userUsage = (user.userUsage || 0) + 1;
            
            // Decrement available usage (we already checked it's > 0 before analysis)
            user.availableUsage = Math.max(0, (user.availableUsage || 100) - 1);
            
            // Extract game seat from analysis results
            let gamePot = null;
            if (analysisImageResult.pot) {
              gamePot = analysisImageResult.pot;
            }

            // Prepare session data
            const sessionData = {
              date: new Date(),
              gamePot: gamePot,
              recommendedAction: analysisImageResult.recommended_action,
              confidence: analysisImageResult.confidence,
              analysisNotes: analysisImageResult.analysis_notes
            };

            // Update based on game format
            if (gameFormat === 'cash') {
              user.recentSessionCash = sessionData;
            } else if (gameFormat === 'tournament') {
              // For tournament format, we'll treat it as Spin&Go
              user.recentSessionSpinAndGo = sessionData;
            }

            await user.save();
            console.log(`👤 User data updated for user: ${userFullName} - Usage: ${user.userUsage}, Available: ${user.availableUsage}`);
          } else {
            console.log(`⚠️ User not found with ID: ${userId}`);
          }
        } catch (userUpdateError) {
          console.error('❌ User update error:', userUpdateError);
          // Don't fail the request since analysis was successful
        }
      }
    } catch (dbError) {
      console.error('❌ Database save error:', dbError);
      // Don't fail the request since we already sent the response
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process image upload'
    });
  }
});

/**
 * GET /api/analysis/result/:analysisId
 * Get analysis result by ID from database
 */
router.get('/result/:analysisId', async (req, res) => {
  try {
    const { analysisId } = req.params;
    
    const result = await PokerAnalysis.findByAnalysisId(analysisId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found'
      });
    }

    res.json({
      success: true,
      result: result.getPublicData()
    });

  } catch (error) {
    console.error('Result retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analysis result'
    });
  }
});

/**
 * GET /api/analysis/history
 * Get analysis history (optional: with pagination and filters)
 */
router.get('/history', async (req, res) => {
  try {
    const { gameFormat, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    if (gameFormat) {
      query.gameFormat = gameFormat.toLowerCase();
    }
    
    const analyses = await PokerAnalysis.find(query)
      .sort({ gameFormat: 1, sequenceNumber: 1 }) // Sort by game format then sequence number
      .skip(skip)
      .limit(parseInt(limit))
      .select('-imageBuffer'); // Exclude image buffer for performance
    
    const total = await PokerAnalysis.countDocuments(query);
    
    res.json({
      success: true,
      analyses: analyses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalAnalyses: total,
        hasNext: skip + analyses.length < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('History retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analysis history'
    });
  }
});

/**
 * GET /api/analysis/stats
 * Get analysis statistics from database
 */
router.get('/stats', async (req, res) => {
  try {
    // Get average processing time
    const avgProcessingTime = await PokerAnalysis.aggregate([
      { $match: { processingTime: { $exists: true, $ne: null } } },
      { $group: { _id: null, avgTime: { $avg: '$processingTime' } } }
    ]);

    // Get average confidence
    const avgConfidence = await PokerAnalysis.aggregate([
      { $match: { confidence: { $exists: true, $ne: null } } },
      { $group: { _id: null, avgConfidence: { $avg: '$confidence' } } }
    ]);

    // Get max decisions
    const maxDecisions = await PokerAnalysis.aggregate([
      { $match: { decisions: { $exists: true, $ne: null } } },
      { $group: { _id: null, maxDecisions: { $max: '$decisions' } } }
    ]);

    // Get total analysis count
    const totalAnalyses = await PokerAnalysis.countDocuments();

    // Format the results
    const stats = {
      avgProcessingTime: avgProcessingTime.length > 0 ? parseFloat(avgProcessingTime[0].avgTime).toFixed(2) : '0.00',
      avgConfidence: avgConfidence.length > 0 ? Math.round(avgConfidence[0].avgConfidence) : 0,
      maxDecisions: maxDecisions.length > 0 ? maxDecisions[0].maxDecisions : 0,
      totalAnalyses: totalAnalyses
    };

    console.log('📊 Analysis stats calculated:', stats);

    res.json({
      success: true,
      stats: stats
    });

  } catch (error) {
    console.error('❌ Stats calculation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate statistics'
    });
  }
});

/**
 * GET /api/analysis/stats/:userId/:format
 * Get user-specific analysis statistics by game format (cash or tournaments)
 */
router.get('/stats/:userId/:format', async (req, res) => {
  try {
    const { userId, format } = req.params;

    // Validate format
    if (!['cash', 'tournaments'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid format. Must be "cash" or "tournaments"'
      });
    }

    // Convert tournaments to tournament for database query (since DB uses 'tournament' not 'tournaments')
    const dbFormat = format === 'tournaments' ? 'tournament' : format;

    console.log(`📊 Fetching ${format} stats for user ${userId}...`);

    // Get user-specific analyses for the specified format
    const userAnalyses = await PokerAnalysis.find({
      userId: userId,
      gameFormat: dbFormat
    });

    if (userAnalyses.length === 0) {
      console.log(`📊 No ${format} analyses found for user ${userId}, returning default stats`);
      return res.json({
        success: true,
        stats: {
          handsAnalyzed: 0,
          accuracyRate: 0,
          avgProcessingTime: '0.00',
          avgConfidence: 0,
          maxDecisions: 0,
          totalAnalyses: 0,
          studyTime: '0h'
        }
      });
    }

    // Calculate hands analyzed (total number of analyses)
    const handsAnalyzed = userAnalyses.length;

    // Calculate accuracy rate (average confidence)
    const validConfidences = userAnalyses.filter(analysis => analysis.confidence != null);
    console.log('🔍 Valid confidences:', validConfidences, validConfidences.length);
    const accuracyRate = validConfidences.length > 0 
      ? Math.round(validConfidences.reduce((sum, analysis) => sum + analysis.confidence, 0) / validConfidences.length)
      : 0;

    // Calculate average processing time
    const validProcessingTimes = userAnalyses.filter(analysis => analysis.processingTime != null);
    const avgProcessingTime = validProcessingTimes.length > 0
      ? (validProcessingTimes.reduce((sum, analysis) => sum + parseFloat(analysis.processingTime.toString()), 0) / validProcessingTimes.length).toFixed(2)
      : '0.00';

    // Calculate max decisions
    const validDecisions = userAnalyses.filter(analysis => analysis.decisions != null);
    const maxDecisions = validDecisions.length > 0
      ? Math.max(...validDecisions.map(analysis => analysis.decisions))
      : 0;

    // Calculate study time (rough estimate: 30 seconds per analysis)
    const studyTimeMinutes = handsAnalyzed * 0.5; // 30 seconds per hand
    const studyTimeHours = Math.floor(studyTimeMinutes / 60);
    const studyTime = studyTimeHours > 0 ? `${studyTimeHours}h` : `${Math.round(studyTimeMinutes)}m`;

    const stats = {
      handsAnalyzed,
      accuracyRate,
      avgProcessingTime,
      avgConfidence: accuracyRate, // Same as accuracy rate for consistency
      maxDecisions,
      totalAnalyses: handsAnalyzed,
      studyTime
    };

    console.log(`✅ ${format} stats calculated for user ${userId}:`, stats);

    res.json({
      success: true,
      stats: stats
    });

  } catch (error) {
    console.error(`❌ Error fetching ${req.params.format} stats for user ${req.params.userId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate user statistics'
    });
  }
});

/**
 * GET /api/analysis/comprehensive-stats/:userId
 * Get comprehensive user statistics for the stats page overview
 */
router.get('/comprehensive-stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`📊 Fetching comprehensive stats for user ${userId}...`);

    // Get all user analyses
    const userAnalyses = await PokerAnalysis.find({ userId: userId });
    
    if (userAnalyses.length === 0) {
      console.log(`📊 No analyses found for user ${userId}, returning default stats`);
      return res.json({
        success: true,
        stats: {
          overallAccuracy: 0,
          accuracyChange: 0,
          handsPlayed: 0,
          handsThisWeek: 0,
          studyTime: '0h',
          studyTimeThisWeek: '0h',
          winRate: '+0bb/100',
          winRateFormat: 'Cash games',
          positionStats: [],
          accuracyTrend: [],
          recentSessions: []
        }
      });
    }

    // Calculate overall accuracy (average confidence)
    const validConfidences = userAnalyses.filter(analysis => analysis.confidence != null);
    const overallAccuracy = validConfidences.length > 0 
      ? Math.round(validConfidences.reduce((sum, analysis) => sum + analysis.confidence, 0) / validConfidences.length)
      : 0;

    // Calculate hands played
    const handsPlayed = userAnalyses.length;

    // Calculate hands this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const handsThisWeek = userAnalyses.filter(analysis => 
      new Date(analysis.createdAt) >= oneWeekAgo
    ).length;

    // Calculate study time (rough estimate: 30 seconds per analysis)
    const totalStudyMinutes = handsPlayed * 0.5;
    const studyTimeHours = Math.floor(totalStudyMinutes / 60);
    const studyTime = studyTimeHours > 0 ? `${studyTimeHours}h` : `${Math.round(totalStudyMinutes)}m`;

    // Calculate study time this week
    const weeklyStudyMinutes = handsThisWeek * 0.5;
    const weeklyStudyHours = Math.floor(weeklyStudyMinutes / 60);
    const studyTimeThisWeek = weeklyStudyHours > 0 ? `${weeklyStudyHours}h` : `${Math.round(weeklyStudyMinutes)}m`;

    // Calculate accuracy change (compare last week vs previous week)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const lastWeekAnalyses = userAnalyses.filter(analysis => {
      const date = new Date(analysis.createdAt);
      return date >= oneWeekAgo;
    });
    const previousWeekAnalyses = userAnalyses.filter(analysis => {
      const date = new Date(analysis.createdAt);
      return date >= twoWeeksAgo && date < oneWeekAgo;
    });

    let accuracyChange = 0;
    if (lastWeekAnalyses.length > 0 && previousWeekAnalyses.length > 0) {
      const lastWeekAvg = lastWeekAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / lastWeekAnalyses.length;
      const previousWeekAvg = previousWeekAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / previousWeekAnalyses.length;
      accuracyChange = Math.round(lastWeekAvg - previousWeekAvg);
    }

    // Calculate position-based statistics (mock data for now, could be enhanced)
    const positionStats = [
      { position: 'Button', accuracy: Math.min(100, overallAccuracy + 5), hands: Math.floor(handsPlayed * 0.2), color: '#22c55e' },
      { position: 'Cut-off', accuracy: Math.min(100, overallAccuracy + 2), hands: Math.floor(handsPlayed * 0.18), color: '#3b82f6' },
      { position: 'Big Blind', accuracy: Math.max(0, overallAccuracy - 3), hands: Math.floor(handsPlayed * 0.22), color: '#f59e0b' },
      { position: 'Small Blind', accuracy: Math.max(0, overallAccuracy - 8), hands: Math.floor(handsPlayed * 0.20), color: '#ef4444' },
      { position: 'UTG', accuracy: Math.max(0, overallAccuracy - 1), hands: Math.floor(handsPlayed * 0.20), color: '#8b5cf6' },
    ];

    // Calculate accuracy trend for last 7 days
    const accuracyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      
      const dayAnalyses = userAnalyses.filter(analysis => {
        const analysisDate = new Date(analysis.createdAt);
        return analysisDate >= dayStart && analysisDate < dayEnd;
      });

      const dayAccuracy = dayAnalyses.length > 0 
        ? Math.round(dayAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / dayAnalyses.length)
        : null;

      accuracyTrend.push({
        date: dayStart.toISOString().split('T')[0],
        accuracy: dayAccuracy,
        hands: dayAnalyses.length
      });
    }

    // Get recent sessions (last 5 analyses)
    const recentSessions = userAnalyses
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map(analysis => ({
        date: analysis.createdAt,
        gameType: analysis.gameFormat === 'cash' ? 'Cash' : 'Tournament',
        confidence: analysis.confidence || 0,
        recommendedAction: analysis.recommendedAction,
        result: `${analysis.confidence || 0}% accuracy`
      }));

    // Calculate win rate (simplified - based on confidence)
    const cashAnalyses = userAnalyses.filter(a => a.gameFormat === 'cash');
    const avgCashConfidence = cashAnalyses.length > 0 
      ? cashAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / cashAnalyses.length
      : 0;
    
    // Convert confidence to estimated bb/100 (simplified formula)
    const winRateBB = Math.round((avgCashConfidence - 50) / 4);
    const winRate = winRateBB > 0 ? `+${winRateBB}bb/100` : `${winRateBB}bb/100`;
    const bestAccuracy = Math.max(...userAnalyses.map(analysis => analysis.confidence));

    const comprehensiveStats = {
      overallAccuracy,
      accuracyChange,
      handsPlayed,
      handsThisWeek,
      studyTime,
      studyTimeThisWeek,
      winRate,
      winRateFormat: 'Cash games',
      positionStats,
      accuracyTrend,
      recentSessions,
      bestAccuracy: bestAccuracy
    };

    console.log(`✅ Comprehensive stats calculated for user ${userId}:`, {
      accuracy: overallAccuracy,
      hands: handsPlayed,
      studyTime: studyTime,
      bestAccuracy: bestAccuracy
    });

    res.json({
      success: true,
      stats: comprehensiveStats,
      bestAccuracy: bestAccuracy
    });

  } catch (error) {
    console.error(`❌ Error fetching comprehensive stats for user ${req.params.userId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate comprehensive user statistics'
    });
  }
});

/**
 * POST /api/analysis/format-config
 * Update analysis configuration for specific game format
 */
router.post('/format-config', async (req, res) => {
  try {
    const { gameFormat, config } = req.body;

    if (!validateGameFormat(gameFormat)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid game format'
      });
    }

    // Here you would update format-specific configuration
    console.log(`🔧 Updating ${gameFormat} configuration:`, config);

    res.json({
      success: true,
      message: `${gameFormat} configuration updated`,
      gameFormat: gameFormat
    });

  } catch (error) {
    console.error('Configuration update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

/**
 * GET /api/analysis/formats
 * Get available game formats and their configurations
 */
router.get('/formats', (req, res) => {
  res.json({
    success: true,
    formats: {
      cash: {
        name: 'Cash Games',
        description: 'Deep stack analysis for cash games',
        decisions: ['FOLD', 'CALL', 'RAISE 2.5x', 'RAISE 3.5x', 'RAISE POT'],
        analysisTime: '3-5 seconds'
      },
      tournament: {
        name: 'Spin & Go',
        description: 'Short stack analysis for tournaments',
        decisions: ['FOLD', 'CALL', 'SHOVE', 'MIN-RAISE'],
        analysisTime: '2-4 seconds'
      }
    }
  });
});

/**
 * GET /api/analysis/user-sessions/:userId
 * Get user's recent session data
 */
router.get('/user-sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('recentSessionCash recentSessionSpinAndGo');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      sessions: {
        recentSessionCash: user.recentSessionCash,
        recentSessionSpinAndGo: user.recentSessionSpinAndGo
      }
    });

  } catch (error) {
    console.error('User sessions retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user sessions'
    });
  }
});

/**
 * GET /api/analysis/user-usage/:userId
 * Get user's current usage count and available usage
 */
router.get('/user-usage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('userUsage availableUsage fullName email planStatus');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        planStatus: user.planStatus,
        userUsage: user.userUsage || 0,
        availableUsage: user.availableUsage || 100,
        remainingUsage: Math.max(0, user.availableUsage || 100)
      }
    });

  } catch (error) {
    console.error('❌ User usage retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user usage'
    });
  }
});

/**
 * GET /api/analysis/check-usage/:userId
 * Check if user has available usage without performing analysis
 */
router.get('/check-usage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('availableUsage userUsage fullName email planStatus');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const hasAvailableUsage = user.availableUsage > 0;

    res.json({
      success: true,
      data: {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        planStatus: user.planStatus,
        userUsage: user.userUsage || 0,
        availableUsage: user.availableUsage || 100,
        hasAvailableUsage: hasAvailableUsage,
        canAnalyze: hasAvailableUsage
      }
    });

  } catch (error) {
    console.error('❌ Check usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check user usage'
    });
  }
});

/**
 * POST /api/analysis/update-available-usage/:userId
 * Update user's available usage (admin function)
 */
router.post('/update-available-usage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { availableUsage, action = 'set' } = req.body; // action: 'set', 'add', 'subtract'
    
    if (typeof availableUsage !== 'number' || availableUsage < 0) {
      return res.status(400).json({
        success: false,
        error: 'Available usage must be a non-negative number'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update available usage based on action
    switch (action) {
      case 'set':
        user.availableUsage = availableUsage;
        break;
      case 'add':
        user.availableUsage = (user.availableUsage || 100) + availableUsage;
        break;
      case 'subtract':
        user.availableUsage = Math.max(0, (user.availableUsage || 100) - availableUsage);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Must be "set", "add", or "subtract"'
        });
    }

    await user.save();

    res.json({
      success: true,
      data: {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        availableUsage: user.availableUsage,
        action: action,
        previousValue: user.availableUsage - (action === 'add' ? availableUsage : action === 'subtract' ? -availableUsage : 0)
      }
    });

  } catch (error) {
    console.error('❌ Update available usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update available usage'
    });
  }
});

/**
 * GET /api/analysis/check-daily-checkin/:userId
 * Check if user has already checked in today
 */
router.get('/check-daily-checkin/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('lastCheckIn availableUsage userUsage');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user has checked in today
    const today = new Date();
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
    
    const hasCheckedInToday = lastCheckIn && 
      lastCheckIn.getDate() === today.getDate() &&
      lastCheckIn.getMonth() === today.getMonth() &&
      lastCheckIn.getFullYear() === today.getFullYear();

    res.json({
      success: true,
      data: {
        hasCheckedInToday: !!hasCheckedInToday,
        lastCheckIn: lastCheckIn,
        availableUsage: user.availableUsage || 100,
        userUsage: user.userUsage || 0
      }
    });

  } catch (error) {
    console.error('❌ Check daily check-in error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check daily check-in status'
    });
  }
});

/**
 * POST /api/analysis/daily-checkin/:userId
 * Perform daily check-in and award random quota
 */
router.post('/daily-checkin/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user has already checked in today
    const today = new Date();
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
    
    const hasCheckedInToday = lastCheckIn && 
      lastCheckIn.getDate() === today.getDate() &&
      lastCheckIn.getMonth() === today.getMonth() &&
      lastCheckIn.getFullYear() === today.getFullYear();

    if (hasCheckedInToday) {
      return res.status(400).json({
        success: false,
        error: 'You have already checked in today. Come back tomorrow!',
        errorCode: 'ALREADY_CHECKED_IN'
      });
    }

    // Generate random quota reward (5-25)
    const quotaRewards = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5,  // 50% chance for 5
                          10, 10, 10, 10, 10, 10, 10,    // 35% chance for 10
                          15, 15, 15,                     // 10% chance for 15
                          20, 20,                         // 3% chance for 20
                          25];                            // 2% chance for 25
    
    const randomIndex = Math.floor(Math.random() * quotaRewards.length);
    const quotaReward = quotaRewards[randomIndex];

    // Update user's available usage and last check-in
    user.availableUsage = (user.availableUsage || 100) + quotaReward;
    user.lastCheckIn = today;
    
    await user.save();

    console.log(`🎉 Daily check-in completed for user ${user.fullName}: +${quotaReward} quota`);

    res.json({
      success: true,
      data: {
        quotaReward: quotaReward,
        newAvailableUsage: user.availableUsage,
        message: `You received ${quotaReward} bonus analysis quota!`,
        checkInDate: today
      }
    });

  } catch (error) {
    console.error('❌ Daily check-in error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform daily check-in'
    });
  }
});

/**
 * GET /api/analysis/daily-progress/:userId
 * Get user's daily progress history from pokeranalyses database
 */
router.get('/daily-progress/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query; // Default to last 30 days
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(days));
    
    console.log(`📊 Fetching daily progress for user ${userId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all analyses for the user within the date range
    const analyses = await PokerAnalysis.find({
      userId: userId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .select('-imageBuffer') // Exclude image buffer for performance
    .sort({ createdAt: -1 }); // Sort by newest first
    
    // Group analyses by date and calculate daily stats
    const dailyProgress = {};
    
    analyses.forEach(analysis => {
      const dateKey = analysis.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      if (!dailyProgress[dateKey]) {
        dailyProgress[dateKey] = {
          date: dateKey,
          handsPlayed: 0,
          totalConfidence: 0,
          gameTypes: new Set(),
          analyses: [],
          pointsEarned: 0,
          achievements: []
        };
      }
      
      dailyProgress[dateKey].handsPlayed += 1;
      dailyProgress[dateKey].totalConfidence += analysis.confidence;
      dailyProgress[dateKey].gameTypes.add(analysis.gameFormat);
      dailyProgress[dateKey].analyses.push({
        id: analysis.analysisId,
        gameFormat: analysis.gameFormat,
        recommendedAction: analysis.recommendedAction,
        confidence: analysis.confidence,
        analysisNotes: analysis.analysisNotes,
        time: analysis.createdAt
      });
      
      // Calculate points based on confidence and game type
      let points = 0;
      if (analysis.confidence >= 90) points = 20;
      else if (analysis.confidence >= 80) points = 15;
      else if (analysis.confidence >= 70) points = 10;
      else points = 5;
      
      // Bonus points for tournament format
      if (analysis.gameFormat === 'tournament') points += 5;
      
      dailyProgress[dateKey].pointsEarned += points;
      
      // Add achievements based on performance
      if (analysis.confidence >= 95) {
        dailyProgress[dateKey].achievements.push('Perfect Analysis');
      }
      if (analysis.gameFormat === 'tournament' && analysis.confidence >= 85) {
        dailyProgress[dateKey].achievements.push('Tournament Expert');
      }
    });
    
    // Convert to array and calculate averages
    const progressArray = Object.values(dailyProgress).map(day => ({
      id: day.date,
      date: day.date,
      handsPlayed: day.handsPlayed,
      accuracy: Math.round(day.totalConfidence / day.handsPlayed),
      studyTime: Math.round(day.handsPlayed * 2), // Estimate 2 minutes per analysis
      pointsEarned: day.pointsEarned,
      gameType: Array.from(day.gameTypes).join(', '),
      achievements: [...new Set(day.achievements)], // Remove duplicates
      analyses: day.analyses
    })).sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date descending
    
    console.log(`✅ Found ${progressArray.length} days of progress data`);
    
    res.json({
      success: true,
      data: progressArray,
      summary: {
        totalDays: progressArray.length,
        totalHands: progressArray.reduce((sum, day) => sum + day.handsPlayed, 0),
        totalPoints: progressArray.reduce((sum, day) => sum + day.pointsEarned, 0),
        averageAccuracy: Math.round(progressArray.reduce((sum, day) => sum + day.accuracy, 0) / progressArray.length) || 0
      }
    });

  } catch (error) {
    console.error('❌ Daily progress retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve daily progress'
    });
  }
});

// Streaks and Goals endpoint
router.get('/streaks-goals/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Get user's analysis history for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const analyses = await PokerAnalysis.find({
      userId: userId,
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ createdAt: -1 });

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Group analyses by date
    const analysesByDate = {};
    analyses.forEach(analysis => {
      const date = new Date(analysis.createdAt);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().split('T')[0];
      
      if (!analysesByDate[dateKey]) {
        analysesByDate[dateKey] = [];
      }
      analysesByDate[dateKey].push(analysis);
    });

    // Calculate streak by checking consecutive days
    const sortedDates = Object.keys(analysesByDate).sort().reverse();
    for (let i = 0; i < sortedDates.length; i++) {
      const checkDate = new Date(sortedDates[i]);
      const expectedDate = new Date(today);
      expectedDate.setDate(today.getDate() - i);
      expectedDate.setHours(0, 0, 0, 0);
      
      if (checkDate.getTime() === expectedDate.getTime()) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Calculate weekly progress (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const weeklyAnalyses = analyses.filter(analysis => 
      new Date(analysis.createdAt) >= sevenDaysAgo
    );
    
    const weeklyActiveDays = new Set();
    weeklyAnalyses.forEach(analysis => {
      const date = new Date(analysis.createdAt);
      date.setHours(0, 0, 0, 0);
      weeklyActiveDays.add(date.toISOString().split('T')[0]);
    });

    const weeklyProgress = {
      daysActive: weeklyActiveDays.size,
      goalDays: 7,
      pointsEarned: weeklyActiveDays.size >= 7 ? 20 : 0,
      isCompleted: weeklyActiveDays.size >= 7
    };

    // Calculate monthly progress (last 30 days)
    const monthlyActiveDays = new Set();
    analyses.forEach(analysis => {
      const date = new Date(analysis.createdAt);
      date.setHours(0, 0, 0, 0);
      monthlyActiveDays.add(date.toISOString().split('T')[0]);
    });

    const monthlyProgress = {
      daysActive: monthlyActiveDays.size,
      goalDays: 30,
      pointsEarned: monthlyActiveDays.size >= 30 ? 70 : 0,
      isCompleted: monthlyActiveDays.size >= 30
    };

    // Calculate total points
    const totalPoints = weeklyProgress.pointsEarned + monthlyProgress.pointsEarned;

    // Generate achievements
    const achievements = [
      {
        id: 'first_analysis',
        name: 'First Steps',
        description: 'Complete your first analysis',
        icon: 'star',
        earned: analyses.length > 0,
        points: 5
      },
      {
        id: 'weekly_warrior',
        name: 'Weekly Warrior',
        description: 'Be active for 7 consecutive days',
        icon: 'flame',
        earned: weeklyProgress.isCompleted,
        points: 20
      },
      {
        id: 'monthly_master',
        name: 'Monthly Master',
        description: 'Be active for 30 consecutive days',
        icon: 'trophy',
        earned: monthlyProgress.isCompleted,
        points: 70
      },
      {
        id: 'streak_keeper',
        name: 'Streak Keeper',
        description: 'Maintain a 10-day streak',
        icon: 'flash',
        earned: currentStreak >= 10,
        points: 15
      },
      {
        id: 'dedicated_learner',
        name: 'Dedicated Learner',
        description: 'Complete 50 analyses',
        icon: 'school',
        earned: analyses.length >= 50,
        points: 25
      },
      {
        id: 'accuracy_ace',
        name: 'Accuracy Ace',
        description: 'Achieve 90%+ accuracy in 10 analyses',
        icon: 'target',
        earned: false, // This would need more complex calculation
        points: 30
      }
    ];

    // Check if user has checked in today
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
    const hasCheckedInToday = lastCheckIn && lastCheckIn >= today;

    const streaksGoalsData = {
      currentStreak,
      lastCheckIn: lastCheckIn?.toISOString() || null,
      hasCheckedInToday,
      weeklyProgress,
      monthlyProgress,
      totalPoints,
      achievements,
      availableUsage: user.availableUsage || 100,
      userUsage: user.userUsage || 0
    };

    console.log('📊 Streaks and goals data generated:', {
      userId,
      currentStreak,
      weeklyProgress,
      monthlyProgress,
      totalPoints,
      achievementsEarned: achievements.filter(a => a.earned).length
    });

    res.json({
      success: true,
      data: streaksGoalsData
    });
  } catch (error) {
    console.error('❌ Error fetching streaks and goals:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Claim reward endpoint
router.post('/claim-reward/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { rewardType } = req.body; // 'weekly' or 'monthly'
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Get current streaks and goals data to verify eligibility
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const analyses = await PokerAnalysis.find({
      userId: userId,
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ createdAt: -1 });

    let pointsEarned = 0;
    let isEligible = false;

    if (rewardType === 'weekly') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const weeklyAnalyses = analyses.filter(analysis => 
        new Date(analysis.createdAt) >= sevenDaysAgo
      );
      
      const weeklyActiveDays = new Set();
      weeklyAnalyses.forEach(analysis => {
        const date = new Date(analysis.createdAt);
        date.setHours(0, 0, 0, 0);
        weeklyActiveDays.add(date.toISOString().split('T')[0]);
      });

      isEligible = weeklyActiveDays.size >= 7;
      pointsEarned = 20;
    } else if (rewardType === 'monthly') {
      const monthlyActiveDays = new Set();
      analyses.forEach(analysis => {
        const date = new Date(analysis.createdAt);
        date.setHours(0, 0, 0, 0);
        monthlyActiveDays.add(date.toISOString().split('T')[0]);
      });

      isEligible = monthlyActiveDays.size >= 30;
      pointsEarned = 70;
    }

    if (!isEligible) {
      return res.status(400).json({
        success: false,
        error: `You haven't completed the ${rewardType} goal yet`
      });
    }

    // Add points to user (assuming we have a points field in User model)
    // For now, we'll add to availableUsage as a bonus
    const bonusQuota = Math.floor(pointsEarned / 5); // 1 bonus quota per 5 points
    user.availableUsage = (user.availableUsage || 100) + bonusQuota;
    await user.save();

    console.log('🎁 Reward claimed:', {
      userId,
      rewardType,
      pointsEarned,
      bonusQuota
    });

    res.json({
      success: true,
      data: {
        pointsEarned,
        bonusQuota,
        message: `Congratulations! You earned ${pointsEarned} points and ${bonusQuota} bonus analysis quota!`
      }
    });
  } catch (error) {
    console.error('❌ Error claiming reward:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

module.exports = router;