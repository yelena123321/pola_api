/**
 * API Layer Entry Point
 * 
 * This file re-exports the main server application from server.js
 * Both 'node server.js' and 'node index.js' will work identically
 * 
 * All APIs are defined in server.js (270+ endpoints)
 */

let app;

try {
  // Import the main application from server.js
  app = require('./server');
  console.log('✅ Server loaded successfully');
} catch (error) {
  console.error('❌ Failed to load server:', error.message);
  console.error('Stack:', error.stack);
  
  // Create a minimal error-reporting app
  const express = require('express');
  app = express();
  
  app.get('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Server initialization failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  });
}

// For local development - start server when run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📝 API Documentation: http://localhost:${PORT}/api-docs`);
    console.log(`✅ Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🔑 Get Token: http://localhost:${PORT}/api/get-token`);
  });
}

// Export for Vercel and other serverless platforms
module.exports = app;

// Disable Vercel's built-in body parser to let Express handle multipart/form-data
module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};
