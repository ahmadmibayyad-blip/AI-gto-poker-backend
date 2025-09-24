/**
 * Validate image upload request
 */
const validateImageUpload = (req, res, next) => {
  // Check if file was uploaded
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No image file provided. Please upload a poker table image.'
    });
  }

  // Check file size (additional check beyond multer)
  if (req.file.size > 10 * 1024 * 1024) {
    return res.status(413).json({
      success: false,
      error: 'Image file too large. Maximum size is 10MB.'
    });
  }

  // Check if file buffer exists
  if (!req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image file. Please try uploading again.'
    });
  }

  // Validate game format if provided
  const { gameFormat } = req.body;
  if (gameFormat && !['cash', 'tournament'].includes(gameFormat)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid game format. Must be "cash" or "tournament".'
    });
  }

  console.log(`📤 Image upload validated: ${req.file.originalname} (${req.file.size} bytes)`);
  next();
};

/**
 * Validate analysis ID parameter
 */
const validateAnalysisId = (req, res, next) => {
  const { analysisId } = req.params;
  
  if (!analysisId) {
    return res.status(400).json({
      success: false,
      error: 'Analysis ID is required.'
    });
  }

  // Basic UUID format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(analysisId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid analysis ID format.'
    });
  }

  next();
};

/**
 * Rate limiting for analysis requests (per IP)
 */
const analysisRateLimit = (req, res, next) => {
  // This is a simple in-memory rate limiter
  // In production, use Redis or proper rate limiting middleware
  
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!global.analysisRateLimit) {
    global.analysisRateLimit = new Map();
  }

  const clientData = global.analysisRateLimit.get(clientIp) || { count: 0, resetTime: now + 60000 };
  
  // Reset counter if minute has passed
  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + 60000;
  }

  // Check if limit exceeded (10 analysis requests per minute)
  if (clientData.count >= 10) {
    return res.status(429).json({
      success: false,
      error: 'Too many analysis requests. Please wait before submitting another image.',
      retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
    });
  }

  clientData.count++;
  global.analysisRateLimit.set(clientIp, clientData);
  
  next();
};

module.exports = {
  validateImageUpload,
  validateAnalysisId,
  analysisRateLimit
}; 