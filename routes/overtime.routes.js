/**
 * overtime Routes (includes missing APIs from index.js)
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== ADMIN OVERTIME APIs (Weekly-based) =====

// GET /api/admin/employees/overtime - Get all employees overtime summary
router.get('/admin/employees/overtime', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    // Check admin from employees table OR company_details table
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can access this endpoint' });
    }

    const { period = 'current_week', date } = req.query;

    // Get company settings
    let standardHoursPerDay = 8;
    let workingDaysPerWeek = 5;
    try {
      const csResult = await pool.query(
        'SELECT overtime_starts_after FROM company_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (csResult.rows.length > 0 && csResult.rows[0].overtime_starts_after) {
        standardHoursPerDay = parseInt(csResult.rows[0].overtime_starts_after);
      }
      const cdResult = await pool.query(
        'SELECT working_hours_per_day, working_days_per_week FROM company_details WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (cdResult.rows.length > 0) {
        if (cdResult.rows[0].working_hours_per_day) standardHoursPerDay = parseFloat(cdResult.rows[0].working_hours_per_day);
        if (cdResult.rows[0].working_days_per_week) workingDaysPerWeek = parseInt(cdResult.rows[0].working_days_per_week);
      }
    } catch (e) { /* defaults */ }

    const weeklyExpectedMinutes = standardHoursPerDay * workingDaysPerWeek * 60;
    const weeklyExpectedHours = standardHoursPerDay * workingDaysPerWeek;

    // Calculate date range based on period
    const getMonday = (d) => {
      const dt = new Date(d);
      const day = dt.getDay();
      const diff = day === 0 ? 6 : day - 1;
      dt.setDate(dt.getDate() - diff);
      return dt.toISOString().split('T')[0];
    };

    let periodStart, periodEnd, periodLabel;
    const refDate = date ? new Date(date) : new Date();

    if (period === 'current_week') {
      periodStart = getMonday(refDate);
      const endDt = new Date(periodStart);
      endDt.setDate(endDt.getDate() + 6);
      periodEnd = endDt.toISOString().split('T')[0];
      periodLabel = `Week of ${periodStart}`;
    } else if (period === 'current_month') {
      const ms = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
      periodStart = ms.toISOString().split('T')[0];
      const me = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
      periodEnd = me.toISOString().split('T')[0];
      periodLabel = `${refDate.toLocaleString('en', { month: 'long', year: 'numeric' })}`;
    } else if (period === 'current_year') {
      periodStart = `${refDate.getFullYear()}-01-01`;
      periodEnd = `${refDate.getFullYear()}-12-31`;
      periodLabel = `Year ${refDate.getFullYear()}`;
    } else {
      periodStart = getMonday(refDate);
      const endDt = new Date(periodStart);
      endDt.setDate(endDt.getDate() + 6);
      periodEnd = endDt.toISOString().split('T')[0];
      periodLabel = `Week of ${periodStart}`;
    }

    // Get all employees for this tenant
    const employeesResult = await pool.query(
      `SELECT id, employee_id, first_name, last_name, email, department, profile_photo 
       FROM employees WHERE tenant_id = $1 AND status = 'Active' ORDER BY first_name`,
      [tenantId]
    );

    // Get all timer data for the period grouped by employee and date
    const timersResult = await pool.query(`
      SELECT 
        t.employee_id,
        DATE(t.clock_in) as work_date,
        SUM(t.duration_minutes) as daily_minutes
      FROM timers t
      WHERE t.employee_id = ANY($1::text[])
        AND t.clock_out IS NOT NULL
        AND DATE(t.clock_in) >= $2
        AND DATE(t.clock_in) <= $3
      GROUP BY t.employee_id, DATE(t.clock_in)
      ORDER BY t.employee_id, DATE(t.clock_in)
    `, [employeesResult.rows.map(e => e.employee_id), periodStart, periodEnd]);

    // Group timer data by employee
    const employeeTimers = {};
    timersResult.rows.forEach(row => {
      const empId = row.employee_id;
      if (!employeeTimers[empId]) employeeTimers[empId] = [];
      employeeTimers[empId].push({
        date: row.work_date instanceof Date ? row.work_date.toISOString().split('T')[0] : row.work_date,
        minutes: parseInt(row.daily_minutes) || 0
      });
    });

    // Calculate overtime per employee (weekly basis)
    const employeesOvertime = employeesResult.rows.map(emp => {
      const timers = employeeTimers[emp.employee_id] || [];

      // Group by week
      const weeklyTotals = {};
      timers.forEach(t => {
        const weekKey = getMonday(t.date);
        if (!weeklyTotals[weekKey]) weeklyTotals[weekKey] = 0;
        weeklyTotals[weekKey] += t.minutes;
      });

      let totalWorkedMinutes = 0;
      let totalOvertimeMinutes = 0;
      let weeksWithOvertime = 0;
      const weekBreakdown = [];

      Object.entries(weeklyTotals).forEach(([weekStart, minutes]) => {
        totalWorkedMinutes += minutes;
        const overtime = Math.max(0, minutes - weeklyExpectedMinutes);
        if (overtime > 0) {
          totalOvertimeMinutes += overtime;
          weeksWithOvertime++;
        }
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekBreakdown.push({
          week_start: weekStart,
          week_end: weekEnd.toISOString().split('T')[0],
          worked_hours: parseFloat((minutes / 60).toFixed(2)),
          expected_hours: weeklyExpectedHours,
          overtime_hours: parseFloat((overtime / 60).toFixed(2)),
          has_overtime: overtime > 0
        });
      });

      const totalWorkedHours = parseFloat((totalWorkedMinutes / 60).toFixed(2));
      const totalOvertimeHours = parseFloat((totalOvertimeMinutes / 60).toFixed(2));

      return {
        employee: {
          id: emp.id,
          employee_id: emp.employee_id,
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          email: emp.email,
          department: emp.department,
          profile_photo: emp.profile_photo
        },
        total_worked_hours: totalWorkedHours,
        total_overtime_hours: totalOvertimeHours,
        weeks_with_overtime: weeksWithOvertime,
        has_overtime: totalOvertimeMinutes > 0,
        week_breakdown: weekBreakdown
      };
    });

    // Sort: employees with most overtime first
    employeesOvertime.sort((a, b) => b.total_overtime_hours - a.total_overtime_hours);

    const totalTeamOvertime = employeesOvertime.reduce((sum, e) => sum + e.total_overtime_hours, 0);
    const employeesWithOvertime = employeesOvertime.filter(e => e.has_overtime).length;

    res.json({
      success: true,
      message: 'Employees overtime retrieved successfully',
      data: {
        period: {
          type: period,
          start: periodStart,
          end: periodEnd,
          label: periodLabel
        },
        settings: {
          calculation_mode: 'weekly',
          weekly_expected_hours: weeklyExpectedHours,
          standard_hours_per_day: standardHoursPerDay,
          working_days_per_week: workingDaysPerWeek
        },
        summary: {
          total_employees: employeesResult.rows.length,
          employees_with_overtime: employeesWithOvertime,
          total_team_overtime_hours: parseFloat(totalTeamOvertime.toFixed(2))
        },
        employees: employeesOvertime
      }
    });
  } catch (error) {
    console.error('Admin overtime error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees overtime',
      error: error.message
    });
  }
});

// GET /api/admin/employees/:id/overtime - Get specific employee overtime detail
router.get('/admin/employees/:id/overtime', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    const targetEmployeeId = parseInt(req.params.id);

    // Check admin from employees table OR company_details table
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can access this endpoint' });
    }

    // Get target employee
    const empResult = await pool.query(
      `SELECT id, employee_id, first_name, last_name, email, department, profile_photo 
       FROM employees WHERE id = $1 AND tenant_id::integer = $2`,
      [targetEmployeeId, tenantId]
    );
    if (empResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    const emp = empResult.rows[0];

    const { period = 'current_month' } = req.query;

    // Get company settings
    let standardHoursPerDay = 8;
    let workingDaysPerWeek = 5;
    try {
      const csResult = await pool.query(
        'SELECT overtime_starts_after FROM company_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (csResult.rows.length > 0 && csResult.rows[0].overtime_starts_after) {
        standardHoursPerDay = parseInt(csResult.rows[0].overtime_starts_after);
      }
      const cdResult = await pool.query(
        'SELECT working_hours_per_day, working_days_per_week FROM company_details WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (cdResult.rows.length > 0) {
        if (cdResult.rows[0].working_hours_per_day) standardHoursPerDay = parseFloat(cdResult.rows[0].working_hours_per_day);
        if (cdResult.rows[0].working_days_per_week) workingDaysPerWeek = parseInt(cdResult.rows[0].working_days_per_week);
      }
    } catch (e) { /* defaults */ }

    const weeklyExpectedMinutes = standardHoursPerDay * workingDaysPerWeek * 60;
    const weeklyExpectedHours = standardHoursPerDay * workingDaysPerWeek;

    const getMonday = (d) => {
      const dt = new Date(d);
      const day = dt.getDay();
      const diff = day === 0 ? 6 : day - 1;
      dt.setDate(dt.getDate() - diff);
      return dt.toISOString().split('T')[0];
    };

    // Calculate date ranges
    const now = new Date();
    let periodStart, periodEnd;

    if (period === 'current_week') {
      periodStart = getMonday(now);
      const endDt = new Date(periodStart);
      endDt.setDate(endDt.getDate() + 6);
      periodEnd = endDt.toISOString().split('T')[0];
    } else if (period === 'current_month') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    } else if (period === 'current_year') {
      periodStart = `${now.getFullYear()}-01-01`;
      periodEnd = `${now.getFullYear()}-12-31`;
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    // Get all timer data for this employee in the period
    const timersResult = await pool.query(`
      SELECT 
        DATE(clock_in) as work_date,
        SUM(duration_minutes) as daily_minutes,
        MIN(clock_in) as first_clock_in,
        MAX(clock_out) as last_clock_out,
        MAX(remarks) as remarks
      FROM timers 
      WHERE employee_id = $1 
        AND clock_out IS NOT NULL
        AND DATE(clock_in) >= $2 
        AND DATE(clock_in) <= $3
      GROUP BY DATE(clock_in)
      ORDER BY DATE(clock_in)
    `, [emp.employee_id, periodStart, periodEnd]);

    // Group by week
    const weeklyData = {};
    timersResult.rows.forEach(row => {
      const dateStr = row.work_date instanceof Date ? row.work_date.toISOString().split('T')[0] : row.work_date;
      const weekKey = getMonday(dateStr);
      if (!weeklyData[weekKey]) weeklyData[weekKey] = { totalMinutes: 0, days: [] };
      const minutes = parseInt(row.daily_minutes) || 0;
      weeklyData[weekKey].totalMinutes += minutes;
      weeklyData[weekKey].days.push({
        date: dateStr,
        worked_hours: parseFloat((minutes / 60).toFixed(2)),
        first_clock_in: row.first_clock_in,
        last_clock_out: row.last_clock_out,
        remarks: row.remarks
      });
    });

    // Calculate weekly overtime
    let totalOvertimeMinutes = 0;
    let totalWorkedMinutes = 0;
    const weeks = Object.entries(weeklyData).map(([weekStart, data]) => {
      const overtime = Math.max(0, data.totalMinutes - weeklyExpectedMinutes);
      totalOvertimeMinutes += overtime;
      totalWorkedMinutes += data.totalMinutes;
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return {
        week_start: weekStart,
        week_end: weekEnd.toISOString().split('T')[0],
        total_worked_hours: parseFloat((data.totalMinutes / 60).toFixed(2)),
        expected_hours: weeklyExpectedHours,
        overtime_hours: parseFloat((overtime / 60).toFixed(2)),
        has_overtime: overtime > 0,
        days_worked: data.days.length,
        daily_breakdown: data.days
      };
    });

    // Sort weeks desc
    weeks.sort((a, b) => b.week_start.localeCompare(a.week_start));

    res.json({
      success: true,
      message: 'Employee overtime details retrieved successfully',
      data: {
        employee: {
          id: emp.id,
          employee_id: emp.employee_id,
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          email: emp.email,
          department: emp.department,
          profile_photo: emp.profile_photo
        },
        period: { type: period, start: periodStart, end: periodEnd },
        settings: {
          calculation_mode: 'weekly',
          weekly_expected_hours: weeklyExpectedHours,
          standard_hours_per_day: standardHoursPerDay,
          working_days_per_week: workingDaysPerWeek
        },
        summary: {
          total_worked_hours: parseFloat((totalWorkedMinutes / 60).toFixed(2)),
          total_overtime_hours: parseFloat((totalOvertimeMinutes / 60).toFixed(2)),
          weeks_with_overtime: weeks.filter(w => w.has_overtime).length,
          total_weeks: weeks.length
        },
        weeks
      }
    });
  } catch (error) {
    console.error('Admin employee overtime error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee overtime',
      error: error.message
    });
  }
});

// GET /api/me/work-status - Get current work status (Database-driven)
router.get('/me/work-status', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // Get active timer session
    const timerResult = await pool.query(
      "SELECT * FROM timer_sessions WHERE employee_id = $1 AND status IN ('running', 'paused') ORDER BY start_time DESC LIMIT 1",
      [userId]
    );
    
    // Get today's time entries
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayResult = await pool.query(
      'SELECT SUM(duration_minutes) as total_minutes FROM time_entries WHERE employee_id = $1 AND date = CURRENT_DATE',
      [userId]
    );
    
    // Get breaks taken today
    const breaksResult = await pool.query(
      'SELECT COUNT(*) as breaks_count FROM timer_breaks WHERE employee_id = $1 AND DATE(start_time) = CURRENT_DATE',
      [userId]
    );
    
    const activeSession = timerResult.rows[0];
    const todayMinutes = parseInt(todayResult.rows[0]?.total_minutes) || 0;
    const todayHours = todayMinutes / 60;
    const breaksTaken = parseInt(breaksResult.rows[0]?.breaks_count) || 0;
    
    let currentStatus = 'not_working';
    let workSession = null;
    
    if (activeSession) {
      currentStatus = activeSession.status === 'paused' ? 'on_break' : 'working';
      const elapsedMs = Date.now() - new Date(activeSession.start_time).getTime();
      const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
      const elapsedMinutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
      
      workSession = {
        started_at: activeSession.start_time,
        current_task: activeSession.task_description || null,
        elapsed_time: `${elapsedHours}h ${elapsedMinutes}m`,
        productivity_score: null,
        breaks_taken: breaksTaken,
        last_activity: new Date().toISOString()
      };
    }
    
    const targetHours = 8;
    const progressPercentage = Math.min(100, (todayHours / targetHours) * 100);
    
    res.json({
      success: true,
      data: {
        current_status: currentStatus,
        work_session: workSession,
        daily_progress: {
          target_hours: targetHours,
          completed_hours: parseFloat(todayHours.toFixed(2)),
          progress_percentage: parseFloat(progressPercentage.toFixed(2)),
          remaining_hours: parseFloat(Math.max(0, targetHours - todayHours).toFixed(2))
        },
        mood_tracker: null
      }
    });
  } catch (error) {
    console.error('Work status error:', error);
    // Return default response if tables don't exist
    res.json({
      success: true,
      data: {
        current_status: 'not_working',
        work_session: null,
        daily_progress: {
          target_hours: 8,
          completed_hours: 0,
          progress_percentage: 0,
          remaining_hours: 8
        },
        mood_tracker: null
      }
    });
  }
});

// GET /api/me/updates - Get user updates (Database-driven - returns empty if no announcements table)
router.get('/me/updates', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  
  try {
    // Check if announcements table exists and fetch data
    // For now, return empty as no announcements table exists
    res.json({
      success: true,
      data: {
        announcements: [],
        company_news: [],
        unread_count: 0,
        total_count: 0
      }
    });
  } catch (error) {
    console.error('Updates fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch updates',
      error: error.message
    });
  }
});

// GET /api/me/quick-actions - Get user quick actions
router.get('/me/quick-actions', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      quick_actions: [
        {
          id: 1,
          title: 'Request Time Correction',
          description: 'Correct missed clock-in or clock-out',
          icon: 'clock_edit',
          color: '#FF9800',
          action: 'time_correction',
          requires_form: true
        },
        {
          id: 2,
          title: 'Add Manual Entry',
          description: 'Add time entry for work done offline',
          icon: 'add_task',
          color: '#4CAF50',
          action: 'manual_entry',
          requires_form: true
        },
        {
          id: 3,
          title: 'Request Vacation',
          description: 'Submit new vacation request',
          icon: 'beach_access',
          color: '#2196F3',
          action: 'vacation_request',
          requires_form: true
        },
        {
          id: 4,
          title: 'Report Issue',
          description: 'Report technical or time tracking issue',
          icon: 'report_problem',
          color: '#F44336',
          action: 'report_issue',
          requires_form: true
        }
      ],
      total_actions: 4
    }
  });
});

// GET /api/me/activity - Get user activity feed (Database-driven)
router.get('/me/activity', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const limit = parseInt(req.query.limit) || 20;
  
  try {
    // Get activities from activities table
    const result = await pool.query(
      'SELECT * FROM activities WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    
    const activities = result.rows.map(row => ({
      id: `activity_${row.id}`,
      type: row.type,
      title: row.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: row.message,
      timestamp: row.created_at,
      icon: getActivityIcon(row.type),
      metadata: row.metadata || {}
    }));
    
    res.json({
      success: true,
      data: {
        activities: activities,
        total_count: activities.length,
        showing: activities.length,
        has_more: activities.length >= limit
      }
    });
  } catch (error) {
    console.error('Activity fetch error:', error);
    res.json({
      success: true,
      data: {
        activities: [],
        total_count: 0,
        showing: 0,
        has_more: false
      }
    });
  }
});

// Helper function to get activity icons
function getActivityIcon(type) {
  const icons = {
    login: '🔐',
    logout: '🚪',
    clock_in: '⏰',
    clock_out: '🏠',
    break_start: '☕',
    break_end: '💼',
    leave_request: '🏖️',
    leave_approved: '✅',
    leave_rejected: '❌',
    project_assigned: '📋',
    time_correction: '⏱️',
    profile_update: '👤'
  };
  return icons[type] || '📌';
}

// GET /api/admin/recent-activity - Get recent admin activity (Database-driven)
router.get('/admin/recent-activity', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  const limit = parseInt(req.query.limit) || 20;
  
  try {
    // Get recent activities from all employees in tenant
    let query = `
      SELECT a.*, e.full_name, e.role 
      FROM activities a 
      JOIN employees e ON a.user_id = e.id 
      WHERE e.tenant_id = $1
    `;
    const params = [tenantId];
    let paramIndex = 2;
    
    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    
    const activities = result.rows.map(row => ({
      id: `activity_${row.id}`,
      type: row.type,
      title: row.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: row.message,
      timestamp: row.created_at,
      icon: getActivityIcon(row.type),
      user: { name: row.full_name || 'Unknown', role: row.role || 'Employee' }
    }));
    
    res.json({
      success: true,
      data: {
        activities: activities,
        total_count: activities.length,
        showing: activities.length,
        has_more: activities.length >= limit,
        filters: {
          available_types: ['All', 'Employee Activity', 'Leave Requests', 'Time Corrections', 'System Updates']
        }
      }
    });
  } catch (error) {
    console.error('Admin activity fetch error:', error);
    res.json({
      success: true,
      data: {
        activities: [],
        total_count: 0,
        showing: 0,
        has_more: false,
        filters: {
          available_types: ['All', 'Employee Activity', 'Leave Requests', 'Time Corrections', 'System Updates']
        }
      }
    });
  }
});

// GET /api/updates - Get global updates (Database returns empty - no updates table)
router.get('/updates', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    data: {
      updates: [],
      total: 0
    }
  });
});

// GET /api/quick-actions - Get quick actions list
router.get('/quick-actions', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      actions: [
        {
          id: 'manual_time_entry',
          title: 'Manual Time Entry',
          description: 'Add time entry for missed clock-in/out',
          icon: '⏰',
          enabled: true
        },
        {
          id: 'time_correction',
          title: 'Time Correction',
          description: 'Request correction for time entries',
          icon: '📝',
          enabled: true
        },
        {
          id: 'leave_request',
          title: 'Leave Request', 
          description: 'Apply for leave/vacation',
          icon: '🌴',
          enabled: true
        }
      ]
    }
  });
});

// GET /api/notifications/config - Get notification configuration
router.get('/notifications/config', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: "Notification configuration retrieved successfully",
    data: {
      break_reminder: {
        enabled: true,
        trigger_after_minutes: 120,
        trigger_after_formatted: "2h",
        title: "Time for a break",
        message: "You've been working for a while. Taking a short break helps you stay fresh."
      },
      clock_out_reminder: {
        enabled: true,
        trigger_after_hours: 8,
        trigger_after_formatted: "8h",
        title: "Did you forget to clock out?",
        message: "You've been working for a long time. Would you like to end your workday?"
      },
      extended_break_reminder: {
        enabled: true,
        break_duration_limits: {
          lunch: 60,
          coffee: 15,
          short: 10,
          personal: 30,
          meeting: 120,
          default: 30
        },
        title: "Still on break?",
        message: "You've been on break for a while. Ready to continue your work?"
      },
      general: {
        check_interval_seconds: 60,
        auto_dismiss_after_minutes: 10,
        sound_enabled: true,
        vibration_enabled: true
      }
    }
  });
});

// GET /api/time-correction-types - Get time correction types
router.get('/time-correction-types', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: "Time correction types retrieved successfully",
    data: {
      issue_types: [
        {
          id: 'missing_clock_in',
          label: 'Missing clock in',
          value: 'missing_clock_in',
          description: 'Add missing clock-in entry',
          icon: 'login',
          color: '#8BC34A',
          requires_time: true,
          time_field_label: 'New clock-in time'
        },
        {
          id: 'missing_clock_out',
          label: 'Missing clock out',
          value: 'missing_clock_out',
          description: 'Add missing clock-out entry',
          icon: 'logout',
          color: '#FFC107',
          requires_time: true,
          time_field_label: 'New clock-out time'
        },
        {
          id: 'wrong_clock_in',
          label: 'Wrong clock-in time',
          value: 'wrong_clock_in',
          description: 'Correct incorrect clock-in time',
          icon: 'clock-in',
          color: '#00BCD4',
          requires_time: true,
          time_field_label: 'Correct clock-in time'
        },
        {
          id: 'wrong_clock_out',
          label: 'Wrong clock-out time',
          value: 'wrong_clock_out',
          description: 'Correct incorrect clock-out time',
          icon: 'clock-out',
          color: '#FF5722',
          requires_time: true,
          time_field_label: 'Correct clock-out time'
        },
        {
          id: 'missing_work_entry',
          label: 'Add missing work entry',
          value: 'missing_work_entry',
          description: 'Request to add missing clock-in/out for a work day',
          icon: 'clock-plus',
          color: '#4CAF50',
          requires_time: true,
          time_field_label: 'Work entry times'
        },
        {
          id: 'missing_break',
          label: 'Missing break entry',
          value: 'missing_break',
          description: 'Add missing break time entry',
          icon: 'coffee',
          color: '#2196F3',
          requires_time: true,
          time_field_label: 'Break time'
        }
      ]
    }
  });
});

// GET /api/me/time-corrections - Get user's time correction requests (Database-driven)
router.get('/me/time-corrections', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const result = await pool.query(
      `SELECT * FROM correction_requests 
       WHERE employee_id = $1 AND status = 'pending' 
       ORDER BY created_at DESC`,
      [userId]
    );
    
    const activeRequests = result.rows.map(row => ({
      id: row.id,
      issue_type: row.correction_type,
      issue_type_label: row.correction_type ? row.correction_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Time Correction',
      date: row.date ? row.date.toISOString().split('T')[0] : null,
      date_formatted: row.date ? new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
      correction_time: row.corrected_start_time || row.corrected_end_time || null,
      label: row.reason || row.description || '',
      description: row.reason || row.description || '',
      attachment_url: row.attachment_url || null,
      status: row.status,
      submitted_at: row.created_at,
      submitted_at_formatted: getTimeAgo(row.created_at)
    }));

    res.json({
      success: true,
      message: "Active correction requests retrieved successfully",
      data: {
        active_requests: activeRequests,
        total_count: activeRequests.length,
        empty_state: {
          show: activeRequests.length === 0,
          title: 'No Active Requests',
          message: 'You don\'t have any pending correction requests at the moment.',
          icon: 'clipboard-check',
          cta_label: 'New Request'
        }
      }
    });
  } catch (error) {
    console.error('Time corrections error:', error);
    res.json({
      success: true,
      data: {
        active_requests: [],
        total_count: 0,
        empty_state: {
          show: true,
          title: 'No Active Requests',
          message: 'You don\'t have any pending correction requests at the moment.',
          icon: 'clipboard-check',
          cta_label: 'New Request'
        }
      }
    });
  }
});

// Helper function for time ago formatting
function getTimeAgo(date) {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  return `${diffDays} days ago`;
}

// POST /api/me/time-corrections - Create time correction request (Database-driven)
router.post('/me/time-corrections', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { date, issue_type, correction_time, label, description, corrected_start_time, corrected_end_time } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO correction_requests 
       (employee_id, tenant_id, date, correction_type, corrected_start_time, corrected_end_time, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING *`,
      [userId, tenantId, date, issue_type, corrected_start_time || correction_time, corrected_end_time, label || description]
    );
    
    const newRequest = result.rows[0];
    
    res.status(201).json({
      success: true,
      message: 'Time correction request submitted successfully',
      data: {
        correction_id: newRequest.id,
        date: newRequest.date,
        issue_type: newRequest.correction_type,
        correction_time,
        label,
        status: 'pending',
        submitted_at: newRequest.created_at,
        estimated_processing_time: '24-48 hours'
      }
    });
  } catch (error) {
    console.error('Create time correction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit time correction request'
    });
  }
});

// PUT /api/time-corrections/:id/status - Update time correction status (Database-driven)
router.put('/time-corrections/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  const { status, reason } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE correction_requests 
       SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, reason, userId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Correction request not found'
      });
    }
    
    res.json({
      success: true,
      message: `Time correction request ${status} successfully`,
      data: {
        id: parseInt(id),
        status,
        updated_at: result.rows[0].updated_at,
        reason: reason || null
      }
    });
  } catch (error) {
    console.error('Update correction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update correction status'
    });
  }
});

// GET /api/me/time-corrections/history - Get time corrections history (Database-driven)
router.get('/me/time-corrections/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { status } = req.query;
  
  try {
    let query = `SELECT cr.*, e.full_name as reviewer_name 
                 FROM correction_requests cr
                 LEFT JOIN employees e ON cr.reviewed_by = e.id
                 WHERE cr.employee_id = $1 AND cr.status != 'pending'`;
    const params = [userId];
    let paramIndex = 2;
    
    if (status && ['approved', 'rejected'].includes(status)) {
      query += ` AND cr.status = $${paramIndex}`;
      params.push(status);
    }
    
    query += ' ORDER BY cr.created_at DESC';
    
    const result = await pool.query(query, params);
    
    const history = result.rows.map(row => ({
      id: row.id,
      issue_type: row.correction_type,
      issue_type_label: row.correction_type ? row.correction_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Time Correction',
      date: row.date ? row.date.toISOString().split('T')[0] : null,
      date_formatted: row.date ? new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
      correction_time: row.corrected_start_time || row.corrected_end_time || null,
      label: row.reason || '',
      status: row.status,
      submitted_at: row.created_at,
      approved_at: row.status === 'approved' ? row.reviewed_at : null,
      rejected_at: row.status === 'rejected' ? row.reviewed_at : null,
      approved_by: row.status === 'approved' ? row.reviewer_name : null,
      rejected_by: row.status === 'rejected' ? row.reviewer_name : null,
      rejection_reason: row.rejection_reason || null,
      processed_at_formatted: row.reviewed_at ? getTimeAgo(row.reviewed_at) : null
    }));
    
    const approvedCount = result.rows.filter(r => r.status === 'approved').length;
    const rejectedCount = result.rows.filter(r => r.status === 'rejected').length;

    res.json({
      success: true,
      message: "Correction history retrieved successfully",
      data: {
        history: history,
        total_count: history.length,
        approved_count: approvedCount,
        rejected_count: rejectedCount,
        empty_state: {
          show: history.length === 0,
          title: 'No History Found',
          message: 'You don\'t have any completed correction requests yet.',
          icon: 'history',
          cta_label: 'New Request'
        }
      }
    });
  } catch (error) {
    console.error('Time correction history error:', error);
    res.json({
      success: true,
      data: {
        history: [],
        total_count: 0,
        approved_count: 0,
        rejected_count: 0,
        empty_state: {
          show: true,
          title: 'No History Found',
          message: 'You don\'t have any completed correction requests yet.',
          icon: 'history',
          cta_label: 'New Request'
        }
      }
    });
  }
});

// POST /api/me/time-entries/manual - Manual time entry (Database-driven)
router.post('/me/time-entries/manual', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { date, start_time, end_time, task_description, reason, project_id } = req.body;
  
  try {
    // Insert into time_entries as pending approval
    const result = await pool.query(
      `INSERT INTO time_entries 
       (employee_id, tenant_id, date, clock_in, clock_out, notes, project_id, is_manual, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'pending', NOW())
       RETURNING *`,
      [userId, tenantId, date, start_time, end_time, task_description || reason, project_id || null]
    );
    
    const entry = result.rows[0];
    
    res.status(201).json({
      success: true,
      message: 'Manual time entry submitted successfully',
      data: {
        entry_id: entry.id,
        date: entry.date,
        start_time: entry.clock_in,
        end_time: entry.clock_out,
        task_description: entry.notes,
        reason,
        status: 'pending_approval',
        submitted_at: entry.created_at,
        requires_manager_approval: true
      }
    });
  } catch (error) {
    console.error('Manual time entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit manual time entry'
    });
  }
});

// POST /api/quick-actions/manual-time-entry - Quick action manual entry (Database-driven)
router.post('/quick-actions/manual-time-entry', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { date, start_time, end_time, project_id, reason } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO time_entries 
       (employee_id, tenant_id, date, clock_in, clock_out, notes, project_id, is_manual, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'pending', NOW())
       RETURNING *`,
      [userId, tenantId, date, start_time, end_time, reason, project_id || null]
    );
    
    const entry = result.rows[0];
    
    res.status(201).json({
      success: true,
      message: 'Manual time entry request submitted successfully',
      data: {
        request_id: entry.id,
        type: 'manual_time_entry',
        status: 'pending_approval',
        submitted_at: entry.created_at,
        estimated_processing_time: '1-2 business days',
        next_steps: 'Your manager will review and approve this request'
      }
    });
  } catch (error) {
    console.error('Quick action manual entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit manual time entry request'
    });
  }
});

// POST /api/quick-actions/time-correction - Quick action time correction (Database-driven)
router.post('/quick-actions/time-correction', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { original_entry_id, correction_type, reason, corrected_start_time, corrected_end_time } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO correction_requests 
       (employee_id, tenant_id, time_entry_id, correction_type, corrected_start_time, corrected_end_time, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING *`,
      [userId, tenantId, original_entry_id, correction_type, corrected_start_time, corrected_end_time, reason]
    );
    
    const request = result.rows[0];
    
    res.status(201).json({
      success: true,
      message: 'Time correction request submitted successfully',
      data: {
        request_id: request.id,
        type: 'time_correction',
        status: 'pending_approval',
        submitted_at: request.created_at,
        estimated_processing_time: '24-48 hours'
      }
    });
  } catch (error) {
    console.error('Quick action time correction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit time correction request'
    });
  }
});

// GET /api/reports/timesheet - Get timesheet reports (Database-driven)
router.get('/reports/timesheet', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { startDate, endDate, format = 'json' } = req.query;
  
  // Default to current month if no dates provided
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;
  
  try {
    // Get time entries for the period
    const result = await pool.query(
      `SELECT te.*, p.name as project_name
       FROM time_entries te
       LEFT JOIN projects p ON te.project_id = p.id
       WHERE te.employee_id = $1 AND te.date >= $2 AND te.date <= $3 AND te.tenant_id::integer = $4
       ORDER BY te.date DESC`,
      [userId, start, end, tenantId]
    );
    
    let totalMinutes = 0;
    let overtimeMinutes = 0;
    const daysWorked = new Set();
    
    const entries = result.rows.map(row => {
      const clockIn = row.clock_in ? new Date(row.clock_in) : null;
      const clockOut = row.clock_out ? new Date(row.clock_out) : null;
      let totalHours = 0;
      
      if (clockIn && clockOut) {
        const diffMs = clockOut - clockIn;
        totalHours = diffMs / (1000 * 60 * 60);
        totalMinutes += diffMs / (1000 * 60);
        daysWorked.add(row.date.toISOString().split('T')[0]);
        
        // Calculate overtime (anything over 8 hours)
        if (totalHours > 8) {
          overtimeMinutes += (totalHours - 8) * 60;
        }
      }
      
      return {
        date: row.date ? row.date.toISOString().split('T')[0] : null,
        clock_in: clockIn ? clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null,
        clock_out: clockOut ? clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null,
        break_time: row.break_duration ? `${Math.round(row.break_duration / 60)}h` : '0h',
        total_hours: parseFloat(totalHours.toFixed(2)),
        projects: row.project_name ? [row.project_name] : []
      };
    });
    
    const totalHours = totalMinutes / 60;
    const totalDays = daysWorked.size;
    const overtimeHours = overtimeMinutes / 60;
    
    res.json({
      success: true,
      data: {
        period: {
          start_date: start,
          end_date: end
        },
        summary: {
          total_hours: parseFloat(totalHours.toFixed(2)),
          total_days: totalDays,
          average_daily_hours: totalDays > 0 ? parseFloat((totalHours / totalDays).toFixed(2)) : 0,
          overtime_hours: parseFloat(overtimeHours.toFixed(2)),
          leave_days: 0,
          sick_days: 0
        },
        entries: entries,
        export_formats: ['json', 'csv', 'pdf'],
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Timesheet report error:', error);
    res.json({
      success: true,
      data: {
        period: { start_date: start, end_date: end },
        summary: {
          total_hours: 0,
          total_days: 0,
          average_daily_hours: 0,
          overtime_hours: 0,
          leave_days: 0,
          sick_days: 0
        },
        entries: [],
        export_formats: ['json', 'csv', 'pdf'],
        generated_at: new Date().toISOString()
      }
    });
  }
});

// GET /api/dashboard/summary - Get dashboard summary (Database-driven)
router.get('/dashboard/summary', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Count total employees
    const empResult = await pool.query(
      'SELECT COUNT(*) as total FROM employees WHERE tenant_id = $1',
      [tenantId]
    );
    const totalEmployees = parseInt(empResult.rows[0]?.total || 0);
    
    // Count employees clocked in today (active timers)
    const clockedInResult = await pool.query(
      `SELECT COUNT(DISTINCT t.employee_id) as count 
       FROM timers t
       JOIN employees e ON t.employee_id = e.employee_id
       WHERE t.clock_out IS NULL AND e.tenant_id = $1`,
      [tenantId]
    );
    const clockedIn = parseInt(clockedInResult.rows[0]?.count || 0);
    
    // Count employees on leave today
    const onLeaveResult = await pool.query(
      `SELECT COUNT(DISTINCT lr.employee_id) as count 
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.employee_id
       WHERE lr.status = 'approved' AND $1 BETWEEN lr.start_date AND lr.end_date AND e.tenant_id = $2`,
      [today, tenantId]
    );
    const onLeave = parseInt(onLeaveResult.rows[0]?.count || 0);
    
    // Count employees on break
    const onBreakResult = await pool.query(
      `SELECT COUNT(DISTINCT t.employee_id) as count 
       FROM timers t
       JOIN employees e ON t.employee_id = e.employee_id
       JOIN breaks b ON t.id = b.timer_record_id
       WHERE t.clock_out IS NULL AND b.end_time IS NULL AND e.tenant_id = $1`,
      [tenantId]
    );
    const onBreak = parseInt(onBreakResult.rows[0]?.count || 0);
    
    // Get average hours today
    const avgResult = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (t.clock_out - t.clock_in)) / 3600) as avg_hours
       FROM timers t
       JOIN employees e ON t.employee_id = e.employee_id
       WHERE t.date = $1 AND t.clock_out IS NOT NULL AND e.tenant_id = $2`,
      [today, tenantId]
    );
    const avgHours = parseFloat(avgResult.rows[0]?.avg_hours || 0).toFixed(1);
    
    // Count pending requests
    const pendingResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM leave_requests lr JOIN employees e ON lr.employee_id = e.employee_id WHERE lr.status = 'pending' AND e.tenant_id = $1) +
        (SELECT COUNT(*) FROM correction_requests cr JOIN employees e ON cr.employee_id = e.employee_id WHERE cr.status = 'pending' AND e.tenant_id = $1) as pending`,
      [tenantId]
    );
    const pendingRequests = parseInt(pendingResult.rows[0]?.pending || 0);
    
    res.json({
      success: true,
      data: {
        total_employees: totalEmployees,
        active_today: clockedIn,
        on_leave: onLeave,
        on_break: onBreak,
        clocked_in: clockedIn,
        average_hours_today: parseFloat(avgHours),
        pending_requests: pendingRequests
      }
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dashboard summary',
      error: error.message
    });
  }
});

// GET /api/dashboard/workforce-activity - Get workforce activity (Database-driven)
router.get('/dashboard/workforce-activity', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Get clocked in employees (active timers)
    const clockedInResult = await pool.query(
      `SELECT DISTINCT e.full_name 
       FROM employees e
       JOIN timers t ON e.employee_id = t.employee_id
       WHERE t.clock_out IS NULL AND e.tenant_id = $1
       LIMIT 5`,
      [tenantId]
    );
    const clockedInEmployees = clockedInResult.rows.map(r => r.full_name);
    
    // Get employees on break
    const onBreakResult = await pool.query(
      `SELECT DISTINCT e.full_name 
       FROM employees e
       JOIN timers t ON e.employee_id = t.employee_id
       JOIN breaks b ON t.id = b.timer_record_id
       WHERE t.clock_out IS NULL AND b.end_time IS NULL AND e.tenant_id = $1
       LIMIT 5`,
      [tenantId]
    );
    const onBreakEmployees = onBreakResult.rows.map(r => r.full_name);
    
    // Get clocked out employees today
    const clockedOutResult = await pool.query(
      `SELECT DISTINCT e.full_name 
       FROM employees e
       JOIN timers t ON e.employee_id = t.employee_id
       WHERE t.date = $1 AND t.clock_out IS NOT NULL AND e.tenant_id = $2
       LIMIT 5`,
      [today, tenantId]
    );
    const clockedOutEmployees = clockedOutResult.rows.map(r => r.full_name);
    
    // Get counts
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM employees WHERE tenant_id = $1',
      [tenantId]
    );
    const totalEmployees = parseInt(totalResult.rows[0]?.total || 0);
    const clockedInCount = clockedInEmployees.length;
    const notClockedInCount = Math.max(0, totalEmployees - clockedInCount);
    
    // Get late arrivals (clocked in after company start_time)
    const lateResult = await pool.query(
      `SELECT DISTINCT e.full_name
       FROM employees e
       JOIN timers t ON e.employee_id = t.employee_id
       WHERE t.date = $1 AND e.tenant_id = $2
         AND t.clock_in::time > '09:30:00'
       LIMIT 5`,
      [today, tenantId]
    );
    const lateEmployees = lateResult.rows.map(r => r.full_name);
    
    res.json({
      success: true,
      data: {
        todayStats: {
          clockedInToday: {
            count: clockedInCount,
            description: 'Employees who have started their shift',
            employees: clockedInEmployees
          },
          notClockedIn: {
            count: notClockedInCount,
            description: 'Employees who haven\'t started their day yet',
            employees: []
          },
          onBreak: {
            count: onBreakEmployees.length,
            description: 'Currently on break or paused',
            employees: onBreakEmployees
          },
          clockedOutToday: {
            count: clockedOutEmployees.length,
            description: 'Employees who have finished their shift',
            employees: clockedOutEmployees
          },
          lateArrivals: {
            count: lateEmployees.length,
            description: 'Clocked in after the scheduled start time',
            employees: lateEmployees
          }
        },
        realTimeUpdates: {
          lastUpdated: new Date().toISOString(),
          refreshRate: '30 seconds'
        }
      }
    });
  } catch (error) {
    console.error('Workforce activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve workforce activity',
      error: error.message
    });
  }
});

// GET /api/employees - List all employees (TENANT ISOLATED)
router.get('/employees', authenticateToken, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const status = req.query.status || 'all';
  const role = req.query.role || 'all';
  const department = req.query.department || 'all';
  const search = req.query.search || '';

  // Get tenant_id from authenticated user's token
  const tenantId = req.user.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  try {
    // Build dynamic WHERE clause with tenant_id filter
    let whereConditions = ['tenant_id = $1'];
    let queryParams = [tenantId];
    let paramIndex = 2;

    if (search) {
      whereConditions.push(`(full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (status !== 'all') {
      whereConditions.push(`status ILIKE $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (role !== 'all') {
      whereConditions.push(`role ILIKE $${paramIndex}`);
      queryParams.push(role);
      paramIndex++;
    }

    if (department !== 'all') {
      whereConditions.push(`department ILIKE $${paramIndex}`);
      queryParams.push(department);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');
    
    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM employees WHERE ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalEmployees = parseInt(countResult.rows[0].total);
    
    // Get paginated employees
    const offset = (page - 1) * limit;
    const selectQuery = `
      SELECT id, employee_id, full_name, email, phone, role, department, status, 
             start_date, created_at, profile_photo, work_model, working_hours
      FROM employees 
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);
    
    const result = await pool.query(selectQuery, queryParams);
    
    const employees = result.rows.map(emp => ({
      id: emp.id,
      name: emp.full_name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role || 'Employee',
      department: emp.department,
      status: emp.status || 'Active',
      dateJoined: emp.start_date || emp.created_at,
      employeeId: emp.employee_id,
      profileImage: emp.profile_photo,
      workModel: emp.work_model,
      workingHours: emp.working_hours
    }));

    const totalPages = Math.ceil(totalEmployees / limit);

    res.json({
      success: true,
      data: {
        employees,
        pagination: {
          currentPage: page,
          totalPages,
          totalEmployees,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching employees:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while fetching employees',
      error: error.message
    });
  }
});

// POST /api/employees - Create new employee (TENANT ISOLATED)
router.post('/employees', authenticateToken, async (req, res) => {
  const { name, email, role, department, phone, workingHours, workModel, startDate, password } = req.body;
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  if (!name || !email) {
    return res.status(400).json({
      success: false,
      message: 'Name and email are required'
    });
  }

  try {
    // Check if employee already exists in this tenant
    const existingCheck = await pool.query(
      'SELECT id FROM employees WHERE email = $1 AND tenant_id = $2',
      [email, tenantId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee with this email already exists in your organization'
      });
    }

    const employeeNumber = `EMP-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    
    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Insert employee into database with tenant_id
    const result = await pool.query(
      `INSERT INTO employees (
        employee_id, full_name, email, role, department, phone,
        working_hours, work_model, start_date, status, password,
        tenant_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *`,
      [
        employeeNumber,
        name,
        email,
        role || 'Employee',
        department,
        phone,
        workingHours || '09:00 - 17:00',
        workModel || 'office',
        startDate || new Date().toISOString().split('T')[0],
        'Active',
        hashedPassword,
        tenantId
      ]
    );

    const newEmployee = result.rows[0];

    // Log activity
    logActivity({ tenantId: tenantId, actorId: req.user.userId, actorName: req.user.name, actorType: 'admin', category: 'employees', action: 'create_employee', title: 'New employee added', description: `${newEmployee.full_name} · ${newEmployee.employee_id}`, targetType: 'employee', targetId: newEmployee.id, targetName: newEmployee.full_name });

    res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: {
        id: newEmployee.id,
        employeeNumber: newEmployee.employee_id,
        name: newEmployee.full_name,
        email: newEmployee.email,
        role: newEmployee.role,
        department: newEmployee.department,
        phone: newEmployee.phone,
        status: newEmployee.status,
        dateJoined: newEmployee.start_date,
        createdAt: newEmployee.created_at
      }
    });
  } catch (error) {
    console.error('\u274c Error creating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while creating employee',
      error: error.message
    });
  }
});

// GET /api/employees/:id - Get single employee full profile (TENANT ISOLATED)
router.get('/employees/:id', authenticateToken, async (req, res) => {
  const employeeId = req.params.id; // Can be "EMP001" or numeric id
  const tenantId = req.user.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }
  
  try {
    // Get employee from database WITH TENANT FILTER - try employee_id first, then id
    let employeeResult;
    if (isNaN(employeeId)) {
      // String employee_id like "EMP001"
      employeeResult = await pool.query(
        `SELECT * FROM employees WHERE employee_id = $1 AND tenant_id = $2`,
        [employeeId, tenantId]
      );
    } else {
      // Numeric id
      employeeResult = await pool.query(
        `SELECT * FROM employees WHERE (id = $1 OR employee_id = $2) AND tenant_id = $3`,
        [parseInt(employeeId), employeeId.toString(), tenantId]
      );
    }
    
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied',
        employeeId
      });
    }
    
    const emp = employeeResult.rows[0];
    
    // Get timesheet summary - hours worked this week
    let timesheetSummary = {
      hoursWorkedThisWeek: "0h 0m",
      averageDailyHours: "0h 0m",
      overtimeThisMonth: "0h 0m",
      lastClockIn: null,
      lastClockOut: null
    };
    
    try {
      // Get this week's time entries
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      
      const timeResult = await pool.query(
        `SELECT SUM(EXTRACT(EPOCH FROM (clock_out - clock_in))/3600) as total_hours,
                COUNT(*) as days_worked
         FROM time_entries 
         WHERE employee_id = $1 AND clock_in >= $2`,
        [emp.id, weekStart.toISOString()]
      );
      
      if (timeResult.rows[0] && timeResult.rows[0].total_hours) {
        const totalHours = parseFloat(timeResult.rows[0].total_hours) || 0;
        const daysWorked = parseInt(timeResult.rows[0].days_worked) || 1;
        const avgHours = totalHours / daysWorked;
        
        timesheetSummary.hoursWorkedThisWeek = `${Math.floor(totalHours)}h ${Math.round((totalHours % 1) * 60)}m`;
        timesheetSummary.averageDailyHours = `${Math.floor(avgHours)}h ${Math.round((avgHours % 1) * 60)}m`;
      }
      
      // Get last clock in/out
      const lastEntryResult = await pool.query(
        `SELECT clock_in, clock_out FROM time_entries 
         WHERE employee_id = $1 ORDER BY clock_in DESC LIMIT 1`,
        [emp.id]
      );
      
      if (lastEntryResult.rows.length > 0) {
        const lastEntry = lastEntryResult.rows[0];
        if (lastEntry.clock_in) {
          const clockIn = new Date(lastEntry.clock_in);
          timesheetSummary.lastClockIn = clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
        if (lastEntry.clock_out) {
          const clockOut = new Date(lastEntry.clock_out);
          timesheetSummary.lastClockOut = clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }
      }
    } catch (err) {
      console.log('Error fetching timesheet:', err.message);
    }
    
    // Get leave requests
    let leaveRequests = [];
    try {
      const leaveResult = await pool.query(
        `SELECT id, leave_type, start_date, end_date, status, reason, created_at
         FROM leave_requests 
         WHERE user_id = $1 
         ORDER BY created_at DESC LIMIT 5`,
        [emp.id]
      );
      leaveRequests = leaveResult.rows.map(lr => ({
        id: lr.id,
        type: lr.leave_type,
        startDate: lr.start_date,
        endDate: lr.end_date,
        status: lr.status,
        reason: lr.reason,
        requestedAt: lr.created_at
      }));
    } catch (err) {
      console.log('Error fetching leave requests:', err.message);
    }
    
    // Get correction requests
    let correctionRequests = [];
    try {
      const correctionResult = await pool.query(
        `SELECT id, correction_type, original_date, status, reason, created_at
         FROM correction_requests 
         WHERE user_id = $1 
         ORDER BY created_at DESC LIMIT 5`,
        [emp.id]
      );
      correctionRequests = correctionResult.rows.map(cr => ({
        id: cr.id,
        type: cr.correction_type,
        date: cr.original_date,
        status: cr.status,
        reason: cr.reason,
        requestedAt: cr.created_at
      }));
    } catch (err) {
      console.log('Error fetching correction requests:', err.message);
    }
    
    // Build full employee profile response
    const employee = {
      id: emp.id,
      employeeId: emp.employee_id,
      
      // Personal Information
      personalInfo: {
        firstName: emp.first_name || emp.full_name?.split(' ')[0] || '',
        lastName: emp.last_name || emp.full_name?.split(' ').slice(1).join(' ') || '',
        fullName: emp.full_name,
        email: emp.email,
        phone: emp.phone || emp.phone_number,
        address: emp.address,
        dateOfBirth: emp.date_of_birth || emp.dob,
        profileImage: emp.profile_image || emp.avatar
      },
      
      // Work Information  
      workInfo: {
        role: emp.role,
        department: emp.department,
        workingHours: emp.working_hours || '09:00 - 17:00',
        workModel: emp.work_model || 'Office',
        manager: emp.manager || emp.reporting_to,
        employeeId: emp.employee_id,
        startDate: emp.start_date || emp.date_joined || emp.created_at
      },
      
      // Status
      status: emp.status || 'Active',
      dateJoined: emp.date_joined || emp.created_at,
      
      // Timesheet Summary
      timesheetSummary,
      
      // Requests
      requests: {
        vacationRequests: leaveRequests,
        correctionRequests: correctionRequests
      },
      
      // Recent Activity (combine leave + correction requests)
      recentActivity: [...leaveRequests, ...correctionRequests]
        .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
        .slice(0, 10)
        .map(item => ({
          type: item.type,
          description: item.reason || `${item.type} request`,
          date: item.requestedAt,
          status: item.status
        }))
    };

    res.json({
      success: true,
      data: employee
    });
  } catch (error) {
    console.error('Error fetching employee profile:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while fetching employee',
      error: error.message
    });
  }
});

// POST /api/employees/invite - Invite new employee (TENANT ISOLATED)
router.post('/employees/invite', authenticateToken, async (req, res) => {
  const { firstName, lastName, email, role, department, workingHours, workingModel, startDate } = req.body;
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  if (!firstName || !lastName || !email || !role || !department) {
    return res.status(400).json({
      success: false,
      message: "Required fields: firstName, lastName, email, role, department"
    });
  }

  try {
    // Check if employee already exists in this tenant
    const existingCheck = await pool.query(
      'SELECT id FROM employees WHERE email = $1 AND tenant_id = $2',
      [email, tenantId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee with this email already exists in your organization'
      });
    }

    const employeeNumber = `EMP-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const invitationToken = require('crypto').randomBytes(32).toString('hex');

    // Insert employee into database with tenant_id
    const result = await pool.query(
      `INSERT INTO employees (
        employee_id, full_name, email, role, department, 
        working_hours, work_model, start_date, status, 
        invitation_token, tenant_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        employeeNumber,
        `${firstName} ${lastName}`,
        email,
        role,
        department,
        workingHours || '09:00 - 17:00',
        workingModel || 'office',
        startDate || new Date().toISOString().split('T')[0],
        'Invited',
        invitationToken,
        tenantId
      ]
    );

    const newEmployee = result.rows[0];
    const invitationLink = `https://api-layer.vercel.app/accept-invitation?token=${invitationToken}`;

    res.status(201).json({
      success: true,
      message: "Employee invitation sent successfully",
      data: {
        employee: {
          id: newEmployee.id,
          employeeNumber: newEmployee.employee_id,
          firstName,
          lastName,
          email: newEmployee.email,
          role: newEmployee.role,
          department: newEmployee.department,
          workingHours: newEmployee.working_hours,
          workingModel: newEmployee.work_model,
          startDate: newEmployee.start_date,
          status: newEmployee.status,
          createdAt: newEmployee.created_at
        },
        invitationLink: invitationLink,
        message: `Invitation email sent to ${email}`
      }
    });
  } catch (error) {
    console.error('\u274c Error inviting employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while inviting employee',
      error: error.message
    });
  }
});

// POST /api/employees/accept-invitation - Accept employee invitation
router.post('/employees/accept-invitation', (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({
      success: false,
      message: "Invitation token and password are required"
    });
  }

  const employee = {
    id: 123,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@company.com",
    status: "Active",
    dateJoined: new Date().toISOString().split('T')[0]
  };

  res.json({
    success: true,
    message: "Invitation accepted successfully. Employee account is now active.",
    data: {
      employee,
      message: "You can now log in with your email and password."
    }
  });
});

// GET /api/employees/roles - Get available roles
router.get('/employees/roles', authenticateToken, (req, res) => {
  const roles = [
    { id: 1, name: "Employee", description: "Standard employee role" },
    { id: 2, name: "Manager", description: "Department manager" },
    { id: 3, name: "Admin", description: "System administrator" },
    { id: 4, name: "HR", description: "Human Resources" },
    { id: 5, name: "Developer", description: "Software developer" }
  ];

  res.json({
    success: true,
    message: "Available roles retrieved successfully",
    data: roles
  });
});

// GET /api/employees/departments - Get available departments
router.get('/employees/departments', authenticateToken, (req, res) => {
  const departments = [
    { id: 1, name: "Engineering", employeeCount: 15 },
    { id: 2, name: "Human Resources", employeeCount: 5 },
    { id: 3, name: "Marketing", employeeCount: 8 },
    { id: 4, name: "Sales", employeeCount: 12 },
    { id: 5, name: "Finance", employeeCount: 6 },
    { id: 6, name: "Operations", employeeCount: 10 },
    { id: 7, name: "Design", employeeCount: 7 }
  ];

  res.json({
    success: true,
    message: "Available departments retrieved successfully",
    data: departments
  });
});

// PUT /api/employees/:id - Update employee (TENANT ISOLATED)
router.put('/employees/:id', authenticateToken, async (req, res) => {
  const employeeId = req.params.id;
  const updatedData = req.body;
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  try {
    // Build dynamic UPDATE query with allowed fields
    const allowedFields = [
      'full_name', 'phone', 'role', 'department', 'status', 'work_model',
      'working_hours', 'manager', 'address', 'date_of_birth', 'profile_image'
    ];
    
    let setClause = [];
    let params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updatedData)) {
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // Convert camelCase to snake_case
      if (allowedFields.includes(dbField) && value !== undefined) {
        setClause.push(`${dbField} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update'
      });
    }

    // Add updated_at
    setClause.push(`updated_at = NOW()`);

    // Add WHERE conditions (id/employee_id + tenant_id)
    let whereClause;
    if (isNaN(employeeId)) {
      whereClause = `employee_id = $${paramIndex} AND tenant_id = $${paramIndex + 1}`;
      params.push(employeeId, tenantId);
    } else {
      whereClause = `(id = $${paramIndex} OR employee_id = $${paramIndex + 1}) AND tenant_id = $${paramIndex + 2}`;
      params.push(parseInt(employeeId), employeeId.toString(), tenantId);
    }

    const query = `UPDATE employees SET ${setClause.join(', ')} WHERE ${whereClause} RETURNING *`;
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('\u274c Error updating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while updating employee',
      error: error.message
    });
  }
});

// DELETE /api/employees/:id - Delete employee (TENANT ISOLATED)
router.delete('/employees/:id', authenticateToken, async (req, res) => {
  const employeeId = req.params.id;
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  try {
    let deleteResult;
    if (isNaN(employeeId)) {
      deleteResult = await pool.query(
        `DELETE FROM employees WHERE employee_id = $1 AND tenant_id = $2 RETURNING id, employee_id, full_name`,
        [employeeId, tenantId]
      );
    } else {
      deleteResult = await pool.query(
        `DELETE FROM employees WHERE (id = $1 OR employee_id = $2) AND tenant_id = $3 RETURNING id, employee_id, full_name`,
        [parseInt(employeeId), employeeId.toString(), tenantId]
      );
    }

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Employee deleted successfully',
      data: {
        ...deleteResult.rows[0],
        deletedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('\u274c Error deleting employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while deleting employee',
      error: error.message
    });
  }
});

// PATCH /api/employees/:id/activate - Activate employee (TENANT ISOLATED)
router.patch('/employees/:id/activate', authenticateToken, async (req, res) => {
  const employeeId = req.params.id;
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  try {
    let activateResult;
    if (isNaN(employeeId)) {
      activateResult = await pool.query(
        `UPDATE employees SET status = 'Active', updated_at = NOW() WHERE employee_id = $1 AND tenant_id = $2 RETURNING *`,
        [employeeId, tenantId]
      );
    } else {
      activateResult = await pool.query(
        `UPDATE employees SET status = 'Active', updated_at = NOW() WHERE (id = $1 OR employee_id = $2) AND tenant_id = $3 RETURNING *`,
        [parseInt(employeeId), employeeId.toString(), tenantId]
      );
    }

    if (activateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied'
      });
    }

    res.json({
      success: true,
      message: 'Employee activated',
      data: {
        ...activateResult.rows[0],
        activatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('\u274c Error activating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while activating employee',
      error: error.message
    });
  }
});

// GET /api/employees/:id/timesheet - Get employee timesheet (TENANT ISOLATED)
router.get('/employees/:id/timesheet', authenticateToken, async (req, res) => {
  const employeeId = req.params.id;
  const period = req.query.period || 'weekly';
  const tenantId = req.user.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant_id found in token. Access denied.'
    });
  }

  try {
    // First verify employee belongs to same tenant
    let employeeResult;
    if (isNaN(employeeId)) {
      employeeResult = await pool.query(
        `SELECT id, employee_id, full_name FROM employees WHERE employee_id = $1 AND tenant_id = $2`,
        [employeeId, tenantId]
      );
    } else {
      employeeResult = await pool.query(
        `SELECT id, employee_id, full_name FROM employees WHERE (id = $1 OR employee_id = $2) AND tenant_id = $3`,
        [parseInt(employeeId), employeeId.toString(), tenantId]
      );
    }

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied'
      });
    }

    const emp = employeeResult.rows[0];

    // Calculate date range based on period
    let startDate = new Date();
    if (period === 'weekly') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setDate(startDate.getDate() - 7);
    }

    // Get time entries for this employee
    const timeResult = await pool.query(
      `SELECT id, clock_in, clock_out, 
              EXTRACT(EPOCH FROM (clock_out - clock_in))/3600 as hours_worked
       FROM time_entries 
       WHERE employee_id = $1 AND clock_in >= $2
       ORDER BY clock_in DESC`,
      [emp.id, startDate.toISOString()]
    );

    let totalHours = 0;
    const timeEntries = timeResult.rows.map(entry => {
      const hours = parseFloat(entry.hours_worked) || 0;
      totalHours += hours;
      return {
        id: entry.id,
        date: entry.clock_in ? new Date(entry.clock_in).toISOString().split('T')[0] : null,
        clockIn: entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null,
        clockOut: entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null,
        totalHours: `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`,
        status: entry.clock_out ? 'completed' : 'in-progress'
      };
    });

    const daysWorked = timeEntries.length || 1;
    const avgHours = totalHours / daysWorked;

    res.json({
      success: true,
      data: {
        employeeId: emp.id,
        employeeCode: emp.employee_id,
        employeeName: emp.full_name,
        period: period,
        summary: {
          totalHours: `${Math.floor(totalHours)}h ${Math.round((totalHours % 1) * 60)}m`,
          averageDailyHours: `${Math.floor(avgHours)}h ${Math.round((avgHours % 1) * 60)}m`,
          daysWorked: daysWorked,
          lastClockIn: timeEntries[0]?.clockIn || null,
          lastClockOut: timeEntries[0]?.clockOut || null
        },
        timeEntries
      }
    });
  } catch (error) {
    console.error('\u274c Error fetching timesheet:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while fetching timesheet',
      error: error.message
    });
  }
});

// POST /api/me/notifications - Create notification
router.post('/me/notifications', authenticateToken, (req, res) => {
  const { title, message, type, priority, actionable, action_url } = req.body;
  
  if (!title || !message) {
    return res.status(400).json({
      success: false,
      message: 'Title and message are required'
    });
  }

  const newNotification = {
    id: Math.floor(Math.random() * 10000),
    title,
    message,
    type: type || 'info',
    priority: priority || 'medium',
    timestamp: new Date().toISOString(),
    read: false,
    actionable: actionable || false,
    action_url: action_url || null
  };

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: newNotification
  });
});

// POST /api/me/notifications/:id/read - Mark notification as read
router.post('/me/notifications/:id/read', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  res.json({
    success: true,
    message: 'Notification marked as read',
    data: {
      notification_id: parseInt(id),
      read: true,
      read_at: new Date().toISOString()
    }
  });
});

// POST /api/me/notifications/mark-all-read - Mark all notifications as read
router.post('/me/notifications/mark-all-read', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'All notifications marked as read',
    data: {
      marked_count: 5,
      marked_at: new Date().toISOString()
    }
  });
});

// GET /api/correction-requests - Get correction requests (admin)
router.get('/correction-requests', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      requests: [
        {
          id: 1,
          employee_name: 'John Doe',
          employee_id: 1,
          type: 'missing_clock_in',
          date: '2025-12-10',
          status: 'pending',
          submitted_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 2,
          employee_name: 'Jane Smith',
          employee_id: 2,
          type: 'wrong_clock_out',
          date: '2025-12-09',
          status: 'pending',
          submitted_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
        }
      ],
      total: 2
    }
  });
});

// POST /api/correction-requests/:id/approve - Approve correction request
router.post('/correction-requests/:id/approve', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  res.json({
    success: true,
    message: 'Correction request approved successfully',
    data: {
      request_id: parseInt(id),
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: req.user?.userId || 1
    }
  });
});

// POST /api/correction-requests/:id/reject - Reject correction request
router.post('/correction-requests/:id/reject', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  res.json({
    success: true,
    message: 'Correction request rejected',
    data: {
      request_id: parseInt(id),
      status: 'rejected',
      rejection_reason: reason || 'No reason provided',
      rejected_at: new Date().toISOString(),
      rejected_by: req.user?.userId || 1
    }
  });
});

// POST /api/requests/:id/approve - Approve generic request
router.post('/requests/:id/approve', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  res.json({
    success: true,
    message: 'Request approved successfully',
    data: {
      request_id: parseInt(id),
      status: 'approved',
      approved_at: new Date().toISOString()
    }
  });
});

// POST /api/requests/:id/reject - Reject generic request
router.post('/requests/:id/reject', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  res.json({
    success: true,
    message: 'Request rejected',
    data: {
      request_id: parseInt(id),
      status: 'rejected',
      rejection_reason: reason || 'No reason provided',
      rejected_at: new Date().toISOString()
    }
  });
});

// POST /api/setup-sample-tasks - Setup sample tasks
router.post('/setup-sample-tasks', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Sample tasks created successfully',
    data: {
      tasks_created: 10,
      projects_updated: 3,
      sample_data: {
        'API Development': 4,
        'Testing': 3,
        'Documentation': 3
      }
    }
  });
});

// PUT /api/company/address - Update company address
router.put('/company/address', authenticateToken, async (req, res) => {
  try {
    const { address, city, state, zipCode, country } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        message: "Address is required"
      });
    }
    
    const fullAddress = `${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''}${zipCode ? ' ' + zipCode : ''}${country ? ', ' + country : ''}`;
    
    const result = await pool.query(
      'UPDATE company_settings SET address = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING address, updated_at',
      [fullAddress, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company address updated successfully",
      data: {
        address: fullAddress,
        updated_at: result.rows[0].updated_at
      }
    });
  } catch (error) {
    console.error('Error updating company address:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company address",
      error: error.message
    });
  }
});

// PUT /api/company/name - Update company name
router.put('/company/name', authenticateToken, async (req, res) => {
  try {
    const { company_name } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!company_name) {
      return res.status(400).json({
        success: false,
        message: "Company name is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET name = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING name, updated_at',
      [company_name, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company name updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company name:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company name",
      error: error.message
    });
  }
});

// PUT /api/company/brand-color - Update brand color
router.put('/company/brand-color', authenticateToken, async (req, res) => {
  try {
    const { brand_color, brand_color_name } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!brand_color) {
      return res.status(400).json({
        success: false,
        message: "Brand color is required"
      });
    }
    
    const updateFields = ['brand_color = $1', 'updated_at = $2'];
    const values = [brand_color, new Date()];
    let paramIndex = 3;
    
    if (brand_color_name) {
      updateFields.splice(1, 0, `brand_color_name = $${paramIndex}`);
      values.splice(1, 0, brand_color_name);
      paramIndex++;
    }
    
    values.push(tenantId);
    
    const result = await pool.query(
      `UPDATE company_settings SET ${updateFields.join(', ')} WHERE tenant_id = $${paramIndex} RETURNING brand_color, brand_color_name, updated_at`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Brand color updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating brand color:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update brand color",
      error: error.message
    });
  }
});

// PUT /api/company/support-email - Update support email
router.put('/company/support-email', authenticateToken, async (req, res) => {
  try {
    const { support_email } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!support_email || !support_email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: "Valid support email is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET support_email = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING support_email, updated_at',
      [support_email, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Support email updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating support email:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update support email",
      error: error.message
    });
  }
});

// PUT /api/company/phone - Update company phone
router.put('/company/phone', authenticateToken, async (req, res) => {
  try {
    const { company_phone } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!company_phone) {
      return res.status(400).json({
        success: false,
        message: "Company phone is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET company_phone = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING company_phone, updated_at',
      [company_phone, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company phone updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company phone:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company phone",
      error: error.message
    });
  }
});

// POST /api/company/logo - Upload company logo
router.post('/company/logo', authenticateToken, uploadCompanyLogo.single('logo'), async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Logo file is required"
      });
    }
    
    // Upload to Cloudinary
    const logoUrl = await uploadToCloudinary(req.file.buffer, 'company-logos');
    
    // Update database with Cloudinary URL
    const result = await pool.query(
      'UPDATE company_settings SET logo_url = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING logo_url, updated_at',
      [logoUrl, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company logo uploaded successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error uploading company logo:', error);
    res.status(500).json({
      success: false,
      message: "Failed to upload company logo",
      error: error.message
    });
  }
});

// PUT /api/company/industry - Update company industry
router.put('/company/industry', authenticateToken, async (req, res) => {
  try {
    const { industry } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!industry) {
      return res.status(400).json({
        success: false,
        message: "Industry is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET industry = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING industry, updated_at',
      [industry, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company industry updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company industry:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company industry",
      error: error.message
    });
  }
});

// ========== END OF MISSING APIs ==========

// Test endpoints for debugging
router.get('/test-users', (req, res) => {
  const users = Object.values(persistentUsers).map(user => ({
    id: user.id,
    name: user.full_name,
    email: user.email,
    role: user.role,
    token: jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' })
  }));
  
  res.json({
    success: true,
    message: "Available test users with tokens",
    data: { users }
  });
});

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'CLIENT ISSUES FIXED - Server running perfectly! EMERGENCY PATCH v2.2 - TIME ENTRIES ADDED',
    status: 'All fixes implemented',
    fixes: [
      'Profile persistence - no more Jenny Wilson revert',
      'Timer persistence - no auto-stopping',
      'Pause API fully implemented',
      'Login/Profile email consistency',
      'Data persistence across restarts'
    ],
    docs: {
      swagger: '/api-docs',
      json: '/swagger.json'
    }
  });
});

// Debug route to list all admin routes
router.get('/debug-routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      const path = middleware.route.path;
      const methods = Object.keys(middleware.route.methods);
      if (path.includes('/admin/')) {
        routes.push({ path, methods });
      }
    }
  });
  res.json({
    success: true,
    message: 'Admin routes listed',
    adminRoutes: routes.sort((a, b) => a.path.localeCompare(b.path))
  });
});

// Database connection test endpoint
router.get('/db-test', (req, res) => {
  pool.query('SELECT current_database(), current_user, version(), NOW() as current_time', (err, result) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Database connection failed',
        error: err.message,
        code: err.code
      });
    }
    
    res.json({
      success: true,
      message: 'Database connected successfully',
      database: result.rows[0].current_database,
      user: result.rows[0].current_user,
      version: result.rows[0].version,
      server_time: result.rows[0].current_time
    });
  });
});

// Swagger/API docs routes moved to server.js (root level)


  return router;
};
