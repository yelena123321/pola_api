/**
 * employment-contract Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// =====================================
// LEAVE TYPES APIs (Admin Management)
// =====================================

// GET /api/admin/leave-types - Get all leave types (Admin)
router.get('/admin/leave-types', authenticateToken, async (req, res) => {
  const tenantId = req.user.tenantId;
  
  console.log(`📋 GET leave-types - tenantId: ${tenantId}`);

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can manage leave types'
    });
  }

  try {
    const result = await pool.query(`
      SELECT 
        lt.*,
        COUNT(lr.id) as total_requests,
        COUNT(CASE WHEN lr.status = 'approved' THEN 1 END) as approved_requests
      FROM leave_types lt
      LEFT JOIN leave_requests lr ON lt.id = lr.leave_type_id
      WHERE lt.tenant_id::integer = $1
      GROUP BY lt.id
      ORDER BY lt.id ASC
    `, [tenantId]);

    res.json({
      success: true,
      message: 'Leave types retrieved successfully',
      data: {
        leave_types: result.rows,
        total_count: result.rows.length,
        active_count: result.rows.filter(lt => lt.is_active).length,
        tenant_id: tenantId
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

// POST /api/admin/leave-types - Create new leave type (Admin)
router.post('/admin/leave-types', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  
  console.log(`📝 POST leave-types - userId: ${userId}, tenantId: ${tenantId}`);

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can create leave types'
    });
  }

  const { 
    name, 
    description, 
    days_allowed = 0, 
    color = '#6366F1', 
    requires_approval = true,
    is_paid = true,
    is_active = true,
    leave_category = 'general',
    custom_fields = []
  } = req.body;

  // Validate required fields
  if (!name || name.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Leave type name is required'
    });
  }

  // Validate custom_fields structure
  if (custom_fields && !Array.isArray(custom_fields)) {
    return res.status(400).json({
      success: false,
      message: 'custom_fields must be an array'
    });
  }

  // Validate each custom field
  const validFieldTypes = ['text', 'date', 'select', 'number', 'textarea'];
  if (custom_fields.length > 0) {
    for (const field of custom_fields) {
      if (!field.name || !field.label || !field.type) {
        return res.status(400).json({
          success: false,
          message: 'Each custom field must have name, label, and type'
        });
      }
      if (!validFieldTypes.includes(field.type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid field type: ${field.type}. Must be one of: ${validFieldTypes.join(', ')}`
        });
      }
    }
  }

  // Get tenant_id from JWT token
  console.log(`📝 Creating leave type with tenant_id: ${tenantId}`);

  try {
    // Check if leave type already exists for this tenant
    const existing = await pool.query(
      'SELECT id FROM leave_types WHERE LOWER(name) = LOWER($1) AND tenant_id::integer = $2',
      [name.trim(), tenantId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Leave type with this name already exists for your organization',
        data: { existing_id: existing.rows[0].id }
      });
    }

    // Create leave type with tenant_id from token
    const code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const result = await pool.query(`
      INSERT INTO leave_types (
        name, code, description, days_allowed, color, 
        requires_approval, is_paid, is_active,
        leave_category, custom_fields, tenant_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name.trim(),
      code,
      description || '',
      days_allowed,
      color,
      requires_approval,
      is_paid,
      is_active,
      leave_category,
      JSON.stringify(custom_fields),
      tenantId
    ]);

    const newLeaveType = result.rows[0];

    console.log(`✅ Leave type created: ${newLeaveType.name} (tenant_id: ${newLeaveType.tenant_id})`);

    res.json({
      success: true,
      message: 'Leave type created successfully',
      data: {
        leave_type: newLeaveType,
        tenant_id: tenantId,
        created_by: {
          id: userId,
          name: req.user.name || 'Admin'
        }
      }
    });
  } catch (error) {
    console.error('❌ Error creating leave type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create leave type',
      error: error.message
    });
  }
});

// PUT /api/admin/leave-types/:id - Update leave type (Admin)
router.put('/admin/leave-types/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const leaveTypeId = parseInt(req.params.id);

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can update leave types'
    });
  }

  const { 
    name, 
    description, 
    days_allowed, 
    color, 
    requires_approval,
    is_paid,
    is_active 
  } = req.body;

  try {
    // Check if leave type exists (tenant-scoped)
    const existing = await pool.query(
      'SELECT * FROM leave_types WHERE id = $1 AND tenant_id::integer = $2',
      [leaveTypeId, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave type not found'
      });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (days_allowed !== undefined) {
      updates.push(`days_allowed = $${paramCount++}`);
      values.push(days_allowed);
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount++}`);
      values.push(color);
    }
    if (requires_approval !== undefined) {
      updates.push(`requires_approval = $${paramCount++}`);
      values.push(requires_approval);
    }
    if (is_paid !== undefined) {
      updates.push(`is_paid = $${paramCount++}`);
      values.push(is_paid);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    updates.push(`updated_at = NOW()`);
    values.push(leaveTypeId, tenantId);

    const result = await pool.query(`
      UPDATE leave_types 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND tenant_id::integer = $${paramCount + 1}
      RETURNING *
    `, values);

    console.log(`✅ Leave type updated: ${result.rows[0].name} (tenant_id: ${result.rows[0].tenant_id})`);

    res.json({
      success: true,
      message: 'Leave type updated successfully',
      data: {
        leave_type: result.rows[0],
        updated_by: {
          id: userId,
          name: req.user.name || 'Admin'
        }
      }
    });
  } catch (error) {
    console.error('❌ Error updating leave type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update leave type',
      error: error.message
    });
  }
});

// DELETE /api/admin/leave-types/:id - Delete/Deactivate leave type (Admin)
router.delete('/admin/leave-types/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;
  const leaveTypeId = parseInt(req.params.id);

  // Check admin role from JWT
  const adminCheck = await verifyAdminRole(req.user, pool);
  if (!adminCheck.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can delete leave types'
    });
  }

  try {
    // Check if leave type exists (tenant-scoped)
    const existing = await pool.query(
      'SELECT * FROM leave_types WHERE id = $1 AND tenant_id::integer = $2',
      [leaveTypeId, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave type not found'
      });
    }

    // Check if leave type is used in any requests
    const usageCheck = await pool.query(
      'SELECT COUNT(*) FROM leave_requests WHERE leave_type_id = $1',
      [leaveTypeId]
    );

    const usageCount = parseInt(usageCheck.rows[0].count);

    if (usageCount > 0) {
      // Soft delete - just deactivate (tenant-scoped)
      await pool.query(
        'UPDATE leave_types SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id::integer = $2',
        [leaveTypeId, tenantId]
      );

      console.log(`⚠️ Leave type deactivated (has ${usageCount} requests): ${existing.rows[0].name}`);

      return res.json({
        success: true,
        message: 'Leave type deactivated (cannot delete as it has associated requests)',
        data: {
          leave_type_id: leaveTypeId,
          name: existing.rows[0].name,
          status: 'deactivated',
          reason: `This leave type has ${usageCount} associated leave requests`,
          usage_count: usageCount
        }
      });
    }

    // Hard delete if no usage (tenant-scoped)
    await pool.query('DELETE FROM leave_types WHERE id = $1 AND tenant_id::integer = $2', [leaveTypeId, tenantId]);

    console.log(`✅ Leave type deleted: ${existing.rows[0].name}`);

    res.json({
      success: true,
      message: 'Leave type deleted successfully',
      data: {
        leave_type_id: leaveTypeId,
        name: existing.rows[0].name,
        deleted_by: {
          id: userId,
          name: user?.full_name || req.user.name || 'Admin'
        }
      }
    });
  } catch (error) {
    console.error('❌ Error deleting leave type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete leave type',
      error: error.message
    });
  }
});


  return router;
};
