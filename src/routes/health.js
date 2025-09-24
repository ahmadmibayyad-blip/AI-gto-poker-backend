const express = require('express');
const router = express.Router();

/**
 * GET /api/health
 * Basic health check endpoint
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    message: 'GTO Poker Backend is running',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

/**
 * GET /api/health/detailed
 * Detailed system health information
 */
router.get('/detailed', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  res.json({
    success: true,
    status: 'healthy',
    system: {
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
      },
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    services: {
      imageProcessing: 'operational',
      gtoAnalysis: 'operational',
      storage: 'operational'
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/health/ready
 * Readiness probe for container orchestration
 */
router.get('/ready', (req, res) => {
  // Check if all required services are ready
  const isReady = true; // Add actual readiness checks here
  
  if (isReady) {
    res.json({
      success: true,
      status: 'ready',
      message: 'All services are ready to accept requests'
    });
  } else {
    res.status(503).json({
      success: false,
      status: 'not-ready',
      message: 'Services are still initializing'
    });
  }
});

module.exports = router; 