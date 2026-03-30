/**
 * faq-support Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== FAQ APIs =====

// Create FAQ (Admin only)
router.post('/admin/faqs', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { question, answer, category, order_index } = req.body;

  console.log(`📝 FAQ creation request from user ID: ${adminId}`);

  try {
    // Check if user is admin via JWT userType
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can create FAQs',
        data: {
          required_role: 'admin',
          your_role: req.user.userType || 'unknown'
        }
      });
    }

    // Validate required fields
    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required',
        data: {
          required_fields: ['question', 'answer']
        }
      });
    }

    // Ensure tenant_id column exists
    await pool.query('ALTER TABLE faqs ADD COLUMN IF NOT EXISTS tenant_id INTEGER');
    // Drop FK constraints on created_by/updated_by (admin is in company_details, not employees)
    await pool.query('ALTER TABLE faqs DROP CONSTRAINT IF EXISTS faqs_created_by_fkey');
    await pool.query('ALTER TABLE faqs DROP CONSTRAINT IF EXISTS faqs_updated_by_fkey');

    // Insert FAQ with tenant_id
    const result = await pool.query(
      `INSERT INTO faqs (question, answer, category, order_index, tenant_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [question, answer, category || null, order_index || 0, tenantId, adminId]
    );

    console.log(`✅ FAQ created successfully with ID: ${result.rows[0].id}`);

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully',
      data: {
        faq: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ FAQ creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ',
      error: error.message
    });
  }
});

// Get all FAQs (All users)
router.get('/faqs', authenticateToken, async (req, res) => {
  const { category, active_only } = req.query;
  const tenantId = req.user?.tenantId;

  console.log(`📚 Get all FAQs request for tenant ${tenantId}`);

  try {
    let query = 'SELECT * FROM faqs';
    const params = [tenantId];
    const conditions = ['tenant_id::integer = $1'];

    // Filter by category
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    // Filter active only
    if (active_only === 'true') {
      conditions.push('is_active = true');
    }

    query += ' WHERE ' + conditions.join(' AND ');

    query += ' ORDER BY order_index ASC, created_at DESC';

    const result = await pool.query(query, params);

    console.log(`✅ Retrieved ${result.rows.length} FAQs`);

    res.json({
      success: true,
      message: 'FAQs retrieved successfully',
      data: {
        total_count: result.rows.length,
        faqs: result.rows
      }
    });

  } catch (error) {
    console.error('❌ Get FAQs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQs',
      error: error.message
    });
  }
});

// Get FAQ by ID (All users)
router.get('/faqs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  console.log(`📖 Get FAQ by ID request: ${id}`);

  try {
    const result = await pool.query(
      'SELECT * FROM faqs WHERE id = $1 AND tenant_id::integer = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found',
        data: {
          faq_id: id
        }
      });
    }

    console.log(`✅ FAQ retrieved successfully: ${id}`);

    res.json({
      success: true,
      message: 'FAQ retrieved successfully',
      data: {
        faq: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Get FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQ',
      error: error.message
    });
  }
});

// Edit FAQ (Admin only)
router.put('/admin/faqs/:id', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { id } = req.params;
  const { question, answer, category, order_index, is_active } = req.body;

  console.log(`✏️ FAQ edit request from user ID: ${adminId} for FAQ: ${id}`);

  try {
    // Check if user is admin via JWT userType
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can edit FAQs',
        data: {
          required_role: 'admin',
          your_role: req.user.userType || 'unknown'
        }
      });
    }

    // Check if FAQ exists for this tenant
    const faqCheck = await pool.query('SELECT id FROM faqs WHERE id = $1 AND tenant_id::integer = $2', [id, tenantId]);
    if (faqCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found',
        data: { faq_id: id }
      });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (question !== undefined) {
      updates.push(`question = $${paramCount}`);
      params.push(question);
      paramCount++;
    }

    if (answer !== undefined) {
      updates.push(`answer = $${paramCount}`);
      params.push(answer);
      paramCount++;
    }

    if (category !== undefined) {
      updates.push(`category = $${paramCount}`);
      params.push(category);
      paramCount++;
    }

    if (order_index !== undefined) {
      updates.push(`order_index = $${paramCount}`);
      params.push(order_index);
      paramCount++;
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      params.push(is_active);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
        data: {
          available_fields: ['question', 'answer', 'category', 'order_index', 'is_active']
        }
      });
    }

    // Add updated_by and updated_at
    updates.push(`updated_by = $${paramCount}`);
    params.push(adminId);
    paramCount++;

    updates.push(`updated_at = NOW()`);

    // Add FAQ ID to params
    params.push(id);

    const query = `
      UPDATE faqs 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    console.log(`✅ FAQ updated successfully: ${id}`);

    res.json({
      success: true,
      message: 'FAQ updated successfully',
      data: {
        faq: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ FAQ update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ',
      error: error.message
    });
  }
});

// Delete FAQ (Admin only)
router.delete('/admin/faqs/:id', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { id } = req.params;

  console.log(`🗑️ FAQ deletion request from user ID: ${adminId} for FAQ: ${id}`);

  try {
    // Check if user is admin via JWT userType
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete FAQs',
        data: {
          required_role: 'admin',
          your_role: req.user.userType || 'unknown'
        }
      });
    }

    // Check if FAQ exists for this tenant
    const faqCheck = await pool.query(
      'SELECT * FROM faqs WHERE id = $1 AND tenant_id::integer = $2',
      [id, tenantId]
    );
    
    if (faqCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found',
        data: { faq_id: id }
      });
    }

    const deletedFaq = faqCheck.rows[0];

    // Delete FAQ
    await pool.query('DELETE FROM faqs WHERE id = $1 AND tenant_id::integer = $2', [id, tenantId]);

    console.log(`✅ FAQ deleted successfully: ${id}`);

    res.json({
      success: true,
      message: 'FAQ deleted successfully',
      data: {
        deleted_faq: {
          id: deletedFaq.id,
          question: deletedFaq.question,
          deleted_at: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ FAQ deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ',
      error: error.message
    });
  }
});

// ===== CONTACT SUPPORT API =====

// Get support contact information (Public)
router.get('/support/info', authenticateToken, async (req, res) => {
  console.log('📞 Get support contact information request');

  try {
    const tenantId = req.user.tenantId;

    // Try to get company-specific support info from company_settings
    let supportInfo = null;
    try {
      const settingsResult = await pool.query(
        `SELECT support_phone, support_email, company_name, street, city, postal_code, country, website, linkedin
         FROM company_settings WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      if (settingsResult.rows.length > 0) {
        const s = settingsResult.rows[0];
        // Only use if at least one support field is set
        if (s.support_phone || s.support_email) {
          supportInfo = {
            phone: {
              number: s.support_phone || null,
              display: s.support_phone || null,
              available_hours: 'Mon-Fri 9:00 AM - 6:00 PM CET'
            },
            email: {
              address: s.support_email || null,
              response_time: 'Within 24 hours'
            },
            office: {
              name: s.company_name || null,
              street: s.street || null,
              city: s.city || null,
              postal_code: s.postal_code || null,
              country: s.country || 'Switzerland',
              full_address: [s.street, [s.postal_code, s.city].filter(Boolean).join(' '), s.country].filter(Boolean).join(', ') || null
            },
            social: {
              website: s.website || null,
              linkedin: s.linkedin || null
            }
          };
        }
      }
    } catch (dbErr) {
      console.log('⚠️ Could not fetch company support settings:', dbErr.message);
    }

    if (!supportInfo) {
      console.log(`⚠️ No support info configured for tenant ${tenantId}`);
      return res.json({
        success: true,
        message: 'Support contact information has not been configured by your company. Please ask your administrator to set up support details in Company Settings.',
        data: null,
        is_configured: false
      });
    }

    console.log(`✅ Support info retrieved for tenant ${tenantId}`);

    res.json({
      success: true,
      message: 'Support contact information retrieved successfully',
      data: supportInfo,
      is_configured: true
    });

  } catch (error) {
    console.error('❌ Get support info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve support information',
      error: error.message
    });
  }
});

// ===== PROBLEM REPORTING APIs =====

// Submit a problem report (All authenticated users)
router.post('/problem-reports', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const { problem_type, additional_details } = req.body;

  console.log(`🚨 Problem report submission from user ID: ${userId}`);

  try {
    // Validate required fields
    if (!problem_type) {
      return res.status(400).json({
        success: false,
        message: 'Problem type is required',
        data: {
          required_fields: ['problem_type'],
          available_types: [
            'What are the different types of PTO?',
            'How do I request vacation time?',
            'Where can I see my past requests?',
            'How do I change or remove a request?',
            'Where can I view my PTO balance?',
            'Which holidays does NoviPlan observe?',
            'Who do I ask about my paycheck?',
            'Other'
          ]
        }
      });
    }

    // Insert problem report
    const result = await pool.query(
      `INSERT INTO problem_reports (user_id, problem_type, additional_details, status, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, problem_type, additional_details || null, 'open', 'normal']
    );

    console.log(`✅ Problem report created successfully with ID: ${result.rows[0].id}`);

    res.status(201).json({
      success: true,
      message: 'Problem report submitted successfully. Our team will review it shortly.',
      data: {
        report: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Problem report submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit problem report',
      error: error.message
    });
  }
});

// Get user's own problem reports
router.get('/me/problem-reports', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const { status } = req.query;

  console.log(`📋 Get user's problem reports - User ID: ${userId}`);

  try {
    let query = 'SELECT * FROM problem_reports WHERE user_id = $1';
    const params = [userId];

    // Filter by status
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    console.log(`✅ Retrieved ${result.rows.length} problem reports for user ${userId}`);

    res.json({
      success: true,
      message: 'Problem reports retrieved successfully',
      data: {
        total_count: result.rows.length,
        reports: result.rows
      }
    });

  } catch (error) {
    console.error('❌ Get user problem reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve problem reports',
      error: error.message
    });
  }
});

// Get all problem reports (Admin only)
router.get('/admin/problem-reports', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { status, priority, user_id } = req.query;

  console.log(`📊 Admin get all problem reports request from user ID: ${adminId}`);

  try {
    // Check if user is admin
    const isAdmin = await verifyAdminRole(req.user, pool);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all problem reports'
      });
    }

    let query = `
      SELECT pr.*, 
             u.email as user_email, 
             u.full_name as user_name,
             admin.full_name as responded_by_name
      FROM problem_reports pr
      JOIN employees u ON pr.user_id = u.id
      LEFT JOIN employees admin ON pr.responded_by = admin.id
      WHERE u.tenant_id = $1
    `;
    const params = [tenantId];
    let paramCount = 2;

    // Filter by status
    if (status) {
      query += ` AND pr.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    // Filter by priority
    if (priority) {
      query += ` AND pr.priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    // Filter by user_id
    if (user_id) {
      query += ` AND pr.user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    query += ' ORDER BY pr.created_at DESC';

    const result = await pool.query(query, params);

    // Get statistics (tenant-filtered)
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN pr.status = 'open' THEN 1 END) as open,
        COUNT(CASE WHEN pr.status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN pr.status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN pr.status = 'closed' THEN 1 END) as closed
      FROM problem_reports pr
      JOIN employees u ON pr.user_id = u.id
      WHERE u.tenant_id = $1
    `, [tenantId]);

    console.log(`✅ Retrieved ${result.rows.length} problem reports`);

    res.json({
      success: true,
      message: 'Problem reports retrieved successfully',
      data: {
        total_count: result.rows.length,
        statistics: statsResult.rows[0],
        reports: result.rows
      }
    });

  } catch (error) {
    console.error('❌ Admin get problem reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve problem reports',
      error: error.message
    });
  }
});

// Get problem report by ID (User can see own, Admin can see all)
router.get('/problem-reports/:id', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const { id } = req.params;

  console.log(`📄 Get problem report by ID: ${id} - User ID: ${userId}`);

  try {
    // Get user role
    const userResult = await pool.query(
      'SELECT role FROM employees WHERE id = $1',
      [userId]
    );

    const isAdmin = userResult.rows.length > 0 && userResult.rows[0].role === 'Admin';

    let query = `
      SELECT pr.*, 
             u.email as user_email, 
             u.full_name as user_name,
             admin.full_name as responded_by_name
      FROM problem_reports pr
      LEFT JOIN employees u ON pr.user_id = u.id
      LEFT JOIN employees admin ON pr.responded_by = admin.id
      WHERE pr.id = $1
    `;
    const params = [id];

    // Non-admin users can only see their own reports
    if (!isAdmin) {
      query += ' AND pr.user_id = $2';
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Problem report not found or you do not have permission to view it',
        data: { report_id: id }
      });
    }

    console.log(`✅ Problem report retrieved: ${id}`);

    res.json({
      success: true,
      message: 'Problem report retrieved successfully',
      data: {
        report: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Get problem report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve problem report',
      error: error.message
    });
  }
});

// Update problem report status and add response (Admin only)
router.put('/admin/problem-reports/:id', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const { id } = req.params;
  const { status, priority, admin_response } = req.body;

  console.log(`✏️ Admin update problem report: ${id} - Admin ID: ${adminId}`);

  try {
    // Check if user is admin
    const adminResult = await pool.query(
      'SELECT role FROM employees WHERE id = $1',
      [adminId]
    );

    if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update problem reports',
        data: {
          required_role: 'Admin',
          your_role: adminResult.rows[0]?.role || 'unknown'
        }
      });
    }

    // Check if report exists
    const reportCheck = await pool.query(
      'SELECT id FROM problem_reports WHERE id = $1',
      [id]
    );

    if (reportCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Problem report not found',
        data: { report_id: id }
      });
    }

    // Build update query
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;

      // Auto-set resolved_at if status is resolved
      if (status === 'resolved') {
        updates.push(`resolved_at = NOW()`);
      }
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramCount}`);
      params.push(priority);
      paramCount++;
    }

    if (admin_response !== undefined) {
      updates.push(`admin_response = $${paramCount}`);
      params.push(admin_response);
      paramCount++;

      updates.push(`responded_by = $${paramCount}`);
      params.push(adminId);
      paramCount++;

      updates.push(`responded_at = NOW()`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
        data: {
          available_fields: ['status', 'priority', 'admin_response']
        }
      });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
      UPDATE problem_reports 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    console.log(`✅ Problem report updated successfully: ${id}`);

    res.json({
      success: true,
      message: 'Problem report updated successfully',
      data: {
        report: result.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Problem report update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update problem report',
      error: error.message
    });
  }
});

// Delete problem report (Admin only)
router.delete('/admin/problem-reports/:id', authenticateToken, async (req, res) => {
  const adminId = req.user?.userId;
  const { id } = req.params;

  console.log(`🗑️ Admin delete problem report: ${id} - Admin ID: ${adminId}`);

  try {
    // Check if user is admin
    const adminResult = await pool.query(
      'SELECT role FROM employees WHERE id = $1',
      [adminId]
    );

    if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete problem reports',
        data: {
          required_role: 'Admin',
          your_role: adminResult.rows[0]?.role || 'unknown'
        }
      });
    }

    // Check if report exists
    const reportCheck = await pool.query(
      'SELECT * FROM problem_reports WHERE id = $1',
      [id]
    );

    if (reportCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Problem report not found',
        data: { report_id: id }
      });
    }

    const deletedReport = reportCheck.rows[0];

    // Delete report
    await pool.query('DELETE FROM problem_reports WHERE id = $1', [id]);

    console.log(`✅ Problem report deleted successfully: ${id}`);

    res.json({
      success: true,
      message: 'Problem report deleted successfully',
      data: {
        deleted_report: {
          id: deletedReport.id,
          problem_type: deletedReport.problem_type,
          deleted_at: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ Problem report deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete problem report',
      error: error.message
    });
  }
});


  return router;
};
