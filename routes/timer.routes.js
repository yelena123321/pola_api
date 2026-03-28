/**
 * timer Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// Helper: get or create employee_id in EMP format for a user
async function getEmployeeId(userId, tenantId) {
  // First check employees table
  let result = await pool.query('SELECT employee_id FROM employees WHERE id = $1', [userId]);
  if (result.rows.length > 0 && result.rows[0].employee_id) return result.rows[0].employee_id;

  // Check if employee exists for this tenant by matching company_details email
  const cdResult = await pool.query('SELECT id, full_name, email, employee_number FROM company_details WHERE id = $1', [userId]);
  if (cdResult.rows.length > 0) {
    // Admin user without employees row - auto-create one
    const cd = cdResult.rows[0];
    // Generate next EMP id
    const maxEmp = await pool.query("SELECT employee_id FROM employees WHERE employee_id LIKE 'EMP%' ORDER BY employee_id DESC LIMIT 1");
    let nextNum = 1;
    if (maxEmp.rows.length > 0) {
      const match = maxEmp.rows[0].employee_id.match(/EMP(\d+)/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }
    const newEmpId = 'EMP' + String(nextNum).padStart(3, '0');

    const insertResult = await pool.query(
      `INSERT INTO employees (employee_id, tenant_id, full_name, email, role, is_admin, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Admin', true, 'Active', NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING employee_id`,
      [newEmpId, tenantId, cd.full_name, cd.email]
    );
    if (insertResult.rows.length > 0) return insertResult.rows[0].employee_id;
    
    // If insert failed (conflict), try to find by email
    const byEmail = await pool.query('SELECT employee_id FROM employees WHERE email = $1 AND tenant_id = $2', [cd.email, tenantId]);
    if (byEmail.rows.length > 0 && byEmail.rows[0].employee_id) return byEmail.rows[0].employee_id;
  }

  return String(userId); // ultimate fallback
}

// ===== TIMER OVERVIEW API - General timer information =====
router.get('/me/timer', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const tenantId = req.user?.tenantId;
  let user = persistentUsers[userId];
  
  // DB fallback if not in memory
  if (!user) {
    try {
      let result = await pool.query('SELECT id, full_name, first_name, last_name, email FROM employees WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
      if (result.rows.length > 0) {
        const r = result.rows[0];
        user = { id: r.id, full_name: r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim(), email: r.email };
      } else {
        let cdResult = await pool.query('SELECT id, first_name, last_name, email, company_name FROM company_details WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
        if (cdResult.rows.length > 0) {
          const cd = cdResult.rows[0];
          user = { id: cd.id, full_name: cd.first_name ? `${cd.first_name} ${cd.last_name || ''}`.trim() : cd.company_name, email: cd.email };
        }
      }
    } catch (e) {
      console.error('Timer user lookup error:', e.message);
    }
  }
  
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  
  const timerData = persistentTimers[userId];
  
  // Calculate current timer status
  let timerStatus = {
    has_active_timer: false,
    is_running: false,
    is_paused: false,
    current_timer: null,
    today_total: 0,
    week_total: 0
  };
  
  if (timerData) {
    timerStatus.has_active_timer = true;
    timerStatus.is_running = timerData.isActive && !timerData.isPaused;
    timerStatus.is_paused = timerData.isPaused;
    
    if (timerData.isActive) {
      // Calculate current session time
      const currentTime = new Date();
      const startTime = new Date(timerData.startTime);
      const sessionTime = Math.floor((currentTime - startTime) / 1000);
      const totalTime = (timerData.totalTime || 0) + sessionTime;
      
      timerStatus.current_timer = {
        timer_id: timerData.timerId,
        task_name: timerData.task_name,
        project_id: timerData.project_id,
        start_time: timerData.startTime,
        current_duration: Math.max(0, sessionTime),
        total_duration: Math.max(0, totalTime),
        formatted_duration: `${Math.floor(totalTime / 3600)}h ${Math.floor((totalTime % 3600) / 60)}m`,
        status: timerData.isPaused ? 'paused' : 'running'
      };
      
      timerStatus.today_total = totalTime;
    } else {
      // Timer stopped but data exists
      timerStatus.current_timer = {
        timer_id: timerData.timerId,
        task_name: timerData.task_name,
        total_duration: timerData.totalTime || 0,
        formatted_duration: `${Math.floor((timerData.totalTime || 0) / 3600)}h ${Math.floor(((timerData.totalTime || 0) % 3600) / 60)}m`,
        status: 'stopped'
      };
      
      timerStatus.today_total = timerData.totalTime || 0;
    }
  }
  
  // Mock week total (in real app would come from database)
  timerStatus.week_total = timerStatus.today_total + (6.5 * 3600); // Add mock previous days
  
  const response = {
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email
    },
    timer_overview: timerStatus,
    available_actions: {
      can_start: !timerStatus.is_running,
      can_pause: timerStatus.is_running,
      can_resume: timerStatus.is_paused,
      can_stop: timerStatus.has_active_timer
    },
    quick_stats: {
      today_hours: Math.round((timerStatus.today_total / 3600) * 10) / 10,
      week_hours: Math.round((timerStatus.week_total / 3600) * 10) / 10,
      productivity_score: Math.min(Math.round((timerStatus.today_total / 28800) * 100), 100)
    }
  };
  
  res.json({
    success: true,
    message: "Timer information retrieved successfully",
    data: response
  });
});

// ===== FIX 4: TIMER START API - Persistent, won't auto-stop =====
router.post('/me/timer/start', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { project_id, projectId, location_id, locationId, description, notes, work_location, workLocation } = req.body || {};
  const selectedProjectId = project_id || projectId || null;
  const selectedLocationId = location_id || locationId || null;
  const selectedWorkLocation = work_location || workLocation || 'office';
  const startTime = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];
  
  console.log(`🚀 Timer start request - User: ${userId}, Project: ${selectedProjectId}, Location: ${selectedWorkLocation}`);
  
  try {
    // Get the actual employee_id from employees table
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);
    
    console.log(`📋 Actual employee_id: ${actualEmployeeId}`);
    
    // Check if already has active timer in database
    const existingCheck = await pool.query(
      `SELECT id, clock_in, project_id FROM timers WHERE employee_id = $1 AND clock_out IS NULL`,
      [actualEmployeeId]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Timer already running. Stop current timer first.',
        data: {
          currentTimer: existingCheck.rows[0],
          hasActiveTimer: true
        }
      });
    }
    
    // Validate project if provided - must belong to same tenant
    let projectName = null;
    if (selectedProjectId) {
      const projectCheck = await pool.query(
        'SELECT id, name FROM projects WHERE id = $1 AND tenant_id = $2',
        [selectedProjectId, req.user.tenantId]
      );
      if (projectCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid project_id. Project not found or does not belong to your organization.'
        });
      }
      projectName = projectCheck.rows[0].name;
    }
    
    console.log(`⚠️ Daily limit check disabled for testing - allowing timer start`);
    
    // Create persistent timer in database with all fields
    const result = await pool.query(
      `INSERT INTO timers (
        employee_id, date, clock_in, duration_minutes, source, 
        description, notes, work_location, is_adjusted, project_id, 
        work_duration_seconds, total_paused_seconds, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        actualEmployeeId,
        today,
        startTime,
        null, // duration_minutes calculated on stop
        'API',
        description || null,
        notes || null,
        selectedWorkLocation,
        false,
        selectedProjectId,
        0, // work_duration_seconds starts at 0
        0, // total_paused_seconds starts at 0
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );
    
    const timerId = result.rows[0].id;
    
    console.log(`✅ Timer started successfully for user ${actualEmployeeId}, ID: ${timerId}, Project: ${projectName || 'None'}, Location: ${selectedWorkLocation}`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, actorType: 'employee', category: 'timesheets', action: 'clock_in', title: 'Employee clocked in', description: `${req.user.name} · ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, targetType: 'timer', targetId: timerId, targetName: actualEmployeeId });

    res.json({
      success: true,
      message: 'Timer started successfully',
      data: {
        id: timerId,
        employee_id: actualEmployeeId,
        date: today,
        clock_in: startTime,
        clock_out: null,
        duration_minutes: null,
        work_duration_seconds: 0,
        total_paused_seconds: 0,
        source: 'API',
        project_id: selectedProjectId,
        project_name: projectName,
        location_id: selectedLocationId,
        work_location: selectedWorkLocation,
        description: description || null,
        notes: notes || null,
        is_adjusted: false,
        is_running: true
      }
    });
  } catch (error) {
    console.error('❌ Timer start error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start timer',
      error: error.message
    });
  }
});

// ===== FIX 5: TIMER CURRENT API - Always shows correct state =====
router.get('/me/timer/current', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  console.log(`🔍 Timer status check for user ${userId}`);
  
  try {
    // Get the actual employee_id from employees table
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);
    
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [actualEmployeeId]
    );
    
    if (timerResult.rows.length === 0) {
      console.log(`❌ No active timer for user ${actualEmployeeId}`);
      
      // Get last stopped timer instead of returning null
      const lastTimerResult = await pool.query(
        `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NOT NULL ORDER BY clock_out DESC LIMIT 1`,
        [actualEmployeeId]
      );
      
      if (lastTimerResult.rows.length === 0) {
        // No timers at all - truly new user
        return res.json({
          success: true,
          data: {
            hasActiveTimer: false,
            timer: null,
            message: 'No active timer - ready to start work session'
          }
        });
      }
      
      // Return last stopped timer with status
      const lastTimer = lastTimerResult.rows[0];
      const startTime = new Date(lastTimer.clock_in);
      const endTime = new Date(lastTimer.clock_out);
      const elapsedMs = endTime.getTime() - startTime.getTime();
      const workTimeSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
      
      const hours = Math.floor(workTimeSeconds / 3600);
      const minutes = Math.floor((workTimeSeconds % 3600) / 60);
      const workDuration = `${hours}h ${minutes}m`;
      const durationMinutes = lastTimer.duration_minutes || Math.floor(workTimeSeconds / 60);
      
      console.log(`📊 Returning last stopped timer for user ${userId}: ID ${lastTimer.id}`);
      
      return res.json({
        success: true,
        data: {
          hasActiveTimer: false,
          status: 'stopped',
          work_duration: workDuration,
          work_time_seconds: workTimeSeconds,
          duration_minutes: durationMinutes,
          timer: {
            id: lastTimer.id,
            employee_id: lastTimer.employee_id,
            date: lastTimer.date,
            clock_in: lastTimer.clock_in,
            clock_out: lastTimer.clock_out,
            duration_minutes: durationMinutes,
            source: lastTimer.source,
            remarks: lastTimer.remarks,
            is_adjusted: lastTimer.is_adjusted,
            status: 'stopped'
          },
          message: 'Last work session completed - ready to start new session'
        }
      });
    }
    
    // Extract timer data from query result
    const timerData = timerResult.rows[0];
    
    // ===== AUTO-STOP AFTER 24 HOURS =====
    // Check if timer has been running for more than 24 hours
    const now = new Date();
    const startTime = new Date(timerData.clock_in);
    const elapsedMs = now.getTime() - startTime.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    
    if (elapsedMs >= twentyFourHoursMs) {
      console.log(`⚠️ Timer ID ${timerData.id} has been running for more than 24 hours - auto-stopping`);
      
      // Calculate auto-stop time as exactly 24 hours after start
      const autoStopTime = new Date(startTime.getTime() + twentyFourHoursMs);
      
      // Get total paused time from breaks table
      const breaksResult = await pool.query(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total_paused 
         FROM breaks 
         WHERE timer_record_id = $1`,
        [timerData.id]
      );
      const totalPausedSeconds = parseInt(breaksResult.rows[0]?.total_paused || 0);
      
      // Calculate work time (24 hours max - paused time)
      const totalTimeSeconds = 24 * 60 * 60; // 24 hours in seconds
      const workTimeSeconds = Math.max(0, totalTimeSeconds - totalPausedSeconds);
      const durationMinutes = Math.floor(workTimeSeconds / 60);
      
      // Update timer in database - mark as auto-stopped
      await pool.query(
        `UPDATE timers SET 
          clock_out = $1, 
          duration_minutes = $2, 
          work_duration_seconds = $3,
          total_paused_seconds = $4,
          updated_at = $5,
          notes = COALESCE(notes, '') || ' [Auto-stopped after 24 hours]'
         WHERE id = $6`,
        [autoStopTime.toISOString(), durationMinutes, workTimeSeconds, totalPausedSeconds, now.toISOString(), timerData.id]
      );
      
      // Also close any active breaks for this timer
      await pool.query(
        `UPDATE breaks SET 
          end_time = $1,
          duration_seconds = EXTRACT(EPOCH FROM ($1::timestamp - start_time))::integer
         WHERE timer_record_id = $2 AND end_time IS NULL`,
        [autoStopTime.toISOString(), timerData.id]
      );
      
      console.log(`✅ Timer auto-stopped after 24 hours for user ${actualEmployeeId}`);
      
      // Return as stopped timer
      const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
      };
      
      return res.json({
        success: true,
        data: {
          hasActiveTimer: false,
          status: 'auto_stopped',
          auto_stopped: true,
          auto_stop_reason: 'Timer automatically stopped after 24 hours',
          work_duration: formatTime(workTimeSeconds),
          work_time_seconds: workTimeSeconds,
          paused_duration: formatTime(totalPausedSeconds),
          paused_time_seconds: totalPausedSeconds,
          total_duration: '24h 0m',
          total_time_seconds: totalTimeSeconds,
          duration_minutes: durationMinutes,
          timer: {
            id: timerData.id,
            employee_id: timerData.employee_id,
            date: timerData.date,
            clock_in: timerData.clock_in,
            clock_out: autoStopTime.toISOString(),
            duration_minutes: durationMinutes,
            source: timerData.source,
            remarks: timerData.remarks,
            is_adjusted: timerData.is_adjusted,
            status: 'auto_stopped'
          },
          message: 'Timer was automatically stopped after running for 24 hours'
        }
      });
    }
  
    console.log(`✅ Active timer found for user ${userId}: ID ${timerData.id}`);
  
    // Get breaks for this timer
    const breaksResult = await pool.query(
      `SELECT break_id, break_type, start_time, end_time, duration_seconds, description 
       FROM breaks 
       WHERE timer_record_id = $1 
       ORDER BY start_time DESC`,
      [timerData.id]
    );
    
    const breaks = breaksResult.rows;
    const totalPausedSeconds = breaks.reduce((sum, b) => sum + (b.duration_seconds || 0), 0);
    
    // Check if currently on break - use timers.is_paused as authority + verify with active break
    // timers.is_paused protects against race conditions on serverless (break row may not be visible yet)
    const activeBreak = breaks.find(b => b.end_time === null);
    const isOnBreak = timerData.is_paused === true || !!activeBreak;
    
    // Calculate duration (reusing now and startTime from 24-hour check above)
    const totalElapsedMs = now.getTime() - startTime.getTime();
    const totalElapsedSeconds = Math.floor(totalElapsedMs / 1000);
    
    // Work time = total elapsed - paused time
    const workTimeSeconds = Math.max(0, totalElapsedSeconds - totalPausedSeconds);
  
    // Format time helper
    const formatTime = (seconds) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}h ${m}m`;
    };
    
    const workDuration = formatTime(workTimeSeconds);
    const pausedDuration = formatTime(totalPausedSeconds);
    const totalDuration = formatTime(totalElapsedSeconds);
    const workMinutes = Math.floor(workTimeSeconds / 60);
    
    console.log(`⏱️ Timer ID ${timerData.id}: Work=${workDuration}, Paused=${pausedDuration}, Total=${totalDuration}, Breaks=${breaks.length}, OnBreak=${isOnBreak}`);
  
    res.json({
      success: true,
      data: {
        hasActiveTimer: true,
        status: isOnBreak ? 'on_break' : 'running',
        work_duration: workDuration,
        work_time_seconds: workTimeSeconds,
        paused_duration: pausedDuration,
        paused_time_seconds: totalPausedSeconds,
        total_duration: totalDuration,
        total_time_seconds: totalElapsedSeconds,
        duration_minutes: workMinutes,
        is_paused: isOnBreak,
        timer: {
          id: timerData.id,
          employee_id: timerData.employee_id,
          date: timerData.date,
          clock_in: timerData.clock_in,
          clock_out: null,
          duration_minutes: workMinutes,
          source: timerData.source,
          remarks: timerData.remarks,
          is_adjusted: timerData.is_adjusted,
          is_paused: isOnBreak,
          work_duration: workDuration,
          work_time_seconds: workTimeSeconds,
          paused_duration: pausedDuration,
          paused_time_seconds: totalPausedSeconds,
          total_duration: totalDuration,
          total_time_seconds: totalElapsedSeconds
        },
        breaks: breaks.map(b => ({
          break_id: b.break_id,
          break_type: b.break_type,
          description: b.description,
          start_time: b.start_time,
          end_time: b.end_time,
          duration_seconds: b.duration_seconds,
          duration: b.duration_seconds ? formatTime(b.duration_seconds) : null,
          is_active: !b.end_time
        })),
        active_break: activeBreak ? {
          break_id: activeBreak.break_id,
          break_type: activeBreak.break_type,
          description: activeBreak.description,
          start_time: activeBreak.start_time,
          duration_seconds: Math.floor((now.getTime() - new Date(activeBreak.start_time).getTime()) / 1000)
        } : null
      }
    });
  } catch (error) {
    console.error('❌ Timer current error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get timer status',
      error: error.message
    });
  }
});

// ===== TIMER HISTORY API =====
router.get('/me/timer/history', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { period, start_date, end_date, page = 1, limit = 50 } = req.query;

  try {
    const actualEmployeeId = await getEmployeeId(userId, tenantId);

    // Build date filter
    let dateFilter = '';
    const params = [actualEmployeeId];
    let paramIdx = 2;

    if (start_date && end_date) {
      dateFilter = ` AND t.clock_in >= $${paramIdx} AND t.clock_in < ($${paramIdx + 1}::date + interval '1 day')`;
      params.push(start_date, end_date);
      paramIdx += 2;
    } else if (period) {
      const now = new Date();
      let startOfPeriod;
      if (period === 'today') {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === 'week') {
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      } else if (period === 'month') {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === 'year') {
        startOfPeriod = new Date(now.getFullYear(), 0, 1);
      }
      if (startOfPeriod) {
        dateFilter = ` AND t.clock_in >= $${paramIdx}`;
        params.push(startOfPeriod.toISOString());
        paramIdx++;
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Save count of params before adding LIMIT/OFFSET
    const countParams = [...params];

    // Get timer records
    const query = `
      SELECT t.id, t.employee_id, t.date, t.clock_in, t.clock_out, 
             t.duration_minutes, t.work_duration_seconds, t.total_paused_seconds,
             t.source, t.work_location, t.remarks, t.notes, t.status, t.is_paused,
             t.project_id, p.name as project_name, t.created_at
      FROM timers t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.employee_id = $1${dateFilter}
      ORDER BY t.clock_in DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    // Get total count (without LIMIT/OFFSET params)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM timers t
      WHERE t.employee_id = $1${dateFilter}
    `;
    const countResult = await pool.query(countQuery, countParams);

    // Calculate summary
    const entries = result.rows.map(t => {
      const clockIn = new Date(t.clock_in);
      const clockOut = t.clock_out ? new Date(t.clock_out) : null;
      const totalSeconds = t.work_duration_seconds || (clockOut ? Math.floor((clockOut - clockIn) / 1000) : 0);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return {
        id: t.id,
        date: t.date,
        clock_in: t.clock_in,
        clock_out: t.clock_out,
        duration_minutes: t.duration_minutes,
        work_duration_seconds: totalSeconds,
        work_duration: `${hours}h ${minutes}m`,
        total_paused_seconds: t.total_paused_seconds || 0,
        source: t.source,
        work_location: t.work_location,
        project_id: t.project_id,
        project_name: t.project_name,
        remarks: t.remarks,
        status: t.clock_out ? 'completed' : (t.is_paused ? 'paused' : 'running')
      };
    });

    const totalWorkSeconds = entries.reduce((sum, e) => sum + (e.work_duration_seconds || 0), 0);
    const totalHours = Math.floor(totalWorkSeconds / 3600);
    const totalMins = Math.floor((totalWorkSeconds % 3600) / 60);

    res.json({
      success: true,
      message: 'Timer history retrieved successfully',
      data: {
        entries,
        total_count: parseInt(countResult.rows[0]?.total || 0),
        page: parseInt(page),
        limit: parseInt(limit),
        summary: {
          total_entries: entries.length,
          total_work_seconds: totalWorkSeconds,
          total_work_duration: `${totalHours}h ${totalMins}m`,
          period: period || 'custom',
          start_date: start_date || null,
          end_date: end_date || null
        }
      }
    });
  } catch (error) {
    console.error('❌ Timer history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get timer history', error: error.message });
  }
});

// ===== FIX 6: TIMER PAUSE API - Fully implemented =====
router.post('/me/timer/pause', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { action } = req.body; // 'pause', 'resume', or undefined for toggle
  
  console.log(`⏸️ Timer pause/resume request for user ${userId} - action: ${action || 'toggle'}`);
  
  try {
    // Get the actual employee_id from employees table
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);
    
    // Get active timer
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [actualEmployeeId]
    );
    
    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active timer to pause/resume'
      });
    }
    
    const timerData = timerResult.rows[0];
    const now = new Date();
    
    // Check if there's an active break (paused state)
    const activeBreakResult = await pool.query(
      `SELECT * FROM breaks WHERE timer_record_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
      [timerData.id]
    );
    const isCurrentlyPaused = activeBreakResult.rows.length > 0 || timerData.is_paused === true;
    
    // Determine action
    const shouldPause = action === 'pause' ? true : action === 'resume' ? false : !isCurrentlyPaused;
    
    if (shouldPause && !isCurrentlyPaused) {
      // Pause timer - Insert a new break + update timers.is_paused
      await pool.query(
        `INSERT INTO breaks (timer_record_id, employee_id, break_type, start_time, description, created_at)
         VALUES ($1, $2, 'pause', $3, 'Manual pause', $3)`,
        [timerData.id, actualEmployeeId, now.toISOString()]
      );
      await pool.query(`UPDATE timers SET is_paused = TRUE WHERE id = $1`, [timerData.id]);
      console.log(`⏸️ Timer paused for user ${userId}`);
    } else if (!shouldPause && isCurrentlyPaused) {
      // Resume timer - End the active break + update timers.is_paused
      const activeBreak = activeBreakResult.rows[0];
      if (activeBreak) {
        const pauseDuration = Math.floor((now - new Date(activeBreak.start_time)) / 1000);
        await pool.query(
          `UPDATE breaks SET end_time = $1, duration_seconds = $2 WHERE break_id = $3`,
          [now.toISOString(), pauseDuration, activeBreak.break_id]
        );
        // Update total_paused_seconds on timer
        const totalPausedResult = await pool.query(
          `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM breaks WHERE timer_record_id = $1`,
          [timerData.id]
        );
        await pool.query(
          `UPDATE timers SET total_paused_seconds = $1, is_paused = FALSE WHERE id = $2`,
          [totalPausedResult.rows[0].total, timerData.id]
        );
      } else {
        await pool.query(`UPDATE timers SET is_paused = FALSE WHERE id = $1`, [timerData.id]);
      }
      console.log(`▶️ Timer resumed for user ${userId}`);
    }
    
    // Determine correct message based on action taken
    let message;
    if (shouldPause && !isCurrentlyPaused) {
      message = 'Timer paused successfully';
    } else if (!shouldPause && isCurrentlyPaused) {
      message = 'Timer resumed successfully';
    } else if (shouldPause && isCurrentlyPaused) {
      message = 'Timer is already paused';
    } else {
      message = 'Timer is already running';
    }
    
    res.json({
      success: true,
      message: message,
      data: {
        timerId: timerData.id,
        isPaused: shouldPause,
        status: shouldPause ? 'paused' : 'running',
        action: shouldPause ? 'pause' : 'resume',
        enhanced: true
      }
    });
  } catch (error) {
    console.error('❌ Timer pause/resume error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause/resume timer',
      error: error.message
    });
  }
});

// ===== TIMER RESUME API - Dedicated endpoint =====
router.post('/me/timer/resume', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  console.log(`▶️ Timer resume request for user ${userId}`);
  
  try {
    // Get the actual employee_id from employees table
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);
    
    // Get active timer
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [actualEmployeeId]
    );
    
    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active timer to resume'
      });
    }
    
    const timerData = timerResult.rows[0];
    
    // Check if there's an active break (paused state)
    const activeBreakResult = await pool.query(
      `SELECT * FROM breaks WHERE timer_record_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
      [timerData.id]
    );
    
    if (activeBreakResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Timer is not paused'
      });
    }
    
    const activeBreak = activeBreakResult.rows[0];
    const now = new Date();
    
    // Calculate pause duration and end the break
    const pauseDuration = Math.floor((now - new Date(activeBreak.start_time)) / 1000);
    
    await pool.query(
      `UPDATE breaks SET end_time = $1, duration_seconds = $2 WHERE break_id = $3`,
      [now.toISOString(), pauseDuration, activeBreak.break_id]
    );
    
    // Update total_paused_seconds on timer
    const totalPausedResult = await pool.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM breaks WHERE timer_record_id = $1`,
      [timerData.id]
    );
    const totalPausedSeconds = totalPausedResult.rows[0].total;
    
    await pool.query(
      `UPDATE timers SET total_paused_seconds = $1, is_paused = FALSE WHERE id = $2`,
      [totalPausedSeconds, timerData.id]
    );
    
    console.log(`✅ Timer resumed for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Timer resumed successfully',
      data: {
        timerId: timerData.id,
        isPaused: false,
        totalPausedSeconds: totalPausedSeconds,
        status: 'running',
        resumedAt: now.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Timer resume error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resume timer',
      error: error.message
    });
  }
});

// ===== SIMPLE TIMER STOP-NOW API =====
// Stops the active timer immediately without any body required
router.post('/me/timer/stop-now', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;

  console.log(`⏹️ Timer stop-now request for user ${userId}`);

  try {
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);

    // Get active timer
    const timerResult = await pool.query(
      `SELECT * FROM timers WHERE employee_id = $1 AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [actualEmployeeId]
    );

    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active timer to stop'
      });
    }

    const timerData = timerResult.rows[0];
    const now = new Date();

    // If timer is paused, close any open break first
    const activeBreakResult = await pool.query(
      `SELECT * FROM breaks WHERE timer_record_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
      [timerData.id]
    );
    if (activeBreakResult.rows.length > 0) {
      const activeBreak = activeBreakResult.rows[0];
      const pauseDuration = Math.floor((now - new Date(activeBreak.start_time)) / 1000);
      await pool.query(
        `UPDATE breaks SET end_time = $1, duration_seconds = $2 WHERE break_id = $3`,
        [now.toISOString(), pauseDuration, activeBreak.break_id]
      );
    }

    // Calculate final totals
    const totalPausedResult = await pool.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM breaks WHERE timer_record_id = $1`,
      [timerData.id]
    );
    const totalPausedSeconds = parseInt(totalPausedResult.rows[0].total);
    const totalElapsedSeconds = Math.floor((now - new Date(timerData.clock_in)) / 1000);
    const workDurationSeconds = Math.max(0, totalElapsedSeconds - totalPausedSeconds);
    const durationMinutes = Math.floor(workDurationSeconds / 60);

    // Stop the timer - update all duration fields
    await pool.query(
      `UPDATE timers SET clock_out = $1, duration_minutes = $2, work_duration_seconds = $3, total_paused_seconds = $4, is_paused = FALSE, status = 'completed' WHERE id = $5`,
      [now.toISOString(), durationMinutes, workDurationSeconds, totalPausedSeconds, timerData.id]
    );

    console.log(`✅ Timer stopped for user ${userId}, worked ${durationMinutes} mins (${workDurationSeconds}s), breaks ${totalPausedSeconds}s`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, actorType: 'employee', category: 'timesheets', action: 'clock_out', title: 'Employee clocked out', description: `${req.user.name} · worked ${durationMinutes} mins`, targetType: 'timer', targetId: timerData.id, targetName: userId });

    res.json({
      success: true,
      message: 'Timer stopped successfully',
      data: {
        timerId: timerData.id,
        clockIn: timerData.clock_in,
        clockOut: now.toISOString(),
        durationMinutes: durationMinutes,
        workDurationSeconds: workDurationSeconds,
        totalPausedSeconds: totalPausedSeconds,
        status: 'stopped'
      }
    });
  } catch (error) {
    console.error('❌ Timer stop-now error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop timer',
      error: error.message
    });
  }
});

// ===== NEW: OFFLINE-FIRST TIMER STOP API - Batch Sync =====
// This API accepts complete timer entries from IndexedDB for offline sync
router.post('/me/timer/stop', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { entries } = req.body;
  
  console.log(`⏹️ Timer stop/sync request for user ${userId} - Entries: ${entries?.length || 0}`);
  
  try {
    // Get the actual employee_id from employees table
    const actualEmployeeId = await getEmployeeId(userId, req.user.tenantId);
    
    // Validate request body
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: entries array is required',
        data: {
          required_fields: ['entries'],
          example: {
            entries: [
              {
                clock_in: '2026-03-06T08:00:00.000Z',
                clock_out: '2026-03-06T12:30:00.000Z',
                date: '2026-03-06',
                work_duration_seconds: 16200,
                total_paused_seconds: 900,
                duration_minutes: 270,
                project_id: 5,
                work_location: 'office',
                description: 'Working on feature',
                notes: 'Completed task',
                source: 'PWA',
                breaks: []
              }
            ]
          }
        }
      });
    }
    
    const syncedEntries = [];
    const failedEntries = [];
    
    // Process each entry
    for (const entry of entries) {
      try {
        // Validate required fields
        if (!entry.clock_in || !entry.clock_out || !entry.date) {
          failedEntries.push({
            entry,
            error: 'Missing required fields: clock_in, clock_out, date'
          });
          continue;
        }
        
        // Calculate durations if not provided
        const clockIn = new Date(entry.clock_in);
        const clockOut = new Date(entry.clock_out);
        const totalMs = clockOut.getTime() - clockIn.getTime();
        const totalSeconds = Math.floor(totalMs / 1000);
        
        const workDurationSeconds = entry.work_duration_seconds ?? totalSeconds;
        const totalPausedSeconds = entry.total_paused_seconds ?? 0;
        const durationMinutes = entry.duration_minutes ?? Math.floor(workDurationSeconds / 60);
        
        // Insert timer entry into database
        const timerResult = await pool.query(
          `INSERT INTO timers (
            employee_id, date, clock_in, clock_out, duration_minutes, 
            work_duration_seconds, total_paused_seconds, source, 
            description, notes, work_location, is_adjusted, project_id, 
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING id`,
          [
            actualEmployeeId,
            entry.date,
            entry.clock_in,
            entry.clock_out,
            durationMinutes,
            workDurationSeconds,
            totalPausedSeconds,
            entry.source || 'PWA',
            entry.description || null,
            entry.notes || null,
            entry.work_location || 'office',
            entry.is_adjusted || false,
            entry.project_id || null,
            new Date().toISOString(),
            new Date().toISOString()
          ]
        );
        
        const timerId = timerResult.rows[0].id;
        
        // Insert breaks if provided
        if (entry.breaks && Array.isArray(entry.breaks) && entry.breaks.length > 0) {
          for (const breakEntry of entry.breaks) {
            if (breakEntry.start_time && breakEntry.end_time) {
              const breakStart = new Date(breakEntry.start_time);
              const breakEnd = new Date(breakEntry.end_time);
              const breakDuration = breakEntry.duration_seconds ?? Math.floor((breakEnd.getTime() - breakStart.getTime()) / 1000);
              
              // Resolve break_type_id from break_types table
              let syncBreakTypeId = breakEntry.break_type_id || null;
              if (!syncBreakTypeId && breakEntry.break_type) {
                const btLookup = await pool.query(
                  'SELECT id FROM break_types WHERE name = $1 AND is_active = true LIMIT 1',
                  [breakEntry.break_type]
                );
                if (btLookup.rows.length > 0) syncBreakTypeId = btLookup.rows[0].id;
              }

              await pool.query(
                `INSERT INTO breaks (
                  timer_record_id, employee_id, break_type, break_type_id, start_time, end_time, 
                  duration_seconds, description, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  timerId,
                  actualEmployeeId,
                  breakEntry.break_type || 'pause',
                  syncBreakTypeId,
                  breakEntry.start_time,
                  breakEntry.end_time,
                  breakDuration,
                  breakEntry.description || null,
                  new Date().toISOString()
                ]
              );
            }
          }
        }
        
        syncedEntries.push({
          id: timerId,
          date: entry.date,
          clock_in: entry.clock_in,
          clock_out: entry.clock_out,
          duration_minutes: durationMinutes,
          work_duration_seconds: workDurationSeconds,
          breaks_count: entry.breaks?.length || 0
        });
        
        console.log(`✅ Timer entry synced: ID ${timerId}, Date: ${entry.date}, Duration: ${durationMinutes}m`);
        
      } catch (entryError) {
        console.error(`❌ Failed to sync entry:`, entryError);
        failedEntries.push({
          entry,
          error: entryError.message
        });
      }
    }
    
    const totalSynced = syncedEntries.length;
    const totalFailed = failedEntries.length;
    
    console.log(`📊 Sync complete: ${totalSynced} success, ${totalFailed} failed`);
    
    res.json({
      success: totalSynced > 0,
      message: `${totalSynced} timer ${totalSynced === 1 ? 'entry' : 'entries'} synced successfully${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
      data: {
        synced_count: totalSynced,
        failed_count: totalFailed,
        synced_entries: syncedEntries,
        failed_entries: failedEntries.length > 0 ? failedEntries : undefined
      }
    });
    
  } catch (error) {
    console.error('❌ Timer stop/sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync timer entries',
      error: error.message
    });
  }
});

// ===== TIMER BREAK API - Start break during active timer =====
router.post('/me/timer/break', authenticateToken, (req, res) => {
  const userId = req.user?.userId || 1;
  const { breakType, description, duration_minutes } = req.body;
  
  console.log(`⏸️ Timer break request from user ${userId}: ${breakType}`);
  
  // Validate break type
  if (!breakType) {
    return res.status(400).json({
      success: false,
      message: 'Break type is required',
      data: {
        required_fields: ['breakType'],
        available_types: ['lunch', 'coffee', 'personal', 'meeting', 'short', 'custom']
      }
    });
  }
  
  // Check if user has an active timer
  const activeTimer = persistentTimers[userId];
  if (!activeTimer || !activeTimer.isActive) {
    return res.status(400).json({
      success: false,
      message: 'No active timer found. Please start a timer before taking a break.',
      data: {
        has_timer: false,
        action_required: 'Start timer first'
      }
    });
  }
  
  // Check if timer is already paused/on break
  if (activeTimer.isPaused) {
    return res.status(400).json({
      success: false,
      message: 'Timer is already paused. You cannot start a break during a paused timer.',
      data: {
        timer_status: 'paused',
        suggestion: 'Resume timer first or end current break'
      }
    });
  }
  
  // Check if user already has an active break
  if (persistentBreaks[userId] && persistentBreaks[userId].status === 'active') {
    return res.status(400).json({
      success: false,
      message: 'You already have an active break running',
      data: {
        current_break: persistentBreaks[userId],
        action_required: 'End current break first'
      }
    });
  }
  
  // Define break types with default durations
  const breakTypes = {
    lunch: { name: 'Lunch Break', default_duration: 60 },
    coffee: { name: 'Coffee Break', default_duration: 15 },
    personal: { name: 'Personal Break', default_duration: 30 },
    meeting: { name: 'Meeting Break', default_duration: 45 },
    short: { name: 'Short Break', default_duration: 10 },
    custom: { name: 'Custom Break', default_duration: 15 }
  };
  
  const selectedBreakType = breakTypes[breakType] || breakTypes.custom;
  const breakDuration = duration_minutes || selectedBreakType.default_duration;
  
  // Pause the timer and save accumulated work time
  const now = new Date();
  const startTime = new Date(activeTimer.startTime);
  
  // Calculate current work time (total elapsed time minus all break time)
  let elapsedMs = now.getTime() - startTime.getTime();
  const totalBreakTimeMs = (activeTimer.totalBreakTime || 0) * 1000;
  const workTimeMs = elapsedMs - totalBreakTimeMs;
  const workTimeSeconds = Math.max(0, Math.floor(workTimeMs / 1000));
  
  persistentTimers[userId] = {
    ...activeTimer,
    isPaused: true,
    pausedAt: now.toISOString(),
    pauseReason: 'break',
    frozenWorkTime: workTimeSeconds, // Freeze work time at this point
    breakStartTime: now.toISOString() // Track when break started
  };
  
  // Create break record
  const breakId = `break_${userId}_${Date.now()}`;
  persistentBreaks[userId] = {
    id: breakId,
    user_id: userId,
    break_type: breakType,
    display_name: selectedBreakType.name,
    description: description || `Taking a ${selectedBreakType.name.toLowerCase()}`,
    start_time: now.toISOString(),
    duration_minutes: breakDuration,
    expected_end_time: new Date(now.getTime() + (breakDuration * 60000)).toISOString(),
    status: 'active',
    timer_id: activeTimer.timerId
  };
  
  savePersistentData();
  
  // Add activity log
  addActivity(userId, 'break_start', `Started ${selectedBreakType.name} (${breakDuration} min)`, {
    break_type: breakType,
    break_name: selectedBreakType.name,
    duration: breakDuration
  });
  
  console.log(`✅ Timer break started: ${selectedBreakType.name} for ${breakDuration} minutes`);
  
  res.json({
    success: true,
    message: `${selectedBreakType.name} started successfully`,
    data: {
      break: persistentBreaks[userId],
      timer_status: {
        paused: true,
        pause_reason: 'break',
        timer_id: activeTimer.timerId,
        accumulated_time: persistentTimers[userId].totalTime
      },
      instructions: [
        'Your timer has been paused automatically',
        `Break will last ${breakDuration} minutes`,
        'Use PUT /api/me/timer/break to end break and resume timer',
        'Timer will resume automatically when break ends'
      ]
    }
  });
});

// ===== END TIMER BREAK API - End break and resume timer =====
router.put('/me/timer/break', authenticateToken, (req, res) => {
  const userId = req.user?.userId || 1;
  
  console.log(`▶️ End timer break request from user ${userId}`);
  
  // Check if user has an active break
  const activeBreak = persistentBreaks[userId];
  if (!activeBreak || activeBreak.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'No active break found',
      data: {
        has_break: false,
        break_status: activeBreak ? activeBreak.status : 'none'
      }
    });
  }
  
  // Check if timer exists and is paused
  const pausedTimer = persistentTimers[userId];
  if (!pausedTimer || !pausedTimer.isPaused) {
    return res.status(400).json({
      success: false,
      message: 'Timer is not paused or does not exist',
      data: {
        timer_status: pausedTimer ? 'running' : 'not_found'
      }
    });
  }
  
  // End the break
  const now = new Date();
  const breakStartTime = new Date(activeBreak.start_time);
  const breakDuration = Math.floor((now - breakStartTime) / 1000);
  
  persistentBreaks[userId] = {
    ...activeBreak,
    status: 'completed',
    end_time: now.toISOString(),
    actual_duration_seconds: breakDuration,
    actual_duration_minutes: Math.round(breakDuration / 60)
  };
  
  // Calculate total break time
  const totalBreakTime = (pausedTimer.totalBreakTime || 0) + breakDuration;
  
  // Resume the timer - adjust start time to maintain frozen work time
  // Formula: new_start_time = current_time - frozen_work_time - total_break_time
  const frozenWorkTimeMs = (pausedTimer.frozenWorkTime || 0) * 1000;
  const totalBreakTimeMs = totalBreakTime * 1000;
  const adjustedStartTime = new Date(now.getTime() - frozenWorkTimeMs - totalBreakTimeMs);
  
  persistentTimers[userId] = {
    ...pausedTimer,
    isPaused: false,
    startTime: adjustedStartTime.toISOString(), // Adjusted to continue from frozen work time
    pausedAt: null,
    pauseReason: null,
    resumedAt: now.toISOString(),
    totalBreakTime: totalBreakTime, // Track total break duration
    breakCount: (pausedTimer.breakCount || 0) + 1, // Count breaks taken
    frozenWorkTime: null // Clear frozen time
  };
  
  savePersistentData();
  
  // Add activity log
  addActivity(userId, 'break_end', `Ended ${activeBreak.display_name} - Back to work`, {
    break_type: activeBreak.break_type,
    actual_duration: `${Math.round(breakDuration / 60)} min`
  });
  
  console.log(`✅ Timer break ended and timer resumed after ${Math.round(breakDuration / 60)} minutes`);
  
  res.json({
    success: true,
    message: 'Break ended successfully and timer resumed',
    data: {
      break_summary: {
        type: activeBreak.break_type,
        display_name: activeBreak.display_name,
        planned_duration: `${activeBreak.duration_minutes} minutes`,
        actual_duration: `${Math.round(breakDuration / 60)} minutes`,
        efficiency: breakDuration <= (activeBreak.duration_minutes * 60) ? 'on_time' : 'extended'
      },
      timer_status: {
        resumed: true,
        timer_id: pausedTimer.timerId,
        accumulated_time: pausedTimer.totalTime,
        new_session_start: now.toISOString()
      }
    }
  });
});


  return router;
};
