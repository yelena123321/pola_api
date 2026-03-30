/**
 * correction Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

let correctionRequestIdCounter = 1;
const persistentCorrectionRequests = {};
let correctionTypeIdCounter = 100;
const persistentCorrectionTypes = {};

// ========== CORRECTION TYPE APIs (Admin) ==========

// POST Create Correction Type (Admin)
router.post('/admin/correction-types', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const { name, description, custom_fields } = req.body;

  console.log(`👮 Admin ${adminId} creating correction type: ${name}`);

  // Check admin role from token, employees table, and company_details table
  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }
  } catch (err) {
    console.error('Admin role verification error:', err.message);
    return res.status(403).json({
      success: false,
      message: "Access denied. Could not verify admin role"
    });
  }

  // Validate required fields
  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Correction type name is required"
    });
  }

  // Validate custom_fields structure
  if (custom_fields && !Array.isArray(custom_fields)) {
    return res.status(400).json({
      success: false,
      message: "custom_fields must be an array"
    });
  }

  // Validate each custom field
  if (custom_fields && custom_fields.length > 0) {
    for (const field of custom_fields) {
      if (!field.field_name || !field.field_type) {
        return res.status(400).json({
          success: false,
          message: "Each custom field must have field_name and field_type",
          data: { invalid_field: field }
        });
      }

      const validTypes = ['text', 'time', 'date', 'number', 'textarea', 'select'];
      if (!validTypes.includes(field.field_type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid field_type. Must be one of: ${validTypes.join(', ')}`,
          data: { invalid_type: field.field_type }
        });
      }
    }
  }

  try {
    const tenantId = req.user.tenantId;
    // Create correction type in database with tenant_id for isolation
    const result = await pool.query(
      `INSERT INTO correction_types (name, description, custom_fields, is_active, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, NOW(), NOW())
       RETURNING *`,
      [name, description || null, JSON.stringify(custom_fields || []), tenantId]
    );

    const newCorrectionType = result.rows[0];

    // Also store in memory
    const newId = correctionTypeIdCounter++;
    persistentCorrectionTypes[newId] = {
      id: newId,
      name: name,
      description: description || null,
      custom_fields: custom_fields || [],
      is_active: true,
      created_at: new Date().toISOString(),
      created_by: adminId,
      created_by_name: req.user.name || 'Admin'
    };

    savePersistentData();

    console.log(`✅ Correction type created: ID ${newId} - ${name}`);

    res.status(201).json({
      success: true,
      message: "Correction type created successfully",
      data: {
        correction_type: persistentCorrectionTypes[newId],
        field_count: custom_fields ? custom_fields.length : 0
      }
    });
  } catch (error) {
    console.error('Error creating correction type:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create correction type",
      error: error.message
    });
  }
});

// GET All Correction Types (Admin) - shows all types for admin's tenant including inactive
router.get('/admin/correction-types', authenticateToken, async (req, res) => {
  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }

    const tenantId = req.user.tenantId;
    const result = await pool.query(
      `SELECT * FROM correction_types WHERE tenant_id::integer = $1 ORDER BY id ASC`,
      [tenantId]
    );

    const correctionTypes = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      custom_fields: row.custom_fields || [],
      is_active: row.is_active,
      tenant_id: row.tenant_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    res.json({
      success: true,
      message: "Correction types retrieved successfully",
      data: {
        correction_types: correctionTypes,
        total: correctionTypes.length,
        active: correctionTypes.filter(ct => ct.is_active).length,
        inactive: correctionTypes.filter(ct => !ct.is_active).length
      }
    });
  } catch (error) {
    console.error('Error fetching admin correction types:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch correction types",
      error: error.message
    });
  }
});

// GET All Correction Types (Employee - only active types for their tenant)
router.get('/correction-types', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const result = await pool.query(
      `SELECT * FROM correction_types WHERE is_active = true AND tenant_id::integer = $1 ORDER BY id ASC`,
      [tenantId]
    );

    const correctionTypes = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      custom_fields: row.custom_fields || [],
      is_active: row.is_active,
      created_at: row.created_at
    }));

    res.json({
      success: true,
      message: "Correction types retrieved successfully",
      data: {
        correction_types: correctionTypes,
        total: correctionTypes.length
      }
    });
  } catch (error) {
    console.error('Error fetching correction types:', error);
    
    // Fallback to in-memory data
    const types = Object.values(persistentCorrectionTypes).filter(ct => ct.is_active);
    
    res.json({
      success: true,
      message: "Correction types retrieved successfully",
      data: {
        correction_types: types,
        total: types.length
      }
    });
  }
});

// GET Single Correction Type
router.get('/correction-types/:id', authenticateToken, async (req, res) => {
  const typeId = parseInt(req.params.id);
  const tenantId = req.user.tenantId;

  try {
    const result = await pool.query(
      `SELECT * FROM correction_types WHERE id = $1 AND tenant_id::integer = $2`,
      [typeId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Correction type not found"
      });
    }

    const correctionType = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: result.rows[0].description,
      custom_fields: result.rows[0].custom_fields || [],
      is_active: result.rows[0].is_active,
      created_at: result.rows[0].created_at
    };

    res.json({
      success: true,
      message: "Correction type retrieved successfully",
      data: { correction_type: correctionType }
    });
  } catch (error) {
    console.error('Error fetching correction type:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch correction type",
      error: error.message
    });
  }
});

// ========== CORRECTION REQUEST APIs ==========

// POST Create Correction Request (Employee)
router.post('/me/correction-requests', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { correction_type_id, date, correction_data, comment, new_time, original_time, reason } = req.body;

  console.log(`📝 Correction request from user ${userId}`);

  // Build correction_data from direct fields if not provided
  let finalCorrectionData = correction_data;
  if (!finalCorrectionData && (new_time || original_time)) {
    finalCorrectionData = {
      new_time: new_time,
      original_time: original_time
    };
  }

  // Validate required fields
  if (!correction_type_id || !date) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
      data: {
        required_fields: ["correction_type_id", "date"],
        optional_fields: ["new_time", "original_time", "reason", "correction_data"],
        missing: [
          !correction_type_id && "correction_type_id",
          !date && "date"
        ].filter(Boolean)
      }
    });
  }

  // Use reason from direct field or comment
  const finalComment = reason || comment || '';

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      success: false,
      message: "Invalid date format. Use YYYY-MM-DD",
      data: { provided_date: date }
    });
  }

  // Get user details from memory or use token data
  let user = persistentUsers[userId];
  let employeeId = null;
  if (!user) {
    // Try to get from database
    try {
      const userResult = await pool.query(
        'SELECT id, full_name, email, tenant_id, employee_id FROM employees WHERE (id = $1 OR email = $2) AND tenant_id = $3',
        [userId, req.user.email, req.user.tenantId]
      );
      if (userResult.rows.length > 0) {
        user = userResult.rows[0];
        employeeId = user.employee_id;
      }
    } catch (err) {
      console.log('User lookup error:', err.message);
    }
  } else {
    employeeId = user.employee_id;
  }

  // If no employee_id found, we cannot proceed
  if (!employeeId) {
    return res.status(400).json({
      success: false,
      message: "Employee ID not found. Please ensure your profile has an employee_id set.",
      data: { user_id: userId }
    });
  }

  try {
    // Get correction type from database (tenant-isolated)
    const typeResult = await pool.query(
      `SELECT * FROM correction_types WHERE id = $1 AND is_active = true AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [correction_type_id, req.user.tenantId]
    );

    if (typeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Correction type not found or inactive"
      });
    }

    const correctionType = typeResult.rows[0];
    const customFields = correctionType.custom_fields || [];

    // Validate correction_data against custom_fields (only if custom fields exist and data provided)
    if (customFields.length > 0) {
      const hasRequiredFields = customFields.some(f => f.required);
      if (hasRequiredFields && !finalCorrectionData) {
        const requiredFieldNames = customFields.filter(f => f.required).map(f => ({
          field_name: f.field_name,
          field_type: f.field_type,
          label: f.label
        }));
        return res.status(400).json({
          success: false,
          message: "correction_data is required for this correction type",
          data: {
            correction_type: correctionType.name,
            required_fields: requiredFieldNames
          }
        });
      }
      if (finalCorrectionData) {
        for (const field of customFields) {
          if (field.required && !finalCorrectionData[field.field_name]) {
            return res.status(400).json({
              success: false,
              message: `Required field missing: ${field.label || field.field_name}`,
              data: {
                missing_field: field.field_name,
                correction_type: correctionType.name,
                all_required_fields: customFields.filter(f => f.required).map(f => ({
                  field_name: f.field_name,
                  field_type: f.field_type,
                  label: f.label
                })),
                all_optional_fields: customFields.filter(f => !f.required).map(f => ({
                  field_name: f.field_name,
                  field_type: f.field_type,
                  label: f.label
                }))
              }
            });
          }

          // Validate time format
          if (field.field_type === 'time' && finalCorrectionData[field.field_name]) {
            const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
            if (!timeRegex.test(finalCorrectionData[field.field_name])) {
              return res.status(400).json({
                success: false,
                message: `Invalid time format for ${field.label || field.field_name}. Use HH:MM`,
                data: { field: field.field_name, value: finalCorrectionData[field.field_name] }
              });
            }
          }

          // Validate date format
          if (field.field_type === 'date' && finalCorrectionData[field.field_name]) {
            if (!dateRegex.test(finalCorrectionData[field.field_name])) {
              return res.status(400).json({
                success: false,
                message: `Invalid date format for ${field.label || field.field_name}. Use YYYY-MM-DD`,
                data: { field: field.field_name, value: finalCorrectionData[field.field_name] }
              });
            }
          }

          // Validate number format
          if (field.field_type === 'number' && finalCorrectionData[field.field_name]) {
            if (isNaN(finalCorrectionData[field.field_name])) {
              return res.status(400).json({
                success: false,
                message: `${field.label || field.field_name} must be a number`,
                data: { field: field.field_name, value: finalCorrectionData[field.field_name] }
              });
            }
          }
        }
      }
    }

    // Insert correction request into database
    const result = await pool.query(
      `INSERT INTO correction_requests 
       (employee_id, correction_type_id, date, correction_data, comment, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
       RETURNING *`,
      [employeeId, correction_type_id, date, JSON.stringify(finalCorrectionData || {}), finalComment || null, req.user.tenantId]
    );

    const newRequest = result.rows[0];

    // Also store in memory
    const memoryId = correctionRequestIdCounter++;
    const now = new Date();

    persistentCorrectionRequests[memoryId] = {
      id: memoryId,
      userId: userId,
      employee_name: user?.full_name || req.user.name || 'Employee',
      employee_email: user?.email || req.user.email,
      correction_type_id: correction_type_id,
      correction_type_name: correctionType.name,
      date: date,
      correction_data: finalCorrectionData || {},
      new_time: finalCorrectionData?.new_time || null,
      original_time: finalCorrectionData?.original_time || null,
      comment: finalComment || null,
      reason: finalComment || null,
      status: "pending",
      submitted_at: now.toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      reviewer_name: null,
      rejection_reason: null
    };

    savePersistentData();

    console.log(`✅ Correction request created: ID ${memoryId} for user ${userId}`);

    res.status(201).json({
      success: true,
      message: "Correction request submitted successfully",
      data: {
        request: persistentCorrectionRequests[memoryId],
        next_steps: [
          "Your request has been sent to the admin",
          "You will be notified once it's reviewed",
          "Check status using GET /api/me/correction-requests"
        ]
      }
    });
  } catch (error) {
    console.error('Error creating correction request:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create correction request",
      error: error.message
    });
  }
});

// GET User's Correction Requests (Employee)
router.get('/me/correction-requests', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { status } = req.query;

  console.log(`📋 Get correction requests for user ${userId}`);

  try {
    // Get employee_id from employees table
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 OR email = $2',
      [userId, req.user.email]
    );
    const employeeId = empResult.rows[0]?.employee_id;
    
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID not found for this user"
      });
    }

    // Fetch from database
    let query = `
      SELECT cr.*, ct.name as correction_type_name, u.full_name as employee_name, u.email as employee_email
      FROM correction_requests cr
      LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
      LEFT JOIN employees u ON cr.employee_id = u.employee_id
      WHERE cr.employee_id = $1
    `;
    const params = [employeeId];

    // Filter by status if provided (skip if 'all' to return everything)
    if (status && status.toLowerCase() !== 'all') {
      query += ` AND cr.status = $2`;
      params.push(status.toLowerCase());
    }

    query += ` ORDER BY cr.created_at DESC`;

    const result = await pool.query(query, params);
    const userRequests = result.rows.map(row => ({
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      employee_email: row.employee_email,
      correction_type_id: row.correction_type_id,
      correction_type_name: row.correction_type_name,
      date: row.date,
      correction_data: row.correction_data,
      comment: row.comment,
      status: row.status,
      submitted_at: row.created_at,
      reviewed_at: row.approved_at,
      reviewed_by: row.approved_by,
      rejection_reason: row.rejection_reason
    }));

    res.json({
      success: true,
      message: "Correction requests retrieved successfully",
      data: {
        requests: userRequests,
        total: userRequests.length,
        pending: userRequests.filter(cr => cr.status === 'pending').length,
        approved: userRequests.filter(cr => cr.status === 'approved').length,
        rejected: userRequests.filter(cr => cr.status === 'rejected').length,
        userId: userId
      }
    });
  } catch (error) {
    console.error('Error fetching correction requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch correction requests',
      error: error.message
    });
  }
});

// GET All Correction Requests (Admin)
router.get('/admin/correction-requests', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const tenantId = req.user.tenantId;
  const { status, employeeId, userId, date, sort } = req.query;

  console.log(`👮 Admin ${adminId} viewing correction requests`);

  try {
    // Check admin role - verify from multiple sources
    const adminCheck = await verifyAdminRole(req.user, pool);
    
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }

    // Build query - filter by tenant_id for data isolation
    let query = `
      SELECT cr.*, ct.name as correction_type_name, u.full_name as employee_name, u.email as employee_email
      FROM correction_requests cr
      LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
      LEFT JOIN employees u ON cr.employee_id = u.employee_id AND u.tenant_id = $1
      WHERE cr.tenant_id = $1
    `;
    const params = [tenantId];
    let paramCount = 2;

    // Filter by status (skip if 'all' to return everything)
    if (status && status.toLowerCase() !== 'all') {
      query += ` AND cr.status = $${paramCount}`;
      params.push(status.toLowerCase());
      paramCount++;
    }

    // Filter by employeeId (support both employeeId and userId for backward compatibility)
    const filterEmployeeId = employeeId || userId;
    if (filterEmployeeId) {
      query += ` AND cr.employee_id = $${paramCount}`;
      params.push(filterEmployeeId);
      paramCount++;
    }

    // Filter by date
    if (date) {
      query += ` AND cr.date = $${paramCount}`;
      params.push(date);
      paramCount++;
    }

    // Sort
    if (sort === 'oldest') {
      query += ` ORDER BY cr.created_at ASC`;
    } else {
      query += ` ORDER BY cr.created_at DESC`;
    }

    const result = await pool.query(query, params);
    const requests = result.rows.map(row => ({
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      employee_email: row.employee_email,
      correction_type_id: row.correction_type_id,
      correction_type_name: row.correction_type_name,
      date: row.date,
      correction_data: row.correction_data,
      comment: row.comment,
      status: row.status,
      submitted_at: row.created_at,
      reviewed_at: row.approved_at,
      reviewed_by: row.approved_by,
      rejection_reason: row.rejection_reason
    }));

    res.json({
      success: true,
      message: "All correction requests retrieved successfully",
      data: {
        requests: requests,
        total: requests.length,
        pending: requests.filter(cr => cr.status === 'pending').length,
        approved: requests.filter(cr => cr.status === 'approved').length,
        rejected: requests.filter(cr => cr.status === 'rejected').length,
        filters_applied: {
          status: status || null,
          userId: userId || null,
          date: date || null,
          sort: sort || 'newest'
        }
      }
    });
  } catch (error) {
    console.error('Error fetching correction requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch correction requests',
      error: error.message
    });
  }
});

// GET Single Correction Request Detail (for Admin modal/form)
router.get('/admin/correction-requests/:id', authenticateToken, async (req, res) => {
  const requestId = parseInt(req.params.id);
  
  try {
    // Check admin role - verify from multiple sources
    const adminCheck = await verifyAdminRole(req.user, pool);
    
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }

    // Get correction request with all details
    const result = await pool.query(`
      SELECT 
        cr.*,
        ct.name as correction_type_name,
        ct.description as correction_type_description,
        u.full_name as employee_name,
        u.email as employee_email,
        u.role as employee_role,
        u.department as employee_department,
        u.profile_photo as employee_photo
      FROM correction_requests cr
      LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
      LEFT JOIN employees u ON cr.employee_id = u.employee_id
      WHERE cr.id = $1
    `, [requestId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Correction request not found',
        data: { request_id: requestId }
      });
    }
    
    const cr = result.rows[0];
    const correctionData = cr.correction_data || {};
    
    // Get original timer data for this date
    let currentValues = {
      clock_in: null,
      clock_out: null,
      break_duration: null
    };
    
    if (cr.date) {
      const date = cr.date instanceof Date 
        ? cr.date.toISOString().split('T')[0]
        : String(cr.date).split('T')[0];
      
      const timerResult = await pool.query(`
        SELECT clock_in, clock_out, duration_minutes
        FROM timers
        WHERE employee_id = $1 AND DATE(clock_in) = $2
        ORDER BY id DESC LIMIT 1
      `, [cr.employee_id, date]);
      
      if (timerResult.rows.length > 0) {
        const timer = timerResult.rows[0];
        if (timer.clock_in) {
          currentValues.clock_in = new Date(timer.clock_in).toLocaleTimeString('en-US', { 
            hour: '2-digit', minute: '2-digit', hour12: false 
          });
        }
        if (timer.clock_out) {
          currentValues.clock_out = new Date(timer.clock_out).toLocaleTimeString('en-US', { 
            hour: '2-digit', minute: '2-digit', hour12: false 
          });
        }
      }
      
      // Get break duration for this date
      const breakResult = await pool.query(`
        SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))/60) as total_break
        FROM breaks
        WHERE employee_id::text = $1 AND DATE(start_time) = $2
      `, [cr.employee_id, date]);
      
      if (breakResult.rows[0]?.total_break) {
        currentValues.break_duration = Math.round(parseFloat(breakResult.rows[0].total_break));
      }
    }
    
    res.json({
      success: true,
      data: {
        id: cr.id,
        
        // Employee info
        employee: {
          id: cr.employee_id,
          name: cr.employee_name || 'Unknown',
          email: cr.employee_email,
          role: cr.employee_role || 'Employee',
          department: cr.employee_department,
          photo: cr.employee_photo
        },
        
        // Issue details
        issue_type: cr.correction_type_name || 'Time Correction',
        issue_description: cr.correction_type_description,
        date: cr.date,
        date_formatted: cr.date ? new Date(cr.date).toLocaleDateString('en-US', { 
          day: '2-digit', month: 'short', year: 'numeric' 
        }) : null,
        
        // Current values (original data)
        current_value: {
          clock_in: currentValues.clock_in,
          clock_out: currentValues.clock_out,
          break: currentValues.break_duration ? `${currentValues.break_duration}m` : null,
          break_minutes: currentValues.break_duration
        },
        
        // Corrected values (what employee requested)
        corrected_value: {
          clock_in: correctionData.new_clock_in_time || correctionData.start_time,
          clock_out: correctionData.new_clock_out_time || correctionData.end_time,
          break: correctionData.break_duration ? `${correctionData.break_duration}m` : null,
          break_minutes: correctionData.break_duration
        },
        
        // Comment/reason from employee
        comment: cr.reason || cr.comments || correctionData.comment,
        
        // Status info
        status: cr.status,
        submitted_at: cr.created_at,
        reviewed_at: cr.approved_at,
        reviewed_by: cr.approved_by,
        admin_comment: cr.admin_comment
      }
    });
    
  } catch (error) {
    console.error('Error fetching correction request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch correction request',
      error: error.message
    });
  }
});

// PUT Approve Correction Request (Admin) - with optional value edits
router.put('/admin/correction-requests/:id/approve', authenticateToken, async (req, res) => {
  const requestId = parseInt(req.params.id);
  
  // Admin can optionally override correction values
  const { 
    clock_in,      // Override clock-in time (HH:MM format)
    clock_out,     // Override clock-out time (HH:MM format)
    break_duration, // Override break duration in minutes
    admin_comment   // Admin's comment/note
  } = req.body;

  console.log(`✅ Approving correction request ${requestId}, user:`, req.user);
  console.log(`📝 Admin edits:`, { clock_in, clock_out, break_duration, admin_comment });

  try {
    // Check admin role - verify from multiple sources
    const adminCheck = await verifyAdminRole(req.user, pool);
    
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }

    // Find correction request from database (with tenant isolation)
    const requestResult = await pool.query(
      `SELECT cr.*, ct.name as correction_type_name, u.full_name as employee_name, u.email as employee_email
       FROM correction_requests cr
       LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
       LEFT JOIN employees u ON cr.employee_id = u.employee_id
       WHERE cr.id = $1 AND u.tenant_id::integer = $2`,
      [requestId, req.user.tenantId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Correction request not found",
        data: { request_id: requestId }
      });
    }

    const correctionRequest = requestResult.rows[0];

    // Check if already processed
    if (correctionRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request already ${correctionRequest.status}`,
        data: {
          current_status: correctionRequest.status,
          reviewed_at: correctionRequest.approved_at,
          reviewed_by: correctionRequest.approved_by
        }
      });
    }

    // Apply the correction to actual timer/break data based on type
    let appliedChanges = [];
    const correctionTypeId = correctionRequest.correction_type_id;
    
    // Use admin override values if provided, otherwise use employee's requested values
    let correctionData = correctionRequest.correction_data || {};
    if (clock_in) correctionData.new_clock_in_time = clock_in;
    if (clock_out) correctionData.new_clock_out_time = clock_out;
    if (clock_in) correctionData.start_time = clock_in;
    if (clock_out) correctionData.end_time = clock_out;
    if (break_duration !== undefined) correctionData.break_duration = break_duration;
    
    const employeeId = correctionRequest.employee_id;
    const dateObj = correctionRequest.date;
    
    // Format date as YYYY-MM-DD
    const date = dateObj instanceof Date 
      ? dateObj.toISOString().split('T')[0]
      : (typeof dateObj === 'string' ? dateObj.split('T')[0] : dateObj);

    // Get the timer record for this date and user
    const timerQuery = await pool.query(
      `SELECT * FROM timers 
       WHERE employee_id = $1 
       AND DATE(clock_in) = $2 
       ORDER BY id DESC LIMIT 1`,
      [employeeId, date]
    );

    if (correctionTypeId === 1) {
      // Missing clock in - Update clock_in time
      if (timerQuery.rows.length > 0) {
        const timer = timerQuery.rows[0];
        const newClockIn = `${date}T${correctionData.new_clock_in_time}:00`;
        await pool.query(
          `UPDATE timers SET clock_in = $1, updated_at = NOW() WHERE id = $2`,
          [newClockIn, timer.id]
        );
        appliedChanges.push(`Updated clock-in to ${correctionData.new_clock_in_time}`);
      } else {
        // Create new timer entry
        const newClockIn = `${date}T${correctionData.new_clock_in_time}:00`;
        await pool.query(
          `INSERT INTO timers (employee_id, date, clock_in, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())`,
          [employeeId, date, newClockIn]
        );
        appliedChanges.push(`Created new timer with clock-in ${correctionData.new_clock_in_time}`);
      }
    } 
    else if (correctionTypeId === 2) {
      // Add missing work entry - Create complete timer
      const clockIn = `${date}T${correctionData.start_time}:00`;
      const clockOut = `${date}T${correctionData.end_time}:00`;
      
      const result = await pool.query(
        `INSERT INTO timers (employee_id, date, clock_in, clock_out, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [employeeId, date, clockIn, clockOut]
      );
      
      appliedChanges.push(`Created work entry: ${correctionData.start_time} - ${correctionData.end_time}`);
      
      // Add break if provided
      if (correctionData.break_duration) {
        const breakStartTime = `${date}T12:00:00`;
        const breakDurationSec = correctionData.break_duration * 60;
        const breakEndTime = new Date(new Date(breakStartTime).getTime() + breakDurationSec * 1000).toISOString();
        await pool.query(
          `INSERT INTO breaks (timer_record_id, employee_id, break_type, start_time, end_time, duration_seconds, created_at)
           VALUES ($1, $2, 'lunch', $3, $4, $5, NOW())`,
          [result.rows[0].id, employeeId, breakStartTime, breakEndTime, breakDurationSec]
        );
        appliedChanges.push(`Added ${correctionData.break_duration} min break`);
      }
    }
    else if (correctionTypeId === 3) {
      // Missing clock out - Update clock_out time
      if (timerQuery.rows.length > 0) {
        const timer = timerQuery.rows[0];
        const newClockOut = `${date}T${correctionData.new_clock_out_time}:00`;
        await pool.query(
          `UPDATE timers SET clock_out = $1, updated_at = NOW() WHERE id = $2`,
          [newClockOut, timer.id]
        );
        appliedChanges.push(`Updated clock-out to ${correctionData.new_clock_out_time}`);
      }
    }
    else if (correctionTypeId === 4) {
      // Wrong clock-in time - Update clock_in
      if (timerQuery.rows.length > 0) {
        const timer = timerQuery.rows[0];
        const newClockIn = `${date}T${correctionData.new_clock_in_time}:00`;
        await pool.query(
          `UPDATE timers SET clock_in = $1, updated_at = NOW() WHERE id = $2`,
          [newClockIn, timer.id]
        );
        appliedChanges.push(`Corrected clock-in from ${correctionData.old_clock_in_time || 'previous'} to ${correctionData.new_clock_in_time}`);
      }
    }
    else if (correctionTypeId === 5) {
      // Wrong clock-out time - Update clock_out
      if (timerQuery.rows.length > 0) {
        const timer = timerQuery.rows[0];
        const newClockOut = `${date}T${correctionData.new_clock_out_time}:00`;
        await pool.query(
          `UPDATE timers SET clock_out = $1, updated_at = NOW() WHERE id = $2`,
          [newClockOut, timer.id]
        );
        appliedChanges.push(`Corrected clock-out from ${correctionData.old_clock_out_time || 'previous'} to ${correctionData.new_clock_out_time}`);
      }
    }
    else if (correctionTypeId === 6) {
      // Wrong break duration - Update break duration_seconds (duration is a generated column)
      if (timerQuery.rows.length > 0) {
        const timer = timerQuery.rows[0];
        const breakDurationSec = correctionData.new_break_duration * 60;
        await pool.query(
          `UPDATE breaks SET duration_seconds = $1 WHERE timer_record_id = $2`,
          [breakDurationSec, timer.id]
        );
        appliedChanges.push(`Corrected break duration to ${correctionData.new_break_duration} minutes`);
      }
    }
    else if (correctionTypeId === 7) {
      // Overtime - Create new timer entry for overtime
      const overtimeStart = `${date}T${correctionData.overtime_start}:00`;
      const overtimeEnd = `${date}T${correctionData.overtime_end}:00`;
      
      await pool.query(
        `INSERT INTO timers (employee_id, date, clock_in, clock_out, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [employeeId, date, overtimeStart, overtimeEnd]
      );
      appliedChanges.push(`Recorded overtime: ${correctionData.overtime_start} - ${correctionData.overtime_end}`);
    }

    // Update correction request status in database
    const adminId = req.user.userId;
    const adminName = req.user.name || 'Admin';
    
    // Drop FK constraint on approved_by (admin may be in company_details, not employees)
    await pool.query(`ALTER TABLE correction_requests DROP CONSTRAINT IF EXISTS correction_requests_approved_by_fkey`);
    
    await pool.query(
      `UPDATE correction_requests 
       SET status = 'approved', 
           approved_at = NOW(), 
           approved_by = $1,
           applied_changes = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [adminId, JSON.stringify(appliedChanges), requestId]
    );

    console.log(`✅ Correction request ${requestId} approved and applied by ${adminName}`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: adminId, actorName: adminName, actorType: 'admin', category: 'requests', action: 'approve_correction', title: 'Admin approved correction request', description: `Request #${requestId} approved and applied`, targetType: 'correction_request', targetId: requestId });

    res.json({
      success: true,
      message: "Correction request approved and applied successfully",
      data: {
        request_id: requestId,
        status: 'approved',
        applied_changes: appliedChanges,
        approved_by: {
          id: adminId,
          name: adminName,
          role: adminCheck.role
        },
        approved_at: new Date().toISOString(),
        correction_applied: true,
        next_steps: [
          "Time entry has been updated in database",
          "Employee will be notified",
          "Change is reflected in time tracking reports"
        ]
      }
    });
  } catch (error) {
    console.error('Error approving correction request:', error);
    res.status(500).json({
      success: false,
      message: "Failed to approve correction request",
      error: error.message
    });
  }
});

// PUT Reject Correction Request (Admin)
router.put('/admin/correction-requests/:id/reject', authenticateToken, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { reason } = req.body;

  console.log(`❌ Rejecting correction request ${requestId}`);

  try {
    // Check admin role - verify from multiple sources
    const adminCheck = await verifyAdminRole(req.user, pool);
    
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or Manager role required",
        data: { your_role: adminCheck.role }
      });
    }

    // Find correction request from database (with tenant isolation)
    const requestResult = await pool.query(
      `SELECT cr.*, ct.name as correction_type_name, u.full_name as employee_name, u.email as employee_email
       FROM correction_requests cr
       LEFT JOIN correction_types ct ON cr.correction_type_id = ct.id
       LEFT JOIN employees u ON cr.employee_id = u.employee_id
       WHERE cr.id = $1 AND u.tenant_id::integer = $2`,
      [requestId, req.user.tenantId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Correction request not found",
        data: { request_id: requestId }
      });
    }

    const correctionRequest = requestResult.rows[0];

    // Check if already processed
    if (correctionRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request already ${correctionRequest.status}`,
        data: {
          current_status: correctionRequest.status,
          reviewed_at: correctionRequest.approved_at,
          reviewed_by: correctionRequest.approved_by
        }
      });
    }

    // Validate reason
    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
        data: {
          hint: "Provide a clear reason for rejection in the 'reason' field"
        }
      });
    }

    // Update correction request status in database
    const adminId = req.user.userId;
    const adminName = req.user.name || 'Admin';
    
    // Drop FK constraint on approved_by (admin may be in company_details, not employees)
    await pool.query(`ALTER TABLE correction_requests DROP CONSTRAINT IF EXISTS correction_requests_approved_by_fkey`);
    
    await pool.query(
      `UPDATE correction_requests 
       SET status = 'rejected', 
           approved_at = NOW(), 
           approved_by = $1,
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [adminId, reason, requestId]
    );

    console.log(`❌ Correction request ${requestId} rejected by ${adminName}`);

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: adminId, actorName: adminName, actorType: 'admin', category: 'requests', action: 'reject_correction', title: 'Admin rejected correction request', description: `Request #${requestId} · Reason: ${reason}`, targetType: 'correction_request', targetId: requestId });

    res.json({
      success: true,
      message: "Correction request rejected",
      data: {
        request_id: requestId,
        status: 'rejected',
        rejected_by: {
          id: adminId,
          name: adminName,
          role: adminCheck.role
        },
        rejected_at: new Date().toISOString(),
        rejection_reason: reason
      }
    });
  } catch (error) {
    console.error('Error rejecting correction request:', error);
    res.status(500).json({
      success: false,
      message: "Failed to reject correction request",
      error: error.message
    });
  }
});

// DELETE Cancel Correction Request (Employee - only pending)
router.delete('/me/correction-requests/:id', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const requestId = parseInt(req.params.id);

  console.log(`🗑️ User ${userId} canceling correction request ${requestId}`);

  // Find correction request
  const correctionRequest = persistentCorrectionRequests[requestId];
  if (!correctionRequest) {
    return res.status(404).json({
      success: false,
      message: "Correction request not found",
      data: { request_id: requestId }
    });
  }

  // Check ownership
  if (correctionRequest.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: "Access denied. You can only cancel your own requests",
      data: {
        request_owner: correctionRequest.employee_name,
        your_id: userId
      }
    });
  }

  // Check if still pending
  if (correctionRequest.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel ${correctionRequest.status} requests`,
      data: {
        current_status: correctionRequest.status,
        hint: "Only pending requests can be canceled"
      }
    });
  }

  // Store request info before deletion
  const deletedRequest = {
    id: correctionRequest.id,
    date: correctionRequest.date,
    issue: correctionRequest.issue,
    new_time: correctionRequest.new_time,
    submitted_at: correctionRequest.submitted_at
  };

  // Delete the request
  delete persistentCorrectionRequests[requestId];
  savePersistentData();

  console.log(`✅ Correction request ${requestId} canceled by user ${userId}`);

  res.json({
    success: true,
    message: "Correction request canceled successfully",
    data: {
      deleted_request: deletedRequest,
      canceled_at: new Date().toISOString()
    }
  });
});


  return router;
};
