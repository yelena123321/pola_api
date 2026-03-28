const winston = require('winston');
const path = require('path');

// Check if we're running on Vercel (serverless environment - no filesystem writes)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

// Build transports based on environment
const transports = [];

// Only add file transports if NOT on Vercel (serverless can't write files)
if (!isVercel) {
  transports.push(
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/error.log'), 
      level: 'error' 
    }),
    // Write all logs with level `info` and below to `combined.log`
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/combined.log') 
    })
  );
}

// Always add console transport for serverless environments
if (isVercel || process.env.NODE_ENV !== 'production') {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Create winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'working-time-api' },
  transports: transports
});

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info('Request started', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    tenantId: req.user?.tenantId
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    
    logger.info('Request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      tenantId: req.user?.tenantId
    });

    originalEnd.apply(this, args);
  };

  next();
};

// Audit logging for sensitive operations
const auditLog = (action, details) => {
  logger.info('Audit Log', {
    action,
    details,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  logger,
  requestLogger,
  auditLog
};