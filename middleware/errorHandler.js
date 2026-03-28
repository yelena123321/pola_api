// Global Error Handler
const errorHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    userId: req.user?.id,
    tenantId: req.user?.tenantId
  });

  // Database connection errors
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Database Connection Error',
      message: 'Unable to connect to database. Please try again later.'
    });
  }

  // PostgreSQL errors
  if (err.code && err.code.startsWith('23')) {
    return res.status(400).json({
      error: 'Database Constraint Error',
      message: 'Data validation failed. Please check your input.'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Invalid authentication token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Authentication token has expired'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.details
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(statusCode).json({
    error: 'Server Error',
    message: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  asyncHandler
};