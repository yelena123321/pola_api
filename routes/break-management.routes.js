/**
 * break-management Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== BREAK MANAGEMENT APIs =====
let persistentBreaks = {};

// GET Break Types (public endpoint - Employee access)
router.get('/break-types', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;

  try {
    // Fetch active break types from database (tenant-specific first, then defaults)
    let result = await pool.query(`
      SELECT id, name, display_name, duration_minutes, description
      FROM break_types 
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY id ASC
    `, [tenantId]);

    // Fallback to defaults if no tenant-specific break types
    if (result.rows.length === 0) {
      result = await pool.query(`
        SELECT id, name, display_name, duration_minutes, description
        FROM break_types 
        WHERE tenant_id IS NULL AND is_active = true
        ORDER BY id ASC
      `);
    }

    res.json({
      success: true,
      message: 'Break types retrieved successfully',
      data: {
        break_types: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching break types:', error);
    // Fallback to default break types if database error
    res.json({
      success: true,
      message: 'Break types retrieved successfully (default)',
      data: {
        break_types: [],
        total: 0
      }
    });
  }
});

// GET Break Types (user-specific endpoint - Employee access)
router.get('/me/break-types', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;

  try {
    // Fetch active break types from database (tenant-specific first, then defaults)
    let result = await pool.query(`
      SELECT id, name, display_name, duration_minutes, description
      FROM break_types 
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY id ASC
    `, [tenantId]);

    // Fallback to defaults if no tenant-specific break types
    if (result.rows.length === 0) {
      result = await pool.query(`
        SELECT id, name, display_name, duration_minutes, description
        FROM break_types 
        WHERE tenant_id IS NULL AND is_active = true
        ORDER BY id ASC
      `);
    }

    res.json({
      success: true,
      message: 'Break types retrieved successfully',
      data: {
        break_types: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching break types:', error);
    // Fallback to default break types if database error
    res.json({
      success: true,
      message: 'Break types retrieved successfully (default)',
      data: {
        break_types: [],
        total: 0
      }
    });
  }
});

// POST Start Break
router.post('/me/break/start', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { break_type, break_type_id, description } = req.body;

  console.log(`☕ Break start request - User: ${userId}, Type: ${break_type}, TypeId: ${break_type_id}`);

  try {
    // Get the actual employee_id from employees table
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1',
      [userId]
    );
    const actualEmployeeId = empResult.rows.length > 0 ? empResult.rows[0].employee_id : String(userId);
    
    // Validate break_type against break_types table
    let resolvedBreakTypeId = null;
    let resolvedBreakTypeName = break_type || 'other';

    if (break_type_id) {
      // Lookup by ID (tenant-specific first, then defaults)
      let btResult = await pool.query(
        'SELECT id, name, display_name FROM break_types WHERE id = $1 AND tenant_id = $2 AND is_active = true',
        [break_type_id, tenantId]
      );
      if (btResult.rows.length === 0) {
        btResult = await pool.query(
          'SELECT id, name, display_name FROM break_types WHERE id = $1 AND tenant_id IS NULL AND is_active = true',
          [break_type_id]
        );
      }
      if (btResult.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid break_type_id. Break type not found or inactive.' });
      }
      resolvedBreakTypeId = btResult.rows[0].id;
      resolvedBreakTypeName = btResult.rows[0].name;
    } else if (break_type) {
      // Lookup by name (tenant-specific first, then defaults)
      let btResult = await pool.query(
        'SELECT id, name, display_name FROM break_types WHERE name = $1 AND tenant_id = $2 AND is_active = true',
        [break_type, tenantId]
      );
      if (btResult.rows.length === 0) {
        btResult = await pool.query(
          'SELECT id, name, display_name FROM break_types WHERE name = $1 AND tenant_id IS NULL AND is_active = true',
          [break_type]
        );
      }
      if (btResult.rows.length > 0) {
        resolvedBreakTypeId = btResult.rows[0].id;
        resolvedBreakTypeName = btResult.rows[0].name;
      }
    }

    // Check if user already has an active break
    const existingBreak = await pool.query(
      `SELECT * FROM breaks WHERE employee_id = $1 AND end_time IS NULL`,
      [actualEmployeeId]
    );

    if (existingBreak.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active break running',
        data: {
          current_break: existingBreak.rows[0]
        }
      });
    }

    // Get active timer
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NULL ORDER BY created_at DESC LIMIT 1`,
      [actualEmployeeId]
    );

    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active timer found. Please start a timer before taking a break.'
      });
    }

    const timer = timerResult.rows[0];
    const now = new Date();

    // Update timer: set is_paused = true
    await pool.query(
      `UPDATE timers SET is_paused = true, updated_at = $1 WHERE id = $2`,
      [now, timer.id]
    );

    // Create break record with break_type_id reference
    const breakResult = await pool.query(
      `INSERT INTO breaks (timer_record_id, employee_id, break_type, break_type_id, start_time, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [timer.id, actualEmployeeId, resolvedBreakTypeName, resolvedBreakTypeId, now, description || '', now]
    );

    const breakData = breakResult.rows[0];

    console.log(`✅ Break started for user ${actualEmployeeId} - Timer ${timer.id} paused - Type: ${resolvedBreakTypeName} (ID: ${resolvedBreakTypeId})`);

    res.json({
      success: true,
      message: 'Break started successfully. Timer paused.',
      data: {
        break: {
          break_id: breakData.break_id,
          break_type: breakData.break_type,
          break_type_id: breakData.break_type_id,
          description: breakData.description,
          start_time: breakData.start_time,
          timer_id: timer.id,
          timer_record_id: timer.id
        }
      }
    });
  } catch (error) {
    console.error('❌ Break start error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start break',
      error: error.message
    });
  }
});

// POST End Break
router.post('/me/break/end', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  console.log(`⏰ Break end request - User: ${userId}`);

  try {
    // Get the actual employee_id from employees table
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1',
      [userId]
    );
    const actualEmployeeId = empResult.rows.length > 0 ? empResult.rows[0].employee_id : String(userId);
    
    // Check if user has an active break
    const breakResult = await pool.query(
      `SELECT * FROM breaks WHERE employee_id = $1 AND end_time IS NULL ORDER BY created_at DESC LIMIT 1`,
      [actualEmployeeId]
    );

    if (breakResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active break found to end'
      });
    }

    const breakData = breakResult.rows[0];
    const now = new Date();
    const startTime = new Date(breakData.start_time);
    const durationMs = now.getTime() - startTime.getTime();
    const durationSeconds = Math.floor(durationMs / 1000);

    // Update break: set end_time, duration_seconds
    await pool.query(
      `UPDATE breaks SET 
        end_time = $1,
        duration_seconds = $2,
        is_active = false
      WHERE break_id = $3`,
      [now, durationSeconds, breakData.break_id]
    );

    // Get timer to update
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE id = $1`,
      [breakData.timer_record_id]
    );

    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Timer not found for this break'
      });
    }

    const timer = timerResult.rows[0];

    // Get total paused time for this timer (including current break)
    const totalBreaksResult = await pool.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total_paused FROM breaks WHERE timer_record_id = $1`,
      [timer.id]
    );
    // Add current break duration to total (since we just updated it)
    const totalPausedTime = parseInt(totalBreaksResult.rows[0]?.total_paused || 0);

    // Update timer: resume timer and update total_paused_seconds
    await pool.query(
      `UPDATE timers SET 
        is_paused = false,
        total_paused_seconds = $1,
        updated_at = $2
      WHERE id = $3`,
      [totalPausedTime, now, timer.id]
    );

    console.log(`✅ Break ended for user ${actualEmployeeId} - Duration: ${durationSeconds}s, Total paused: ${totalPausedTime}s`);

    res.json({
      success: true,
      message: 'Break ended successfully. Timer resumed.',
      data: {
        break: {
          break_id: breakData.break_id,
          break_type: breakData.break_type,
          duration_seconds: durationSeconds,
          duration: `${Math.floor(durationSeconds / 60)} minutes`
        },
        timer: {
          id: timer.id,
          total_paused_time: totalPausedTime,
          resumed: true
        }
      }
    });
  } catch (error) {
    console.error('❌ Break end error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end break',
      error: error.message
    });
  }
});

// GET Current Break
router.get('/me/break/current', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const currentBreak = persistentBreaks[userId];

  if (!currentBreak || currentBreak.status !== 'active') {
    return res.json({
      success: true,
      message: 'No active break found',
      data: {
        has_active_break: false,
        break: null
      }
    });
  }

  const now = new Date();
  const startTime = new Date(currentBreak.start_time);
  const durationMs = now - startTime;
  const durationMinutes = Math.floor(durationMs / (1000 * 60));

  res.json({
    success: true,
    message: 'Active break retrieved',
    data: {
      has_active_break: true,
      break: {
        ...currentBreak,
        current_duration_minutes: durationMinutes,
        duration: `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
      }
    }
  });
});


  return router;
};
