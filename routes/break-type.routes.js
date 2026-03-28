/**
 * break-type Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== BREAK TYPES CRUD APIs (Admin Management) =====

// GET All Break Types (Admin)
router.get('/admin/break-types', authenticateToken, async (req, res) => {
  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all break types'
      });
    }

    const tenantId = req.user.tenantId;

    const result = await pool.query(`
      SELECT 
        id,
        name,
        display_name,
        duration_minutes,
        description,
        is_active,
        tenant_id,
        created_at,
        updated_at
      FROM break_types 
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `, [tenantId]);

    console.log(`✅ Retrieved ${result.rows.length} break types for admin`);

    res.json({
      success: true,
      message: 'Break types retrieved successfully',
      data: {
        break_types: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving break types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve break types',
      error: error.message
    });
  }
});

// POST Create Break Type (Admin only)
router.post('/admin/break-types', authenticateToken, async (req, res) => {
  const { name, display_name, duration_minutes, description, is_active } = req.body;

  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can create break types'
      });
    }

    const tenantId = req.user.tenantId;

    // Validate required fields
    if (!name || !display_name) {
      return res.status(400).json({
        success: false,
        message: 'Name and display_name are required'
      });
    }

    // Check if break type already exists for this tenant
    const existingBreakType = await pool.query(
      'SELECT id FROM break_types WHERE name = $1 AND tenant_id = $2',
      [name, tenantId]
    );

    if (existingBreakType.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Break type with this name already exists'
      });
    }

    // Create break type
    const result = await pool.query(`
      INSERT INTO break_types (name, display_name, duration_minutes, description, is_active, tenant_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id, name, display_name, duration_minutes, description, is_active, tenant_id, created_at
    `, [name, display_name, duration_minutes || null, description || null, is_active !== false, tenantId]);

    console.log(`✅ Admin ${req.user.name || 'Admin'} created break type: ${display_name}`);

    res.status(201).json({
      success: true,
      message: 'Break type created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating break type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create break type',
      error: error.message
    });
  }
});

// GET Single Break Type by ID (Admin)
router.get('/admin/break-types/:id', authenticateToken, async (req, res) => {
  const breakTypeId = parseInt(req.params.id);

  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view break type details'
      });
    }

    const tenantId = req.user.tenantId;

    const result = await pool.query(`
      SELECT 
        id,
        name,
        display_name,
        duration_minutes,
        description,
        is_active,
        tenant_id,
        created_at,
        updated_at
      FROM break_types 
      WHERE id = $1 AND tenant_id = $2
    `, [breakTypeId, tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Break type not found'
      });
    }

    res.json({
      success: true,
      message: 'Break type retrieved successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error retrieving break type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve break type',
      error: error.message
    });
  }
});

// PUT Update Break Type (Admin only)
router.put('/admin/break-types/:id', authenticateToken, async (req, res) => {
  const breakTypeId = parseInt(req.params.id);
  const { name, display_name, duration_minutes, description, is_active } = req.body;

  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update break types'
      });
    }

    const tenantId = req.user.tenantId;

    // Check if break type exists
    const existingBreakType = await pool.query(
      'SELECT * FROM break_types WHERE id = $1 AND tenant_id = $2',
      [breakTypeId, tenantId]
    );

    if (existingBreakType.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Break type not found'
      });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }
    if (display_name !== undefined) {
      updates.push(`display_name = $${paramCount}`);
      values.push(display_name);
      paramCount++;
    }
    if (duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramCount}`);
      values.push(duration_minutes);
      paramCount++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      values.push(is_active);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(breakTypeId);
    values.push(tenantId);

    const result = await pool.query(`
      UPDATE break_types 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND tenant_id = $${paramCount + 1}
      RETURNING id, name, display_name, duration_minutes, description, is_active, tenant_id, updated_at
    `, values);

    console.log(`✅ Admin ${req.user.name || 'Admin'} updated break type #${breakTypeId}`);

    res.json({
      success: true,
      message: 'Break type updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error updating break type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update break type',
      error: error.message
    });
  }
});

// DELETE Break Type (Admin only)
router.delete('/admin/break-types/:id', authenticateToken, async (req, res) => {
  const breakTypeId = parseInt(req.params.id);

  try {
    const adminCheck = await verifyAdminRole(req.user, pool);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete break types'
      });
    }

    const tenantId = req.user.tenantId;

    // Check if break type exists
    const existingBreakType = await pool.query(
      'SELECT name FROM break_types WHERE id = $1 AND tenant_id = $2',
      [breakTypeId, tenantId]
    );

    if (existingBreakType.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Break type not found'
      });
    }

    // Check if break type is being used in breaks table
    const breakUsage = await pool.query(
      'SELECT COUNT(*) as count FROM breaks WHERE break_type = $1',
      [existingBreakType.rows[0].name]
    );

    if (parseInt(breakUsage.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete break type. ${breakUsage.rows[0].count} break(s) are using this type. Consider deactivating it instead.`
      });
    }

    // Delete break type (tenant-scoped)
    await pool.query('DELETE FROM break_types WHERE id = $1 AND tenant_id = $2', [breakTypeId, tenantId]);

    console.log(`✅ Admin ${req.user.name || 'Admin'} deleted break type #${breakTypeId}`);

    res.json({
      success: true,
      message: 'Break type deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting break type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete break type',
      error: error.message
    });
  }
});


  return router;
};
