/**
 * activity-log Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ==================== ADMIN ACTIVITY LOG API (Figma Design) ====================
// GET /api/admin/activity-log - Activity Log with Category, Actor, Date Range, Search filters
router.get('/admin/activity-log', authenticateToken, async (req, res) => {

    // Verify admin role
    const roleCheck = await verifyAdminRole(req.user, pool);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }

  const { search, category, actor, date_range, date_from, date_to, sort, page, limit } = req.query;
  const tenantId = req.user.tenantId;

  try {
    let conditions = ['al.tenant_id = $1'];
    let params = [tenantId];
    let paramIndex = 2;

    // Category filter: requests, timesheets, employees, company_settings, system
    if (category && category !== 'all') {
      conditions.push(`al.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    // Actor filter: admin, employee, system
    if (actor && actor !== 'all') {
      conditions.push(`al.actor_type = $${paramIndex}`);
      params.push(actor);
      paramIndex++;
    }

    // Date range filter
    if (date_range && date_range !== 'all_time') {
      const dateConditions = {
        'today': `DATE(al.created_at) = CURRENT_DATE`,
        'yesterday': `DATE(al.created_at) = CURRENT_DATE - INTERVAL '1 day'`,
        'this_week': `al.created_at >= date_trunc('week', CURRENT_DATE)`,
        'this_month': `al.created_at >= date_trunc('month', CURRENT_DATE)`,
        'last_30_days': `al.created_at >= CURRENT_DATE - INTERVAL '30 days'`
      };
      if (dateConditions[date_range]) {
        conditions.push(dateConditions[date_range]);
      }
    }

    // Custom date range
    if (date_from) {
      conditions.push(`al.created_at >= $${paramIndex}`);
      params.push(date_from);
      paramIndex++;
    }
    if (date_to) {
      conditions.push(`al.created_at <= ($${paramIndex}::date + INTERVAL '1 day')`);
      params.push(date_to);
      paramIndex++;
    }

    // Search filter (search in title, description, actor_name, target_name)
    if (search) {
      conditions.push(`(
        al.title ILIKE $${paramIndex} OR
        al.description ILIKE $${paramIndex} OR
        al.actor_name ILIKE $${paramIndex} OR
        al.target_name ILIKE $${paramIndex} OR
        al.action ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Sort order
    const sortOrder = sort === 'oldest' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM activity_logs al ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    // Fetch logs
    const result = await pool.query(`
      SELECT 
        al.id,
        al.actor_name,
        al.actor_type,
        al.category,
        al.action,
        al.title,
        al.description,
        al.target_type,
        al.target_id,
        al.target_name,
        al.metadata,
        TO_CHAR(al.created_at, 'HH24:MI') as time,
        TO_CHAR(al.created_at, 'YYYY-MM-DD') as date,
        TO_CHAR(al.created_at, 'DD-Mon-YYYY HH24:MI') as formatted_date,
        al.created_at
      FROM activity_logs al
      ${whereClause}
      ORDER BY al.created_at ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limitNum, offset]);

    // Group by date for frontend display
    const grouped = {};
    result.rows.forEach(row => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      let dateLabel = row.date;
      if (row.date === today) dateLabel = 'Today';
      else if (row.date === yesterday) dateLabel = 'Yesterday';

      if (!grouped[dateLabel]) grouped[dateLabel] = [];
      grouped[dateLabel].push({
        id: row.id,
        title: row.title,
        description: row.description,
        actor_name: row.actor_name,
        actor_type: row.actor_type,
        category: row.category,
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        target_name: row.target_name,
        metadata: row.metadata,
        time: row.time,
        formatted_date: row.formatted_date
      });
    });

    // Category counts for filter badges
    const categoryCountResult = await pool.query(`
      SELECT 
        category,
        COUNT(*) as count
      FROM activity_logs
      WHERE tenant_id = $1
      GROUP BY category
    `, [tenantId]);
    const categoryCounts = { all: total };
    categoryCountResult.rows.forEach(r => { categoryCounts[r.category] = parseInt(r.count); });

    res.json({
      success: true,
      message: 'Activity log retrieved successfully',
      data: {
        activities: result.rows.map(row => ({
          id: row.id,
          title: row.title,
          description: row.description,
          actor_name: row.actor_name,
          actor_type: row.actor_type,
          category: row.category,
          action: row.action,
          target_type: row.target_type,
          target_id: row.target_id,
          target_name: row.target_name,
          metadata: row.metadata,
          time: row.time,
          date: row.date,
          formatted_date: row.formatted_date
        })),
        grouped_by_date: grouped,
        category_counts: categoryCounts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          total_pages: Math.ceil(total / limitNum)
        },
        filters_applied: {
          search: search || null,
          category: category || 'all',
          actor: actor || 'all',
          date_range: date_range || 'all_time',
          date_from: date_from || null,
          date_to: date_to || null,
          sort: sort || 'latest'
        },
        available_filters: {
          categories: ['all', 'requests', 'timesheets', 'employees', 'company_settings', 'system'],
          actors: ['all', 'admin', 'employee', 'system'],
          date_ranges: ['all_time', 'today', 'yesterday', 'this_week', 'this_month', 'last_30_days'],
          sort_options: ['latest', 'oldest']
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching activity log:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activity log',
      error: error.message
    });
  }
});

// POST /api/company/settings/reset - Reset company settings to default (admin)
router.post('/company/settings/reset', authenticateToken, async (req, res) => {
  try {

    // Verify admin role
    const roleCheck = await verifyAdminRole(req.user, pool);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }

    const tenantId = req.user.tenantId;
    
    // Update company settings with default values
    const result = await pool.query(`
      UPDATE company_settings 
      SET 
        name = 'Default Company',
        industry = 'General',
        support_email = 'support@default.com',
        company_phone = '',
        address = '',
        brand_color = '#667eea',
        website = '',
        timezone = 'UTC',
        founded_date = NULL,
        employee_count = 0,
        description = '',
        work_days = '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]'::jsonb,
        start_time = '09:00',
        end_time = '17:00',
        break_required = false,
        auto_deduct_break = false,
        break_duration = '60',
        enable_overtime = false,
        overtime_starts_after = '8',
        max_overtime_per_day = '2',
        receive_notifications_email = true,
        receive_notifications_app = true,
        require_approval_manual_time_entries = false,
        require_approval_correction_requests = true,
        require_approval_vacation_requests = true,
        default_language = 'English',
        date_format = 'DD/MM/YYYY',
        time_format = '24-hour',
        updated_at = $1
      WHERE tenant_id = $2
      RETURNING *
    `, [new Date(), tenantId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: 'Company settings reset to default successfully',
      data: {
        company: result.rows[0],
        reset_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error resetting company settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset company settings',
      error: error.message
    });
  }
});
// GET /api/company/export-csv - Export company data as CSV (admin, tenant isolated)
router.get('/company/export-csv', authenticateToken, async (req, res) => {
  try {
    const tenantId = parseInt(req.user.tenantId);
    // Query employees from this tenant only
    const result = await pool.query(`
      SELECT first_name, last_name, email, role, department, status
      FROM employees
      WHERE tenant_id::integer = $1
      ORDER BY id ASC
    `, [tenantId]);
    const employees = result.rows;
    // Prepare CSV header
    let csv = 'Employee Name,Email,Role,Department,Status\n';
    // Add each employee as a row
    employees.forEach(emp => {
      const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
      csv += `"${name}","${emp.email}","${emp.role}","${emp.department}","${emp.status || ''}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="company-data.csv"');
    res.status(200).send(csv);
  } catch (err) {
    console.error('Error exporting company CSV:', err);
    res.status(500).json({ success: false, message: 'Failed to export company data as CSV' });
  }
});

// PATCH /api/employees/:id/deactivate - Deactivate employee (admin)
router.patch('/employees/:id/deactivate', async (req, res) => {
  const employeeId = req.params.id;
  
  try {
    // Find employee in database by employee_id
    const result = await pool.query(
      'SELECT id, employee_id, full_name, email, status FROM employees WHERE employee_id = $1',
      [employeeId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
        employeeId
      });
    }
    
    const employee = result.rows[0];
    
    // Update employee status to Inactive
    const updateResult = await pool.query(
      `UPDATE employees 
       SET status = 'Inactive', updated_at = NOW() 
       WHERE employee_id = $1 
       RETURNING id, employee_id, status, updated_at`,
      [employeeId]
    );
    
    const updatedEmployee = updateResult.rows[0];
    
    res.json({
      success: true,
      message: 'Employee deactivated',
      data: {
        employeeId: updatedEmployee.employee_id,
        status: updatedEmployee.status,
        deactivatedAt: updatedEmployee.updated_at
      }
    });
  } catch (error) {
    console.error('Error deactivating employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while deactivating employee',
      error: error.message
    });
  }
});
// GET /api/dashboard/recent-requests - Get recent leave/correction requests with filtering
router.get('/dashboard/recent-requests', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const status = req.query.status || 'all';
  const type = req.query.type || 'all';

  const allRequests = [
    {
      id: 1,
      employeeName: 'Jenny Wilson',
      type: 'Vacation',
      date: '12 - 14 Nov 2025',
      status: 'Pending',
      submitted: 'Today, 08:04',
      submittedDate: new Date().toISOString()
    },
    {
      id: 2,
      employeeName: 'Michael Kim',
      type: 'Vacation',
      date: '5 - 6 Nov 2025',
      status: 'Approved',
      submitted: 'Yesterday, 17:22',
      submittedDate: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 3,
      employeeName: 'Mark Evans',
      type: 'Correction',
      date: '9 Nov 2025',
      status: 'Pending',
      submitted: '2 days ago',
      submittedDate: new Date(Date.now() - 172800000).toISOString()
    },
    {
      id: 4,
      employeeName: 'Sarah Anderson',
      type: 'Correction',
      date: '2 Nov 2025',
      status: 'Reject',
      submitted: '2 days ago',
      submittedDate: new Date(Date.now() - 172800000).toISOString()
    },
    {
      id: 5,
      employeeName: 'Daniel Lee',
      type: 'Correction',
      date: '3 Nov 2025',
      status: 'Reject',
      submitted: 'Yesterday, 10:11',
      submittedDate: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 6,
      employeeName: 'Michael Chen',
      type: 'Vacation',
      date: '20 - 22 Dec 2025',
      status: 'Pending',
      submitted: 'Today, 09:45',
      submittedDate: new Date().toISOString()
    },
    {
      id: 7,
      employeeName: 'Olivia Carter',
      type: 'Vacation',
      date: '10 Nov 2025',
      status: 'Pending',
      submitted: 'Today, 06:04',
      submittedDate: new Date().toISOString()
    },
    {
      id: 8,
      employeeName: 'Joshua Kim',
      type: 'Vacation',
      date: '28 Nov 2025',
      status: 'Approved',
      submitted: '2 days ago',
      submittedDate: new Date(Date.now() - 172800000).toISOString()
    },
    {
      id: 9,
      employeeName: 'Emily Davis',
      type: 'Correction',
      date: '1 Nov 2025',
      status: 'Approved',
      submitted: '3 days ago',
      submittedDate: new Date(Date.now() - 259200000).toISOString()
    },
    {
      id: 10,
      employeeName: 'Michelle Hart',
      type: 'Vacation',
      date: '18 - 19 Nov 2025',
      status: 'Pending',
      submitted: 'Today, 11:12',
      submittedDate: new Date().toISOString()
    }
  ];

  let filteredRequests = allRequests;
  if (status !== 'all') {
    filteredRequests = filteredRequests.filter(req => req.status.toLowerCase() === status.toLowerCase());
  }
  if (type !== 'all') {
    filteredRequests = filteredRequests.filter(req => req.type.toLowerCase() === type.toLowerCase());
  }
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedRequests = filteredRequests.slice(startIndex, endIndex);
  res.json({
    success: true,
    data: {
      requests: paginatedRequests,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(filteredRequests.length / limit),
        total_records: filteredRequests.length,
        per_page: limit
      },
      filters: {
        available_statuses: ['All Status', 'Pending', 'Approved', 'Reject'],
        available_types: ['All Types', 'Vacation', 'Correction'],
        current_status: status,
        current_type: type
      }
    }
  });
});
// This endpoint returns a static dashboard response like index.js
router.get('/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        name: 'John Doe',
        status: 'Available',
        avatar: null
      },
      timer: {
        isRunning: false,
        currentTask: null,
        elapsedTime: 0
      },
      todaysSummary: {
        totalHours: 0,
        hoursTarget: 8,
        breakTime: 0,
        tasksCompleted: 0
      },
      recentActivity: [],
      quickStats: {
        weekTotal: 32.5,
        monthTotal: 140.25,
        weekTarget: 40,
        monthTarget: 160
      }
    }
  });
});
router.get('/admin/dashboard', authenticateToken, async (req, res) => {

    // Verify admin role
    const roleCheck = await verifyAdminRole(req.user, pool);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }

  console.log('📊 Admin Dashboard API called');

  try {
    const tenantId = req.user.tenantId;

    // Get total employees from database
    const employeesResult = await pool.query("SELECT COUNT(*) as count FROM employees WHERE tenant_id = $1", [tenantId]);
    const totalEmployees = parseInt(employeesResult.rows[0]?.count || 0);

    // Get currently working employees (active timers = clock_out IS NULL)
    const workingResult = await pool.query(`
      SELECT COUNT(DISTINCT t.employee_id) as count 
      FROM timers t
      JOIN employees e ON t.employee_id = e.employee_id
      WHERE t.clock_out IS NULL AND e.tenant_id = $1
    `, [tenantId]);
    const workingNow = parseInt(workingResult.rows[0]?.count || 0);

    // Get pending leave requests from database
    const pendingResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.employee_id
      WHERE lr.status = 'pending' AND e.tenant_id = $1
    `, [tenantId]);
    const pendingRequests = parseInt(pendingResult.rows[0]?.count || 0);

    // Get pending correction requests
    const pendingCorrectionResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM correction_requests cr
      JOIN employees e ON cr.employee_id = e.employee_id
      WHERE cr.status = 'pending' AND e.tenant_id = $1
    `, [tenantId]);
    const pendingCorrections = parseInt(pendingCorrectionResult.rows[0]?.count || 0);

    // Get overtime alerts - employees who worked more than 8 hours today
    const today = new Date().toISOString().split('T')[0];
    const overtimeResult = await pool.query(`
      SELECT 
        e.id as user_id,
        e.full_name as user_name,
        COALESCE(SUM(
          CASE 
            WHEN t.clock_out IS NOT NULL THEN EXTRACT(EPOCH FROM (t.clock_out - t.clock_in)) / 3600.0
            ELSE EXTRACT(EPOCH FROM (NOW() - t.clock_in)) / 3600.0
          END
        ), 0) as hours_worked
      FROM employees e
      LEFT JOIN timers t ON e.employee_id = t.employee_id AND DATE(t.date) = $1
      WHERE e.tenant_id = $2
      GROUP BY e.id, e.full_name
      HAVING COALESCE(SUM(
        CASE 
          WHEN t.clock_out IS NOT NULL THEN EXTRACT(EPOCH FROM (t.clock_out - t.clock_in)) / 3600.0
          ELSE EXTRACT(EPOCH FROM (NOW() - t.clock_in)) / 3600.0
        END
      ), 0) > 8
    `, [today, tenantId]);

    const overtimeAlerts = overtimeResult.rows.map(row => ({
      user_id: row.user_id,
      user_name: row.user_name,
      hours_worked: parseFloat(row.hours_worked).toFixed(2),
      overtime_hours: (parseFloat(row.hours_worked) - 8).toFixed(2),
      alert_level: parseFloat(row.hours_worked) > 10 ? 'high' : 'medium',
      alert_message: `${row.user_name} has worked ${parseFloat(row.hours_worked).toFixed(1)} hours today`
    }));

    // Get recent pending leave requests details (last 5)
    const recentPendingResult = await pool.query(`
      SELECT 
        lr.id as request_id,
        e.full_name as user_name,
        lr.leave_type,
        lr.start_date,
        lr.end_date,
        lr.total_days as days,
        lr.created_at as submitted_date
      FROM leave_requests lr
      LEFT JOIN employees e ON lr.employee_id = e.employee_id
      WHERE lr.status = 'pending' AND e.tenant_id = $1
      ORDER BY lr.created_at DESC
      LIMIT 5
    `, [tenantId]);
    const recentPendingRequests = recentPendingResult.rows;

    // Get currently working employees details (active = clock_out IS NULL)
    const workingEmployeesResult = await pool.query(`
      SELECT 
        e.id as user_id,
        e.full_name as user_name,
        e.role,
        t.clock_in as started_at,
        EXTRACT(EPOCH FROM (NOW() - t.clock_in)) / 60 as minutes_worked,
        e.department as project
      FROM timers t
      JOIN employees e ON t.employee_id = e.employee_id
      WHERE t.clock_out IS NULL AND e.tenant_id = $1
      ORDER BY t.clock_in DESC
    `, [tenantId]);

    const workingEmployees = workingEmployeesResult.rows.map(row => {
      const minutesWorked = parseInt(row.minutes_worked) || 0;
      const hours = Math.floor(minutesWorked / 60);
      const minutes = minutesWorked % 60;
      return {
        user_id: row.user_id,
        user_name: row.user_name,
        role: row.role || 'Employee',
        started_at: row.started_at,
        current_duration: `${hours}h ${minutes}m`,
        current_duration_minutes: minutesWorked,
        project: row.project || 'General'
      };
    });

    // Get recent correction requests (last 5 pending)
    const recentCorrectionsResult = await pool.query(`
      SELECT 
        cr.id as request_id,
        e.full_name as user_name,
        ct.name as correction_type,
        cr.date,
        cr.comment as reason,
        cr.created_at as submitted_date
      FROM correction_requests cr
      LEFT JOIN employees e ON cr.employee_id = e.employee_id
      LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
      WHERE cr.status = 'pending' AND e.tenant_id = $1
      ORDER BY cr.created_at DESC
      LIMIT 5
    `, [tenantId]);
    const recentCorrections = recentCorrectionsResult.rows;

    const dashboardData = {
      summary: {
        total_employees: totalEmployees,
        working_now: workingNow,
        pending_leave_requests: pendingRequests,
        pending_corrections: pendingCorrections,
        overtime_alerts: overtimeAlerts.length
      },
      working_employees: workingEmployees,
      recent_pending_requests: recentPendingRequests,
      recent_pending_corrections: recentCorrections,
      overtime_alerts: overtimeAlerts,
      last_updated: new Date().toISOString(),
      status_breakdown: {
        active: workingNow,
        on_break: 0,
        offline: totalEmployees - workingNow
      }
    };

    res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: dashboardData
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dashboard data',
      error: error.message
    });
  }
});


  return router;
};
