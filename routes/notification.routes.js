/**
 * notification Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

const DEFAULT_NOTIFICATION_SETTINGS = {
  break_reminder_after_minutes: 120,
  clock_out_reminder_after_hours: 10,
  extended_break_reminder_after_minutes: 30,
  notifications_enabled: true
};

// ===== CHECK NOTIFICATIONS (Polling Endpoint) =====
// Frontend should call this every 1-5 minutes
router.get('/me/notifications/check', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const notifications = [];
  
  try {
    // Get notification settings
    let settings = DEFAULT_NOTIFICATION_SETTINGS;
    try {
      const settingsResult = await pool.query('SELECT * FROM notification_settings WHERE id = 1');
      if (settingsResult.rows.length > 0) {
        settings = settingsResult.rows[0];
      }
    } catch (e) {
      // Use defaults if table doesn't exist
    }
    
    if (!settings.notifications_enabled) {
      return res.json({
        success: true,
        data: { notifications: [], count: 0 }
      });
    }
    
    // Check for active timer
    const timerResult = await pool.query(`
      SELECT id, clock_in, clock_out, date 
      FROM timers 
      WHERE employee_id = $1 AND clock_out IS NULL 
      ORDER BY clock_in DESC LIMIT 1
    `, [userId]);
    
    // Check for active break
    const breakResult = await pool.query(`
      SELECT break_id as id, start_time, break_type 
      FROM breaks 
      WHERE user_id = $1 AND end_time IS NULL 
      ORDER BY start_time DESC LIMIT 1
    `, [userId]);
    
    const now = new Date();
    
    // NOTIFICATION 1: Time for a Break
    if (timerResult.rows.length > 0 && breakResult.rows.length === 0) {
      const clockIn = new Date(timerResult.rows[0].clock_in);
      const workingMinutes = Math.floor((now - clockIn) / (1000 * 60));
      
      // Check if last break was taken
      const lastBreakResult = await pool.query(`
        SELECT end_time FROM breaks 
        WHERE user_id = $1 AND end_time IS NOT NULL 
        ORDER BY end_time DESC LIMIT 1
      `, [userId]);
      
      let minutesSinceLastBreak = workingMinutes;
      if (lastBreakResult.rows.length > 0) {
        const lastBreakEnd = new Date(lastBreakResult.rows[0].end_time);
        minutesSinceLastBreak = Math.floor((now - lastBreakEnd) / (1000 * 60));
      }
      
      if (minutesSinceLastBreak >= settings.break_reminder_after_minutes) {
        notifications.push({
          id: 'break_reminder',
          type: 'BREAK_REMINDER',
          title: 'Time for a Break',
          message: `You've been working for ${Math.floor(minutesSinceLastBreak / 60)} hours ${minutesSinceLastBreak % 60} minutes. Take a short break to stay productive!`,
          priority: 'medium',
          actions: [
            { id: 'take_break', label: 'Take a Break', action: 'TAKE_BREAK' },
            { id: 'later', label: 'Later', action: 'DISMISS' }
          ],
          data: {
            working_minutes: minutesSinceLastBreak,
            threshold_minutes: settings.break_reminder_after_minutes
          }
        });
      }
    }
    
    // NOTIFICATION 2: Did You Forget to Clock Out?
    if (timerResult.rows.length > 0) {
      const clockIn = new Date(timerResult.rows[0].clock_in);
      const workingHours = (now - clockIn) / (1000 * 60 * 60);
      
      if (workingHours >= settings.clock_out_reminder_after_hours) {
        notifications.push({
          id: 'clock_out_reminder',
          type: 'CLOCK_OUT_REMINDER',
          title: 'Did You Forget to Clock Out?',
          message: `You've been working for ${Math.floor(workingHours)} hours. Don't forget to stop your timer!`,
          priority: 'high',
          actions: [
            { id: 'stop', label: 'Stop', action: 'STOP_TIMER' },
            { id: 'later', label: 'Later', action: 'DISMISS' }
          ],
          data: {
            working_hours: Math.floor(workingHours),
            threshold_hours: settings.clock_out_reminder_after_hours,
            timer_id: timerResult.rows[0].id
          }
        });
      }
    }
    
    // NOTIFICATION 3: Still on Break?
    if (breakResult.rows.length > 0) {
      const breakStart = new Date(breakResult.rows[0].start_time);
      const breakMinutes = Math.floor((now - breakStart) / (1000 * 60));
      
      if (breakMinutes >= settings.extended_break_reminder_after_minutes) {
        notifications.push({
          id: 'extended_break_reminder',
          type: 'EXTENDED_BREAK_REMINDER',
          title: 'Still on Break?',
          message: `Your break has been ${breakMinutes} minutes. Ready to continue working?`,
          priority: 'medium',
          actions: [
            { id: 'continue_work', label: 'Continue Work', action: 'END_BREAK' },
            { id: 'stay_on_break', label: 'Stay on Break', action: 'DISMISS' }
          ],
          data: {
            break_minutes: breakMinutes,
            threshold_minutes: settings.extended_break_reminder_after_minutes,
            break_id: breakResult.rows[0].id,
            break_type: breakResult.rows[0].break_type
          }
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        notifications: notifications,
        count: notifications.length,
        checked_at: now.toISOString()
      }
    });
    
  } catch (error) {
    console.error('Notification check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check notifications',
      error: error.message
    });
  }
});

// ===== NOTIFICATION ACTION: Take a Break =====
router.post('/me/notifications/action/take-break', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { break_type } = req.body;
  
  try {
    // Start a break
    const result = await pool.query(`
      INSERT INTO breaks (user_id, break_type, start_time, created_at, timer_id)
      VALUES ($1, $2, NOW(), NOW(), 'notification-break')
      RETURNING break_id as id, break_type, start_time
    `, [userId, break_type || 'Short Break']);
    
    res.json({
      success: true,
      message: 'Break started',
      data: {
        break_id: result.rows[0].id,
        break_type: result.rows[0].break_type,
        start_time: result.rows[0].start_time,
        notification_dismissed: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to start break',
      error: error.message
    });
  }
});

// ===== NOTIFICATION ACTION: Stop Timer =====
router.post('/me/notifications/action/stop-timer', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // Find and stop active timer
    const timerResult = await pool.query(`
      UPDATE timers 
      SET clock_out = NOW(), 
          duration_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in))/60,
          updated_at = NOW()
      WHERE employee_id = $1 AND clock_out IS NULL
      RETURNING id, clock_in, clock_out, duration_minutes
    `, [userId]);
    
    if (timerResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active timer found'
      });
    }
    
    res.json({
      success: true,
      message: 'Timer stopped',
      data: {
        timer_id: timerResult.rows[0].id,
        clock_in: timerResult.rows[0].clock_in,
        clock_out: timerResult.rows[0].clock_out,
        duration_minutes: Math.round(timerResult.rows[0].duration_minutes),
        notification_dismissed: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to stop timer',
      error: error.message
    });
  }
});

// ===== NOTIFICATION ACTION: End Break (Continue Work) =====
router.post('/me/notifications/action/end-break', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // End active break
    const breakResult = await pool.query(`
      UPDATE breaks 
      SET end_time = NOW(), 
          duration = EXTRACT(EPOCH FROM (NOW() - start_time))
      WHERE user_id = $1 AND end_time IS NULL
      RETURNING break_id as id, start_time, end_time, duration, break_type
    `, [userId]);
    
    if (breakResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active break found'
      });
    }
    
    res.json({
      success: true,
      message: 'Break ended, work resumed',
      data: {
        break_id: breakResult.rows[0].id,
        break_type: breakResult.rows[0].break_type,
        duration_minutes: Math.round(breakResult.rows[0].duration_minutes),
        notification_dismissed: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to end break',
      error: error.message
    });
  }
});

// ===== NOTIFICATION ACTION: Dismiss =====
router.post('/me/notifications/dismiss', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { notification_id, dismiss_until_minutes } = req.body;
  
  // Store dismissed notification to not show again for X minutes
  // For simplicity, we just acknowledge it
  res.json({
    success: true,
    message: 'Notification dismissed',
    data: {
      notification_id: notification_id,
      dismissed_at: new Date().toISOString(),
      show_again_after: dismiss_until_minutes || 30
    }
  });
});

// ===== GET USER NOTIFICATION PREFERENCES =====
router.get('/me/notification-preferences', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const result = await pool.query(`
      SELECT * FROM user_notification_preferences WHERE user_id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          break_reminders: true,
          clock_out_reminders: true,
          extended_break_reminders: true,
          push_notifications: true,
          email_notifications: false
        }
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        break_reminders: true,
        clock_out_reminders: true,
        extended_break_reminders: true,
        push_notifications: true,
        email_notifications: false
      }
    });
  }
});

// ===== UPDATE USER NOTIFICATION PREFERENCES =====
router.put('/me/notification-preferences', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { 
    break_reminders, 
    clock_out_reminders, 
    extended_break_reminders,
    push_notifications,
    email_notifications 
  } = req.body;
  
  try {
    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES employees(id) UNIQUE,
        break_reminders BOOLEAN DEFAULT TRUE,
        clock_out_reminders BOOLEAN DEFAULT TRUE,
        extended_break_reminders BOOLEAN DEFAULT TRUE,
        push_notifications BOOLEAN DEFAULT TRUE,
        email_notifications BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      INSERT INTO user_notification_preferences (user_id, break_reminders, clock_out_reminders, extended_break_reminders, push_notifications, email_notifications, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        break_reminders = COALESCE($2, user_notification_preferences.break_reminders),
        clock_out_reminders = COALESCE($3, user_notification_preferences.clock_out_reminders),
        extended_break_reminders = COALESCE($4, user_notification_preferences.extended_break_reminders),
        push_notifications = COALESCE($5, user_notification_preferences.push_notifications),
        email_notifications = COALESCE($6, user_notification_preferences.email_notifications),
        updated_at = NOW()
    `, [userId, break_reminders, clock_out_reminders, extended_break_reminders, push_notifications, email_notifications]);
    
    res.json({
      success: true,
      message: 'Notification preferences updated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences',
      error: error.message
    });
  }
});

// =====================================================================================
// PUBLIC HOLIDAY MANAGEMENT APIs
// =====================================================================================
const PublicHoliday = require('../models/PublicHoliday');


  return router;
};
