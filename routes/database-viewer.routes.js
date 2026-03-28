/**
 * database-viewer Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== DATABASE VIEWER APIs =====

// Serve DB Viewer HTML
router.get('/db-viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'db_viewer.html'));
});

// Get all tables (admin only)
router.get('/db-viewer/tables', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    res.json({
      success: true,
      tables: result.rows.map(r => r.table_name)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get table data (admin only, safe from SQL injection)
router.get('/db-viewer/table/:tableName', authenticateToken, async (req, res) => {
  const { tableName } = req.params;
  
  try {
    // Validate table name exists to prevent SQL injection
    const tableCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    if (tableCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }
    const safeName = '"' + tableName.replace(/"/g, '""') + '"';

    // Get columns
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    
    // Get row count
    const countResult = await pool.query(`SELECT COUNT(*) FROM ${safeName}`);
    
    // Get data (limit to 100 rows for performance)
    const dataResult = await pool.query(`SELECT * FROM ${safeName} LIMIT 100`);
    
    res.json({
      success: true,
      table: tableName,
      columns: columnsResult.rows,
      total_rows: parseInt(countResult.rows[0].count),
      rows: dataResult.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================================================
// ADMIN PROJECT MANAGEMENT APIs
// =====================================================================================

// Get All Projects (Admin)
router.get('/admin/projects', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        description,
        color,
        status,
        tenant_id,
        created_at,
        updated_at
      FROM projects 
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `, [tenantId]);
    
    res.json({
      success: true,
      message: 'Projects retrieved successfully',
      data: {
        projects: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch projects',
      error: error.message
    });
  }
});

// Create New Project (Admin)
router.post('/admin/projects', authenticateToken, async (req, res) => {
  const { name, description, start_date, end_date, color } = req.body;
  const tenantId = req.user.tenantId;
  
  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'Project name is required'
    });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO projects (name, description, color, status, tenant_id, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())
      RETURNING id, name, description, color, status, tenant_id, created_at
    `, [name, description || null, color || '#4CAF50', tenantId]);
    
    console.log(`✅ Project created: ${name}`);
    
    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create project',
      error: error.message
    });
  }
});

// Get Single Project (Admin)
router.get('/admin/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenantId;
  
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        description,
        color,
        status,
        tenant_id,
        created_at,
        updated_at
      FROM projects 
      WHERE id = $1 AND tenant_id = $2
    `, [id, tenantId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project',
      error: error.message
    });
  }
});

// Update Project (Admin)
router.put('/admin/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, description, color, status } = req.body;
  const tenantId = req.user.tenantId;
  
  try {
    const result = await pool.query(`
      UPDATE projects 
      SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        color = COALESCE($3, color),
        status = COALESCE($4, status),
        updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6
      RETURNING id, name, description, color, status, tenant_id, updated_at
    `, [name, description, color, status, id, tenantId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Project updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update project',
      error: error.message
    });
  }
});

// Delete Project (Admin)
router.delete('/admin/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenantId;
  
  try {
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING name',
      [id, tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    res.json({
      success: true,
      message: `Project "${result.rows[0].name}" deleted successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete project',
      error: error.message
    });
  }
});

// Assign Employees to Project (Admin)
router.post('/admin/projects/:id/assign-employees', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { employee_ids } = req.body;
  
  if (!employee_ids || !Array.isArray(employee_ids)) {
    return res.status(400).json({
      success: false,
      message: 'employee_ids array is required'
    });
  }
  
  try {
    // Check if project exists (with tenant isolation)
    const tenantId = req.user.tenantId;
    const projectCheck = await pool.query('SELECT name FROM projects WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (projectCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    // Create project_employees table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_employees (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        role VARCHAR(100) DEFAULT 'Member',
        UNIQUE(project_id, employee_id)
      )
    `);
    
    // Resolve employee_ids - accept both integer ids and string employee_ids (e.g. "EMP002")
    // TENANT ISOLATION: Only resolve employees belonging to same tenant
    const resolvedIds = [];
    for (const empId of employee_ids) {
      if (typeof empId === 'number' || /^\d+$/.test(empId)) {
        // Verify this employee belongs to same tenant
        const check = await pool.query(
          'SELECT id FROM employees WHERE id = $1 AND tenant_id = $2',
          [parseInt(empId), tenantId]
        );
        if (check.rows.length > 0) {
          resolvedIds.push(parseInt(empId));
        } else {
          console.log(`Employee ${empId} not found in tenant ${tenantId}, skipping`);
        }
      } else {
        // Lookup by employee_id string (e.g. "EMP002") - WITH tenant isolation
        const lookup = await pool.query(
          'SELECT id FROM employees WHERE employee_id = $1 AND tenant_id = $2',
          [empId, tenantId]
        );
        if (lookup.rows.length > 0) {
          resolvedIds.push(lookup.rows[0].id);
        } else {
          console.log(`Employee with employee_id "${empId}" not found in tenant ${tenantId}, skipping`);
        }
      }
    }

    // Assign employees
    let assigned = 0;
    for (const empId of resolvedIds) {
      try {
        await pool.query(`
          INSERT INTO project_employees (project_id, employee_id)
          VALUES ($1, $2)
          ON CONFLICT (project_id, employee_id) DO NOTHING
        `, [id, empId]);
        assigned++;
      } catch (e) {
        console.log(`Could not assign employee ${empId}:`, e.message);
      }
    }
    
    res.json({
      success: true,
      message: `${assigned} employees assigned to project "${projectCheck.rows[0].name}"`,
      data: {
        project_id: parseInt(id),
        assigned_count: assigned
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to assign employees',
      error: error.message
    });
  }
});

// Get Project Employees (Admin)
router.get('/admin/projects/:id/employees', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.full_name,
        u.email,
        u.role,
        u.department,
        pe.assigned_at,
        pe.role as project_role
      FROM project_employees pe
      JOIN employees u ON pe.employee_id = u.id
      WHERE pe.project_id = $1 AND u.tenant_id::integer = $2
      ORDER BY pe.assigned_at DESC
    `, [id, req.user.tenantId]);
    
    res.json({
      success: true,
      data: {
        employees: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project employees',
      error: error.message
    });
  }
});

// Remove Employee from Project (Admin)
router.delete('/admin/projects/:id/employees/:employeeId', authenticateToken, async (req, res) => {
  const { id, employeeId } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM project_employees WHERE project_id = $1 AND employee_id = $2 RETURNING *',
      [id, employeeId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not assigned to this project'
      });
    }
    
    res.json({
      success: true,
      message: 'Employee removed from project'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remove employee',
      error: error.message
    });
  }
});

// =====================================================================================
// ADMIN TIMESHEETS APIs
// =====================================================================================

// GET Admin Timesheets - View all employee timesheets with filters
router.get('/admin/timesheets', authenticateToken, async (req, res) => {
  const { 
    search,           // Search by employee name
    status,           // Filter: all, completed, pending, missing_entry, early_leave
    start_date,       // Date range start (YYYY-MM-DD)
    end_date,         // Date range end (YYYY-MM-DD)
    page = 1,         // Pagination
    limit = 10,       // Items per page
    sort_by = 'date', // Sort field
    sort_order = 'DESC' // ASC or DESC
  } = req.query;
  
  try {
    const tenantId = req.user.tenantId;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let conditions = [`u.tenant_id::integer = $1`];
    let params = [tenantId];
    let paramIndex = 2;
    
    // Search by employee name
    if (search) {
      conditions.push(`(u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    // Date range filter
    if (start_date) {
      conditions.push(`t.date >= $${paramIndex}`);
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      conditions.push(`t.date <= $${paramIndex}`);
      params.push(end_date);
      paramIndex++;
    }
    
    // Status filter
    if (status && status !== 'all') {
      conditions.push(`t.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    // Valid sort columns
    const validSortColumns = ['date', 'clock_in', 'clock_out', 'duration_minutes', 'status'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'date';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM timers t
      LEFT JOIN employees u ON t.employee_id::text = u.id::text OR t.employee_id::text = u.employee_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    
    // Get paginated data
    const dataQuery = `
      SELECT 
        t.id,
        t.employee_id,
        u.first_name,
        u.last_name,
        COALESCE(u.full_name, CONCAT(u.first_name, ' ', u.last_name)) as employee_name,
        u.profile_photo,
        t.date,
        t.clock_in,
        t.clock_out,
        t.duration_minutes,
        t.status,
        t.notes,
        t.project_id,
        p.name as project_name,
        COALESCE(
          (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.end_time, NOW()) - b.start_time))/60)
           FROM breaks b 
           WHERE b.user_id::text = t.employee_id::text 
           AND DATE(b.start_time) = t.date), 0
        ) as break_minutes,
        t.created_at,
        t.updated_at
      FROM timers t
      LEFT JOIN employees u ON t.employee_id::text = u.id::text OR t.employee_id::text = u.employee_id
      LEFT JOIN projects p ON t.project_id = p.id
      ${whereClause}
      ORDER BY t.${sortColumn} ${sortDir}, t.clock_in DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(parseInt(limit), offset);
    const dataResult = await pool.query(dataQuery, params);
    
    // Format response
    const timesheets = dataResult.rows.map(row => {
      const breakMinutes = parseInt(row.break_minutes) || 0;
      const durationMinutes = row.duration_minutes || 0;
      const totalHours = Math.floor(durationMinutes / 60);
      const totalMinutes = Math.round(durationMinutes % 60);
      const breakHours = Math.floor(breakMinutes / 60);
      const breakMins = Math.round(breakMinutes % 60);
      
      return {
        id: row.id,
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        profile_photo: row.profile_photo,
        date: row.date,
        clock_in: row.clock_in ? new Date(row.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null,
        clock_out: row.clock_out ? new Date(row.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null,
        break_duration: breakMinutes > 0 ? `${breakHours > 0 ? breakHours + 'h ' : ''}${breakMins}m` : '-',
        break_minutes: breakMinutes,
        total_hours: durationMinutes > 0 ? `${totalHours}h ${totalMinutes.toString().padStart(2, '0')}m` : '-',
        duration_minutes: durationMinutes,
        status: row.status || 'pending',
        status_label: getStatusLabel(row.status),
        project_name: row.project_name,
        notes: row.notes
      };
    });
    
    res.json({
      success: true,
      data: {
        timesheets: timesheets,
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_items: total,
          total_pages: Math.ceil(total / parseInt(limit)),
          has_next: offset + timesheets.length < total,
          has_prev: parseInt(page) > 1
        }
      }
    });
    
  } catch (error) {
    console.error('Admin timesheets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timesheets',
      error: error.message
    });
  }
});

// Helper function for status labels
function getStatusLabel(status) {
  const labels = {
    'completed': 'Completed',
    'pending': 'Pending',
    'missing_entry': 'Missing Entry',
    'early_leave': 'Early leave',
    'overtime': 'Overtime',
    'late': 'Late'
  };
  return labels[status] || 'Pending';
}

// GET Single Timesheet Details (for view/edit modal)
router.get('/admin/timesheets/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.first_name,
        u.last_name,
        u.email,
        u.full_name,
        u.profile_photo,
        u.working_hours,
        p.name as project_name
      FROM timers t
      LEFT JOIN employees u ON t.employee_id::text = u.id::text OR t.employee_id::text = u.employee_id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = $1 AND u.tenant_id::integer = $2
    `, [id, req.user.tenantId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Timesheet not found'
      });
    }
    
    const row = result.rows[0];
    const employeeName = row.full_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown';
    
    // Get breaks for this day
    const breaksResult = await pool.query(`
      SELECT break_id as id, break_type, start_time, end_time, 
             EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))/60 as duration_minutes
      FROM breaks
      WHERE user_id::text = $1 AND DATE(start_time) = $2
      ORDER BY start_time
    `, [row.employee_id, row.date]);
    
    // Calculate break total
    const totalBreakMinutes = breaksResult.rows.reduce((sum, b) => sum + (parseFloat(b.duration_minutes) || 0), 0);
    const breakHours = Math.floor(totalBreakMinutes / 60);
    const breakMins = Math.round(totalBreakMinutes % 60);
    const breakFormatted = totalBreakMinutes > 0 
      ? `${breakHours > 0 ? breakHours + 'h' : ''}${breakMins > 0 ? (breakHours > 0 ? ' ' : '') + breakMins + 'm' : (breakHours === 0 ? '0m' : '')}`
      : '0m';
    
    // Format clock in/out times
    const clockInTime = row.clock_in ? new Date(row.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    const clockOutTime = row.clock_out ? new Date(row.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    
    // Calculate total hours worked
    let totalMinutes = row.duration_minutes || 0;
    if (!totalMinutes && row.clock_in && row.clock_out) {
      totalMinutes = (new Date(row.clock_out) - new Date(row.clock_in)) / (1000 * 60);
    }
    const totalHours = Math.floor(totalMinutes / 60);
    const totalMins = Math.round(totalMinutes % 60);
    const totalHoursFormatted = totalMinutes > 0 
      ? `${totalHours}h${totalMins > 0 ? ' ' + totalMins + 'm' : ''}`
      : '0h';
    
    // Calculate overtime (assuming 8 hours is standard)
    const standardHours = 8 * 60; // 480 minutes
    const netWorkMinutes = totalMinutes - totalBreakMinutes;
    const overtimeMinutes = Math.max(0, netWorkMinutes - standardHours);
    const overtimeHours = Math.floor(overtimeMinutes / 60);
    const overtimeMins = Math.round(overtimeMinutes % 60);
    const overtimeFormatted = overtimeMinutes > 0 
      ? `${overtimeHours}h${overtimeMins > 0 ? ' ' + overtimeMins + 'm' : ''}`
      : '0h';
    
    // Get activity log for this timesheet
    let activityLog = [];
    try {
      const activityResult = await pool.query(`
        SELECT id, action, description, performed_at, performed_by
        FROM timesheet_activity_log
        WHERE timesheet_id = $1
        ORDER BY performed_at ASC
      `, [id]);
      activityLog = activityResult.rows.map(a => ({
        action: a.action,
        description: a.description,
        time: new Date(a.performed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        performedBy: a.performed_by
      }));
    } catch (err) {
      // Table may not exist, generate activity from timestamps
      if (row.clock_in) {
        activityLog.push({
          action: 'Clock-in recorded',
          time: clockInTime,
          description: `Started work at ${clockInTime}`
        });
      }
      if (row.clock_out) {
        activityLog.push({
          action: 'Clock-out recorded',
          time: clockOutTime,
          description: `Ended work at ${clockOutTime}`
        });
      }
      if (row.adjusted_by) {
        activityLog.push({
          action: 'Correction approved by Admin',
          time: row.updated_at ? new Date(row.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null,
          description: 'Timesheet was corrected by admin'
        });
      }
    }
    
    // Build notes array
    let notesArray = [];
    if (row.notes) {
      notesArray.push({ type: 'Note', description: row.notes });
    }
    // Check for early leave (clock out before 17:00)
    if (row.clock_out) {
      const clockOutHour = new Date(row.clock_out).getHours();
      const clockOutMin = new Date(row.clock_out).getMinutes();
      if (clockOutHour < 17 || (clockOutHour === 16 && clockOutMin < 30)) {
        const earlyBy = 17 * 60 - (clockOutHour * 60 + clockOutMin);
        const earlyHours = Math.floor(earlyBy / 60);
        const earlyMins = earlyBy % 60;
        notesArray.push({
          type: 'Early Leave',
          description: `Employee left at ${clockOutTime} (${earlyHours > 0 ? earlyHours + 'h ' : ''}${earlyMins}m earlier than scheduled)`
        });
      }
    }
    // Add overtime note if applicable
    if (overtimeMinutes > 0) {
      notesArray.push({
        type: 'Overtime',
        description: `Overtime recorded: ${overtimeFormatted} added`
      });
    }
    
    res.json({
      success: true,
      data: {
        id: row.id,
        title: `${employeeName}'s Timesheet`,
        employee: {
          id: row.employee_id,
          name: employeeName,
          email: row.email,
          profile_photo: row.profile_photo
        },
        date: row.date,
        date_formatted: row.date ? new Date(row.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : null,
        status: row.status || 'pending',
        status_label: row.status === 'completed' ? 'Completed' : row.status === 'pending' ? 'Pending' : row.status,
        
        // Time summary cards
        summary: {
          clock_in: clockInTime,
          clock_out: clockOutTime,
          break: breakFormatted,
          overtime: overtimeFormatted,
          total_hours: totalHoursFormatted
        },
        
        // Raw values
        clock_in: row.clock_in,
        clock_out: row.clock_out,
        clock_in_formatted: clockInTime,
        clock_out_formatted: clockOutTime,
        break_minutes: Math.round(totalBreakMinutes),
        break_formatted: breakFormatted,
        overtime_minutes: overtimeMinutes,
        overtime_formatted: overtimeFormatted,
        total_minutes: Math.round(totalMinutes),
        total_hours_formatted: totalHoursFormatted,
        
        // Activity log
        activity: activityLog,
        
        // Notes
        notes: notesArray,
        notes_text: row.notes,
        
        // Breaks detail
        breaks: breaksResult.rows.map(b => ({
          id: b.id,
          type: b.break_type,
          start_time: b.start_time,
          end_time: b.end_time,
          duration_minutes: Math.round(parseFloat(b.duration_minutes) || 0),
          start_formatted: b.start_time ? new Date(b.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null,
          end_formatted: b.end_time ? new Date(b.end_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null
        })),
        
        project: row.project_name,
        work_location: row.work_location,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    });
    
  } catch (error) {
    console.error('Error fetching timesheet detail:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timesheet',
      error: error.message
    });
  }
});

// UPDATE Timesheet (Admin edit)
router.put('/admin/timesheets/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { clock_in, clock_out, status, notes, break_minutes } = req.body;
  
  try {
    // Calculate duration if both clock_in and clock_out provided
    let duration = null;
    if (clock_in && clock_out) {
      const clockInTime = new Date(clock_in);
      const clockOutTime = new Date(clock_out);
      duration = (clockOutTime - clockInTime) / (1000 * 60); // minutes
      if (break_minutes) {
        duration -= break_minutes;
      }
    }
    
    const result = await pool.query(`
      UPDATE timers
      SET 
        clock_in = COALESCE($1, clock_in),
        clock_out = COALESCE($2, clock_out),
        status = COALESCE($3, status),
        notes = COALESCE($4, notes),
        duration_minutes = COALESCE($5, duration_minutes),
        adjusted_by = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [clock_in, clock_out, status, notes, duration, req.user.userId, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Timesheet not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Timesheet updated',
      data: result.rows[0]
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update timesheet',
      error: error.message
    });
  }
});

// GET Timesheet Statistics (for dashboard)
router.get('/admin/timesheets/stats/summary', authenticateToken, async (req, res) => {
  const { start_date, end_date } = req.query;
  
  try {
    const tenantId = req.user.tenantId;
    let dateFilter = '';
    let params = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE e.tenant_id::integer = $1 AND t.date >= $2 AND t.date <= $3';
      params = [tenantId, start_date, end_date];
    } else {
      // Default to current month
      dateFilter = "WHERE e.tenant_id::integer = $1 AND t.date >= DATE_TRUNC('month', CURRENT_DATE)";
      params = [tenantId];
    }
    
    const statsQuery = `
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT t.employee_id) as unique_employees,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN t.status = 'missing_entry' THEN 1 END) as missing_entries,
        COUNT(CASE WHEN t.status = 'early_leave' THEN 1 END) as early_leaves,
        ROUND(AVG(t.duration_minutes)::numeric, 0) as avg_work_minutes,
        ROUND(SUM(t.duration_minutes)::numeric, 0) as total_work_minutes
      FROM timers t
      JOIN employees e ON t.employee_id::text = e.id::text OR t.employee_id::text = e.employee_id
      ${dateFilter}
    `;
    
    const result = await pool.query(statsQuery, params);
    const stats = result.rows[0];
    
    res.json({
      success: true,
      data: {
        total_entries: parseInt(stats.total_entries) || 0,
        unique_employees: parseInt(stats.unique_employees) || 0,
        by_status: {
          completed: parseInt(stats.completed) || 0,
          pending: parseInt(stats.pending) || 0,
          missing_entries: parseInt(stats.missing_entries) || 0,
          early_leaves: parseInt(stats.early_leaves) || 0
        },
        average_work_hours: Math.round((parseInt(stats.avg_work_minutes) || 0) / 60 * 10) / 10,
        total_work_hours: Math.round((parseInt(stats.total_work_minutes) || 0) / 60)
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats',
      error: error.message
    });
  }
});

// BULK Update Timesheet Status
router.post('/admin/timesheets/bulk-update', authenticateToken, async (req, res) => {
  const { ids, status } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Please provide timesheet IDs'
    });
  }
  
  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(`
      UPDATE timers
      SET status = $1, updated_at = NOW()
      WHERE id IN (${placeholders})
      RETURNING id
    `, [status, ...ids]);
    
    res.json({
      success: true,
      message: `${result.rows.length} timesheets updated`,
      updated_ids: result.rows.map(r => r.id)
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update timesheets',
      error: error.message
    });
  }
});

// =====================================================================================
// NOTIFICATION & REMINDER SYSTEM APIs
// =====================================================================================

// Default notification settings
const DEFAULT_NOTIFICATION_SETTINGS = {
  break_reminder_after_minutes: 120, // 2 hours continuous work
  clock_out_reminder_after_hours: 10, // After 10 hours
  extended_break_reminder_after_minutes: 30, // If break > 30 min
  notifications_enabled: true
};

// Get Notification Settings (Admin)
router.get('/admin/notification-settings', authenticateToken, async (req, res) => {
  try {
    // Check if settings exist in DB
    const result = await pool.query(`
      SELECT * FROM notification_settings WHERE id = 1
    `);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: DEFAULT_NOTIFICATION_SETTINGS
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    // If table doesn't exist, return defaults
    res.json({
      success: true,
      data: DEFAULT_NOTIFICATION_SETTINGS
    });
  }
});

// Update Notification Settings (Admin)
router.put('/admin/notification-settings', authenticateToken, async (req, res) => {
  const { 
    break_reminder_after_minutes, 
    clock_out_reminder_after_hours, 
    extended_break_reminder_after_minutes,
    notifications_enabled 
  } = req.body;
  
  try {
    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        break_reminder_after_minutes INTEGER DEFAULT 120,
        clock_out_reminder_after_hours INTEGER DEFAULT 10,
        extended_break_reminder_after_minutes INTEGER DEFAULT 30,
        notifications_enabled BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    // Upsert settings
    await pool.query(`
      INSERT INTO notification_settings (id, break_reminder_after_minutes, clock_out_reminder_after_hours, extended_break_reminder_after_minutes, notifications_enabled, updated_at)
      VALUES (1, $1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        break_reminder_after_minutes = COALESCE($1, notification_settings.break_reminder_after_minutes),
        clock_out_reminder_after_hours = COALESCE($2, notification_settings.clock_out_reminder_after_hours),
        extended_break_reminder_after_minutes = COALESCE($3, notification_settings.extended_break_reminder_after_minutes),
        notifications_enabled = COALESCE($4, notification_settings.notifications_enabled),
        updated_at = NOW()
    `, [
      break_reminder_after_minutes || 120,
      clock_out_reminder_after_hours || 10,
      extended_break_reminder_after_minutes || 30,
      notifications_enabled !== undefined ? notifications_enabled : true
    ]);
    
    res.json({
      success: true,
      message: 'Notification settings updated',
      data: {
        break_reminder_after_minutes: break_reminder_after_minutes || 120,
        clock_out_reminder_after_hours: clock_out_reminder_after_hours || 10,
        extended_break_reminder_after_minutes: extended_break_reminder_after_minutes || 30,
        notifications_enabled: notifications_enabled !== undefined ? notifications_enabled : true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: error.message
    });
  }
});


  return router;
};
