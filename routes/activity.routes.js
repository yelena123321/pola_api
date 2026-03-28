/**
 * activity Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== EMPLOYEE ACTIVITY UPDATES API =====
router.get('/me/activities', authenticateToken, (req, res) => {
  const userId = req.user?.userId || 1;
  const { limit = 20, type } = req.query;
  
  console.log(`📋 Activity log request for user ${userId}`);
  
  let activities = persistentActivities[userId] || [];
  
  if (type) {
    activities = activities.filter(a => a.type === type);
  }
  
  activities = activities.slice(0, parseInt(limit));
  
  const formattedActivities = activities.map(activity => {
    const timestamp = new Date(activity.timestamp);
    const seconds = Math.floor((new Date() - timestamp) / 1000);
    
    let timeAgo;
    if (seconds < 60) timeAgo = 'Just now';
    else if (seconds < 3600) timeAgo = `${Math.floor(seconds / 60)}m ago`;
    else if (seconds < 86400) timeAgo = `${Math.floor(seconds / 3600)}h ago`;
    else timeAgo = `${Math.floor(seconds / 86400)}d ago`;
    
    return {
      id: activity.id,
      type: activity.type,
      message: activity.message,
      time: timestamp.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      }),
      time_ago: timeAgo,
      timestamp: activity.timestamp,
      metadata: activity.metadata
    };
  });
  
  res.json({
    success: true,
    message: 'Activity log retrieved successfully',
    data: {
      activities: formattedActivities,
      total_count: (persistentActivities[userId] || []).length,
      showing: formattedActivities.length
    }
  });
});

// GET Weekly Work Summary
router.get('/me/work-summary/week', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user from database
    const userResult = await pool.query('SELECT first_name, last_name, email FROM employees WHERE id = $1', [userId]);
    const user = userResult.rows[0] || {
      first_name: req.user.name?.split(' ')[0] || 'User',
      last_name: req.user.name?.split(' ')[1] || '',
      email: req.user.email || 'user@example.com'
    };
    
    // Calculate week range (last 7 days)
    const endDate = new Date();
    const startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    
    // Query timers from database for the week
    const timersResult = await pool.query(`
      SELECT 
        DATE(t.clock_in) as work_date,
        COUNT(DISTINCT t.id) as session_count,
        SUM(
          EXTRACT(EPOCH FROM (COALESCE(t.clock_out, NOW()) - t.clock_in)) - 
          COALESCE(
            (SELECT SUM(b.duration_seconds) FROM breaks b WHERE b.timer_record_id = t.id),
            0
          )
        ) as total_seconds
      FROM timers t
      WHERE t.employee_id = $1 
        AND t.clock_in >= $2 
        AND t.clock_in <= $3
        AND t.clock_out IS NOT NULL
      GROUP BY DATE(t.clock_in)
      ORDER BY work_date
    `, [userId, startDate.toISOString(), endDate.toISOString()]);
    
    // Create daily breakdown for all 7 days
    const dailyBreakdown = [];
    let totalHours = 0;
    let daysActive = 0;
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const dayData = timersResult.rows.find(row => row.work_date === date);
      
      const hours = dayData ? parseFloat((dayData.total_seconds / 3600).toFixed(1)) : 0;
      const sessions = dayData ? parseInt(dayData.session_count) : 0;
      
      if (hours > 0) daysActive++;
      totalHours += hours;
      
      dailyBreakdown.push({
        date: date,
        hours: hours,
        sessions: sessions
      });
    }
    
    const averageDailyHours = daysActive > 0 ? parseFloat((totalHours / daysActive).toFixed(1)) : 0;
    const productivityScore = Math.min(100, Math.round((totalHours / (daysActive * 8)) * 100));
    
    const weeklyData = {
      user: {
        id: userId,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email
      },
      week_period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      total_hours_worked: parseFloat(totalHours.toFixed(1)),
      average_daily_hours: averageDailyHours,
      days_active: daysActive,
      productivity_score: productivityScore,
      daily_breakdown: dailyBreakdown
    };
    
    res.json({
      success: true,
      message: "Weekly work summary retrieved successfully",
      data: weeklyData
    });
  } catch (error) {
    console.error('❌ Weekly summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve weekly summary',
      error: error.message
    });
  }
});

// GET Weekly Work Summary (Alternative endpoint: /weekly)
router.get('/me/work-summary/weekly', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user from database
    const userResult = await pool.query('SELECT first_name, last_name, email FROM employees WHERE id = $1', [userId]);
    const user = userResult.rows[0] || {
      first_name: req.user.name?.split(' ')[0] || 'User',
      last_name: req.user.name?.split(' ')[1] || '',
      email: req.user.email || 'user@example.com'
    };
    
    // Calculate week range (last 7 days)
    const endDate = new Date();
    const startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    
    // Query timers from database for the week
    const timersResult = await pool.query(`
      SELECT 
        DATE(t.clock_in) as work_date,
        COUNT(DISTINCT t.id) as session_count,
        SUM(
          EXTRACT(EPOCH FROM (COALESCE(t.clock_out, NOW()) - t.clock_in)) - 
          COALESCE(
            (SELECT SUM(b.duration_seconds) FROM breaks b WHERE b.timer_record_id = t.id),
            0
          )
        ) as total_seconds
      FROM timers t
      WHERE t.employee_id = $1 
        AND t.clock_in >= $2 
        AND t.clock_in <= $3
        AND t.clock_out IS NOT NULL
      GROUP BY DATE(t.clock_in)
      ORDER BY work_date
    `, [userId, startDate.toISOString(), endDate.toISOString()]);
    
    // Create daily breakdown for all 7 days
    const dailyBreakdown = [];
    let totalHours = 0;
    let daysActive = 0;
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const dayData = timersResult.rows.find(row => row.work_date === date);
      
      const hours = dayData ? parseFloat((dayData.total_seconds / 3600).toFixed(1)) : 0;
      const sessions = dayData ? parseInt(dayData.session_count) : 0;
      
      if (hours > 0) daysActive++;
      totalHours += hours;
      
      dailyBreakdown.push({
        date: date,
        hours: hours,
        sessions: sessions
      });
    }
    
    const averageDailyHours = daysActive > 0 ? parseFloat((totalHours / daysActive).toFixed(1)) : 0;
    const productivityScore = Math.min(100, Math.round((totalHours / (daysActive * 8)) * 100));
    
    const weeklyData = {
      user: {
        id: userId,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email
      },
      week_period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      total_hours_worked: parseFloat(totalHours.toFixed(1)),
      average_daily_hours: averageDailyHours,
      days_active: daysActive,
      productivity_score: productivityScore,
      daily_breakdown: dailyBreakdown
    };
    
    res.json({
      success: true,
      message: "Weekly work summary retrieved successfully",
      data: weeklyData
    });
  } catch (error) {
    console.error('❌ Weekly summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve weekly summary',
      error: error.message
    });
  }
});

// GET Monthly Work Summary
router.get('/me/work-summary/month', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user from database
    const userResult = await pool.query('SELECT first_name, last_name, email FROM employees WHERE id = $1', [userId]);
    const user = userResult.rows[0] || {
      first_name: req.user.name?.split(' ')[0] || 'User',
      last_name: req.user.name?.split(' ')[1] || '',
      email: req.user.email || 'user@example.com'
    };
    
    // Calculate month range (current month)
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    // Query timers from database for the month
    const timersResult = await pool.query(`
      SELECT 
        DATE(t.clock_in) as work_date,
        COUNT(DISTINCT t.id) as session_count,
        SUM(
          EXTRACT(EPOCH FROM (COALESCE(t.clock_out, NOW()) - t.clock_in)) - 
          COALESCE(
            (SELECT SUM(b.duration_seconds) FROM breaks b WHERE b.timer_record_id = t.id),
            0
          )
        ) as total_seconds
      FROM timers t
      WHERE t.employee_id = $1 
        AND t.clock_in >= $2 
        AND t.clock_in <= $3
        AND t.clock_out IS NOT NULL
      GROUP BY DATE(t.clock_in)
      ORDER BY work_date
    `, [userId, startDate.toISOString(), endDate.toISOString()]);
    
    // Calculate totals
    let totalHours = 0;
    let daysActive = 0;
    
    timersResult.rows.forEach(row => {
      const hours = parseFloat((row.total_seconds / 3600).toFixed(1));
      if (hours > 0) daysActive++;
      totalHours += hours;
    });
    
    const averageDailyHours = daysActive > 0 ? parseFloat((totalHours / daysActive).toFixed(1)) : 0;
    const workingDaysInMonth = endDate.getDate();
    const expectedHours = workingDaysInMonth * 8; // 8 hours per day
    const completionPercentage = expectedHours > 0 ? Math.round((totalHours / expectedHours) * 100) : 0;
    
    // Calculate weekly breakdown
    const weeklyBreakdown = [];
    let currentWeek = 1;
    let weekStart = new Date(startDate);
    
    while (weekStart <= endDate) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      const weekData = timersResult.rows.filter(row => {
        const date = new Date(row.work_date);
        return date >= weekStart && date <= (weekEnd < endDate ? weekEnd : endDate);
      });
      
      const weekHours = weekData.reduce((sum, row) => sum + parseFloat((row.total_seconds / 3600).toFixed(1)), 0);
      const weekDays = weekData.length;
      
      weeklyBreakdown.push({
        week: currentWeek,
        hours: parseFloat(weekHours.toFixed(1)),
        days: weekDays
      });
      
      weekStart.setDate(weekStart.getDate() + 7);
      currentWeek++;
    }
    
    const monthlyData = {
      user: {
        id: userId,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email
      },
      month_period: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        month_name: now.toLocaleString('default', { month: 'long' })
      },
      total_hours_worked: parseFloat(totalHours.toFixed(1)),
      expected_hours: expectedHours,
      completion_percentage: completionPercentage,
      average_daily_hours: averageDailyHours,
      working_days: workingDaysInMonth,
      days_active: daysActive,
      productivity_metrics: {
        efficiency_score: Math.min(100, Math.round((totalHours / expectedHours) * 100)),
        goal_achievement: completionPercentage,
        consistency_score: Math.min(100, Math.round((daysActive / workingDaysInMonth) * 100))
      },
      weekly_breakdown: weeklyBreakdown
    };
    
    res.json({
      success: true,
      message: "Monthly work summary retrieved successfully", 
      data: monthlyData
    });
  } catch (error) {
    console.error('❌ Monthly summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve monthly summary',
      error: error.message
    });
  }
});


  return router;
};
