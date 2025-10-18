const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Database connection
const { connectDB } = require('./config/database');

const imageAnalysisRoutes = require('./routes/imageAnalysis');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const supportRoutes = require('./routes/support');
const userRoutes = require('./routes/users');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Connect to MongoDB before starting server
async function startServer() {
  try {
    const dbConnection = await connectDB();
    
    // If database connection failed, still start server with limited functionality
    if (!dbConnection) {
      console.log('⚠️ Starting server with limited functionality (no database)');
    }
    
    const app = express();
    const PORT = process.env.PORT || 3001;

    // Trust proxy - enable if behind a reverse proxy (nginx, load balancer, etc.)
    app.set('trust proxy', 1);

    // Security middleware
    app.use(helmet());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
    });
    app.use(limiter);

    // CORS configuration
    const corsOptions = {
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // List of allowed origins
        const allowedOrigins = [
          'http://localhost:8081',
          'http://localhost:19006',
          'http://localhost:3000',
          'http://127.0.0.1:8081',
          'http://127.0.0.1:19006',
          'http://127.0.0.1:3000',
          process.env.FRONTEND_URL
        ].filter(Boolean); // Remove undefined values
        
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.log('❌ CORS blocked origin:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
    };
    
    app.use(cors(corsOptions));

    // Body parsing middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging middleware
    app.use(morgan('combined'));

    // Routes
    app.use('/api/health', healthRoutes);
    app.use('/api/analysis', imageAnalysisRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/support', supportRoutes);
    app.use('/api/users', userRoutes);

    // Error handling middleware
    app.use(notFound);
    app.use(errorHandler);

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 GTO Poker Backend Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:8081'}`);
    });

    
    return app;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = startServer; 