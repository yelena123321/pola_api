const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

// Generate JWT Token
const generateToken = (payload) => {
  // Always generate proper JWT tokens
  const jwtSecret = process.env.JWT_SECRET || 'default-secret-key-for-demo-purposes-only';
  
  try {
    return jwt.sign(payload, jwtSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      issuer: process.env.JWT_ISSUER || 'working-time-api',
      audience: process.env.JWT_AUDIENCE || 'working-time-client'
    });
  } catch (error) {
    console.error('JWT generation error:', error);
    // Fallback to simple JWT without extra options
    return jwt.sign(payload, jwtSecret, { expiresIn: '8h' });
  }
};

// Verify JWT Token
const verifyToken = (token) => {
  try {
    const jwtSecret = process.env.JWT_SECRET || 'default-secret-key-for-demo-purposes-only';
    
    // First try with full verification options
    try {
      return jwt.verify(token, jwtSecret, {
        issuer: process.env.JWT_ISSUER || 'working-time-api',
        audience: process.env.JWT_AUDIENCE || 'working-time-client'
      });
    } catch (error) {
      // Fallback to simple verification without issuer/audience
      return jwt.verify(token, jwtSecret);
    }
  } catch (error) {
    throw new Error('Invalid token');
  }
};

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    const decoded = verifyToken(token);
    
    // Use decoded token data - this contains the real user info from login
    req.user = {
      id: decoded.userId || 1,
      userId: decoded.userId || 1,
      tenantId: decoded.tenantId || null,
      tenant_id: decoded.tenantId || null,
      employeeNumber: decoded.employeeNumber || null,
      employee_number: decoded.employeeNumber || null,
      firstName: decoded.firstName || decoded.name?.split(' ')[0] || 'User',
      lastName: decoded.lastName || decoded.name?.split(' ')[1] || '',
      name: decoded.name || `${decoded.firstName || 'User'} ${decoded.lastName || ''}`,
      email: decoded.email,
      role: decoded.role || decoded.userType || 'Employee',
      userType: decoded.userType || decoded.role || 'Employee',
      tenantName: decoded.tenantName || 'Company'
    };
    req.userId = decoded.userId || 1;
    req.tenantId = decoded.tenantId || null;
    
    console.log(`🔐 Auth middleware - userId: ${req.user.id}, email: ${req.user.email}, tenantId: ${req.user.tenantId}`);
    
    // Verify user still exists and is active in database
    try {
      const userCheckResult = await pool.query(
        'SELECT id, is_active, tenant_id FROM users WHERE id = $1',
        [decoded.userId]
      );
      
      if (userCheckResult.rows.length > 0 && userCheckResult.rows[0].is_active === false) {
        return res.status(401).json({
          error: 'Account deactivated',
          message: 'Your account has been deactivated. Please contact your administrator.'
        });
      }
      
      // Update tenant_id from DB if available (more reliable than token)
      if (userCheckResult.rows.length > 0 && userCheckResult.rows[0].tenant_id) {
        req.user.tenantId = userCheckResult.rows[0].tenant_id;
        req.user.tenant_id = userCheckResult.rows[0].tenant_id;
        req.tenantId = userCheckResult.rows[0].tenant_id;
      }
    } catch (dbErr) {
      // If DB check fails, continue with token data (don't block the request)
      console.log('⚠️ Auth DB check failed, using token data:', dbErr.message);
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(403).json({
      error: 'Invalid token',
      message: 'Please provide a valid authentication token'
    });
  }
};

// Hash password
const hashPassword = async (password) => {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
  return await bcrypt.hash(password, saltRounds);
};

// Compare password
const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  hashPassword,
  comparePassword
};