const express = require('express');
const router = express.Router();
const User = require('../models/User');
const PokerAnalysis = require('../models/PokerAnalysis');
const Support = require('../models/Support');

/**
 * GET /api/users/recent-activity
 * Get recent activity from multiple sources
 */
router.get('/recent-activity', async (req, res) => {
  try {
    console.log('📱 Fetching recent activity...');

    const activities = [];

    // Get recent poker analyses (last 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentAnalyses = await PokerAnalysis.find({
      createdAt: { $gte: oneDayAgo }
    })
    .select('userFullName userEmail recommendedAction createdAt')
    .sort({ createdAt: -1 })
    .limit(10);

    // Convert analyses to activities
    recentAnalyses.forEach(analysis => {
      activities.push({
        id: `analysis-${analysis._id}`,
        user: analysis.userFullName || analysis.userEmail || 'Anonymous User',
        action: 'Completed hand analysis',
        time: analysis.createdAt,
        type: 'success',
        source: 'analysis'
      });
    });

    // Get recent user registrations (last 24 hours)
    const recentUsers = await User.find({
      createdAt: { $gte: oneDayAgo },
      adminAllowed: false
    })
    .select('fullName email planStatus createdAt')
    .sort({ createdAt: -1 })
    .limit(5);

    // Convert user registrations to activities
    recentUsers.forEach(user => {
      const action = user.planStatus === 'premium' ? 'Started Premium trial' : 'Started free trial';
      activities.push({
        id: `user-${user._id}`,
        user: user.fullName || user.email,
        action: action,
        time: user.createdAt,
        type: 'success',
        source: 'registration'
      });
    });

    // Get recent support tickets (last 24 hours)
    const recentTickets = await Support.find({
      createdAt: { $gte: oneDayAgo }
    })
    .select('userFullName userEmail type subject createdAt')
    .sort({ createdAt: -1 })
    .limit(5);

    // Convert support tickets to activities
    recentTickets.forEach(ticket => {
      let action = 'Reported issue';
      let type = 'warning';
      
      if (ticket.type === 'feature_request') {
        action = 'Requested new feature';
        type = 'upgrade';
      }
      
      activities.push({
        id: `support-${ticket._id}`,
        user: ticket.userFullName || ticket.userEmail || 'Anonymous User',
        action: action,
        time: ticket.createdAt,
        type: type,
        source: 'support'
      });
    });

    // Get recent user logins (last 24 hours)
    const recentLogins = await User.find({
      lastLogin: { $gte: oneDayAgo },
      adminAllowed: false
    })
    .select('fullName email lastLogin')
    .sort({ lastLogin: -1 })
    .limit(3);

    // Convert logins to activities
    recentLogins.forEach(user => {
      activities.push({
        id: `login-${user._id}`,
        user: user.fullName || user.email,
        action: 'Logged in',
        time: user.lastLogin,
        type: 'info',
        source: 'login'
      });
    });

    // Sort all activities by time (most recent first)
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Take only the 5 most recent activities
    const recentActivities = activities.slice(0, 5);

    // Format time for display
    const formattedActivities = recentActivities.map(activity => {
      const now = new Date();
      const activityTime = new Date(activity.time);
      const diffInMinutes = Math.floor((now - activityTime) / (1000 * 60));
      
      let timeDisplay;
      if (diffInMinutes < 1) {
        timeDisplay = 'Just now';
      } else if (diffInMinutes < 60) {
        timeDisplay = `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
      } else if (diffInMinutes < 1440) {
        const hours = Math.floor(diffInMinutes / 60);
        timeDisplay = `${hours} hour${hours > 1 ? 's' : ''} ago`;
      } else {
        const days = Math.floor(diffInMinutes / 1440);
        timeDisplay = `${days} day${days > 1 ? 's' : ''} ago`;
      }

      return {
        ...activity,
        timeDisplay: timeDisplay
      };
    });

    console.log('📱 Recent activity:', formattedActivities.length, 'activities found');

    res.json({
      success: true,
      data: {
        activities: formattedActivities,
        totalActivities: activities.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('📱 Error fetching recent activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent activity'
    });
  }
});

/**
 * GET /api/users/analytics
 * Get comprehensive analytics data for dashboard
 */
router.get('/analytics', async (req, res) => {
  try {
    console.log('📊 Fetching comprehensive analytics data...');

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // User Engagement Metrics - Simple count queries only
    const dailyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: oneDayAgo },
      adminAllowed: false
    });

    const totalUsers = await User.countDocuments({ adminAllowed: false });
    
    // Session duration based on analysis activity
    const analysesToday = await PokerAnalysis.countDocuments({
      createdAt: { $gte: oneDayAgo }
    });
    const avgSessionDuration = dailyActiveUsers > 0 ? 
      Math.round((analysesToday / dailyActiveUsers) * 7 * 10) / 10 : 0;

    // Bounce rate based on recent login activity
    const usersWithRecentLogin = await User.countDocuments({
      adminAllowed: false,
      lastLogin: { $gte: sevenDaysAgo }
    });
    const bounceRate = totalUsers > 0 ? 
      Math.round((1 - (usersWithRecentLogin / totalUsers)) * 100 * 10) / 10 : 0;

    // Feature Usage Metrics - Simple distinct queries only
    const usersWithAnalyses = await PokerAnalysis.distinct('userId', { 
      createdAt: { $gte: thirtyDaysAgo } 
    });
    const handAnalysisUsage = totalUsers > 0 ? 
      Math.round((usersWithAnalyses.length / totalUsers) * 100) : 0;
    
    // Range Calculator - users with multiple analyses
    const usersWithHighConfidence = await PokerAnalysis.distinct('userId', { 
      createdAt: { $gte: thirtyDaysAgo },
      confidence: { $gte: 0.8 }
    });
    const rangeCalculatorUsage = totalUsers > 0 ? 
      Math.round((usersWithHighConfidence.length / totalUsers) * 100) : 0;
    
    // Training Modules - users with recent high confidence
    const trainingModulesUsage = totalUsers > 0 ? 
      Math.round((usersWithHighConfidence.length / totalUsers) * 80) : 0;
    
    // Strategy Guides - users with both formats
    const cashUsers = await PokerAnalysis.distinct('userId', { 
      createdAt: { $gte: thirtyDaysAgo },
      gameFormat: 'cash'
    });
    const tournamentUsers = await PokerAnalysis.distinct('userId', { 
      createdAt: { $gte: thirtyDaysAgo },
      gameFormat: 'tournament'
    });
    const usersWithBothFormats = cashUsers.filter(id => tournamentUsers.includes(id)).length;
    const strategyGuidesUsage = totalUsers > 0 ? 
      Math.round((usersWithBothFormats / totalUsers) * 100) : 0;
    
    // Live Coaching - very recent users
    const usersWithRecentAnalyses = await PokerAnalysis.distinct('userId', { 
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    const liveCoachingUsage = totalUsers > 0 ? 
      Math.round((usersWithRecentAnalyses.length / totalUsers) * 100) : 0;

    // Performance Metrics - Simple calculations
    const totalAnalyses = await PokerAnalysis.countDocuments();
    const successfulAnalyses = await PokerAnalysis.countDocuments({
      confidence: { $gte: 0.7 }
    });
    const systemUptime = totalAnalyses > 0 ? 
      Math.round((successfulAnalyses / totalAnalyses) * 100 * 10) / 10 : 0;
    
    // Response time - calculate from actual processing times
    const analysesWithProcessingTime = await PokerAnalysis.find({
      processingTime: { $exists: true, $ne: null }
    }).select('processingTime').limit(100); // Limit to avoid memory issues
    
    const avgResponseTime = analysesWithProcessingTime.length > 0 ? 
      Math.round(analysesWithProcessingTime.reduce((sum, analysis) => {
        return sum + parseFloat(analysis.processingTime.toString());
      }, 0) / analysesWithProcessingTime.length * 10) / 10 : 0;

    // User satisfaction based on retention
    const retentionRate = totalUsers > 0 ? (usersWithRecentLogin / totalUsers) : 0;
    const userSatisfaction = Math.round(retentionRate * 5 * 10) / 10;

    // Conversion rate
    const premiumUsers = await User.countDocuments({ 
      planStatus: 'premium',
      adminAllowed: false 
    });
    const conversionRate = totalUsers > 0 ? 
      Math.round((premiumUsers / totalUsers) * 100 * 10) / 10 : 0;

    const analyticsData = {
      userEngagement: {
        dailyActiveUsers,
        sessionDuration: avgSessionDuration,
        bounceRate
      },
      featureUsage: {
        handAnalysis: handAnalysisUsage,
        rangeCalculator: rangeCalculatorUsage,
        trainingModules: trainingModulesUsage,
        strategyGuides: strategyGuidesUsage,
        liveCoaching: liveCoachingUsage
      },
      performanceMetrics: {
        systemUptime,
        avgResponseTime,
        userSatisfaction,
        conversionRate
      },
      timestamp: new Date().toISOString()
    };

    console.log('📊 Analytics data calculated:', {
      dailyActiveUsers,
      avgSessionDuration,
      bounceRate,
      handAnalysisUsage,
      conversionRate
    });

    res.json({
      success: true,
      data: analyticsData
    });

  } catch (error) {
    console.error('📊 Error fetching analytics data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics data'
    });
  }
});

/**
 * GET /api/users/ai-stats
 * Get AI accuracy statistics from poker analyses
 */
router.get('/ai-stats', async (req, res) => {
  try {
    console.log('🤖 Fetching AI accuracy statistics...');

    // Get total number of analyses
    const totalAnalyses = await PokerAnalysis.countDocuments();
    
    // Calculate average confidence (AI accuracy)
    const avgConfidenceResult = await PokerAnalysis.aggregate([
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$confidence' },
          totalAnalyses: { $sum: 1 }
        }
      }
    ]);

    const avgConfidence = avgConfidenceResult.length > 0 ? avgConfidenceResult[0].avgConfidence : 0;
    const aiAccuracy = Math.round(avgConfidence * 100) / 100; // Round to 2 decimal places

    // Get confidence distribution
    const confidenceDistribution = await PokerAnalysis.aggregate([
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lt: ['$confidence', 0.5] }, then: 'low' },
                { case: { $lt: ['$confidence', 0.8] }, then: 'medium' },
                { case: { $gte: ['$confidence', 0.8] }, then: 'high' }
              ],
              default: 'unknown'
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent analyses (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentAnalyses = await PokerAnalysis.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    // Calculate growth (mock calculation for now)
    const previousWeekAnalyses = Math.max(1, totalAnalyses - recentAnalyses);
    const growthPercentage = ((recentAnalyses / previousWeekAnalyses) * 100).toFixed(1);

    const aiStats = {
      aiAccuracy: aiAccuracy,
      totalAnalyses: totalAnalyses,
      recentAnalyses: recentAnalyses,
      growthPercentage: `+${growthPercentage}%`,
      confidenceDistribution: confidenceDistribution.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      timestamp: new Date().toISOString()
    };

    console.log('🤖 AI accuracy statistics:', aiStats);

    res.json({
      success: true,
      data: aiStats
    });

  } catch (error) {
    console.error('🤖 Error fetching AI accuracy statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch AI accuracy statistics'
    });
  }
});

/**
 * GET /api/users/stats
 * Get user statistics for admin dashboard
 */
router.get('/stats', async (req, res) => {
  try {
    console.log('📊 Fetching user statistics...');

    // Get total users (excluding admin users)
    const totalUsers = await User.countDocuments({ adminAllowed: false });
    
    // Get active users (excluding admin users, active in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeUsers = await User.countDocuments({
      adminAllowed: false,
      lastLogin: { $gte: thirtyDaysAgo }
    });

    // Get users by plan status
    const usersByPlan = await User.aggregate([
      { $match: { adminAllowed: false } },
      {
        $group: {
          _id: '$planStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent signups (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentSignups = await User.countDocuments({
      adminAllowed: false,
      createdAt: { $gte: sevenDaysAgo }
    });

    // Calculate growth percentage (mock calculation for now)
    const previousMonthUsers = Math.max(1, totalUsers - recentSignups);
    const growthPercentage = ((recentSignups / previousMonthUsers) * 100).toFixed(1);

    const stats = {
      totalUsers,
      activeUsers,
      recentSignups,
      growthPercentage: `+${growthPercentage}%`,
      usersByPlan: usersByPlan.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      timestamp: new Date().toISOString()
    };

    console.log('📊 User statistics:', stats);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('📊 Error fetching user statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user statistics'
    });
  }
});

/**
 * GET /api/users
 * Get all users (for admin panel)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = 'all' } = req.query;
    
    // Build query
    let query = { adminAllowed: false }; // Exclude admin users
    
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status !== 'all') {
      if (status === 'active') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query.lastLogin = { $gte: thirtyDaysAgo };
      } else if (status === 'inactive') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query.$or = [
          { lastLogin: { $lt: thirtyDaysAgo } },
          { lastLogin: { $exists: false } }
        ];
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Execute query
    const users = await User.find(query)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / parseInt(limit));

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalUsers,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * GET /api/users/:id
 * Get a specific user
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select('-password -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

/**
 * PUT /api/users/:id
 * Update a user
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete updateData.password;
    delete updateData.resetPasswordToken;
    delete updateData.resetPasswordExpires;

    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user },
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('Error updating user:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

/**
 * PUT /api/users/:id/preferences
 * Update user preferences
 */
router.put('/:id/preferences', async (req, res) => {
  try {
    const { id } = req.params;
    const preferences = req.body;

    console.log('🔄 Updating user preferences:', { userId: id, preferences });

    // Validate preferences
    const validPreferences = {};
    
    if (preferences.gameFormat) {
      if (!['cash', 'tournaments'].includes(preferences.gameFormat)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid game format. Must be "cash" or "tournaments"'
        });
      }
      validPreferences['preferences.gameFormat'] = preferences.gameFormat;
    }

    if (preferences.stackSize) {
      if (!['50bb', '100bb', '200bb', '300bb+'].includes(preferences.stackSize)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid stack size. Must be "50bb", "100bb", "200bb", or "300bb+"'
        });
      }
      validPreferences['preferences.stackSize'] = preferences.stackSize;
    }

    if (preferences.analysisSpeed) {
      if (!['slow', 'fast', 'instant', 'adaptive'].includes(preferences.analysisSpeed)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid analysis speed. Must be "slow", "fast", "instant", or "adaptive"'
        });
      }
      validPreferences['preferences.analysisSpeed'] = preferences.analysisSpeed;
    }

    if (preferences.difficultyLevel) {
      if (!['beginner', 'intermediate', 'advanced', 'expert'].includes(preferences.difficultyLevel)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid difficulty level. Must be "beginner", "intermediate", "advanced", or "expert"'
        });
      }
      validPreferences['preferences.difficultyLevel'] = preferences.difficultyLevel;
    }

    if (preferences.sessionLength) {
      if (!['15min', '30min', '45min', '60min', 'custom'].includes(preferences.sessionLength)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid session length. Must be "15min", "30min", "45min", "60min", or "custom"'
        });
      }
      validPreferences['preferences.sessionLength'] = preferences.sessionLength;
    }

    if (preferences.focusAreas) {
      const validFocusAreas = ['preflop', 'flop', 'turn', 'river', 'bluffing', 'value_betting', 'position', 'stack_sizes'];
      if (!Array.isArray(preferences.focusAreas) || 
          !preferences.focusAreas.every(area => validFocusAreas.includes(area))) {
        return res.status(400).json({
          success: false,
          error: 'Invalid focus areas. Must be an array of valid focus areas'
        });
      }
      validPreferences['preferences.focusAreas'] = preferences.focusAreas;
    }

    // Update user preferences
    const user = await User.findByIdAndUpdate(
      id,
      { $set: validPreferences },
      { new: true, runValidators: true }
    ).select('-password -resetPasswordToken -resetPasswordExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('✅ User preferences updated successfully:', user.email);

    res.json({
      success: true,
      data: { 
        user,
        preferences: user.preferences
      },
      message: 'User preferences updated successfully'
    });

  } catch (error) {
    console.error('Error updating user preferences:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update user preferences'
    });
  }
});

/**
 * DELETE /api/users/:id
 * Delete a user
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

module.exports = router;