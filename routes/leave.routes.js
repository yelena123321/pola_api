/**
 * leave Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== LEAVE MANAGEMENT APIs =====
// Persistent leave data
let persistentLeaveRequests = {
  1: {
    id: 1,
    userId: 1,
    leaveTypeId: 1,
    leaveType: "Paid Leave",
    startDate: "2026-02-01",
    endDate: "2026-02-05",
    status: "approved",
    comment: "Family trip",
    createdAt: "2026-01-20",
    approvedAt: "2026-01-21"
  }
};

// Time Entries storage
let persistentTimeEntries = {};
let timeEntryIdCounter = 1;

// Correction Types storage
let persistentCorrectionTypes = {};
let correctionTypeIdCounter = 1;

// Correction Requests storage
let persistentCorrectionRequests = {};
let correctionRequestIdCounter = 1;

// ====================================================================
// LEAVE MANAGEMENT ROUTES
// ====================================================================

// GET Leave Types (Dropdown)
router.get('/leave-types', authenticateToken, (req, res) => {
  const leaveTypes = [
    {
      id: 1,
      name: "Paid Leave",
      displayName: "Paid Leave",
      color: "#4CAF50",
      icon: "💰",
      description: "Paid vacation days"
    },
    {
      id: 2,
      name: "Sick Leave",
      displayName: "Sick Leave",
      color: "#FF6B6B",
      icon: "🤒",
      description: "Sick leave for health reasons"
    },
    {
      id: 3,
      name: "Unpaid Leave",
      displayName: "Unpaid Leave",
      color: "#FFA500",
      icon: "📋",
      description: "Unpaid leave time"
    },
    {
      id: 4,
      name: "Maternity Leave",
      displayName: "Maternity Leave",
      color: "#FF69B4",
      icon: "👶",
      description: "Maternity leave for expectant mothers"
    },
    {
      id: 5,
      name: "Paternity Leave",
      displayName: "Paternity Leave",
      color: "#1E90FF",
      icon: "👨‍👧",
      description: "Paternity leave for new fathers"
    },
    {
      id: 6,
      name: "Training / Education Leave",
      displayName: "Training / Education Leave",
      color: "#9370DB",
      icon: "📚",
      description: "Training and educational programs"
    },
    {
      id: 7,
      name: "Special Leave",
      displayName: "Special Leave",
      color: "#20B2AA",
      icon: "⭐",
      description: "Special occasions leave"
    },
    {
      id: 8,
      name: "Half-day Leave",
      displayName: "Half-day Leave",
      color: "#FFD700",
      icon: "⏳",
      description: "Half day leave (morning or afternoon)"
    }
  ];

  res.json({
    success: true,
    message: "Leave types retrieved successfully",
    data: {
      leaveTypes: leaveTypes,
      total: leaveTypes.length
    }
  });
});

// GET User's Current/Upcoming Leave Requests (Today onwards)
router.get('/me/leave-requests/current', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get actual employee_id for this user
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, tenantId]
    );
    const actualEmployeeId = empResult.rows[0]?.employee_id;
    
    if (!actualEmployeeId) {
      return res.json({
        success: true,
        message: 'No employee found',
        data: { ongoing: [], upcoming: [], all: [], total: 0, ongoingCount: 0, upcomingCount: 0, userId }
      });
    }
    
    // Get current and upcoming leave requests (end_date >= today)
    const result = await pool.query(`
      SELECT 
        lr.*,
        lt.color as leave_color,
        lt.is_paid,
        u.full_name as approved_by_name
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id OR lr.leave_type = lt.name
      LEFT JOIN employees u ON lr.approved_by = u.id
      WHERE lr.employee_id = $1 
        AND lr.end_date >= $2
        AND lr.tenant_id = $3::integer
      ORDER BY lr.start_date ASC, lr.created_at DESC
    `, [actualEmployeeId, today, tenantId]);

    const leaveRequests = result.rows.map(lr => ({
      id: lr.id,
      userId: lr.user_id,
      leaveType: lr.leave_type,
      leaveTypeId: lr.leave_type_id,
      leaveColor: lr.leave_color,
      isPaid: lr.is_paid,
      startDate: lr.start_date,
      endDate: lr.end_date,
      totalDays: parseFloat(lr.total_days),
      reason: lr.reason,
      status: lr.status,
      approvedBy: lr.approved_by,
      approvedByName: lr.approved_by_name,
      approvedAt: lr.approved_at,
      rejectionReason: lr.rejection_reason,
      createdAt: lr.created_at,
      updatedAt: lr.updated_at,
      isOngoing: new Date(lr.start_date) <= new Date() && new Date(lr.end_date) >= new Date(),
      isUpcoming: new Date(lr.start_date) > new Date()
    }));

    // Separate into ongoing and upcoming
    const ongoing = leaveRequests.filter(lr => lr.isOngoing);
    const upcoming = leaveRequests.filter(lr => lr.isUpcoming);

    console.log(`✅ Retrieved ${leaveRequests.length} current/upcoming leave requests for user ${userId}`);

    res.json({
      success: true,
      message: "Current and upcoming leave requests retrieved successfully",
      data: {
        ongoing: ongoing,
        upcoming: upcoming,
        all: leaveRequests,
        total: leaveRequests.length,
        ongoingCount: ongoing.length,
        upcomingCount: upcoming.length,
        userId: userId
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving current leave requests:', error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve current leave requests",
      error: error.message
    });
  }
});

// GET User's Past Leave Requests (Ended before today)
router.get('/me/leave-requests/past', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { limit = 50, offset = 0 } = req.query;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get actual employee_id for this user
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, tenantId]
    );
    const actualEmployeeId = empResult.rows[0]?.employee_id;
    
    if (!actualEmployeeId) {
      return res.json({
        success: true,
        message: 'No employee found',
        data: { leaveRequests: [], stats: { total: 0, approved: 0, rejected: 0, cancelled: 0 }, pagination: { limit: parseInt(limit), offset: parseInt(offset), hasMore: false }, userId }
      });
    }
    
    // Get past leave requests (end_date < today)
    const result = await pool.query(`
      SELECT 
        lr.*,
        lt.color as leave_color,
        lt.is_paid,
        u.full_name as approved_by_name
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id OR lr.leave_type = lt.name
      LEFT JOIN employees u ON lr.approved_by = u.id
      WHERE lr.employee_id = $1 
        AND lr.end_date < $2
        AND lr.tenant_id = $3::integer
      ORDER BY lr.end_date DESC, lr.created_at DESC
      LIMIT $4 OFFSET $5
    `, [actualEmployeeId, today, tenantId, parseInt(limit), parseInt(offset)]);

    // Get total count for pagination
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM leave_requests 
      WHERE employee_id = $1 AND end_date < $2 AND tenant_id = $3::integer
    `, [actualEmployeeId, today, tenantId]);

    const leaveRequests = result.rows.map(lr => ({
      id: lr.id,
      userId: lr.user_id,
      leaveType: lr.leave_type,
      leaveTypeId: lr.leave_type_id,
      leaveColor: lr.leave_color,
      isPaid: lr.is_paid,
      startDate: lr.start_date,
      endDate: lr.end_date,
      totalDays: parseFloat(lr.total_days),
      reason: lr.reason,
      status: lr.status,
      approvedBy: lr.approved_by,
      approvedByName: lr.approved_by_name,
      approvedAt: lr.approved_at,
      rejectionReason: lr.rejection_reason,
      createdAt: lr.created_at,
      updatedAt: lr.updated_at,
      daysAgo: Math.floor((new Date() - new Date(lr.end_date)) / (1000 * 60 * 60 * 24))
    }));

    // Group by status
    const approved = leaveRequests.filter(lr => lr.status === 'approved');
    const rejected = leaveRequests.filter(lr => lr.status === 'rejected');
    const cancelled = leaveRequests.filter(lr => lr.status === 'cancelled');

    console.log(`✅ Retrieved ${leaveRequests.length} past leave requests for user ${userId}`);

    res.json({
      success: true,
      message: "Past leave requests retrieved successfully",
      data: {
        leaveRequests: leaveRequests,
        stats: {
          total: parseInt(countResult.rows[0].count),
          approved: approved.length,
          rejected: rejected.length,
          cancelled: cancelled.length
        },
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + result.rows.length) < parseInt(countResult.rows[0].count)
        },
        userId: userId
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving past leave requests:', error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve past leave requests",
      error: error.message
    });
  }
});

// GET User's Leave Requests (All - Original endpoint)
router.get('/me/leave-requests', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { status, leave_type_id, leave_type, start_date, end_date, sort_by = 'created_at', sort_order = 'desc', page = 1, limit = 50 } = req.query;
  
  try {
    // First get actual employee_id from employees table (with tenant check)
    const empResult = await pool.query(
      'SELECT employee_id, full_name FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, tenantId]
    );
    const employeeData = empResult.rows[0];
    
    if (!employeeData?.employee_id) {
      return res.json({
        success: true,
        message: 'No employee found',
        data: { leaveRequests: [], total: 0, userId: userId, pagination: { total: 0, page: 1, limit: parseInt(limit), total_pages: 0 } }
      });
    }
    
    // Build query with filters (tenant isolated)
    let query = `SELECT lr.* FROM leave_requests lr WHERE lr.employee_id = $1 AND lr.tenant_id = $2::integer`;
    const params = [employeeData.employee_id, tenantId];
    let paramCount = 3;

    if (status) {
      query += ` AND lr.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    if (leave_type_id) {
      query += ` AND lr.leave_type_id = $${paramCount}`;
      params.push(parseInt(leave_type_id));
      paramCount++;
    }
    if (leave_type) {
      query += ` AND LOWER(lr.leave_type) = LOWER($${paramCount})`;
      params.push(leave_type);
      paramCount++;
    }
    if (start_date) {
      query += ` AND lr.start_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }
    if (end_date) {
      query += ` AND lr.end_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    // Count query (tenant isolated)
    let countQuery = `SELECT COUNT(*) FROM leave_requests lr WHERE lr.employee_id = $1 AND lr.tenant_id = $2::integer`;
    const countParams = [employeeData.employee_id, tenantId];
    let countParamNum = 3;

    if (status) {
      countQuery += ` AND lr.status = $${countParamNum}`;
      countParams.push(status);
      countParamNum++;
    }
    if (leave_type_id) {
      countQuery += ` AND lr.leave_type_id = $${countParamNum}`;
      countParams.push(parseInt(leave_type_id));
      countParamNum++;
    }
    if (leave_type) {
      countQuery += ` AND LOWER(lr.leave_type) = LOWER($${countParamNum})`;
      countParams.push(leave_type);
      countParamNum++;
    }
    if (start_date) {
      countQuery += ` AND lr.start_date >= $${countParamNum}`;
      countParams.push(start_date);
      countParamNum++;
    }
    if (end_date) {
      countQuery += ` AND lr.end_date <= $${countParamNum}`;
      countParams.push(end_date);
      countParamNum++;
    }
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Sorting
    const allowedSortColumns = ['created_at', 'start_date', 'end_date', 'status', 'leave_type', 'total_days'];
    const safeSortBy = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY lr.${safeSortBy} ${safeSortOrder}`;
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

    const leaveRequests = result.rows.map(lr => ({
      id: lr.id,
      employeeId: lr.employee_id,
      employeeName: employeeData.full_name,
      leaveType: lr.leave_type,
      leaveTypeId: lr.leave_type_id,
      startDate: lr.start_date,
      endDate: lr.end_date,
      totalDays: lr.total_days,
      reason: lr.reason,
      status: lr.status,
      approvedBy: lr.approved_by,
      approvedAt: lr.approved_at,
      rejectionReason: lr.rejection_reason,
      createdAt: lr.created_at,
      updatedAt: lr.updated_at
    }));

    console.log(`✅ Retrieved ${leaveRequests.length} leave requests from DB for employee ${employeeData.employee_id}`);

    res.json({
      success: true,
      message: "Leave requests retrieved successfully from database",
      data: {
        leaveRequests: leaveRequests,
        total: totalCount,
        employeeId: employeeData.employee_id,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          total_pages: Math.ceil(totalCount / parseInt(limit))
        },
        filters: {
          status: status || 'all',
          leave_type_id: leave_type_id || 'all',
          leave_type: leave_type || 'all',
          start_date: start_date || 'all',
          end_date: end_date || 'all',
          sort_by: safeSortBy,
          sort_order: safeSortOrder
        }
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving leave requests:', error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve leave requests",
      error: error.message
    });
  }
});

// POST Create Leave Request
router.post('/me/leave-requests', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { leaveTypeId, leaveType, leave_type, startDate, start_date, endDate, end_date, reason, comment, custom_data } = req.body;

  // Accept both formats: leave_type or leaveType or leaveTypeId
  const finalLeaveTypeId = leaveTypeId || req.body.leave_type_id;
  const finalLeaveTypeName = leave_type || leaveType;
  const finalStartDate = start_date || startDate;
  const finalEndDate = end_date || endDate || finalStartDate;
  const finalReason = reason || comment || "";
  const finalCustomData = custom_data || {};

  if ((!finalLeaveTypeId && !finalLeaveTypeName) || !finalStartDate) {
    return res.status(400).json({
      success: false,
      message: "Leave type and start date are required",
      required: {
        leave_type_id: "integer (e.g., 1) OR",
        leave_type: "string (e.g., 'Vacation', 'Sick Leave')",
        start_date: "date (YYYY-MM-DD)",
        end_date: "date (YYYY-MM-DD) - optional",
        reason: "string - optional",
        custom_data: "object - optional (for custom fields based on leave type)"
      }
    });
  }

  try {
    // Validate leave type from database
    let leaveTypeData;
    
    if (finalLeaveTypeId) {
      // Query by ID
      const leaveTypeResult = await pool.query(
        'SELECT * FROM leave_types WHERE id = $1 AND is_active = true',
        [finalLeaveTypeId]
      );
      
      if (leaveTypeResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive leave type ID',
          data: { leave_type_id: finalLeaveTypeId }
        });
      }
      
      leaveTypeData = leaveTypeResult.rows[0];
    } else {
      // Query by name
      const leaveTypeResult = await pool.query(
        'SELECT * FROM leave_types WHERE LOWER(name) = LOWER($1) AND is_active = true',
        [finalLeaveTypeName]
      );
      
      if (leaveTypeResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive leave type. Please use GET /api/me/leave-types to see available types',
          data: { 
            leave_type: finalLeaveTypeName,
            hint: 'Use GET /api/me/leave-types to get valid leave types'
          }
        });
      }
      
      leaveTypeData = leaveTypeResult.rows[0];
    }

    // Validate custom fields if leave type has custom_fields defined
    const customFields = leaveTypeData.custom_fields || [];
    
    if (customFields.length > 0) {
      // Check required custom fields
      for (const field of customFields) {
        if (field.required && !finalCustomData[field.name]) {
          return res.status(400).json({
            success: false,
            message: `Required field missing: ${field.label}`,
            data: {
              missing_field: field.name,
              field_label: field.label,
              field_type: field.type,
              leave_type: leaveTypeData.name,
              custom_fields_required: customFields.filter(f => f.required).map(f => ({
                name: f.name,
                label: f.label,
                type: f.type
              }))
            }
          });
        }
        
        // Validate select field options
        if (field.type === 'select' && finalCustomData[field.name]) {
          const validOptions = field.options || [];
          if (validOptions.length > 0 && !validOptions.includes(finalCustomData[field.name])) {
            return res.status(400).json({
              success: false,
              message: `Invalid value for ${field.label}`,
              data: {
                field: field.name,
                provided_value: finalCustomData[field.name],
                valid_options: validOptions
              }
            });
          }
        }
        
        // Validate date fields
        if (field.type === 'date' && finalCustomData[field.name]) {
          const dateValue = new Date(finalCustomData[field.name]);
          if (isNaN(dateValue.getTime())) {
            return res.status(400).json({
              success: false,
              message: `Invalid date format for ${field.label}`,
              data: {
                field: field.name,
                provided_value: finalCustomData[field.name],
                expected_format: 'YYYY-MM-DD'
              }
            });
          }
        }
      }
    }

    // Check for overlapping leave requests for the same employee
    // First get the actual employee_id - try by id then by email (with tenant check)
    let empLookup = await pool.query('SELECT employee_id FROM employees WHERE id = $1 AND tenant_id = $2::integer', [userId, req.user.tenantId]);
    if (empLookup.rows.length === 0 && req.user.email) {
      empLookup = await pool.query('SELECT employee_id FROM employees WHERE email = $1 AND tenant_id = $2::integer', [req.user.email, req.user.tenantId]);
    }
    const lookupEmployeeId = empLookup.rows[0]?.employee_id;
    console.log(`🔍 Employee lookup for userId ${userId}, email ${req.user.email}: employee_id = ${lookupEmployeeId}`);
    
    const overlapCheck = await pool.query(`
      SELECT id, leave_type, start_date, end_date, status 
      FROM leave_requests 
      WHERE employee_id = $1 
        AND status != 'rejected'
        AND status != 'cancelled'
        AND (
          (start_date <= $2 AND end_date >= $2) OR
          (start_date <= $3 AND end_date >= $3) OR
          (start_date >= $2 AND end_date <= $3)
        )
    `, [lookupEmployeeId, finalStartDate, finalEndDate]);

    if (overlapCheck.rows.length > 0) {
      const existingLeave = overlapCheck.rows[0];
      return res.status(400).json({
        success: false,
        message: 'You already have a leave request for the selected dates',
        data: {
          conflict: {
            id: existingLeave.id,
            leaveType: existingLeave.leave_type,
            startDate: existingLeave.start_date,
            endDate: existingLeave.end_date,
            status: existingLeave.status
          },
          requested: {
            startDate: finalStartDate,
            endDate: finalEndDate
          },
          hint: 'Please cancel or modify your existing leave request before creating a new one for overlapping dates'
        }
      });
    }

    // Calculate total days
    const start = new Date(finalStartDate);
    const end = new Date(finalEndDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // Get actual employee_id from employees table - NEVER use request body!
    // First try by userId, then by email for more reliable lookup (with tenant check)
    let employeeResult = await pool.query(
      'SELECT id, employee_id, full_name, tenant_id FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, req.user.tenantId]
    );
    
    // If not found by id, try by email from token
    if (employeeResult.rows.length === 0 && req.user.email) {
      employeeResult = await pool.query(
        'SELECT id, employee_id, full_name, tenant_id FROM employees WHERE email = $1 AND tenant_id = $2::integer',
        [req.user.email, req.user.tenantId]
      );
      console.log(`📋 Lookup by email ${req.user.email}: found ${employeeResult.rows.length} rows`);
    }
    
    const employeeData = employeeResult.rows[0] || {};
    const actualEmployeeId = employeeData.employee_id;
    console.log(`📋 POST /api/me/leave-requests - userId: ${userId}, email: ${req.user.email}, actualEmployeeId from DB: ${actualEmployeeId}`);
    
    if (!actualEmployeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee not found in database',
        debug: {
          userId: userId,
          email: req.user.email
        }
      });
    }

    // Insert into database with leave_type_id and custom_data (using employee_id from employees table)
    const result = await pool.query(`
      INSERT INTO leave_requests (
        employee_id, leave_type_id, leave_type, start_date, end_date, total_days, 
        reason, status, custom_data, tenant_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `, [
      actualEmployeeId, 
      leaveTypeData.id,
      leaveTypeData.name, 
      finalStartDate, 
      finalEndDate, 
      totalDays,
      finalReason,
      'pending',
      JSON.stringify(finalCustomData),
      employeeData.tenant_id || null
    ]);

    const newLeaveRequest = result.rows[0];

    console.log(`✅ Leave request created in DB - ID: ${newLeaveRequest.id}, User: ${userId}, EmployeeId: ${employeeData.employee_id}, Type: ${leaveTypeData.name} (ID: ${leaveTypeData.id}), Custom Data: ${JSON.stringify(finalCustomData)}`);

    res.status(201).json({
      success: true,
      message: "Leave request submitted successfully and saved to database",
      data: {
        id: newLeaveRequest.id,
        userId: newLeaveRequest.user_id,
        employeeId: employeeData.employee_id,
        employeeName: employeeData.full_name,
        leaveTypeId: newLeaveRequest.leave_type_id,
        leaveType: newLeaveRequest.leave_type,
        startDate: newLeaveRequest.start_date,
        endDate: newLeaveRequest.end_date,
        totalDays: newLeaveRequest.total_days,
        reason: newLeaveRequest.reason,
        status: newLeaveRequest.status,
        customData: newLeaveRequest.custom_data,
        requiresApproval: leaveTypeData.requires_approval,
        isPaid: leaveTypeData.is_paid,
        color: leaveTypeData.color,
        createdAt: newLeaveRequest.created_at
      }
    });
  } catch (error) {
    console.error('❌ Error creating leave request:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create leave request",
      error: error.message
    });
  }
});

// PUT Update Leave Request
router.put('/me/leave-requests/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const requestId = req.params.id;
  const { leave_type, leaveType, start_date, startDate, end_date, endDate, reason, comment } = req.body;

  try {
    // Get actual employee_id
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, tenantId]
    );
    const actualEmployeeId = empResult.rows[0]?.employee_id;
    
    // Check if leave request exists and belongs to user (with tenant check)
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1 AND employee_id = $2 AND tenant_id = $3::integer',
      [requestId, actualEmployeeId, tenantId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found or you don't have permission to update it"
      });
    }

    const existingRequest = checkResult.rows[0];

    // Prepare update values
    const finalLeaveType = leave_type || leaveType || existingRequest.leave_type;
    const finalStartDate = start_date || startDate || existingRequest.start_date;
    const finalEndDate = end_date || endDate || existingRequest.end_date;
    const finalReason = reason || comment || existingRequest.reason;

    // Calculate total days
    const start = new Date(finalStartDate);
    const end = new Date(finalEndDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // Update in database
    const result = await pool.query(`
      UPDATE leave_requests 
      SET leave_type = $1, start_date = $2, end_date = $3, 
          total_days = $4, reason = $5, updated_at = NOW()
      WHERE id = $6 AND employee_id = $7 AND tenant_id = $8::integer
      RETURNING *
    `, [finalLeaveType, finalStartDate, finalEndDate, totalDays, finalReason, requestId, actualEmployeeId, tenantId]);

    const updatedRequest = result.rows[0];

    console.log(`✅ Leave request updated in DB - ID: ${requestId}, User: ${userId}`);

    res.json({
      success: true,
      message: "Leave request updated successfully in database",
      data: {
        id: updatedRequest.id,
        userId: updatedRequest.user_id,
        leaveType: updatedRequest.leave_type,
        startDate: updatedRequest.start_date,
        endDate: updatedRequest.end_date,
        totalDays: updatedRequest.total_days,
        reason: updatedRequest.reason,
        status: updatedRequest.status,
        createdAt: updatedRequest.created_at,
        updatedAt: updatedRequest.updated_at
      }
    });
  } catch (error) {
    console.error('❌ Error updating leave request:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update leave request",
      error: error.message
    });
  }
});

// DELETE Cancel/Withdraw Leave Request (Employee - Only Pending)
router.delete('/me/leave-requests/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const requestId = parseInt(req.params.id);

  console.log(`🗑️ User ${userId} attempting to delete leave request ${requestId}`);

  try {
    // Get actual employee_id
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 AND tenant_id = $2::integer',
      [userId, tenantId]
    );
    const actualEmployeeId = empResult.rows[0]?.employee_id;
    
    // Check if leave request exists and belongs to user (with tenant check)
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1 AND employee_id = $2 AND tenant_id = $3::integer',
      [requestId, actualEmployeeId, tenantId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found or you don't have permission to delete it"
      });
    }

    const leaveRequest = checkResult.rows[0];

    // Only allow deletion of pending requests
    if (leaveRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete ${leaveRequest.status} leave request`,
        data: {
          current_status: leaveRequest.status,
          hint: "Only pending requests can be cancelled"
        }
      });
    }

    // Delete from database
    await pool.query('DELETE FROM leave_requests WHERE id = $1', [requestId]);

    console.log(`✅ Leave request ${requestId} deleted by user ${userId}`);

    res.json({
      success: true,
      message: 'Leave request cancelled successfully',
      data: {
        deleted_request_id: requestId,
        leave_type: leaveRequest.leave_type,
        start_date: leaveRequest.start_date,
        end_date: leaveRequest.end_date,
        total_days: leaveRequest.total_days
      }
    });
  } catch (error) {
    console.error('❌ Error deleting leave request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete leave request',
      error: error.message
    });
  }
});

// =====================================
// ADMIN LEAVE REQUEST MANAGEMENT APIs
// =====================================

console.log('🔵 REGISTERING: GET /api/admin/leave-requests');

// GET All Leave Requests (Admin/Manager)
router.get('/admin/leave-requests', authenticateToken, async (req, res) => {
  const userId = parseInt(req.user.userId);
  const tenantId = parseInt(req.user.tenantId);
  const userType = req.user.userType;

  try {
    let user = null;
    let isAdmin = false;

    // Check both employees and company_details tables based on userType
    if (userType === 'admin') {
      // Admin from company_details table
      const adminResult = await pool.query(
        'SELECT id, name as full_name, role, tenant_id FROM company_details WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = adminResult.rows[0];
      isAdmin = true;
    } else {
      // Employee from employees table
      const userResult = await pool.query(
        'SELECT id, full_name, role, is_admin, tenant_id FROM employees WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = userResult.rows[0];
      isAdmin = user && (user.role === 'Admin' || user.role === 'Manager' || user.is_admin);
    }

    // Check admin/manager permission
    if (!user || !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can view all leave requests'
      });
    }

    const { status, user_id, employee_id, leave_type_id, leave_type, start_date, end_date, department, search, sort_by = 'created_at', sort_order = 'desc', page = 1, limit = 50 } = req.query;

    // Support both user_id and employee_id params
    const filterEmployeeId = employee_id || user_id;

    // Build query with filters - filter by tenant_id to get all employees' leave requests
    let query = `
      SELECT 
        lr.*,
        u.full_name as user_name,
        u.email as user_email,
        u.department as user_department,
        u.employee_id as real_employee_id,
        u.profile_photo as user_profile_photo,
        lt.name as leave_type_name,
        lt.color as leave_type_color,
        lt.requires_approval,
        lt.is_paid
      FROM leave_requests lr
      LEFT JOIN employees u ON lr.employee_id = u.employee_id
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE u.tenant_id::integer = $1
    `;
    
    const params = [tenantId];
    let paramCount = 2;

    if (status) {
      query += ` AND lr.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (filterEmployeeId) {
      query += ` AND u.id = $${paramCount}`;
      params.push(parseInt(filterEmployeeId));
      paramCount++;
    }

    if (leave_type_id) {
      query += ` AND lr.leave_type_id = $${paramCount}`;
      params.push(parseInt(leave_type_id));
      paramCount++;
    }

    if (leave_type) {
      query += ` AND LOWER(lr.leave_type) = LOWER($${paramCount})`;
      params.push(leave_type);
      paramCount++;
    }

    if (start_date) {
      query += ` AND lr.start_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND lr.end_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    if (department) {
      query += ` AND LOWER(u.department) = LOWER($${paramCount})`;
      params.push(department);
      paramCount++;
    }

    if (search) {
      query += ` AND (LOWER(u.full_name) LIKE LOWER($${paramCount}) OR LOWER(u.employee_id) LIKE LOWER($${paramCount}) OR LOWER(lr.leave_type) LIKE LOWER($${paramCount}))`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Sorting - whitelist allowed columns
    const allowedSortColumns = ['created_at', 'start_date', 'end_date', 'status', 'leave_type', 'total_days'];
    const safeSortBy = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY lr.${safeSortBy} ${safeSortOrder}`;

    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

    // Get total count with same filters
    let countQuery = `
      SELECT COUNT(*) 
      FROM leave_requests lr
      LEFT JOIN employees u ON lr.employee_id = u.employee_id
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE u.tenant_id::integer = $1
    `;
    const countParams = [tenantId];
    let countParamNum = 2;

    if (status) {
      countQuery += ` AND lr.status = $${countParamNum}`;
      countParams.push(status);
      countParamNum++;
    }

    if (filterEmployeeId) {
      countQuery += ` AND u.id = $${countParamNum}`;
      countParams.push(parseInt(filterEmployeeId));
      countParamNum++;
    }

    if (leave_type_id) {
      countQuery += ` AND lr.leave_type_id = $${countParamNum}`;
      countParams.push(parseInt(leave_type_id));
      countParamNum++;
    }

    if (leave_type) {
      countQuery += ` AND LOWER(lr.leave_type) = LOWER($${countParamNum})`;
      countParams.push(leave_type);
      countParamNum++;
    }

    if (start_date) {
      countQuery += ` AND lr.start_date >= $${countParamNum}`;
      countParams.push(start_date);
      countParamNum++;
    }

    if (end_date) {
      countQuery += ` AND lr.end_date <= $${countParamNum}`;
      countParams.push(end_date);
      countParamNum++;
    }

    if (department) {
      countQuery += ` AND LOWER(u.department) = LOWER($${countParamNum})`;
      countParams.push(department);
      countParamNum++;
    }

    if (search) {
      countQuery += ` AND (LOWER(u.full_name) LIKE LOWER($${countParamNum}) OR LOWER(u.employee_id) LIKE LOWER($${countParamNum}) OR LOWER(lr.leave_type) LIKE LOWER($${countParamNum}))`;
      countParams.push(`%${search}%`);
      countParamNum++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    console.log(`✅ Admin ${user.full_name} (tenant_id: ${tenantId}) retrieved ${result.rows.length} leave requests`);

    // Map results to include employee_id
    const leaveRequests = result.rows.map(lr => ({
      ...lr,
      employee_id: lr.real_employee_id
    }));

    res.json({
      success: true,
      message: 'Leave requests retrieved successfully',
      data: {
        leave_requests: leaveRequests,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          total_pages: Math.ceil(totalCount / parseInt(limit))
        },
        filters: {
          status: status || 'all',
          employee_id: filterEmployeeId || 'all',
          leave_type_id: leave_type_id || 'all',
          leave_type: leave_type || 'all',
          start_date: start_date || 'all',
          end_date: end_date || 'all',
          department: department || 'all',
          search: search || null,
          sort_by: safeSortBy,
          sort_order: safeSortOrder
        }
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving leave requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve leave requests',
      error: error.message
    });
  }
});

// PUT Approve Leave Request (Admin/Manager)
router.put('/admin/leave-requests/:id/approve', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const requestId = parseInt(req.params.id);

  try {
    // Verify admin/manager role from multiple sources (employees, company_details, token)
    const roleCheck = await verifyAdminRole(req.user, pool);

    if (!roleCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can approve leave requests'
      });
    }

    // Fetch admin name from employees or company_details
    let admin = null;
    const adminResult = await pool.query(
      'SELECT id, employee_id, full_name, email, role, is_admin FROM employees WHERE id = $1',
      [adminId]
    );
    if (adminResult.rows.length > 0) {
      admin = adminResult.rows[0];
    } else {
      const companyResult = await pool.query(
        'SELECT id, full_name, email, role, is_admin FROM company_details WHERE email = $1',
        [req.user.email]
      );
      if (companyResult.rows.length > 0) {
        admin = companyResult.rows[0];
      } else {
        admin = { id: adminId, full_name: req.user.name || req.user.email, role: roleCheck.role, email: req.user.email };
      }
    }

    const { comment } = req.body;

    // Check if leave request exists (tenant-isolated)
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1 AND tenant_id = $2',
      [requestId, req.user.tenantId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const leaveRequest = checkResult.rows[0];

    // Check if already processed
    if (leaveRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Leave request is already ${leaveRequest.status}`,
        data: {
          current_status: leaveRequest.status,
          approved_by: leaveRequest.approved_by,
          approved_at: leaveRequest.approved_at
        }
      });
    }

    // Approve leave request
    const result = await pool.query(`
      UPDATE leave_requests 
      SET status = 'approved',
          approved_by = $1,
          approved_at = NOW(),
          rejection_reason = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminId, comment || null, requestId]);

    const approvedRequest = result.rows[0];

    console.log(`✅ Leave request ${requestId} approved by ${admin.full_name}`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: adminId, actorName: admin.full_name, actorType: 'admin', category: 'requests', action: 'approve_leave', title: 'Admin approved vacation request', description: `${approvedRequest.employee_id} · ${approvedRequest.leave_type}`, targetType: 'leave_request', targetId: requestId, targetName: approvedRequest.employee_id });

    res.json({
      success: true,
      message: 'Leave request approved successfully',
      data: {
        leave_request: approvedRequest,
        approved_by: {
          id: adminId,
          name: admin.full_name,
          role: admin.role
        },
        approved_at: approvedRequest.approved_at,
        comment: comment
      }
    });
  } catch (error) {
    console.error('❌ Error approving leave request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve leave request',
      error: error.message
    });
  }
});

// PUT Reject Leave Request (Admin/Manager)
router.put('/admin/leave-requests/:id/reject', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const requestId = parseInt(req.params.id);

  try {
    // Verify admin/manager role from multiple sources (employees, company_details, token)
    const roleCheck = await verifyAdminRole(req.user, pool);

    if (!roleCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can reject leave requests'
      });
    }

    // Fetch admin name from employees or company_details
    let admin = null;
    const adminResult = await pool.query(
      'SELECT id, employee_id, full_name, email, role, is_admin FROM employees WHERE id = $1',
      [adminId]
    );
    if (adminResult.rows.length > 0) {
      admin = adminResult.rows[0];
    } else {
      const companyResult = await pool.query(
        'SELECT id, full_name, email, role, is_admin FROM company_details WHERE email = $1',
        [req.user.email]
      );
      if (companyResult.rows.length > 0) {
        admin = companyResult.rows[0];
      } else {
        admin = { id: adminId, full_name: req.user.name || req.user.email, role: roleCheck.role, email: req.user.email };
      }
    }

    const { reason, comment } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required',
        data: {
          required_fields: ['reason']
        }
      });
    }

    // Check if leave request exists (tenant-isolated)
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1 AND tenant_id = $2',
      [requestId, req.user.tenantId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const leaveRequest = checkResult.rows[0];

    // Check if already processed
    if (leaveRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Leave request is already ${leaveRequest.status}`,
        data: {
          current_status: leaveRequest.status
        }
      });
    }

    // Reject leave request
    const result = await pool.query(`
      UPDATE leave_requests 
      SET status = 'rejected',
          approved_by = $1,
          approved_at = NOW(),
          rejection_reason = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminId, reason, requestId]);

    const rejectedRequest = result.rows[0];

    console.log(`❌ Leave request ${requestId} rejected by ${admin.full_name}: ${reason}`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: adminId, actorName: admin.full_name, actorType: 'admin', category: 'requests', action: 'reject_leave', title: 'Admin rejected vacation request', description: `${rejectedRequest.employee_id} · Reason: ${reason}`, targetType: 'leave_request', targetId: requestId, targetName: rejectedRequest.employee_id });

    res.json({
      success: true,
      message: 'Leave request rejected',
      data: {
        leave_request: rejectedRequest,
        rejected_by: {
          id: adminId,
          name: admin.full_name,
          role: admin.role
        },
        rejected_at: rejectedRequest.approved_at,
        rejection_reason: reason,
        comment: comment
      }
    });
  } catch (error) {
    console.error('❌ Error rejecting leave request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject leave request',
      error: error.message
    });
  }
});

// GET Leave Balance
router.get('/me/leave-balance', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  const leaveBalance = {
    userId: userId,
    totalBalance: {
      paidLeave: 20,
      sickLeave: 10,
      unpaidLeave: 5,
      maternityLeave: 90,
      paternityLeave: 15,
      trainingLeave: 5,
      specialLeave: 3,
      halfDayLeave: 8
    },
    used: {
      paidLeave: 5,
      sickLeave: 2,
      unpaidLeave: 0,
      maternityLeave: 0,
      paternityLeave: 0,
      trainingLeave: 0,
      specialLeave: 1,
      halfDayLeave: 1
    },
    remaining: {
      paidLeave: 15,
      sickLeave: 8,
      unpaidLeave: 5,
      maternityLeave: 90,
      paternityLeave: 15,
      trainingLeave: 5,
      specialLeave: 2,
      halfDayLeave: 7
    },
    pendingRequests: 2
  };

  res.json({
    success: true,
    message: "Leave balance retrieved successfully",
    data: leaveBalance
  });
});

// GET Leave Balance by Type
router.get('/me/leave-balance/:leaveTypeId', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const leaveTypeId = req.params.leaveTypeId;

  const balanceData = {
    userId: userId,
    leaveTypeId: leaveTypeId,
    total: 20,
    used: 5,
    remaining: 15,
    pending: 2,
    lastUpdated: new Date().toISOString().split('T')[0]
  };

  res.json({
    success: true,
    message: "Leave balance retrieved successfully",
    data: balanceData
  });
});

// ====================================================================
// END OF LEAVE ROUTES
// ====================================================================


  return router;
};
