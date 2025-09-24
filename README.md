# GTO Poker Assistant - Backend API

A Node.js backend service for analyzing poker table images and providing GTO (Game Theory Optimal) strategy recommendations for Cash Games and Spin & Go tournaments.

## 🚀 Features

- **Image Analysis**: Upload poker table images for real-time analysis
- **Format-Specific GTO**: Optimized strategies for Cash Games and Tournaments
- **High Accuracy**: Advanced image processing with Sharp.js
- **Rate Limiting**: Built-in protection against abuse
- **Health Monitoring**: Comprehensive health check endpoints
- **Error Handling**: Robust error handling and logging

## 📋 Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager

## 🛠️ Installation

1. **Clone and navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Start production server**:
   ```bash
   npm start
   ```

## 📡 API Endpoints

### Health Check
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed system information
- `GET /api/health/ready` - Readiness probe

### Image Analysis
- `POST /api/analysis/upload` - Upload and analyze poker table image
- `GET /api/analysis/result/:analysisId` - Get analysis result
- `POST /api/analysis/format-config` - Update format configuration
- `GET /api/analysis/formats` - Get available game formats

## 🎯 Usage Examples

### Upload Image for Analysis

```bash
curl -X POST http://localhost:3001/api/analysis/upload \
  -F "image=@poker-table.jpg" \
  -F "gameFormat=cash"
```

**Response:**
```json
{
  "success": true,
  "analysisId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Analysis started for cash game",
  "estimatedTime": "3-5 seconds"
}
```

### Get Analysis Result

```bash
curl http://localhost:3001/api/analysis/result/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "success": true,
  "result": {
    "decision": "RAISE 3.5x",
    "confidence": 87,
    "reasoning": "Deep stack post-flop decision. Deep stack allows for complex post-flop play.",
    "alternatives": ["CALL", "RAISE 2.5x"],
    "gameState": {
      "position": 4,
      "potSize": 150,
      "stackSize": 1500,
      "opponents": 3
    },
    "gameFormat": "cash",
    "analysisId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

## 🎮 Game Formats

### Cash Games
- **Decisions**: FOLD, CALL, RAISE 2.5x, RAISE 3.5x, RAISE POT
- **Focus**: Deep stack strategy, complex post-flop play
- **Analysis Time**: 3-5 seconds

### Tournaments (Spin & Go)
- **Decisions**: FOLD, CALL, SHOVE, MIN-RAISE
- **Focus**: Short stack strategy, push/fold decisions
- **Analysis Time**: 2-4 seconds

## 🔧 Configuration

Key environment variables:

```env
PORT=3001                    # Server port
NODE_ENV=development         # Environment
FRONTEND_URL=http://localhost:8081  # CORS origin
MAX_IMAGE_SIZE_MB=10        # Max upload size
ANALYSIS_TIMEOUT_MS=30000   # Analysis timeout
```

## 📊 System Requirements

- **Memory**: 512MB minimum (1GB recommended)
- **Storage**: 100MB for application, additional for images
- **Network**: Stable internet for real-time analysis
- **CPU**: Multi-core recommended for concurrent analysis

## 🛡️ Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **File Validation**: Only image files accepted
- **Size Limits**: 10MB maximum file size
- **CORS Protection**: Configurable allowed origins
- **Helmet.js**: Security headers

## 📈 Monitoring

### Health Endpoints

```bash
# Basic health check
curl http://localhost:3001/api/health

# Detailed system info
curl http://localhost:3001/api/health/detailed

# Readiness probe
curl http://localhost:3001/api/health/ready
```

## 🚨 Error Handling

The API returns standardized error responses:

```json
{
  "success": false,
  "error": "Description of the error",
  "timestamp": "2024-01-26T10:00:00.000Z"
}
```

Common HTTP status codes:
- `400` - Bad Request (invalid input)
- `413` - Payload Too Large (file too big)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## 🧪 Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## 📦 Production Deployment

1. Set `NODE_ENV=production`
2. Configure production database and Redis
3. Set up reverse proxy (nginx)
4. Configure SSL certificates
5. Set up monitoring and logging

## 🤝 Development

### Project Structure
```
backend/
├── src/
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic
│   ├── middleware/      # Custom middleware
│   └── server.js        # Main application file
├── package.json         # Dependencies and scripts
└── README.md           # This file
```

### Adding New Features

1. Create route handlers in `src/routes/`
2. Implement business logic in `src/services/`
3. Add middleware in `src/middleware/`
4. Update API documentation

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the health endpoints for system status
2. Review server logs for error details
3. Ensure all dependencies are installed correctly
4. Verify environment configuration 