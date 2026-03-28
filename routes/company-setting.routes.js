/**
 * company-setting Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ========== COMPANY SETTINGS APIs (Based on Figma Screens) ==========

// Helper: ensure company_settings row exists for a tenant (auto-create from company_details if missing)
async function ensureCompanySettings(pool, tenantId) {
  const check = await pool.query('SELECT id FROM company_settings WHERE tenant_id = $1', [tenantId]);
  if (check.rows.length > 0) return;
  const cdResult = await pool.query('SELECT name, timezone FROM company_details WHERE tenant_id = $1', [tenantId]);
  const companyName = cdResult.rows.length > 0 ? cdResult.rows[0].name : 'My Company';
  const timezone = cdResult.rows.length > 0 ? cdResult.rows[0].timezone : 'UTC';
  await pool.query(
    `INSERT INTO company_settings (tenant_id, name, timezone, work_days, start_time, end_time, break_required, break_duration, enable_overtime, overtime_starts_after, max_overtime_per_day)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     WHERE NOT EXISTS (SELECT 1 FROM company_settings WHERE tenant_id = $1)`,
    [tenantId, companyName, timezone, JSON.stringify(["Mon","Tue","Wed","Thu","Fri"]), '09:00', '17:00', true, 60, false, 8, 2]
  );
}

// GET Company Settings - Main screen (fetches from company_details)
router.get('/company/settings', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    // Fetch from company_details table
    const result = await pool.query(
      'SELECT * FROM company_details WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company details not found for this tenant"
      });
    }

    const cd = result.rows[0];
    
    // Also fetch extra settings from company_settings if they exist
    let extraSettings = {};
    try {
      const settingsResult = await pool.query(
        'SELECT * FROM company_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      if (settingsResult.rows.length > 0) {
        extraSettings = settingsResult.rows[0];
      }
    } catch (e) {
      // company_settings may not have data yet, that's OK
    }

    const company = {
      id: cd.id,
      tenant_id: cd.tenant_id,
      name: cd.name || cd.company || '',
      email: cd.email || '',
      phone: cd.phone || '',
      country: cd.country || '',
      timezone: cd.timezone || extraSettings.timezone || 'UTC',
      logo_url: cd.logo || extraSettings.logo_url || '',
      address: cd.address || extraSettings.address || '',
      full_name: cd.full_name || '',
      role: cd.role || '',
      department: cd.department || '',
      employee_id: cd.employee_id || '',
      status: cd.status || '',
      is_active: cd.is_active,
      is_admin: cd.is_admin,
      profile_photo: cd.profile_photo || '',
      working_hours: cd.working_hours || '',
      work_model: cd.work_model || cd.default_work_model || '',
      start_date: cd.start_date || '',
      industry: extraSettings.industry || '',
      brand_color: extraSettings.brand_color || '#6366F1',
      brand_color_name: extraSettings.brand_color_name || 'Purple',
      support_email: extraSettings.support_email || cd.email || '',
      website: extraSettings.website || '',
      description: extraSettings.description || '',
      employee_count: extraSettings.employee_count || 0,
      founded_date: extraSettings.founded_date || null,
      work_days: extraSettings.work_days || '["Mon","Tue","Wed","Thu","Fri"]',
      start_time: extraSettings.start_time || '09:00',
      end_time: extraSettings.end_time || '17:00',
      break_required: extraSettings.break_required ?? true,
      auto_deduct_break: extraSettings.auto_deduct_break ?? false,
      break_duration: extraSettings.break_duration || 60,
      enable_overtime: extraSettings.enable_overtime ?? false,
      overtime_starts_after: extraSettings.overtime_starts_after || 8,
      max_overtime_per_day: extraSettings.max_overtime_per_day || 2,
      working_hours_per_day: cd.working_hours_per_day || null,
      working_days_per_week: cd.working_days_per_week || null,
      default_break_duration: cd.default_break_duration || null,
      overtime_calculation: cd.overtime_calculation || null,
      created_at: cd.created_at,
      updated_at: cd.updated_at
    };
    
    res.json({
      success: true,
      message: "Company settings retrieved successfully",
      data: {
        company: company,
        permissions: {
          can_edit: true,
          can_upload_logo: true,
          role_required: "admin"
        }
      }
    });
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch company settings",
      error: error.message
    });
  }
});

// UPDATE Complete Company Settings
router.put('/company/settings', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    const allowedFields = ['name', 'industry', 'brand_color', 'brand_color_name', 'support_email', 'company_phone', 'address', 'website', 'description', 'timezone', 'employee_count', 'founded_date'];
    
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields.push(`${field} = $${paramIndex}`);
        updateValues.push(req.body[field]);
        paramIndex++;
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update"
      });
    }
    
    updateFields.push(`updated_at = $${paramIndex}`);
    updateValues.push(new Date());
    paramIndex++;
    
    updateValues.push(tenantId);
    
    const query = `
      UPDATE company_settings 
      SET ${updateFields.join(', ')}
      WHERE tenant_id = $${paramIndex}
      RETURNING *
    `;
    
    const result = await pool.query(query, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company settings updated successfully",
      data: { company: result.rows[0] }
    });
  } catch (error) {
    console.error('Error updating company settings:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company settings",
      error: error.message
    });
  }
});

// UPDATE Company Name
router.put('/company/settings/name', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Company name is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET name = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING name, updated_at',
      [name, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company name updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company name:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company name",
      error: error.message
    });
  }
});

// UPDATE Industry/Category
router.put('/company/settings/industry', authenticateToken, async (req, res) => {
  try {
    const { industry } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!industry || industry.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Industry is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET industry = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING industry, updated_at',
      [industry, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Industry updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating industry:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update industry",
      error: error.message
    });
  }
});

// UPDATE Brand Color
router.put('/company/settings/brand-color', authenticateToken, async (req, res) => {
  try {
    const { brand_color, brand_color_name } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!brand_color) {
      return res.status(400).json({
        success: false,
        message: "Brand color is required"
      });
    }
    
    const updateFields = ['brand_color = $1'];
    const values = [brand_color];
    let paramIndex = 2;
    
    if (brand_color_name) {
      updateFields.push(`brand_color_name = $${paramIndex}`);
      values.push(brand_color_name);
      paramIndex++;
    }
    
    updateFields.push(`updated_at = $${paramIndex}`);
    values.push(new Date());
    paramIndex++;
    
    values.push(tenantId);
    
    const result = await pool.query(
      `UPDATE company_settings SET ${updateFields.join(', ')} WHERE tenant_id = $${paramIndex} RETURNING brand_color, brand_color_name, updated_at`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Edit brand color successfully updated",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating brand color:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update brand color",
      error: error.message
    });
  }
});

// UPDATE Support Email
router.put('/company/settings/support-email', authenticateToken, async (req, res) => {
  try {
    const { support_email } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!support_email || !support_email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: "Valid support email is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET support_email = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING support_email, updated_at',
      [support_email, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Support email updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating support email:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update support email",
      error: error.message
    });
  }
});

// UPDATE Company Phone
router.put('/company/settings/company-phone', authenticateToken, async (req, res) => {
  try {
    const { company_phone } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!company_phone || company_phone.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Company phone is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET company_phone = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING company_phone, updated_at',
      [company_phone, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company phone updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company phone:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company phone",
      error: error.message
    });
  }
});

// UPDATE Address
router.put('/company/settings/address', authenticateToken, async (req, res) => {
  try {
    const { address } = req.body;
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!address || address.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Address is required"
      });
    }
    
    const result = await pool.query(
      'UPDATE company_settings SET address = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING address, updated_at',
      [address, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Address updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update address",
      error: error.message
    });
  }
});

// UPLOAD Company Logo
router.post('/company/settings/logo', authenticateToken, uploadCompanyLogo.single('logo'), async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Logo file is required"
      });
    }
    
    // Upload to Cloudinary
    const logoUrl = await uploadToCloudinary(req.file.buffer, 'company-logos');
    
    // Update database with Cloudinary URL
    const result = await pool.query(
      'UPDATE company_settings SET logo_url = $1, updated_at = $2 WHERE tenant_id = $3 RETURNING logo_url, updated_at',
      [logoUrl, new Date(), tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found"
      });
    }
    
    res.json({
      success: true,
      message: "Company logo uploaded successfully",
      data: {
        logo_url: result.rows[0].logo_url,
        updated_at: result.rows[0].updated_at
      }
    });
  } catch (error) {
    console.error('Error uploading company logo:', error);
    res.status(500).json({
      success: false,
      message: "Failed to upload company logo",
      error: error.message
    });
  }
});

// GET Available Brand Colors
router.get('/company/brand-colors', authenticateToken, (req, res) => {
  const brandColors = [
    { id: 1, name: "Blue", hex: "#3B82F6", icon: "🔵" },
    { id: 2, name: "Purple", hex: "#6366F1", icon: "🟣" },
    { id: 3, name: "Burgundy", hex: "#991B1B", icon: "🟤" },
    { id: 4, name: "Red", hex: "#EF4444", icon: "🔴" },
    { id: 5, name: "Midnight Blue", hex: "#1E3A8A", icon: "🔵" },
    { id: 6, name: "Orange", hex: "#F97316", icon: "🟠" },
    { id: 7, name: "Lavender Purple", hex: "#A78BFA", icon: "🟣" },
    { id: 8, name: "Customize Color", hex: null, icon: "🎨" }
  ];
  
  res.json({
    success: true,
    message: "Brand colors retrieved successfully",
    data: { colors: brandColors }
  });
});

// ========== WORKING HOURS APIs (Based on Figma Screens) ==========

// GET Working Hours - Get company working schedule
router.get('/company/working-hours', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    // Fetch working hours from database
    const result = await pool.query(
      'SELECT work_days, start_time, end_time, break_required, auto_deduct_break, break_duration, enable_overtime, overtime_starts_after, max_overtime_per_day FROM company_settings WHERE tenant_id = $1',
      [tenantId]
    );
    
    if (result.rows.length === 0) {
      // Return default working hours if not set
      return res.json({
        success: true,
        message: "Working hours retrieved successfully (defaults)",
        data: {
          work_schedule: {
            work_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
            start_time: "09:00",
            end_time: "17:00"
          },
          break_rules: {
            break_required: true,
            auto_deduct_break: false,
            break_duration: 60
          },
          overtime_rules: {
            enable_overtime: false,
            overtime_starts_after: 8,
            max_overtime_per_day: 2
          }
        }
      });
    }
    
    const settings = result.rows[0];
    
    res.json({
      success: true,
      message: "Working hours retrieved successfully",
      data: {
        work_schedule: {
          work_days: settings.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"],
          start_time: settings.start_time || "09:00",
          end_time: settings.end_time || "17:00"
        },
        break_rules: {
          break_required: settings.break_required !== null ? settings.break_required : true,
          auto_deduct_break: settings.auto_deduct_break !== null ? settings.auto_deduct_break : false,
          break_duration: settings.break_duration || 60
        },
        overtime_rules: {
          enable_overtime: settings.enable_overtime !== null ? settings.enable_overtime : false,
          overtime_starts_after: settings.overtime_starts_after || 8,
          max_overtime_per_day: settings.max_overtime_per_day || 2
        }
      }
    });
  } catch (error) {
    console.error('Error fetching working hours:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch working hours",
      error: error.message
    });
  }
});

// PUT Working Hours - Update company working schedule
router.put('/company/working-hours', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    const {
      work_days,
      start_time,
      end_time,
      break_required,
      auto_deduct_break,
      break_duration,
      enable_overtime,
      overtime_starts_after,
      max_overtime_per_day
    } = req.body;
    
    // Validate work_days if provided
    if (work_days && (!Array.isArray(work_days) || work_days.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "work_days must be a non-empty array"
      });
    }
    
    // Validate time format if provided
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (start_time && !timeRegex.test(start_time)) {
      return res.status(400).json({
        success: false,
        message: "start_time must be in HH:MM format (e.g., 09:00)"
      });
    }
    
    if (end_time && !timeRegex.test(end_time)) {
      return res.status(400).json({
        success: false,
        message: "end_time must be in HH:MM format (e.g., 17:00)"
      });
    }
    
    // Build update query dynamically based on provided fields
    const updateFields = [];
    const values = [];
    let paramIndex = 1;
    
    if (work_days !== undefined) {
      updateFields.push(`work_days = $${paramIndex}`);
      values.push(JSON.stringify(work_days));
      paramIndex++;
    }
    
    if (start_time !== undefined) {
      updateFields.push(`start_time = $${paramIndex}`);
      values.push(start_time);
      paramIndex++;
    }
    
    if (end_time !== undefined) {
      updateFields.push(`end_time = $${paramIndex}`);
      values.push(end_time);
      paramIndex++;
    }
    
    if (break_required !== undefined) {
      updateFields.push(`break_required = $${paramIndex}`);
      values.push(break_required);
      paramIndex++;
    }
    
    if (auto_deduct_break !== undefined) {
      updateFields.push(`auto_deduct_break = $${paramIndex}`);
      values.push(auto_deduct_break);
      paramIndex++;
    }
    
    if (break_duration !== undefined) {
      updateFields.push(`break_duration = $${paramIndex}`);
      values.push(break_duration);
      paramIndex++;
    }
    
    if (enable_overtime !== undefined) {
      updateFields.push(`enable_overtime = $${paramIndex}`);
      values.push(enable_overtime);
      paramIndex++;
    }
    
    if (overtime_starts_after !== undefined) {
      updateFields.push(`overtime_starts_after = $${paramIndex}`);
      values.push(overtime_starts_after);
      paramIndex++;
    }
    
    if (max_overtime_per_day !== undefined) {
      updateFields.push(`max_overtime_per_day = $${paramIndex}`);
      values.push(max_overtime_per_day);
      paramIndex++;
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update"
      });
    }
    
    updateFields.push(`updated_at = $${paramIndex}`);
    values.push(new Date());
    paramIndex++;
    
    values.push(tenantId);
    
    const query = `
      UPDATE company_settings 
      SET ${updateFields.join(', ')}
      WHERE tenant_id = $${paramIndex}
      RETURNING work_days, start_time, end_time, break_required, auto_deduct_break, break_duration, enable_overtime, overtime_starts_after, max_overtime_per_day, updated_at
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found. Please complete company registration first."
      });
    }
    
    const settings = result.rows[0];

    // Log activity
    logActivity({ tenantId: req.user.tenantId, actorId: req.user.userId, actorName: req.user.name, actorType: 'admin', category: 'company_settings', action: 'update_working_hours', title: 'Admin updated working hours', description: `Schedule changed to ${settings.work_days}, ${settings.start_time}-${settings.end_time}`, targetType: 'company_settings', targetId: null, targetName: 'working_hours' });

    res.json({
      success: true,
      message: "Working hours updated successfully",
      data: {
        work_schedule: {
          work_days: settings.work_days,
          start_time: settings.start_time,
          end_time: settings.end_time
        },
        break_rules: {
          break_required: settings.break_required,
          auto_deduct_break: settings.auto_deduct_break,
          break_duration: settings.break_duration
        },
        overtime_rules: {
          enable_overtime: settings.enable_overtime,
          overtime_starts_after: settings.overtime_starts_after,
          max_overtime_per_day: settings.max_overtime_per_day
        },
        updated_at: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating working hours:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update working hours",
      error: error.message
    });
  }
});

// ========== COMPANY PREFERENCES APIs (Notifications, Approvals, Localization) ==========

// GET /api/company/preferences - Get company preferences
router.get('/company/preferences', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    let result = await pool.query(`
      SELECT 
        receive_notifications_email,
        receive_notifications_app,
        require_approval_manual_time_entries,
        require_approval_correction_requests,
        require_approval_vacation_requests,
        default_language,
        date_format,
        time_format,
        updated_at
      FROM company_settings 
      WHERE tenant_id = $1
    `, [tenantId]);
    
    if (result.rows.length === 0) {
      // Auto-create default company_settings row from company_details
      await ensureCompanySettings(pool, tenantId);

      result = await pool.query(`
        SELECT 
          receive_notifications_email,
          receive_notifications_app,
          require_approval_manual_time_entries,
          require_approval_correction_requests,
          require_approval_vacation_requests,
          default_language,
          date_format,
          time_format,
          updated_at
        FROM company_settings 
        WHERE tenant_id = $1
      `, [tenantId]);
    }
    
    const settings = result.rows[0];
    
    res.json({
      success: true,
      message: "Company preferences retrieved successfully",
      data: {
        notifications: {
          receive_via_email: settings.receive_notifications_email || false,
          receive_in_app: settings.receive_notifications_app || false
        },
        approval_settings: {
          require_approval_manual_time_entries: settings.require_approval_manual_time_entries || false,
          require_approval_time_correction: settings.require_approval_correction_requests || true,
          require_approval_vacation_requests: settings.require_approval_vacation_requests || true
        },
        localization: {
          default_language: settings.default_language || 'English',
          date_format: settings.date_format || 'DD/MM/YYYY',
          time_format: settings.time_format || '24-hour'
        },
        updated_at: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching company preferences:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch company preferences",
      error: error.message
    });
  }
});

// PUT /api/company/preferences - Update company preferences
router.put('/company/preferences', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    await ensureCompanySettings(pool, tenantId);
    const {
      // Notifications
      receive_via_email,
      receive_in_app,
      // Approval settings
      require_approval_manual_time_entries,
      require_approval_time_correction,
      require_approval_vacation_requests,
      // Localization
      default_language,
      date_format,
      time_format
    } = req.body;
    
    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramIndex = 1;
    
    if (typeof receive_via_email !== 'undefined') {
      updateFields.push(`receive_notifications_email = $${paramIndex}`);
      values.push(receive_via_email);
      paramIndex++;
    }
    
    if (typeof receive_in_app !== 'undefined') {
      updateFields.push(`receive_notifications_app = $${paramIndex}`);
      values.push(receive_in_app);
      paramIndex++;
    }
    
    if (typeof require_approval_manual_time_entries !== 'undefined') {
      updateFields.push(`require_approval_manual_time_entries = $${paramIndex}`);
      values.push(require_approval_manual_time_entries);
      paramIndex++;
    }
    
    if (typeof require_approval_time_correction !== 'undefined') {
      updateFields.push(`require_approval_correction_requests = $${paramIndex}`);
      values.push(require_approval_time_correction);
      paramIndex++;
    }
    
    if (typeof require_approval_vacation_requests !== 'undefined') {
      updateFields.push(`require_approval_vacation_requests = $${paramIndex}`);
      values.push(require_approval_vacation_requests);
      paramIndex++;
    }
    
    if (default_language) {
      updateFields.push(`default_language = $${paramIndex}`);
      values.push(default_language);
      paramIndex++;
    }
    
    if (date_format) {
      updateFields.push(`date_format = $${paramIndex}`);
      values.push(date_format);
      paramIndex++;
    }
    
    if (time_format) {
      updateFields.push(`time_format = $${paramIndex}`);
      values.push(time_format);
      paramIndex++;
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update"
      });
    }
    
    updateFields.push(`updated_at = $${paramIndex}`);
    values.push(new Date());
    paramIndex++;
    
    values.push(tenantId);
    
    const query = `
      UPDATE company_settings 
      SET ${updateFields.join(', ')}
      WHERE tenant_id = $${paramIndex}
      RETURNING 
        receive_notifications_email,
        receive_notifications_app,
        require_approval_manual_time_entries,
        require_approval_correction_requests,
        require_approval_vacation_requests,
        default_language,
        date_format,
        time_format,
        updated_at
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company settings not found. Please complete company registration first."
      });
    }
    
    const settings = result.rows[0];
    
    res.json({
      success: true,
      message: "Company preferences updated successfully",
      data: {
        notifications: {
          receive_via_email: settings.receive_notifications_email,
          receive_in_app: settings.receive_notifications_app
        },
        approval_settings: {
          require_approval_manual_time_entries: settings.require_approval_manual_time_entries,
          require_approval_time_correction: settings.require_approval_correction_requests,
          require_approval_vacation_requests: settings.require_approval_vacation_requests
        },
        localization: {
          default_language: settings.default_language,
          date_format: settings.date_format,
          time_format: settings.time_format
        },
        updated_at: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating company preferences:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update company preferences",
      error: error.message
    });
  }
});


  return router;
};
