/**
 * dashboard Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== ADMIN DASHBOARD API =====
// ===== USER DASHBOARD API (from index.js) =====
// GET /api/activity-log - Get activity log entries (admin, dynamic from DB, tenant isolated)
router.get('/activity-log', authenticateToken, async (req, res) => {
  try {
    const tenantId = parseInt(req.user.tenantId);
    // Read from activity_logs table (has tenant_id), fallback to activities table
    const result = await pool.query(`
      SELECT id, category as type, title, description as message, actor_name as user_name, 
             actor_type, action, target_type, target_name, metadata, ip_address, created_at
      FROM activity_logs
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [tenantId]);

    let activityLog = result.rows.map(row => ({
      id: row.id,
      type: row.type || 'system',
      title: row.title,
      message: row.message || row.action,
      user: row.user_name || '',
      actor_type: row.actor_type,
      action: row.action,
      target_type: row.target_type,
      target_name: row.target_name,
      metadata: row.metadata,
      ip_address: row.ip_address,
      created_at: row.created_at
    }));

    // If no activity_logs, also check activities table as fallback
    if (activityLog.length === 0) {
      const fallback = await pool.query(`
        SELECT a.id, a.type, a.message, a.metadata, a.created_at, u.full_name as user_name
        FROM activities a
        LEFT JOIN employees u ON a.user_id = u.id
        WHERE u.tenant_id::integer = $1
        ORDER BY a.created_at DESC
        LIMIT 100
      `, [tenantId]);
      activityLog = fallback.rows.map(row => ({
        id: row.id,
        type: row.type,
        message: row.message,
        user: row.user_name || '',
        metadata: row.metadata,
        created_at: row.created_at
      }));
    }

    res.json({
      success: true,
      message: 'Activity log retrieved successfully',
      data: { activityLog }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity log',
      error: error.message
    });
  }
});
// GET /api/me/notifications - Get all notifications for the user (DYNAMIC - FROM DATABASE)
router.get('/me/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const tenantId = parseInt(req.user.tenantId);
    const userType = req.user.userType;
    const notifications = [];

    // Get employee record for this user within the same tenant
    const empResult = await pool.query(
      'SELECT employee_id, id, full_name FROM employees WHERE id = $1 AND tenant_id::integer = $2',
      [userId, tenantId]
    );
    const employeeId = empResult.rows[0]?.employee_id;
    const employeeDbId = empResult.rows[0]?.id;
    console.log(`[Notifications] userId=${userId}, tenantId=${tenantId}, userType=${userType}, employeeId=${employeeId}, employeeDbId=${employeeDbId}`);

    // 1. Fetch leave requests belonging to this user (tenant-isolated)
    if (employeeDbId) {
      try {
        const leaveResults = await pool.query(`
          SELECT 
            CONCAT('leave-', lr.id) as id,
            'request' as type,
            CASE 
              WHEN lr.status = 'pending' THEN 'Your vacation request is pending'
              WHEN lr.status = 'approved' THEN 'Your vacation request was approved'
              WHEN lr.status = 'rejected' THEN 'Your vacation request was rejected'
            END as title,
            CONCAT(
              'Leave request for ', 
              TO_CHAR(lr.start_date, 'DD-Mon-YYYY'),
              ' to ',
              TO_CHAR(lr.end_date, 'DD-Mon-YYYY'),
              ' (',
              lr.total_days::TEXT,
              ' days)'
            ) as message,
            CASE WHEN lr.status = 'pending' THEN false ELSE true END as read,
            TO_CHAR(lr.created_at, 'HH24:MI') as created_at,
            lr.created_at as created_at_timestamp,
            lr.status
          FROM leave_requests lr
          JOIN employees e ON lr.employee_id::text = e.id::text
          WHERE lr.employee_id::text = $1::text
            AND e.tenant_id::integer = $2
          ORDER BY lr.created_at DESC
          LIMIT 50
        `, [employeeDbId, tenantId]);
        notifications.push(...leaveResults.rows);
      } catch(e) { /* table may not exist */ }
    }

    // Also try matching by employee_id field if it exists
    if (employeeId) {
      try {
        const leaveByEmpId = await pool.query(`
          SELECT 
            CONCAT('leave-', lr.id) as id,
            'request' as type,
            CASE 
              WHEN lr.status = 'pending' THEN 'Your vacation request is pending'
              WHEN lr.status = 'approved' THEN 'Your vacation request was approved'
              WHEN lr.status = 'rejected' THEN 'Your vacation request was rejected'
            END as title,
            CONCAT(
              'Leave request for ', 
              TO_CHAR(lr.start_date, 'DD-Mon-YYYY'),
              ' to ',
              TO_CHAR(lr.end_date, 'DD-Mon-YYYY'),
              ' (',
              lr.total_days::TEXT,
              ' days)'
            ) as message,
            CASE WHEN lr.status = 'pending' THEN false ELSE true END as read,
            TO_CHAR(lr.created_at, 'HH24:MI') as created_at,
            lr.created_at as created_at_timestamp,
            lr.status
          FROM leave_requests lr
          JOIN employees e ON lr.employee_id::text = e.employee_id::text
          WHERE lr.employee_id = $1
            AND e.tenant_id::integer = $2
          ORDER BY lr.created_at DESC
          LIMIT 50
        `, [employeeId, tenantId]);
        // Only add if not already found via id
        const existingIds = new Set(notifications.map(n => n.id));
        leaveByEmpId.rows.forEach(r => { if (!existingIds.has(r.id)) notifications.push(r); });
      } catch(e) { /* ignore */ }
    }

    // 2. Fetch correction requests belonging to this user (tenant-isolated)
    if (employeeId || employeeDbId) {
      try {
        const correctionResults = await pool.query(`
          SELECT 
            CONCAT('correction-', cr.id) as id,
            'request' as type,
            CASE 
              WHEN cr.status = 'pending' THEN 'Your correction request is pending'
              WHEN cr.status = 'approved' THEN 'Your correction request was approved'
              WHEN cr.status = 'rejected' THEN 'Your correction request was rejected'
            END as title,
            CONCAT(
              'Correction request for ',
              TO_CHAR(cr.date, 'DD-Mon-YYYY'),
              ' (Status: ',
              cr.status,
              ')'
            ) as message,
            CASE WHEN cr.status = 'pending' THEN false ELSE true END as read,
            TO_CHAR(cr.created_at, 'HH24:MI') as created_at,
            cr.created_at as created_at_timestamp,
            cr.status
          FROM correction_requests cr
          JOIN employees e ON cr.employee_id::text = e.employee_id::text OR cr.employee_id::text = e.id::text
          WHERE (cr.employee_id::text = $1::text OR cr.employee_id::text = $2::text)
            AND e.tenant_id::integer = $3
          ORDER BY cr.created_at DESC
          LIMIT 50
        `, [employeeId || '', employeeDbId || 0, tenantId]);
        const existingIds = new Set(notifications.map(n => n.id));
        correctionResults.rows.forEach(r => { if (!existingIds.has(r.id)) notifications.push(r); });
      } catch(e) { /* table may not exist */ }
    }

    // 3. Fetch pending requests that need approval (ONLY for admin users, tenant-isolated)
    if (userType === 'admin') {
      try {
        const approvalsNeeded = await pool.query(`
          SELECT 
            CONCAT('pending-approval-', lr.id) as id,
            'approval' as type,
            'Approval Needed' as title,
            CONCAT(
              'You have a ', 
              lr.leave_type, 
              ' request to review from ',
              e.full_name,
              ' for ',
              TO_CHAR(lr.start_date, 'DD-Mon')
            ) as message,
            false as read,
            TO_CHAR(lr.created_at, 'HH24:MI') as created_at,
            lr.created_at as created_at_timestamp,
            'pending' as status
          FROM leave_requests lr
          JOIN employees e ON lr.employee_id::text = e.employee_id::text OR lr.employee_id::text = e.id::text
          WHERE lr.status = 'pending' 
            AND e.tenant_id::integer = $1
            AND lr.created_at > NOW() - INTERVAL '30 days'
          ORDER BY lr.created_at DESC
          LIMIT 50
        `, [tenantId]);
        notifications.push(...approvalsNeeded.rows);
      } catch(e) { console.error('Approvals query error:', e.message); }

      // Also fetch pending correction requests for admin approval
      try {
        const correctionApprovals = await pool.query(`
          SELECT 
            CONCAT('pending-correction-', cr.id) as id,
            'approval' as type,
            'Correction Approval Needed' as title,
            CONCAT(
              'You have a correction request to review from ',
              e.full_name,
              ' for ',
              TO_CHAR(cr.date, 'DD-Mon')
            ) as message,
            false as read,
            TO_CHAR(cr.created_at, 'HH24:MI') as created_at,
            cr.created_at as created_at_timestamp,
            'pending' as status
          FROM correction_requests cr
          JOIN employees e ON cr.employee_id::text = e.employee_id::text OR cr.employee_id::text = e.id::text
          WHERE cr.status = 'pending' 
            AND e.tenant_id::integer = $1
            AND cr.created_at > NOW() - INTERVAL '30 days'
          ORDER BY cr.created_at DESC
          LIMIT 50
        `, [tenantId]);
        notifications.push(...correctionApprovals.rows);
      } catch(e) { console.error('Correction approvals error:', e.message); }
    }

    // Sort by created_at_timestamp (newest first)
    notifications.sort((a, b) => 
      new Date(b.created_at_timestamp) - new Date(a.created_at_timestamp)
    );

    // Remove timestamp field before sending
    const finalNotifications = notifications.map(({ created_at_timestamp, ...rest }) => rest);

    res.json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: { 
        notifications: finalNotifications,
        total: finalNotifications.length,
        unread_count: finalNotifications.filter(n => !n.read).length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
});

// GET /api/admin/notifications - Get all pending items for admin dashboard
router.get('/admin/notifications', authenticateToken, async (req, res) => {
  const { type, category, status: filterStatus, priority, date, date_from, date_to, employee_id, sort, page, limit } = req.query;
  const tenantId = req.user.tenantId;

  try {
    // Verify admin/manager role
    const roleCheck = await verifyAdminRole(req.user, pool);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin or Manager role required.'
      });
    }
    const adminNotifications = [];

    // Figma category mapping:
    // "request"    → leave_request, correction_request
    // "timesheets" → late_clock_in, long_hours_alert
    // "employees"  → new_employee, employee_status
    // "system"     → system alerts
    // "all"        → everything (default)
    const categoryMap = {
      request: ['leave_request', 'correction_request'],
      timesheets: ['late_clock_in', 'long_hours_alert'],
      employees: ['new_employee', 'employee_status'],
      system: ['system_alert']
    };

    // Determine which types to fetch based on category or type filter
    const activeCategory = category || 'all';
    const allowedTypes = activeCategory !== 'all' ? (categoryMap[activeCategory] || []) : null;
    
    const shouldFetch = (t) => {
      if (type && type !== 'all') return type === t;
      if (allowedTypes) return allowedTypes.includes(t);
      return true;
    };

    // 1. Pending vacation/leave requests (category: request)
    if (shouldFetch('leave_request')) {
      const pendingLeaves = await pool.query(`
        SELECT 
          CONCAT('leave-', lr.id) as id,
          'leave_request' as type,
          'request' as filter_category,
          'Vacation request submitted' as title,
          e.full_name as requester_name,
          e.employee_id as requester_id,
          lr.leave_type,
          CONCAT(
            e.full_name,
            ' requested vacation from ',
            TO_CHAR(lr.start_date, 'DD-Mon'), 
            ' to ',
            TO_CHAR(lr.end_date, 'DD-Mon YYYY')
          ) as message,
          lr.total_days::TEXT || ' days' as duration,
          lr.reason,
          false as read,
          TO_CHAR(lr.created_at, 'HH24:MI') as time,
          TO_CHAR(lr.created_at, 'DD-Mon-YYYY HH24:MI') as requested_on,
          lr.created_at as created_at_timestamp,
          'pending' as status
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id::text = e.id::text
        WHERE lr.status = 'pending' AND e.tenant_id::integer = $1
        ORDER BY lr.created_at DESC
      `, [tenantId]);
      adminNotifications.push(
        ...pendingLeaves.rows.map(row => ({ ...row, priority: 'high' }))
      );
    }

    // 2. Pending time correction requests (category: request)
    if (shouldFetch('correction_request')) {
      const pendingCorrections = await pool.query(`
        SELECT 
          CONCAT('correction-', cr.id) as id,
          'correction_request' as type,
          'request' as filter_category,
          'Time correction request' as title,
          e.full_name as requester_name,
          e.employee_id as requester_id,
          (SELECT name FROM correction_types WHERE id = cr.correction_type_id) as correction_type,
          CONCAT(
            e.full_name,
            ' requested a correction for ',
            TO_CHAR(cr.date, 'DD Mon YYYY')
          ) as message,
          false as read,
          TO_CHAR(cr.created_at, 'HH24:MI') as time,
          TO_CHAR(cr.created_at, 'DD-Mon-YYYY HH24:MI') as requested_on,
          cr.created_at as created_at_timestamp,
          'pending' as status
        FROM correction_requests cr
        JOIN employees e ON cr.employee_id::text = e.employee_id::text
        WHERE cr.status = 'pending' AND e.tenant_id::integer = $1
        ORDER BY cr.created_at DESC
      `, [tenantId]);
      adminNotifications.push(
        ...pendingCorrections.rows.map(row => ({ ...row, priority: 'high' }))
      );
    }

    // 3. Late clock-ins detected (category: timesheets)
    if (shouldFetch('late_clock_in')) {
      const lateClockIns = await pool.query(`
        SELECT 
          CONCAT('late-clockin-', te.id) as id,
          'late_clock_in' as type,
          'timesheets' as filter_category,
          'Late clock-in detected' as title,
          e.full_name as employee_name,
          te.employee_id as employee_id,
          CONCAT(
            e.full_name,
            ' clocked in later than scheduled time'
          ) as message,
          true as read,
          TO_CHAR(te.clock_in, 'HH24:MI') as time,
          TO_CHAR(te.clock_in, 'DD-Mon-YYYY') as date,
          TO_CHAR(te.clock_in, 'HH24:MI') as clock_in_time,
          '09:00' as scheduled_time,
          te.clock_in as created_at_timestamp,
          'alert' as status
        FROM time_entries te
        JOIN employees e ON te.employee_id::text = e.id::text
        WHERE DATE(te.clock_in) >= CURRENT_DATE - INTERVAL '7 days'
          AND EXTRACT(HOUR FROM te.clock_in) > 9
          AND e.tenant_id::integer = $1
        ORDER BY te.clock_in DESC
        LIMIT 50
      `, [tenantId]);
      adminNotifications.push(
        ...lateClockIns.rows.map(row => ({ ...row, priority: 'medium' }))
      );
    }

    // 4. Long working hours detected (category: timesheets)
    if (shouldFetch('long_hours_alert')) {
      const longHours = await pool.query(`
        SELECT 
          CONCAT('long-hours-', te.id) as id,
          'long_hours_alert' as type,
          'timesheets' as filter_category,
          'Extended working hours' as title,
          e.full_name as employee_name,
          te.employee_id as employee_id,
          CONCAT(
            e.full_name,
            ' worked ',
            (te.duration_minutes / 60)::TEXT, 'h ',
            (te.duration_minutes % 60)::TEXT, 'm on ',
            TO_CHAR(DATE(te.clock_in), 'DD Mon')
          ) as message,
          true as read,
          TO_CHAR(te.clock_in, 'HH24:MI') as time,
          TO_CHAR(DATE(te.clock_in), 'DD-Mon-YYYY') as date,
          te.clock_in as created_at_timestamp,
          'alert' as status
        FROM time_entries te
        JOIN employees e ON te.employee_id::text = e.id::text
        WHERE DATE(te.clock_in) >= CURRENT_DATE - INTERVAL '7 days'
          AND te.clock_out IS NOT NULL
          AND te.duration_minutes > 600
          AND e.tenant_id::integer = $1
        ORDER BY te.clock_in DESC
        LIMIT 20
      `, [tenantId]);
      adminNotifications.push(
        ...longHours.rows.map(row => ({ ...row, priority: 'medium' }))
      );
    }

    // 5. New employees joined recently (category: employees)
    if (shouldFetch('new_employee')) {
      const newEmployees = await pool.query(`
        SELECT 
          CONCAT('new-emp-', id) as id,
          'new_employee' as type,
          'employees' as filter_category,
          'New employee joined' as title,
          full_name as employee_name,
          employee_id as employee_id,
          CONCAT(full_name, ' has joined the team') as message,
          true as read,
          TO_CHAR(created_at, 'HH24:MI') as time,
          created_at as created_at_timestamp,
          'info' as status
        FROM employees
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
          AND tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [tenantId]);
      adminNotifications.push(
        ...newEmployees.rows.map(row => ({ ...row, priority: 'low' }))
      );
    }

    // 6. Employee status changes (category: employees)
    if (shouldFetch('employee_status')) {
      const statusChanges = await pool.query(`
        SELECT 
          CONCAT('emp-status-', id) as id,
          'employee_status' as type,
          'employees' as filter_category,
          'Employee status update' as title,
          full_name as employee_name,
          employee_id as employee_id,
          CONCAT(full_name, ' status: ', COALESCE(status, 'Active')) as message,
          true as read,
          TO_CHAR(updated_at, 'HH24:MI') as time,
          updated_at as created_at_timestamp,
          'info' as status
        FROM employees
        WHERE updated_at >= CURRENT_DATE - INTERVAL '7 days'
          AND updated_at != created_at
          AND tenant_id = $1
        ORDER BY updated_at DESC
        LIMIT 20
      `, [tenantId]);
      adminNotifications.push(
        ...statusChanges.rows.map(row => ({ ...row, priority: 'low' }))
      );
    }

    // 7. System alerts (category: system)
    if (shouldFetch('system_alert')) {
      try {
        const securityLogs = await pool.query(`
          SELECT 
            CONCAT('security-', id) as id,
            'system_alert' as type,
            'system' as filter_category,
            'Security alert' as title,
            CONCAT('Security event on ', endpoint) as message,
            true as read,
            TO_CHAR(created_at, 'HH24:MI') as time,
            created_at as created_at_timestamp,
            'alert' as status
          FROM tenant_security_logs
          WHERE severity IN ('critical', 'high')
            AND created_at >= CURRENT_DATE - INTERVAL '7 days'
            AND user_tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 10
        `, [tenantId]);
        adminNotifications.push(
          ...securityLogs.rows.map(row => ({ ...row, priority: 'high' }))
        );
      } catch (e) {
        // Table may not exist yet — skip system alerts gracefully
      }
    }

    // Apply filters on combined results
    let filtered = adminNotifications;

    // Filter by priority
    if (priority) {
      filtered = filtered.filter(n => n.priority === priority);
    }

    // Filter by status
    if (filterStatus) {
      filtered = filtered.filter(n => n.status === filterStatus);
    }

    // Filter by employee_id
    if (employee_id) {
      filtered = filtered.filter(n => 
        n.requester_id === employee_id || n.employee_id === parseInt(employee_id)
      );
    }

    // Sort: "latest" (default) or "oldest"
    if (sort === 'oldest') {
      filtered.sort((a, b) => new Date(a.created_at_timestamp) - new Date(b.created_at_timestamp));
    } else {
      // Default: latest first
      filtered.sort((a, b) => new Date(b.created_at_timestamp) - new Date(a.created_at_timestamp));
    }

    // Category-wise counts (for tab badges)
    const categoryCounts = {
      all: adminNotifications.length,
      request: adminNotifications.filter(n => n.filter_category === 'request').length,
      timesheets: adminNotifications.filter(n => n.filter_category === 'timesheets').length,
      employees: adminNotifications.filter(n => n.filter_category === 'employees').length,
      system: adminNotifications.filter(n => n.filter_category === 'system').length
    };

    // Unread count
    const unreadCount = adminNotifications.filter(n => n.read === false).length;

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedResults = filtered.slice(startIndex, startIndex + limitNum);

    // Remove timestamp field before sending
    const finalNotifications = paginatedResults.map(({ created_at_timestamp, ...rest }) => rest);

    res.json({
      success: true,
      message: 'Admin notifications retrieved successfully',
      data: {
        category_counts: categoryCounts,
        unread_count: unreadCount,
        notifications: finalNotifications,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filtered.length,
          total_pages: Math.ceil(filtered.length / limitNum)
        },
        filters_applied: {
          category: activeCategory,
          type: type || null,
          status: filterStatus || null,
          priority: priority || null,
          employee_id: employee_id || null,
          sort: sort || 'latest'
        },
        available_filters: {
          categories: ['all', 'request', 'timesheets', 'employees', 'system'],
          sort_options: ['latest', 'oldest']
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching admin notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admin notifications',
      error: error.message
    });
  }
});


  return router;
};
