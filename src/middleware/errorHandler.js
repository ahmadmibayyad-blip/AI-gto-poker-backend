/**
 * 404 Not Found middleware
 */
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // If response was already sent, delegate to Express default error handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  
  // Log error details
  console.error('Error Details:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Prepare error response
  const errorResponse = {
    success: false,
    error: err.message,
    timestamp: new Date().toISOString()
  };

  // Add stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }

  // Handle specific error types
  if (err.code === 'LIMIT_FILE_SIZE') {
    errorResponse.error = 'File too large. Maximum size is 10MB.';
    return res.status(413).json(errorResponse);
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    errorResponse.error = 'Unexpected file field. Please use "image" field name.';
    return res.status(400).json(errorResponse);
  }

  if (err.message === 'Only image files are allowed!') {
    errorResponse.error = 'Invalid file type. Please upload an image file (JPG, PNG, etc.).';
    return res.status(400).json(errorResponse);
  }

  // Generic error response
  res.status(statusCode).json(errorResponse);
};

module.exports = {
  notFound,
  errorHandler
}; 