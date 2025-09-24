
const mongoose = require('mongoose');

// Get MongoDB URI from environment variables
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gto-poker-assistant';

if (!process.env.MONGODB_URI) {
  console.log('⚠️ MONGODB_URI not found, using local MongoDB: mongodb://localhost:27017/gto-poker-assistant');
}

// Connect to MongoDB using Mongoose
async function connectDB() {
  try {
    // Set Mongoose options
    const options = {
      serverSelectionTimeoutMS: 30000, // Increase to 30 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 30000, // Increase connection timeout
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 5, // Maintain a minimum of 5 socket connections
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
    };

    // Connect to MongoDB
    await mongoose.connect(uri, options);
    
    console.log("✅ Successfully connected to MongoDB Atlas with Mongoose!");
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('🔌 MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
    });

    return mongoose.connection;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    
    // If it's a network timeout, try to continue with limited functionality
    if (error.message.includes('Server selection timed out') || 
        error.message.includes('ReplicaSetNoPrimary')) {
      console.log('🔄 Retrying connection in 5 seconds...');
      setTimeout(() => {
        connectDB();
      }, 5000);
      return null;
    }
    
    // For other errors, exit the process
    console.log('💥 Fatal database error, exiting...');
    process.exit(1);
  }
}

// Graceful shutdown
async function closeDB() {
  try {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
  } catch (error) {
    console.error("Error closing MongoDB connection:", error);
  }
}

// Handle process termination
process.on('SIGINT', closeDB);
process.on('SIGTERM', closeDB);

module.exports = {
  connectDB,
  closeDB
};
