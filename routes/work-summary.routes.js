/**
 * work-summary Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ========== WORK SUMMARY APIs ==========

// GET Today's Work Summary
router.get('/me/work-summary/today', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user info and actual employee_id from database
    const userResult = await pool.query(
      'SELECT id, employee_id, first_name, last_name, email, profile_photo FROM employees WHERE id = $1',
      [userId]
    );
    
    const user = userResult.rows[0] || {
      id: userId,
      employee_id: String(userId),
      first_name: req.user.name?.split(' ')[0] || 'User',
      last_name: req.user.name?.split(' ')[1] || '',
      email: req.user.email || 'user@example.com',
      profile_photo: null
    };
    
    const actualEmployeeId = user.employee_id || String(userId);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    
    // Get today's active timer from database using actual employee_id
    const timerResult = await pool.query(
      `SELECT * FROM timers 
       WHERE employee_id = $1 
       AND DATE(date) = $2 
       AND clock_out IS NULL 
       ORDER BY created_at DESC LIMIT 1`,
      [actualEmployeeId, today]
    );
    
    let totalWorkedSeconds = 0;
    let totalBreakSeconds = 0;
    let status = 'Not Started';
    let currentTask = null;
    let breaksCount = 0;
    
    if (timerResult.rows.length > 0) {
      const timer = timerResult.rows[0];
      
      // Get breaks for this timer
      const breaksResult = await pool.query(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total_paused 
         FROM breaks 
         WHERE timer_record_id = $1`,
        [timer.id]
      );
      totalBreakSeconds = parseInt(breaksResult.rows[0]?.total_paused || 0);
      
      // Check if currently on break
      const activeBreakResult = await pool.query(
        `SELECT * FROM breaks WHERE timer_record_id = $1 AND end_time IS NULL`,
        [timer.id]
      );
      const isOnBreak = activeBreakResult.rows.length > 0;
      
      if (isOnBreak) {
        // On break - calculate work time up to break start
        status = 'On Break';
        const startTime = new Date(timer.clock_in);
        const elapsedMs = now.getTime() - startTime.getTime();
        const breakTimeMs = totalBreakSeconds * 1000;
        totalWorkedSeconds = Math.max(0, Math.floor((elapsedMs - breakTimeMs) / 1000));
        currentTask = timer.remarks || 'Work Session';
      } else {
        // Working - calculate current work time
        status = 'Active';
        const startTime = new Date(timer.clock_in);
        const elapsedMs = now.getTime() - startTime.getTime();
        const breakTimeMs = totalBreakSeconds * 1000;
        const workTimeMs = elapsedMs - breakTimeMs;
        totalWorkedSeconds = Math.max(0, Math.floor(workTimeMs / 1000));
        currentTask = timer.remarks || 'Work Session';
      }
      
      // Count breaks taken today
      const breaksCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM breaks WHERE timer_record_id = $1`,
        [timer.id]
      );
      breaksCount = parseInt(breaksCountResult.rows[0]?.count || 0);
    } else {
      // Check if there are any completed timers today using actual employee_id
      const completedResult = await pool.query(
        `SELECT t.id, t.clock_in, t.clock_out, t.duration_minutes,
                COALESCE(SUM(b.duration_seconds), 0) as total_paused
         FROM timers t
         LEFT JOIN breaks b ON b.timer_record_id = t.id
         WHERE t.employee_id = $1 AND DATE(t.date) = $2 AND t.clock_out IS NOT NULL
         GROUP BY t.id, t.clock_in, t.clock_out, t.duration_minutes`,
        [actualEmployeeId, today]
      );
      
      if (completedResult.rows.length > 0) {
        // Calculate total work and break time from all completed timers
        totalWorkedSeconds = 0;
        totalBreakSeconds = 0;
        
        completedResult.rows.forEach(timer => {
          const startTime = new Date(timer.clock_in);
          const endTime = new Date(timer.clock_out);
          const totalMs = endTime.getTime() - startTime.getTime();
          const breakMs = (timer.total_paused || 0) * 1000;
          const workMs = totalMs - breakMs;
          
          totalWorkedSeconds += Math.floor(workMs / 1000);
          totalBreakSeconds += parseInt(timer.total_paused || 0);
        });
        
        status = 'Completed';
        
        // Count all breaks today using actual employee_id
        const breaksCountResult = await pool.query(
          `SELECT COUNT(*) as count FROM breaks b
           INNER JOIN timers t ON t.id = b.timer_record_id
           WHERE t.employee_id = $1 AND DATE(t.date) = $2`,
          [actualEmployeeId, today]
        );
        breaksCount = parseInt(breaksCountResult.rows[0]?.count || 0);
      }
    }
    
    // Convert seconds to hours and minutes
    const todayHours = Math.floor(totalWorkedSeconds / 3600);
    const todayMinutes = Math.floor((totalWorkedSeconds % 3600) / 60);
    const todayWorkedFormatted = `${todayHours}h ${todayMinutes}m`;
    
    const breakHours = Math.floor(totalBreakSeconds / 3600);
    const breakMinutes = Math.floor((totalBreakSeconds % 3600) / 60);
    const breakFormatted = `${breakHours}h ${breakMinutes}m`;
    
    // Get company settings for weekly hours
    let weeklyExpectedHours = 40;
    let workingHoursPerDay = 8;
    let workingDaysPerWeek = 5;
    try {
      const compSettings = await pool.query(
        `SELECT working_hours_per_day, working_days_per_week, overtime_starts_after 
         FROM company_details WHERE tenant_id = $1 LIMIT 1`,
        [req.user.tenantId]
      );
      if (compSettings.rows.length > 0) {
        workingHoursPerDay = parseFloat(compSettings.rows[0].working_hours_per_day) || 8;
        workingDaysPerWeek = parseInt(compSettings.rows[0].working_days_per_week) || 5;
        weeklyExpectedHours = workingHoursPerDay * workingDaysPerWeek;
      }
      // Also check company_settings
      const csSettings = await pool.query(
        `SELECT overtime_starts_after FROM company_settings WHERE tenant_id = $1 LIMIT 1`,
        [req.user.tenantId]
      );
      if (csSettings.rows.length > 0 && csSettings.rows[0].overtime_starts_after) {
        // If overtime_starts_after is set, recalculate weekly expected
        workingHoursPerDay = parseInt(csSettings.rows[0].overtime_starts_after) || workingHoursPerDay;
        weeklyExpectedHours = workingHoursPerDay * workingDaysPerWeek;
      }
    } catch (settingsErr) {
      console.log('⚠️ Could not fetch company settings, using defaults');
    }

    // Calculate week start (Monday)
    const todayDate = new Date(today);
    const dayOfWeek = todayDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(todayDate);
    weekStart.setDate(todayDate.getDate() - mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Get total worked seconds for this ENTIRE week (all days including today)
    let weeklyWorkedSeconds = 0;
    try {
      // Get completed timers for this week (excluding today, today is already calculated above)
      const weekTimersResult = await pool.query(
        `SELECT t.clock_in, t.clock_out, COALESCE(SUM(b.duration_seconds), 0) as total_paused
         FROM timers t
         LEFT JOIN breaks b ON b.timer_record_id = t.id
         WHERE t.employee_id = $1 
           AND DATE(t.date) >= $2 
           AND DATE(t.date) < $3
           AND t.clock_out IS NOT NULL
         GROUP BY t.id, t.clock_in, t.clock_out`,
        [actualEmployeeId, weekStartStr, today]
      );
      weekTimersResult.rows.forEach(row => {
        const startTime = new Date(row.clock_in);
        const endTime = new Date(row.clock_out);
        const totalMs = endTime.getTime() - startTime.getTime();
        const breakMs = (parseInt(row.total_paused) || 0) * 1000;
        weeklyWorkedSeconds += Math.max(0, Math.floor((totalMs - breakMs) / 1000));
      });
    } catch (weekErr) {
      console.log('⚠️ Could not fetch weekly timers');
    }

    // Add today's worked seconds to weekly total
    weeklyWorkedSeconds += totalWorkedSeconds;

    const weeklyWorkedHours = parseFloat((weeklyWorkedSeconds / 3600).toFixed(2));
    const weeklyBalanceHours = weeklyExpectedHours - weeklyWorkedHours;
    
    // Calculate overtime based on WEEKLY threshold (overtime only after weekly hours exceeded)
    const weeklyExpectedSeconds = weeklyExpectedHours * 3600;
    const overtimeSeconds = Math.max(0, weeklyWorkedSeconds - weeklyExpectedSeconds);
    const overtimeHours = Math.floor(overtimeSeconds / 3600);
    const overtimeMinutes = Math.floor((overtimeSeconds % 3600) / 60);
    const overtimeFormatted = overtimeSeconds > 0 ? `${overtimeHours}h ${overtimeMinutes}m` : '0h 0m';
    
    // Get vacation balance from database
    let vacationData = {
      vacation_days_total: 20,
      vacation_days_used: 0,
      vacation_days_remaining: 20
    };
    
    try {
      const vacationResult = await pool.query(
        `SELECT vacation_days_total, vacation_days_used, vacation_days_remaining 
         FROM vacation_balances 
         WHERE employee_id = $1 AND year = $2`,
        [userId, new Date().getFullYear()]
      );
      
      if (vacationResult.rows.length > 0) {
        vacationData = vacationResult.rows[0];
      }
    } catch (vacError) {
      console.log('⚠️ Vacation table not found, using defaults');
    }
    
    // Get pending leave requests
    let pendingDays = 0;
    try {
      const pendingResult = await pool.query(
        `SELECT COUNT(*) as count FROM leave_requests 
         WHERE employee_id = $1 AND status = 'pending'`,
        [userId]
      );
      pendingDays = parseInt(pendingResult.rows[0]?.count || 0);
    } catch (leaveError) {
      console.log('⚠️ Leave requests table not found, using defaults');
    }
    
    const workSummary = {
      user: {
        id: userId,
        name: user.first_name + ' ' + user.last_name,
        email: user.email,
        profile_photo: user.profile_photo
      },
      date: today,
      work_status: status,
      current_task: currentTask,
      
      // TODAY'S WORK
      today_worked_hours: todayWorkedFormatted,
      today_worked_total_seconds: totalWorkedSeconds,
      today_break_time: breakFormatted,
      
      // WEEKLY BALANCE
      weekly_balance: {
        expected_hours: weeklyExpectedHours,
        worked_hours: weeklyWorkedHours,
        remaining_hours: Math.max(0, weeklyBalanceHours),
        status: weeklyBalanceHours <= 0 ? 'completed' : 'pending',
        formatted: `${Math.abs(weeklyBalanceHours).toFixed(1)}h ${weeklyBalanceHours <= 0 ? 'overtime' : 'remaining'}`
      },
      
      // VACATION LEFT
      vacation_left: {
        total_allocated: parseFloat(vacationData.vacation_days_total),
        used: parseFloat(vacationData.vacation_days_used),
        pending: pendingDays,
        available: parseFloat(vacationData.vacation_days_remaining),
        formatted: `${vacationData.vacation_days_remaining} days available`
      },
      
      // OVERTIME (Weekly-based: overtime only after weekly hours exceeded)
      overtime: {
        weekly_overtime_seconds: overtimeSeconds,
        weekly_overtime_formatted: overtimeFormatted,
        weekly_worked_seconds: weeklyWorkedSeconds,
        weekly_expected_seconds: weeklyExpectedSeconds,
        has_overtime: overtimeSeconds > 0,
        calculation_mode: 'weekly'
      },
      
      time_worked: {
        total_seconds: totalWorkedSeconds,
        formatted: todayWorkedFormatted,
        hours: todayHours,
        minutes: todayMinutes
      },
      daily_goal: {
        target_hours: workingHoursPerDay,
        target_seconds: workingHoursPerDay * 3600,
        completion_percentage: Math.min(Math.round((totalWorkedSeconds / (workingHoursPerDay * 3600)) * 100), 100)
      },
      weekly_goal: {
        target_hours: weeklyExpectedHours,
        target_seconds: weeklyExpectedSeconds,
        worked_hours: weeklyWorkedHours,
        worked_seconds: weeklyWorkedSeconds,
        completion_percentage: Math.min(Math.round((weeklyWorkedSeconds / weeklyExpectedSeconds) * 100), 100)
      },
      productivity: {
        efficiency_score: Math.min(Math.round((totalWorkedSeconds / (workingHoursPerDay * 3600)) * 100), 100),
        breaks_taken: breaksCount,
        focus_time: totalWorkedSeconds,
        break_time: totalBreakSeconds
      }
    };
    
    res.json({
      success: true,
      message: "Today's work summary retrieved successfully",
      data: workSummary
    });
  } catch (error) {
    console.error('❌ Work summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve work summary',
      error: error.message
    });
  }
});


  return router;
};
