/**
 * leave-policy Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ==================== LEAVE POLICIES APIs ====================

// GET /api/admin/leave-policies - Get all leave policies (Admin)
router.get('/admin/leave-policies', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can view leave policies'
    });
  }

  try {
    const { leave_type_id, country_code, is_active } = req.query;
    
    let query = `
      SELECT lp.*, lt.name as leave_type_name
      FROM leave_policies lp
      LEFT JOIN leave_types lt ON lp.leave_type_id = lt.id
      WHERE lp.tenant_id::integer = $1
    `;
    const params = [req.user.tenantId];
    let paramIndex = 2;

    if (leave_type_id) {
      query += ` AND lp.leave_type_id = $${paramIndex}`;
      params.push(leave_type_id);
      paramIndex++;
    }

    if (country_code) {
      query += ` AND lp.country_code = $${paramIndex}`;
      params.push(country_code.toUpperCase());
      paramIndex++;
    }

    if (is_active !== undefined) {
      query += ` AND lp.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }

    query += ` ORDER BY lp.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Leave policies retrieved successfully',
      data: {
        policies: result.rows,
        total_count: result.rows.length
      }
    });
  } catch (error) {
    console.error('❌ Error fetching leave policies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave policies',
      error: error.message
    });
  }
});

// GET /api/admin/leave-policies/:id - Get single leave policy
router.get('/admin/leave-policies/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const policyId = parseInt(req.params.id);

  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can view leave policies'
    });
  }

  try {
    const result = await pool.query(`
      SELECT lp.*, lt.name as leave_type_name
      FROM leave_policies lp
      LEFT JOIN leave_types lt ON lp.leave_type_id = lt.id
      WHERE lp.id = $1 AND lp.tenant_id::integer = $2
    `, [policyId, req.user.tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    res.json({
      success: true,
      data: { policy: result.rows[0] }
    });
  } catch (error) {
    console.error('❌ Error fetching leave policy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave policy',
      error: error.message
    });
  }
});

// POST /api/admin/leave-policies - Create leave policy (Admin)
router.post('/admin/leave-policies', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can create leave policies'
    });
  }

  const {
    leave_type_id,
    country_code = 'CH',
    region_code,
    tenant_id,
    min_days,
    max_days,
    max_per_year,
    salary_percentage = 100,
    is_paid = true,
    is_eo_relevant = false,
    requires_approval = true,
    requires_document = false,
    gender,
    applicable_after_days,
    carry_forward_allowed = false,
    carry_forward_limit,
    encashment_allowed = false,
    description,
    valid_from,
    valid_to,
    is_active = true
  } = req.body;

  if (!leave_type_id) {
    return res.status(400).json({
      success: false,
      message: 'leave_type_id is required'
    });
  }

  try {
    // Verify leave type exists
    const leaveTypeCheck = await pool.query('SELECT id, name FROM leave_types WHERE id = $1', [leave_type_id]);
    if (leaveTypeCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid leave_type_id'
      });
    }

    const result = await pool.query(`
      INSERT INTO leave_policies (
        leave_type_id, country_code, region_code, tenant_id,
        min_days, max_days, max_per_year, salary_percentage,
        is_paid, is_eo_relevant, requires_approval, requires_document,
        gender, applicable_after_days, carry_forward_allowed, carry_forward_limit,
        encashment_allowed, description, valid_from, valid_to,
        is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `, [
      leave_type_id, country_code.toUpperCase(), region_code, tenant_id,
      min_days, max_days, max_per_year, salary_percentage,
      is_paid, is_eo_relevant, requires_approval, requires_document,
      gender, applicable_after_days, carry_forward_allowed, carry_forward_limit,
      encashment_allowed, description, valid_from, valid_to,
      is_active, userId
    ]);

    const newPolicy = result.rows[0];
    newPolicy.leave_type_name = leaveTypeCheck.rows[0].name;

    console.log(`✅ Leave policy created for ${leaveTypeCheck.rows[0].name} by ${user.full_name}`);

    res.status(201).json({
      success: true,
      message: 'Leave policy created successfully',
      data: { policy: newPolicy }
    });
  } catch (error) {
    console.error('❌ Error creating leave policy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create leave policy',
      error: error.message
    });
  }
});

// PUT /api/admin/leave-policies/:id - Update leave policy (Admin)
router.put('/admin/leave-policies/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const policyId = parseInt(req.params.id);

  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can update leave policies'
    });
  }

  try {
    // Check if policy exists (with tenant isolation)
    const existing = await pool.query('SELECT * FROM leave_policies WHERE id = $1 AND tenant_id::integer = $2', [policyId, req.user.tenantId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    const current = existing.rows[0];
    const {
      leave_type_id = current.leave_type_id,
      country_code = current.country_code,
      region_code = current.region_code,
      tenant_id = current.tenant_id,
      min_days = current.min_days,
      max_days = current.max_days,
      max_per_year = current.max_per_year,
      salary_percentage = current.salary_percentage,
      is_paid = current.is_paid,
      is_eo_relevant = current.is_eo_relevant,
      requires_approval = current.requires_approval,
      requires_document = current.requires_document,
      gender = current.gender,
      applicable_after_days = current.applicable_after_days,
      carry_forward_allowed = current.carry_forward_allowed,
      carry_forward_limit = current.carry_forward_limit,
      encashment_allowed = current.encashment_allowed,
      description = current.description,
      valid_from = current.valid_from,
      valid_to = current.valid_to,
      is_active = current.is_active
    } = req.body;

    const result = await pool.query(`
      UPDATE leave_policies SET
        leave_type_id = $1, country_code = $2, region_code = $3, tenant_id = $4,
        min_days = $5, max_days = $6, max_per_year = $7, salary_percentage = $8,
        is_paid = $9, is_eo_relevant = $10, requires_approval = $11, requires_document = $12,
        gender = $13, applicable_after_days = $14, carry_forward_allowed = $15, carry_forward_limit = $16,
        encashment_allowed = $17, description = $18, valid_from = $19, valid_to = $20,
        is_active = $21, updated_by = $22, updated_at = NOW()
      WHERE id = $23
      RETURNING *
    `, [
      leave_type_id, country_code, region_code, tenant_id,
      min_days, max_days, max_per_year, salary_percentage,
      is_paid, is_eo_relevant, requires_approval, requires_document,
      gender, applicable_after_days, carry_forward_allowed, carry_forward_limit,
      encashment_allowed, description, valid_from, valid_to,
      is_active, userId, policyId
    ]);

    console.log(`✅ Leave policy ${policyId} updated by ${user.full_name}`);

    res.json({
      success: true,
      message: 'Leave policy updated successfully',
      data: { policy: result.rows[0] }
    });
  } catch (error) {
    console.error('❌ Error updating leave policy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update leave policy',
      error: error.message
    });
  }
});

// DELETE /api/admin/leave-policies/:id - Delete leave policy (Admin)
router.delete('/admin/leave-policies/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const policyId = parseInt(req.params.id);

  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can delete leave policies'
    });
  }

  try {
    const result = await pool.query(
      'DELETE FROM leave_policies WHERE id = $1 AND tenant_id::integer = $2 RETURNING id, leave_type_id',
      [policyId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave policy not found'
      });
    }

    console.log(`✅ Leave policy ${policyId} deleted by ${user.full_name}`);

    res.json({
      success: true,
      message: 'Leave policy deleted successfully',
      data: { deleted_id: policyId }
    });
  } catch (error) {
    console.error('❌ Error deleting leave policy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete leave policy',
      error: error.message
    });
  }
});

// ==================== END LEAVE POLICIES APIs ====================

// PUT /api/admin/employees/:employeeId/leave-balance - Admin Adjust Employee Leave Balance
router.put('/admin/employees/:employeeId/leave-balance', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const adminName = req.user.name || 'Admin';
  const tenantId = req.user.tenantId;
  const employeeId = req.params.employeeId;

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins and managers can adjust leave balances'
    });
  }

  try {
    const {
      leave_type_id,
      adjustment_amount,
      adjustment_type = 'total_allocated',
      reason = ''
    } = req.body;

    // Validation
    if (!leave_type_id || adjustment_amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'leave_type_id and adjustment_amount are required'
      });
    }

    if (!['total_allocated', 'used_days'].includes(adjustment_type)) {
      return res.status(400).json({
        success: false,
        message: 'adjustment_type must be either "total_allocated" or "used_days"'
      });
    }

    // Get employee info - support both numeric id and string employee_id (e.g. EMP002)
    const empResult = await pool.query(
      'SELECT id, employee_id, full_name FROM employees WHERE (employee_id = $1 OR id::text = $1) AND tenant_id::integer = $2',
      [employeeId, tenantId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const employee = empResult.rows[0];

    // Get existing balance
    const balanceResult = await pool.query(`
      SELECT id, total_allocated, used_days, pending_days
      FROM employee_leave_balances
      WHERE employee_id = $1 AND leave_type_id = $2 AND tenant_id = $3
    `, [employee.employee_id, leave_type_id, tenantId]);

    let balance = {};
    let balanceId;

    if (balanceResult.rows.length === 0) {
      // Create new balance record if it doesn't exist
      const newBalance = await pool.query(`
        INSERT INTO employee_leave_balances 
        (employee_id, leave_type_id, tenant_id, total_allocated, used_days, pending_days, notes)
        VALUES ($1, $2, $3, $4, 0, 0, $5)
        RETURNING id, total_allocated, used_days, pending_days
      `, [
        employee.employee_id,
        leave_type_id,
        tenantId,
        adjustment_type === 'total_allocated' ? adjustment_amount : 0,
        `Initial balance adjustment by ${adminName}: ${reason}`
      ]);
      balance = newBalance.rows[0];
      balanceId = newBalance.rows[0].id;
    } else {
      balance = balanceResult.rows[0];
      balanceId = balance.id;
    }

    // Calculate new values based on adjustment type
    let newTotalAllocated = parseFloat(balance.total_allocated);
    let newUsedDays = parseFloat(balance.used_days);

    if (adjustment_type === 'total_allocated') {
      newTotalAllocated = parseFloat(balance.total_allocated) + parseFloat(adjustment_amount);
    } else if (adjustment_type === 'used_days') {
      newUsedDays = parseFloat(balance.used_days) + parseFloat(adjustment_amount);
    }

    // Validate that values don't go negative
    if (newTotalAllocated < 0) {
      return res.status(400).json({
        success: false,
        message: 'Total allocated balance cannot be negative'
      });
    }

    if (newUsedDays < 0) {
      return res.status(400).json({
        success: false,
        message: 'Used days cannot be negative'
      });
    }

    // Update balance
    const updateResult = await pool.query(`
      UPDATE employee_leave_balances
      SET 
        total_allocated = $1,
        used_days = $2,
        notes = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING id, employee_id, leave_type_id, total_allocated, used_days, pending_days
    `, [
      newTotalAllocated,
      newUsedDays,
      `${reason} | Adjusted by ${adminName} on ${new Date().toISOString()}`,
      balanceId
    ]);

    const updatedBalance = updateResult.rows[0];

    console.log(`✅ Leave balance adjusted for employee ${employee.full_name} (ID: ${employeeId})`);
    console.log(`   Leave Type: ${leave_type_id}, Adjustment: ${adjustment_amount} (${adjustment_type})`);
    console.log(`   New Balance: Total=${newTotalAllocated}, Used=${newUsedDays}`);

    res.json({
      success: true,
      message: 'Leave balance adjusted successfully',
      data: {
        employeeId: employee.id,
        employeeName: employee.full_name,
        leaveTypeId: updatedBalance.leave_type_id,
        adjustment: {
          type: adjustment_type,
          amount: adjustment_amount,
          reason: reason,
          adjustedBy: adminName,
          adjustedAt: new Date().toISOString()
        },
        newBalance: {
          totalAllocated: parseFloat(updatedBalance.total_allocated),
          usedDays: parseFloat(updatedBalance.used_days),
          pendingDays: parseFloat(updatedBalance.pending_days),
          availableDays: Math.max(0, parseFloat(updatedBalance.total_allocated) - parseFloat(updatedBalance.used_days) - parseFloat(updatedBalance.pending_days))
        }
      }
    });
  } catch (error) {
    console.error('❌ Error adjusting leave balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to adjust leave balance',
      error: error.message
    });
  }
});

// GET /api/admin/employees/:employeeId/leave-balance - Admin Get Employee Leave Balance
router.get('/admin/employees/:employeeId/leave-balance', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const adminName = req.user.name || 'Admin';
  const tenantId = req.user.tenantId;
  const employeeId = req.params.employeeId;

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins and managers can view leave balances'
    });
  }

  try {
    // Get employee info
    const empResult = await pool.query(
      'SELECT id, employee_id, full_name, email, department FROM employees WHERE (employee_id = $1 OR id::text = $1) AND tenant_id::integer = $2',
      [employeeId, tenantId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const employee = empResult.rows[0];

    // Get all leave types for this tenant
    let leaveTypesResult = await pool.query(`
      SELECT id, name, code, is_paid, days_allowed, salary_percentage, description
      FROM leave_types
      WHERE is_active = true AND tenant_id = $1
      ORDER BY id
    `, [tenantId]);

    // Fallback to system defaults if no tenant-specific leave types
    if (leaveTypesResult.rows.length === 0) {
      leaveTypesResult = await pool.query(`
        SELECT id, name, code, is_paid, days_allowed, salary_percentage, description
        FROM leave_types
        WHERE is_active = true AND tenant_id IS NULL
        ORDER BY id
      `);
    }

    // Get employee's leave balances
    const balancesResult = await pool.query(`
      SELECT 
        id, leave_type_id, total_allocated, used_days, pending_days, notes,
        created_at, updated_at
      FROM employee_leave_balances
      WHERE employee_id = $1 AND tenant_id = $2
      ORDER BY leave_type_id
    `, [employee.employee_id, tenantId]);

    // Get used and pending leaves from leave_requests
    const leavesResult = await pool.query(`
      SELECT 
        lt.id as leave_type_id,
        SUM(CASE WHEN lr.status = 'approved' THEN 
          CASE 
            WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1)
            ELSE 1
          END
        ELSE 0 END) as used_days,
        SUM(CASE WHEN lr.status = 'pending' THEN 
          CASE 
            WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1)
            ELSE 1
          END
        ELSE 0 END) as pending_days
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id OR lr.leave_type = lt.name
      WHERE lr.employee_id = $1
      GROUP BY lt.id
    `, [employee.employee_id]);

    const usedAndPending = {};
    leavesResult.rows.forEach(row => {
      if (row.leave_type_id) {
        usedAndPending[row.leave_type_id] = {
          used: parseFloat(row.used_days) || 0,
          pending: parseFloat(row.pending_days) || 0
        };
      }
    });

    // Build leave balances array
    const leaveBalances = [];
    const balancesMap = {};
    balancesResult.rows.forEach(row => {
      balancesMap[row.leave_type_id] = row;
    });

    leaveTypesResult.rows.forEach(leaveType => {
      const balance = balancesMap[leaveType.id];
      const totalAllocated = balance ? parseFloat(balance.total_allocated) : leaveType.days_allowed || 0;
      const used = usedAndPending[leaveType.id]?.used || (balance ? parseFloat(balance.used_days) : 0);
      const pending = usedAndPending[leaveType.id]?.pending || (balance ? parseFloat(balance.pending_days) : 0);
      const available = Math.max(0, totalAllocated - used - pending);

      leaveBalances.push({
        leaveTypeId: leaveType.id,
        name: leaveType.name,
        code: leaveType.code,
        isPaid: leaveType.is_paid,
        salaryPercentage: leaveType.salary_percentage,
        totalAllocated: totalAllocated,
        usedDays: used,
        pendingDays: pending,
        availableDays: available,
        description: leaveType.description,
        notes: balance?.notes || null,
        lastUpdated: balance?.updated_at || null
      });
    });

    console.log(`✅ Admin ${adminName} retrieved leave balance for ${employee.full_name}`);

    res.json({
      success: true,
      message: 'Employee leave balance retrieved successfully',
      data: {
        employee: {
          id: employee.id,
          employeeId: employee.employee_id,
          name: employee.full_name,
          email: employee.email,
          department: employee.department
        },
        leaveBalances: leaveBalances,
        summary: {
          totalTypes: leaveBalances.length,
          totalAllocated: leaveBalances.reduce((sum, b) => sum + b.totalAllocated, 0),
          totalUsed: leaveBalances.reduce((sum, b) => sum + b.usedDays, 0),
          totalPending: leaveBalances.reduce((sum, b) => sum + b.pendingDays, 0),
          totalAvailable: leaveBalances.reduce((sum, b) => sum + b.availableDays, 0)
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching employee leave balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee leave balance',
      error: error.message
    });
  }
});

// GET /api/admin/leave-balances - Admin Get ALL Employees Leave Balances
router.get('/admin/leave-balances', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins and managers can view leave balances'
    });
  }

  try {
    // Get all employees for this tenant
    const empResult = await pool.query(
      'SELECT id, employee_id, full_name, email, department FROM employees WHERE tenant_id::integer = $1 ORDER BY full_name',
      [tenantId]
    );

    if (empResult.rows.length === 0) {
      return res.json({
        success: true,
        message: 'No employees found',
        data: { employees: [], total: 0 }
      });
    }

    // Get all leave types for this tenant
    let leaveTypesResult3 = await pool.query(`
      SELECT id, name, code, is_paid, days_allowed, salary_percentage
      FROM leave_types
      WHERE is_active = true AND tenant_id = $1
      ORDER BY id
    `, [tenantId]);

    // Fallback to system defaults if no tenant-specific leave types
    if (leaveTypesResult3.rows.length === 0) {
      leaveTypesResult3 = await pool.query(`
        SELECT id, name, code, is_paid, days_allowed, salary_percentage
        FROM leave_types
        WHERE is_active = true AND tenant_id IS NULL
        ORDER BY id
      `);
    }

    const leaveTypes = leaveTypesResult3.rows;

    // Get all balances for this tenant
    const balancesResult = await pool.query(`
      SELECT employee_id, leave_type_id, total_allocated, used_days, pending_days
      FROM employee_leave_balances
      WHERE tenant_id = $1
    `, [tenantId]);

    const balancesMap = {};
    balancesResult.rows.forEach(row => {
      const key = `${row.employee_id}_${row.leave_type_id}`;
      balancesMap[key] = row;
    });

    // Get used/pending from leave_requests for all employees
    const employeeIds = empResult.rows.map(e => e.employee_id);
    const leavesResult = await pool.query(`
      SELECT 
        lr.employee_id,
        lt.id as leave_type_id,
        SUM(CASE WHEN lr.status = 'approved' THEN 
          CASE WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1) ELSE 1 END
        ELSE 0 END) as used_days,
        SUM(CASE WHEN lr.status = 'pending' THEN 
          CASE WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1) ELSE 1 END
        ELSE 0 END) as pending_days
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id OR lr.leave_type = lt.name
      WHERE lr.employee_id = ANY($1)
      GROUP BY lr.employee_id, lt.id
    `, [employeeIds]);

    const usedPendingMap = {};
    leavesResult.rows.forEach(row => {
      if (row.leave_type_id) {
        const key = `${row.employee_id}_${row.leave_type_id}`;
        usedPendingMap[key] = {
          used: parseFloat(row.used_days) || 0,
          pending: parseFloat(row.pending_days) || 0
        };
      }
    });

    // Build response
    const employees = empResult.rows.map(emp => {
      const balances = leaveTypes.map(lt => {
        const key = `${emp.employee_id}_${lt.id}`;
        const balance = balancesMap[key];
        const usedPending = usedPendingMap[key];

        const totalAllocated = balance ? parseFloat(balance.total_allocated) : lt.days_allowed || 0;
        const used = usedPending?.used || (balance ? parseFloat(balance.used_days) : 0);
        const pending = usedPending?.pending || (balance ? parseFloat(balance.pending_days) : 0);
        const available = Math.max(0, totalAllocated - used - pending);

        return {
          leaveTypeId: lt.id,
          name: lt.name,
          code: lt.code,
          isPaid: lt.is_paid,
          totalAllocated,
          usedDays: used,
          pendingDays: pending,
          availableDays: available
        };
      });

      return {
        employeeId: emp.id,
        employeeCode: emp.employee_id,
        name: emp.full_name,
        email: emp.email,
        department: emp.department,
        leaveBalances: balances,
        summary: {
          totalAllocated: balances.reduce((s, b) => s + b.totalAllocated, 0),
          totalUsed: balances.reduce((s, b) => s + b.usedDays, 0),
          totalPending: balances.reduce((s, b) => s + b.pendingDays, 0),
          totalAvailable: balances.reduce((s, b) => s + b.availableDays, 0)
        }
      };
    });

    res.json({
      success: true,
      message: 'All employees leave balances retrieved',
      data: {
        employees,
        total: employees.length,
        leaveTypes: leaveTypes.map(lt => ({ id: lt.id, name: lt.name, code: lt.code }))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching all leave balances:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave balances',
      error: error.message
    });
  }
});

// GET /api/me/leave-types - Get active leave types for employees (tenant-isolated)
router.get('/me/leave-types', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  try {
    let result = await pool.query(`
      SELECT 
        id, name, description, days_allowed, color, 
        requires_approval, is_paid
      FROM leave_types
      WHERE is_active = true AND tenant_id::integer = $1
      ORDER BY name ASC
    `, [tenantId]);

    // Fallback to system defaults if no tenant-specific leave types
    if (result.rows.length === 0) {
      result = await pool.query(`
        SELECT 
          id, name, description, days_allowed, color, 
          requires_approval, is_paid
        FROM leave_types
        WHERE is_active = true AND tenant_id IS NULL
        ORDER BY name ASC
      `);
    }

    res.json({
      success: true,
      message: 'Active leave types retrieved successfully',
      data: {
        leave_types: result.rows,
        total_count: result.rows.length
      }
    });
  } catch (error) {
    console.error('❌ Error fetching leave types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave types',
      error: error.message
    });
  }
});

// =====================================
// TIME ENTRIES APIs - Production Database
// =====================================

// GET /api/me/time-entries - Get user's time entries with pagination and filtering
router.get('/me/time-entries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, startDate, endDate, source, workLocation } = req.query;
    
    // Build query with filters
    let query = `
      SELECT 
        id, employee_id, date, clock_in, clock_out, 
        duration_minutes, source, work_location, 
        contract_id, remarks, is_adjusted, adjusted_by,
        created_at, updated_at
      FROM time_entries
      WHERE employee_id = $1
    `;
    
    const params = [userId];
    let paramIndex = 2;
    
    // Add date filters
    if (startDate) {
      query += ` AND date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    // Add source filter
    if (source) {
      query += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }
    
    // Add work location filter
    if (workLocation) {
      query += ` AND work_location = $${paramIndex}`;
      params.push(workLocation);
      paramIndex++;
    }
    
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${query}) as filtered_count`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Add pagination and sorting
    query += ` ORDER BY date DESC, clock_in DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: "Time entries retrieved successfully",
      data: {
        entries: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching time entries:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching time entries",
      error: error.message
    });
  }
});

// POST /api/me/time-entries - Create a new time entry
router.post('/me/time-entries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, clockIn, clockOut, source = 'API', workLocation = 'office', contractId, remarks } = req.body;
    
    // Validation
    if (!date || !clockIn) {
      return res.status(400).json({
        success: false,
        message: "Date and clock_in time are required"
      });
    }
    
    // Calculate duration in minutes
    let durationMinutes = null;
    if (clockOut) {
      const start = new Date(clockIn);
      const end = new Date(clockOut);
      const durationMs = end - start;
      durationMinutes = Math.round(durationMs / (1000 * 60));
      
      if (durationMinutes < 0) {
        return res.status(400).json({
          success: false,
          message: "Clock out time must be after clock in time"
        });
      }
    }
    
    // Insert into database
    const result = await pool.query(`
      INSERT INTO time_entries 
      (employee_id, date, clock_in, clock_out, duration_minutes, source, work_location, contract_id, remarks, is_adjusted)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
      RETURNING *
    `, [userId, date, clockIn, clockOut || null, durationMinutes, source, workLocation, contractId || null, remarks || null]);
    
    res.json({
      success: true,
      message: "Time entry created successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating time entry:', error);
    res.status(500).json({
      success: false,
      message: "Error creating time entry",
      error: error.message
    });
  }
});

// PUT /api/me/time-entries/:id - Update a time entry
router.put('/me/time-entries/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = parseInt(req.params.id);
    const { date, clockIn, clockOut, source, workLocation, remarks, isAdjusted } = req.body;
    
    if (isNaN(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid time entry ID"
      });
    }
    
    // Check if entry exists and belongs to user
    const existingResult = await pool.query(
      `SELECT * FROM time_entries WHERE id = $1 AND employee_id = $2`,
      [entryId, userId]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Time entry not found or access denied"
      });
    }
    
    const existing = existingResult.rows[0];
    
    // Prepare update data
    let durationMinutes = existing.duration_minutes;
    if (clockIn || clockOut) {
      const start = new Date(clockIn || existing.clock_in);
      const end = new Date(clockOut || existing.clock_out);
      
      if (end && start) {
        const durationMs = end - start;
        durationMinutes = Math.round(durationMs / (1000 * 60));
        
        if (durationMinutes < 0) {
          return res.status(400).json({
            success: false,
            message: "Clock out time must be after clock in time"
          });
        }
      }
    }
    
    // Update record
    const result = await pool.query(`
      UPDATE time_entries 
      SET 
        date = COALESCE($1, date),
        clock_in = COALESCE($2, clock_in),
        clock_out = COALESCE($3, clock_out),
        duration_minutes = $4,
        source = COALESCE($5, source),
        work_location = COALESCE($6, work_location),
        remarks = COALESCE($7, remarks),
        is_adjusted = COALESCE($8, is_adjusted),
        adjusted_by = CASE WHEN $8 = true THEN $9 ELSE adjusted_by END,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `, [date, clockIn, clockOut, durationMinutes, source, workLocation, remarks, isAdjusted, userId, entryId]);
    
    res.json({
      success: true,
      message: "Time entry updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error updating time entry:', error);
    res.status(500).json({
      success: false,
      message: "Error updating time entry",
      error: error.message
    });
  }
});

// DELETE /api/me/time-entries/:id - Delete a time entry
router.delete('/me/time-entries/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = parseInt(req.params.id);
    
    if (isNaN(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid time entry ID"
      });
    }
    
    // Check if entry exists and belongs to user
    const existingResult = await pool.query(
      `SELECT * FROM time_entries WHERE id = $1 AND employee_id = $2`,
      [entryId, userId]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Time entry not found or access denied"
      });
    }
    
    // Delete record
    await pool.query(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
    
    res.json({
      success: true,
      message: "Time entry deleted successfully",
      data: { id: entryId }
    });
  } catch (error) {
    console.error('❌ Error deleting time entry:', error);
    res.status(500).json({
      success: false,
      message: "Error deleting time entry",
      error: error.message
    });
  }
});

// GET /api/me/time-entries/:id - Get specific time entry
router.get('/me/time-entries/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = parseInt(req.params.id);
    
    if (isNaN(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid time entry ID"
      });
    }
    
    const result = await pool.query(
      `SELECT * FROM time_entries WHERE id = $1 AND employee_id = $2`,
      [entryId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Time entry not found or access denied"
      });
    }
    
    res.json({
      success: true,
      message: "Time entry retrieved successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error fetching time entry:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching time entry",
      error: error.message
    });
  }
});

// GET /api/time-entries - Get all time entries (admin view)
router.get('/time-entries', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { page = 1, limit = 20, employeeId, startDate, endDate, source } = req.query;
    
    // Build query with tenant isolation
    let query = `
      SELECT 
        te.id, te.employee_id, te.date, te.clock_in, te.clock_out,
        te.duration_minutes, te.source, te.work_location, te.contract_id,
        te.remarks, te.is_adjusted, te.adjusted_by,
        te.created_at, te.updated_at,
        u.full_name as employee_name, u.email
      FROM time_entries te
      LEFT JOIN employees u ON te.employee_id = u.id
      WHERE te.tenant_id::integer = $1
    `;
    
    const params = [tenantId];
    let paramIndex = 2;
    
    // Add filters
    if (employeeId) {
      query += ` AND te.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }
    
    if (startDate) {
      query += ` AND te.date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND te.date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (source) {
      query += ` AND te.source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }
    
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${query}) as filtered_count`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Add pagination and sorting
    query += ` ORDER BY te.date DESC, te.clock_in DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: "All time entries retrieved successfully",
      data: {
        entries: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching time entries:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching time entries",
      error: error.message
    });
  }
});

// =============================================
// WORK HISTORY APIs (Figma Work History screens)
// =============================================

// Helper: get actual employee_id string from user id
async function getActualEmployeeId(userId) {
  try {
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1',
      [userId]
    );
    return empResult.rows.length > 0 ? empResult.rows[0].employee_id : String(userId);
  } catch (e) {
    return String(userId);
  }
}

// GET /api/me/work-history/weekly - Work History Screen 1: Weekly grouped view
router.get('/me/work-history/weekly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { weekStart } = req.query;
    const actualEmployeeId = await getActualEmployeeId(userId);

    // Calculate week boundaries (Monday-Sunday)
    let startOfWeek;
    if (weekStart) {
      startOfWeek = new Date(weekStart);
    } else {
      startOfWeek = new Date();
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
    }
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startStr = startOfWeek.toISOString().split('T')[0];
    const endStr = endOfWeek.toISOString().split('T')[0];

    // Get timer sessions (production schema: employee_id, clock_in, clock_out)
    const sessionsResult = await pool.query(
      `SELECT id, clock_in, clock_out, notes, project_id, work_location
       FROM timers
       WHERE employee_id = $1
         AND date >= $2 AND date <= $3
       ORDER BY clock_in ASC`,
      [actualEmployeeId, startStr, endStr]
    );

    // Get breaks for these timer sessions
    const timerDbIds = sessionsResult.rows.map(s => s.id);
    let breaksRows = [];
    if (timerDbIds.length > 0) {
      const breaksResult = await pool.query(
        `SELECT b.timer_record_id, b.break_type, b.start_time, b.end_time,
                b.duration_seconds, b.description,
                bt.display_name as break_type_label
         FROM breaks b
         LEFT JOIN break_types bt ON b.break_type_id = bt.id
         WHERE b.timer_record_id = ANY($1)
         ORDER BY b.start_time ASC`,
        [timerDbIds]
      );
      breaksRows = breaksResult.rows;
    }

    // Also get time_entries for the week (fallback data)
    const entriesResult = await pool.query(
      `SELECT id, date, clock_in, clock_out, duration_minutes,
              work_location, remarks
       FROM time_entries
       WHERE employee_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC, clock_in ASC`,
      [userId, startStr, endStr]
    );

    // Group by date
    const dayMap = {};

    // Process timer sessions + breaks into daily segments
    for (const session of sessionsResult.rows) {
      const sessionStart = session.clock_in ? new Date(session.clock_in) : null;
      if (!sessionStart) continue;
      const dateKey = sessionStart.toISOString().split('T')[0];
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = { segments: [], totalSeconds: 0, projects: new Set(), locations: new Set(), notes: [] };
      }

      const sessionBreaks = breaksRows.filter(b => b.timer_record_id === session.id);
      const sessionEnd = session.clock_out ? new Date(session.clock_out) : null;

      let cursor = sessionStart;
      for (const brk of sessionBreaks) {
        const breakStart = new Date(brk.start_time);
        const breakEnd = brk.end_time ? new Date(brk.end_time) : null;

        if (cursor < breakStart) {
          const workSec = (breakStart - cursor) / 1000;
          dayMap[dateKey].segments.push({
            type: 'work', label: 'Work',
            start_time: cursor.toISOString(),
            end_time: breakStart.toISOString(),
            duration_seconds: Math.round(workSec)
          });
          dayMap[dateKey].totalSeconds += Math.round(workSec);
        }

        const bEnd = breakEnd || new Date();
        const breakSec = brk.duration_seconds || (bEnd - breakStart) / 1000;
        const breakLabel = brk.break_type_label || (brk.break_type === 'pause' ? 'Break' : brk.break_type || 'Break');
        dayMap[dateKey].segments.push({
          type: 'break', label: breakLabel,
          start_time: breakStart.toISOString(),
          end_time: breakEnd ? breakEnd.toISOString() : null,
          duration_seconds: Math.round(breakSec),
          description: brk.description || null
        });

        if (breakEnd) cursor = breakEnd;
      }

      if (sessionEnd && cursor < sessionEnd) {
        const workSec = (sessionEnd - cursor) / 1000;
        dayMap[dateKey].segments.push({
          type: 'work', label: 'Work',
          start_time: cursor.toISOString(),
          end_time: sessionEnd.toISOString(),
          duration_seconds: Math.round(workSec)
        });
        dayMap[dateKey].totalSeconds += Math.round(workSec);
      } else if (!sessionEnd && sessionBreaks.length === 0) {
        const workSec = (new Date() - sessionStart) / 1000;
        dayMap[dateKey].segments.push({
          type: 'work', label: 'Work',
          start_time: sessionStart.toISOString(),
          end_time: null,
          duration_seconds: Math.round(workSec),
          is_active: true
        });
        dayMap[dateKey].totalSeconds += Math.round(workSec);
      }

      if (session.notes) dayMap[dateKey].notes.push(session.notes);
      if (session.work_location) dayMap[dateKey].locations.add(session.work_location);
    }

    // Merge time_entries data (for days without timer sessions)
    for (const entry of entriesResult.rows) {
      const dateKey = entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : entry.date;
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = { segments: [], totalSeconds: 0, projects: new Set(), locations: new Set(), notes: [] };
      }
      if (dayMap[dateKey].segments.length === 0 && entry.clock_in) {
        const clockIn = new Date(entry.clock_in);
        const clockOut = entry.clock_out ? new Date(entry.clock_out) : null;
        const durSec = entry.duration_minutes ? entry.duration_minutes * 60 : (clockOut ? (clockOut - clockIn) / 1000 : 0);
        dayMap[dateKey].segments.push({
          type: 'work', label: 'Work',
          start_time: clockIn.toISOString(),
          end_time: clockOut ? clockOut.toISOString() : null,
          duration_seconds: Math.round(durSec)
        });
        dayMap[dateKey].totalSeconds += Math.round(durSec);
      }
      if (entry.work_location) dayMap[dateKey].locations.add(entry.work_location);
      if (entry.remarks) dayMap[dateKey].notes.push(entry.remarks);
    }

    // Format days array
    const days = Object.entries(dayMap)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([dateKey, data]) => {
        const totalMin = Math.round(data.totalSeconds / 60);
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        return {
          date: dateKey,
          date_formatted: new Date(dateKey).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          total_worked: `${hours} hours ${minutes} minutes`,
          total_worked_seconds: Math.round(data.totalSeconds),
          segments: data.segments.map(seg => ({
            ...seg,
            start_time_formatted: seg.start_time ? new Date(seg.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null,
            end_time_formatted: seg.end_time ? new Date(seg.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null
          })),
          projects: [...data.projects],
          locations: [...data.locations],
          notes: data.notes.filter(Boolean).join('; ') || null
        };
      });

    const totalWeekSeconds = days.reduce((sum, d) => sum + d.total_worked_seconds, 0);
    const totalWeekMin = Math.round(totalWeekSeconds / 60);
    const wHours = Math.floor(totalWeekMin / 60);
    const wMinutes = totalWeekMin % 60;

    res.json({
      success: true,
      message: 'Work history retrieved successfully',
      data: {
        week: {
          start_date: startStr,
          end_date: endStr,
          total_worked: `${wHours}h ${wMinutes}m`,
          total_worked_seconds: totalWeekSeconds
        },
        days
      }
    });
  } catch (error) {
    console.error('❌ Error fetching work history:', error);
    res.status(500).json({ success: false, message: 'Error fetching work history', error: error.message });
  }
});

// GET /api/me/work-history/day/:date - Work History Screen 2: Single day detail
router.get('/me/work-history/day/:date', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const dateParam = req.params.date;
    const actualEmployeeId = await getActualEmployeeId(userId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Get timer sessions for this day
    const sessionsResult = await pool.query(
      `SELECT id, clock_in, clock_out, notes, project_id, work_location
       FROM timers
       WHERE employee_id = $1 AND date = $2
       ORDER BY clock_in ASC`,
      [actualEmployeeId, dateParam]
    );

    // Get breaks for these sessions
    const timerDbIds = sessionsResult.rows.map(s => s.id);
    let breaksRows = [];
    if (timerDbIds.length > 0) {
      const breaksResult = await pool.query(
        `SELECT b.timer_record_id, b.break_type, b.start_time, b.end_time,
                b.duration_seconds, b.description,
                bt.display_name as break_type_label
         FROM breaks b
         LEFT JOIN break_types bt ON b.break_type_id = bt.id
         WHERE b.timer_record_id = ANY($1)
         ORDER BY b.start_time ASC`,
        [timerDbIds]
      );
      breaksRows = breaksResult.rows;
    }

    // Get time entries as fallback
    const entriesResult = await pool.query(
      `SELECT id, date, clock_in, clock_out, duration_minutes,
              work_location, remarks
       FROM time_entries
       WHERE employee_id = $1 AND date = $2
       ORDER BY clock_in ASC`,
      [userId, dateParam]
    );

    // Get project info
    let projectName = null;
    const projectIds = sessionsResult.rows.map(s => s.project_id).filter(Boolean);
    if (projectIds.length > 0) {
      try {
        const projResult = await pool.query('SELECT name FROM projects WHERE id = $1 LIMIT 1', [projectIds[0]]);
        if (projResult.rows.length > 0) projectName = projResult.rows[0].name;
      } catch (e) { /* projects table may not exist */ }
    }

    // Build segments
    const segments = [];
    let totalWorkSeconds = 0;

    for (const session of sessionsResult.rows) {
      const sessionStart = session.clock_in ? new Date(session.clock_in) : null;
      if (!sessionStart) continue;
      const sessionBreaks = breaksRows.filter(b => b.timer_record_id === session.id);
      const sessionEnd = session.clock_out ? new Date(session.clock_out) : null;

      let cursor = sessionStart;
      for (const brk of sessionBreaks) {
        const breakStart = new Date(brk.start_time);
        const breakEnd = brk.end_time ? new Date(brk.end_time) : null;

        if (cursor < breakStart) {
          const workSec = (breakStart - cursor) / 1000;
          segments.push({ type: 'work', label: 'Work', start_time: cursor.toISOString(), end_time: breakStart.toISOString(), duration_seconds: Math.round(workSec), note: null });
          totalWorkSeconds += Math.round(workSec);
        }

        const bEnd = breakEnd || new Date();
        const breakLabel = brk.break_type_label || (brk.break_type === 'pause' ? 'Break' : brk.break_type || 'Break');
        segments.push({
          type: 'break', label: breakLabel,
          start_time: breakStart.toISOString(),
          end_time: breakEnd ? breakEnd.toISOString() : null,
          duration_seconds: Math.round(brk.duration_seconds || (bEnd - breakStart) / 1000),
          note: brk.description || null
        });

        if (breakEnd) cursor = breakEnd;
      }

      if (sessionEnd && cursor < sessionEnd) {
        const workSec = (sessionEnd - cursor) / 1000;
        segments.push({ type: 'work', label: 'Work', start_time: cursor.toISOString(), end_time: sessionEnd.toISOString(), duration_seconds: Math.round(workSec), note: null });
        totalWorkSeconds += Math.round(workSec);
      } else if (!sessionEnd && sessionBreaks.length === 0) {
        const workSec = (new Date() - sessionStart) / 1000;
        segments.push({ type: 'work', label: 'Work', start_time: sessionStart.toISOString(), end_time: null, duration_seconds: Math.round(workSec), note: null, is_active: true });
        totalWorkSeconds += Math.round(workSec);
      }
    }

    // Fallback to time_entries if no timer data
    if (segments.length === 0) {
      for (const entry of entriesResult.rows) {
        if (entry.clock_in) {
          const clockIn = new Date(entry.clock_in);
          const clockOut = entry.clock_out ? new Date(entry.clock_out) : null;
          const durSec = entry.duration_minutes ? entry.duration_minutes * 60 : (clockOut ? (clockOut - clockIn) / 1000 : 0);
          segments.push({ type: 'work', label: 'Work', start_time: clockIn.toISOString(), end_time: clockOut ? clockOut.toISOString() : null, duration_seconds: Math.round(durSec), note: entry.remarks || null });
          totalWorkSeconds += Math.round(durSec);
        }
      }
    }

    const formattedSegments = segments.map(seg => ({
      ...seg,
      start_time_formatted: seg.start_time ? new Date(seg.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null,
      end_time_formatted: seg.end_time ? new Date(seg.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null
    }));

    const totalMin = Math.round(totalWorkSeconds / 60);
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    const location = sessionsResult.rows[0]?.work_location || entriesResult.rows[0]?.work_location || null;
    const dayNotes = [
      ...sessionsResult.rows.map(s => s.notes).filter(Boolean),
      ...entriesResult.rows.map(e => e.remarks).filter(Boolean)
    ].join('; ') || null;

    res.json({
      success: true,
      message: 'Work day detail retrieved successfully',
      data: {
        date: dateParam,
        date_formatted: new Date(dateParam).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        total_worked: `${hours} hours ${minutes} minutes`,
        total_worked_seconds: totalWorkSeconds,
        segments: formattedSegments,
        project: projectName,
        location: location,
        day_notes: dayNotes,
        can_request_correction: true
      }
    });
  } catch (error) {
    console.error('❌ Error fetching work day detail:', error);
    res.status(500).json({ success: false, message: 'Error fetching work day detail', error: error.message });
  }
});

// GET /api/me/work-history/monthly - Monthly work history overview
router.get('/me/work-history/monthly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const actualEmployeeId = await getActualEmployeeId(userId);
    const { year, month } = req.query;

    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = new Date(y, m, 0).toISOString().split('T')[0];

    // Get daily totals from timers
    const timerResult = await pool.query(
      `SELECT date as work_date,
              SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out, NOW()) - clock_in))) as total_seconds
       FROM timers
       WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND clock_in IS NOT NULL
       GROUP BY date
       ORDER BY work_date`,
      [actualEmployeeId, startDate, endDate]
    );

    // Get daily totals from time_entries as fallback
    const entriesResult = await pool.query(
      `SELECT date as work_date, SUM(duration_minutes * 60) as total_seconds
       FROM time_entries
       WHERE employee_id = $1 AND date >= $2 AND date <= $3
       GROUP BY date
       ORDER BY date`,
      [userId, startDate, endDate]
    );

    // Merge data (timer data takes priority)
    const dayTotals = {};
    for (const row of entriesResult.rows) {
      const dk = row.work_date instanceof Date ? row.work_date.toISOString().split('T')[0] : row.work_date;
      dayTotals[dk] = parseInt(row.total_seconds) || 0;
    }
    for (const row of timerResult.rows) {
      const dk = row.work_date instanceof Date ? row.work_date.toISOString().split('T')[0] : row.work_date;
      dayTotals[dk] = Math.round(parseFloat(row.total_seconds) || 0);
    }

    const days = Object.entries(dayTotals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, totalSec]) => {
        const totalMin = Math.round(totalSec / 60);
        const h = Math.floor(totalMin / 60);
        const min = totalMin % 60;
        return {
          date: dateKey,
          date_formatted: new Date(dateKey).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          total_worked: `${h} hours ${min} minutes`,
          total_worked_seconds: totalSec
        };
      });

    const totalMonthSeconds = days.reduce((sum, d) => sum + d.total_worked_seconds, 0);
    const totalMonthMin = Math.round(totalMonthSeconds / 60);
    const mHours = Math.floor(totalMonthMin / 60);
    const mMin = totalMonthMin % 60;

    res.json({
      success: true,
      message: 'Monthly work history retrieved successfully',
      data: {
        month: { year: y, month: m, total_worked: `${mHours}h ${mMin}m`, total_worked_seconds: totalMonthSeconds, days_worked: days.length },
        days
      }
    });
  } catch (error) {
    console.error('❌ Error fetching monthly work history:', error);
    res.status(500).json({ success: false, message: 'Error fetching monthly work history', error: error.message });
  }
});

// ========== MISSING APIs FROM INDEX.JS (ADDED FOR COMPATIBILITY) ==========

// GET /api/get-token - Get authentication token for testing
router.get('/get-token', (req, res) => {
  const testUser = {
    userId: 1,
    tenantId: 1,
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User'
  };
  
  const token = jwt.sign(testUser, JWT_SECRET, { expiresIn: '24h' });
  
  res.json({
    success: true,
    message: 'Test token generated successfully',
    data: {
      token,
      access_token: token,
      user: testUser,
      expires_in: '24h',
      token_type: 'Bearer',
      usage: 'Copy this token and use it in Swagger UI Authorization header as: Bearer <token>'
    }
  });
});

// GET /api/test - Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working!',
    timestamp: new Date().toISOString()
  });
});

// GET /api/profile - Get user profile
router.get('/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user?.userId || 1,
      tenantId: 1,
      employeeNumber: 'EMP001',
      firstName: 'John',
      lastName: 'Doe',
      email: req.user?.email || 'john.doe@company.com',
      tenantName: 'Demo Company',
      profile_image: null
    }
  });
});

// GET /api/user/profile - Get user profile (alternate path)
router.get('/user/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user?.userId || 1,
      employeeNumber: 'EMP001',
      firstName: 'John',
      lastName: 'Doe',
      email: req.user?.email || 'john.doe@company.com',
      tenantName: 'Demo Company'
    }
  });
});

// PUT /api/profile/image - Update profile image
router.put('/profile/image', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Profile image updated successfully',
    data: {
      profile_image_url: 'data:image/png;base64,mock-base64-string'
    }
  });
});

// GET /api/profile/image - Get profile image
router.get('/profile/image', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      profile_image: null,
      has_image: false
    }
  });
});

// DELETE /api/profile/image - Delete profile image
router.delete('/profile/image', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Profile image deleted successfully'
  });
});

// GET /api/user/dashboard - Get user dashboard
router.get('/user/dashboard', authenticateToken, (req, res) => {
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
      quickStats: {
        weekTotal: 32.5,
        monthTotal: 140.25
      }
    }
  });
});

// GET /api/projects - List all projects (Database-driven)
router.get('/projects', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  
  try {
    // Fetch projects from database
    let query = 'SELECT * FROM projects WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (tenantId) {
      query += ` AND tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    
    // Get hours logged per project (handle missing project_id column gracefully)
    const projectsWithHours = await Promise.all(result.rows.map(async (project) => {
      let totalHours = 0;
      try {
        const hoursResult = await pool.query(
          'SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes FROM time_entries WHERE project_id = $1',
          [project.id]
        );
        totalHours = (parseInt(hoursResult.rows[0]?.total_minutes) || 0) / 60;
      } catch (e) {
        // project_id column might not exist, default to 0
        totalHours = 0;
      }
      
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        client: project.client || 'Internal',
        status: project.status || 'active',
        color: project.color || '#4CAF50',
        start_date: project.start_date,
        end_date: project.end_date,
        total_hours_logged: parseFloat(totalHours.toFixed(2))
      };
    }));
    
    res.json({
      success: true,
      data: {
        projects: projectsWithHours,
        total: projectsWithHours.length
      }
    });
  } catch (error) {
    console.error('Projects fetch error:', error);
    // Return empty array on error
    res.json({
      success: true,
      data: {
        projects: [],
        total: 0
      }
    });
  }
});

// GET /api/projects/:id/tasks - List tasks for a project
/*
// DISABLED: Using routes/api.js for dynamic tasks from database
router.get('/projects/:id/tasks', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  res.json({
    success: true,
    data: {
      project_id: parseInt(id),
      tasks: [
        {
          id: 1,
          name: 'API Development',
          description: 'Develop REST APIs for time tracking',
          status: 'in_progress',
          priority: 'high',
          estimated_hours: 40,
          logged_hours: 25.5,
          assigned_to: 'John Doe',
          due_date: '2025-12-31'
        },
        {
          id: 2,
          name: 'Database Schema',
          description: 'Design and implement database schema',
          status: 'completed',
          priority: 'high',
          estimated_hours: 16,
          logged_hours: 18.5,
          assigned_to: 'John Doe',
          completed_date: '2025-12-20'
        }
      ],
      total_tasks: 2,
      project_progress: 65
    }
  });
});
*/

// GET /api/me/vacation/balance - Get vacation balance (Database-driven)
router.get('/me/vacation/balance', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // Get from vacation_balances table
    const balanceResult = await pool.query(
      'SELECT total_days, used_days, available_days FROM vacation_balances WHERE user_id = $1',
      [userId]
    );
    
    // Get pending leave requests
    const pendingResult = await pool.query(
      "SELECT COUNT(*) as pending FROM leave_requests WHERE employee_id = $1 AND status = 'pending'",
      [userId]
    );
    
    // Get used by type
    const usedResult = await pool.query(`
      SELECT leave_type, SUM(
        CASE 
          WHEN end_date IS NOT NULL THEN (end_date::date - start_date::date + 1)
          ELSE 1
        END
      ) as days_used
      FROM leave_requests 
      WHERE employee_id = $1 AND status = 'approved'
      GROUP BY leave_type
    `, [userId]);

    // Build by type object
    const byType = {};
    usedResult.rows.forEach(row => {
      const typeName = row.leave_type.toLowerCase().replace(/ /g, '_');
      byType[typeName] = { 
        available: 20, // Default, could be from company settings
        used: parseInt(row.days_used) || 0 
      };
    });

    const balance = balanceResult.rows[0] || { total_days: 25, used_days: 0, available_days: 25 };
    const currentYear = new Date().getFullYear();

    res.json({
      success: true,
      data: {
        balance: {
          available_days: balance.available_days || balance.total_days - balance.used_days,
          used_days: balance.used_days || 0,
          total_allocated: balance.total_days || 25,
          pending_requests: parseInt(pendingResult.rows[0]?.pending) || 0,
          expires_on: `${currentYear}-12-31`
        },
        by_type: byType,
        year: currentYear
      }
    });
  } catch (error) {
    console.error('Vacation balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vacation balance',
      error: error.message
    });
  }
  
});

// GET /api/me/vacation-balance - Get vacation balance (alternate path - Database-driven)
router.get('/me/vacation-balance', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // Get from vacation_balances table
    const balanceResult = await pool.query(
      'SELECT total_days, used_days, available_days FROM vacation_balances WHERE user_id = $1',
      [userId]
    );
    
    // Get pending leave requests
    const pendingResult = await pool.query(
      "SELECT COUNT(*) as pending FROM leave_requests WHERE employee_id = $1 AND status = 'pending'",
      [userId]
    );

    const balance = balanceResult.rows[0] || { total_days: 25, used_days: 0, available_days: 25 };
    const currentYear = new Date().getFullYear();

    res.json({
      success: true,
      data: {
        total_available: balance.total_days || 25,
        used: balance.used_days || 0,
        remaining: balance.available_days || balance.total_days - balance.used_days,
        pending: parseInt(pendingResult.rows[0]?.pending) || 0,
        year: currentYear
      }
    });
  } catch (error) {
    console.error('Vacation balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vacation balance',
      error: error.message
    });
  }
});

// GET /api/me/overtime/summary - Get overtime summary from database
router.get('/me/overtime/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    
    // Get the actual employee_id from employees table
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1',
      [userId]
    );
    const actualEmployeeId = empResult.rows.length > 0 ? empResult.rows[0].employee_id : String(userId);
    
    // Get company settings for standard weekly hours
    const settingsResult = await pool.query(
      'SELECT overtime_starts_after, enable_overtime FROM company_settings WHERE tenant_id = $1',
      [tenantId]
    );
    let standardHoursPerDay = settingsResult.rows[0]?.overtime_starts_after || 8;
    
    // Get working_days_per_week from company_details
    let workingDaysPerWeek = 5;
    try {
      const compDetails = await pool.query(
        'SELECT working_hours_per_day, working_days_per_week FROM company_details WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (compDetails.rows.length > 0) {
        workingDaysPerWeek = parseInt(compDetails.rows[0].working_days_per_week) || 5;
        if (compDetails.rows[0].working_hours_per_day) {
          standardHoursPerDay = parseFloat(compDetails.rows[0].working_hours_per_day);
        }
      }
    } catch (e) { /* use defaults */ }
    
    const weeklyExpectedMinutes = standardHoursPerDay * workingDaysPerWeek * 60;
    const weeklyExpectedHours = standardHoursPerDay * workingDaysPerWeek;
    
    // Helper: get Monday of a given date
    const getMonday = (d) => {
      const date = new Date(d);
      const day = date.getDay();
      const diff = day === 0 ? 6 : day - 1;
      date.setDate(date.getDate() - diff);
      return date.toISOString().split('T')[0];
    };
    
    // Get all timer data grouped by day for this month
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);
    
    const monthlyTimersResult = await pool.query(`
      SELECT 
        DATE(clock_in) as date,
        SUM(duration_minutes) as daily_minutes,
        MAX(remarks) as reason
      FROM timers 
      WHERE employee_id = $1 
        AND clock_out IS NOT NULL
        AND DATE(clock_in) >= $2 
        AND DATE(clock_in) <= CURRENT_DATE
      GROUP BY DATE(clock_in)
      ORDER BY DATE(clock_in)
    `, [actualEmployeeId, currentMonthStart.toISOString().split('T')[0]]);
    
    // Group daily minutes by week (Monday-based)
    const weeklyTotals = {};
    monthlyTimersResult.rows.forEach(row => {
      const dateStr = row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date;
      const weekKey = getMonday(dateStr);
      if (!weeklyTotals[weekKey]) weeklyTotals[weekKey] = { totalMinutes: 0, days: [] };
      weeklyTotals[weekKey].totalMinutes += parseInt(row.daily_minutes) || 0;
      weeklyTotals[weekKey].days.push({ date: dateStr, minutes: parseInt(row.daily_minutes) || 0, reason: row.reason });
    });
    
    // Calculate monthly overtime (weekly basis)
    let monthlyOvertimeMinutes = 0;
    let overtimeWeeks = 0;
    Object.values(weeklyTotals).forEach(week => {
      const weekOvertime = week.totalMinutes - weeklyExpectedMinutes;
      if (weekOvertime > 0) {
        monthlyOvertimeMinutes += weekOvertime;
        overtimeWeeks++;
      }
    });
    
    const monthlyOvertimeHours = (monthlyOvertimeMinutes / 60).toFixed(2);
    
    // Get year-to-date overtime (weekly basis)
    const yearStart = new Date();
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);
    
    const yearlyTimersResult = await pool.query(`
      SELECT 
        DATE(clock_in) as date,
        SUM(duration_minutes) as daily_minutes
      FROM timers 
      WHERE employee_id = $1 
        AND clock_out IS NOT NULL
        AND DATE(clock_in) >= $2 
        AND DATE(clock_in) <= CURRENT_DATE
      GROUP BY DATE(clock_in)
      ORDER BY DATE(clock_in)
    `, [actualEmployeeId, yearStart.toISOString().split('T')[0]]);
    
    // Group yearly data by week
    const yearlyWeekTotals = {};
    yearlyTimersResult.rows.forEach(row => {
      const dateStr = row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date;
      const weekKey = getMonday(dateStr);
      if (!yearlyWeekTotals[weekKey]) yearlyWeekTotals[weekKey] = 0;
      yearlyWeekTotals[weekKey] += parseInt(row.daily_minutes) || 0;
    });
    
    let yearlyOvertimeMinutes = 0;
    Object.values(yearlyWeekTotals).forEach(weekMinutes => {
      const weekOvertime = weekMinutes - weeklyExpectedMinutes;
      if (weekOvertime > 0) {
        yearlyOvertimeMinutes += weekOvertime;
      }
    });
    
    const yearlyOvertimeHours = (yearlyOvertimeMinutes / 60).toFixed(2);
    
    // Get recent overtime weeks (last 10 weeks with overtime)
    const recentOvertimeWeeks = Object.entries(yearlyWeekTotals)
      .filter(([, minutes]) => minutes > weeklyExpectedMinutes)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10)
      .map(([weekStart, minutes]) => {
        const overtimeMins = minutes - weeklyExpectedMinutes;
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return {
          week_start: weekStart,
          week_end: weekEnd.toISOString().split('T')[0],
          total_worked_hours: parseFloat((minutes / 60).toFixed(2)),
          overtime_hours: parseFloat((overtimeMins / 60).toFixed(2)),
          expected_hours: weeklyExpectedHours,
          status: 'logged'
        };
      });
    
    res.json({
      success: true,
      data: {
        calculation_mode: 'weekly',
        current_month: {
          overtime_hours: parseFloat(monthlyOvertimeHours),
          overtime_weeks: overtimeWeeks,
          weekly_expected_hours: weeklyExpectedHours,
          standard_hours_per_day: standardHoursPerDay,
          working_days_per_week: workingDaysPerWeek,
          compensation_type: 'time_off',
          pending_approval: 0
        },
        year_to_date: {
          total_overtime: parseFloat(yearlyOvertimeHours),
          compensated: 0,
          pending: parseFloat(yearlyOvertimeHours)
        },
        recent_overtime: recentOvertimeWeeks
      }
    });
  } catch (error) {
    console.error('Overtime summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overtime summary',
      error: error.message
    });
  }
});


  return router;
};
