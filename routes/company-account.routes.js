/**
 * company-account Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== DELETE COMPANY ACCOUNT API (Self-Deletion) =====
router.delete('/company/account', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const tenantId = req.user.tenantId;
  const userType = req.user.userType;
  const { confirmation } = req.body;

  console.log(`⚠️ Company account deletion request - User: ${adminId}, Tenant: ${tenantId}, Type: ${userType}`);

  try {
    // Check if user is admin from JWT token or database
    let isAdmin = userType === 'admin';

    // Double-check from database
    if (!isAdmin) {
      const empResult = await pool.query(
        'SELECT is_admin, role FROM employees WHERE id = $1 AND tenant_id::integer = $2',
        [adminId, tenantId]
      );
      
      if (empResult.rows.length > 0) {
        isAdmin = empResult.rows[0].is_admin === true || empResult.rows[0].role === 'Admin';
      }
    }

    // Also check company_details table (owner check)
    const companyResult = await pool.query(
      'SELECT email FROM company_details WHERE tenant_id = $1',
      [tenantId]
    );

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only company admins can delete the company account",
        data: {
          required_role: "Admin",
          your_role: userType || "Employee",
          tenant_id: tenantId
        }
      });
    }

    // Validate confirmation text - must type "DELETE"
    if (!confirmation || confirmation !== 'DELETE') {
      return res.status(400).json({
        success: false,
        message: "Please type 'DELETE' (case-sensitive) to confirm company account deletion",
        data: {
          required_confirmation: "DELETE",
          received_confirmation: confirmation || null,
          warning: "This will permanently delete ALL company data including all employees, timers, leaves, breaks, and settings",
          hint: "Type DELETE exactly (case-sensitive) in the confirmation field"
        }
      });
    }

    // Get company info before deletion
    const companyInfo = companyResult.rows[0] || {};
    const adminInfo = await pool.query(
      'SELECT full_name, email FROM employees WHERE id = $1',
      [adminId]
    );

    // Count data before deletion from database
    let totalEmployees = 0, totalTimers = 0, totalLeaveRequests = 0;
    
    try {
      const employeeCount = await pool.query('SELECT COUNT(*) FROM employees WHERE tenant_id = $1', [tenantId]);
      totalEmployees = parseInt(employeeCount.rows[0]?.count) || 0;
    } catch(e) {
      console.log('⚠️ Employee count warning:', e.message);
    }
    
    try {
      const timerCount = await pool.query(`
        SELECT COUNT(*) FROM timers 
        WHERE user_id IN (SELECT id FROM employees WHERE tenant_id = $1)
      `, [tenantId]);
      totalTimers = parseInt(timerCount.rows[0]?.count) || 0;
    } catch(e) {
      console.log('⚠️ Timer count warning:', e.message);
    }
    
    try {
      const leaveCount = await pool.query('SELECT COUNT(*) FROM leave_requests WHERE tenant_id = $1', [tenantId]);
      totalLeaveRequests = parseInt(leaveCount.rows[0]?.count) || 0;
    } catch(e) {
      console.log('⚠️ Leave count warning:', e.message);
    }

    // Store company info before deletion
    const deletedCompany = {
      name: companyInfo.name || 'Unknown Company',
      industry: companyInfo.industry || 'Unknown',
      support_email: companyInfo.email || '',
      company_phone: companyInfo.phone || '',
      deleted_by: adminInfo.rows[0]?.full_name || 'Unknown',
      deleted_by_email: adminInfo.rows[0]?.email || ''
    };

    // PERMANENTLY DELETE ALL DATA FROM DATABASE
    // Note: Delete in correct order to avoid foreign key issues

    // 1. Delete all timers first (using employee_id before employees are deleted)
    try {
      await pool.query(`
        DELETE FROM timers 
        WHERE user_id IN (SELECT id FROM employees WHERE tenant_id = $1)
      `, [tenantId]);
      console.log(`✅ Deleted timers for tenant ${tenantId}`);
    } catch(e) {
      console.log('⚠️ Timers deletion warning:', e.message);
    }
    
    // 2. Delete all breaks
    try {
      await pool.query(`
        DELETE FROM breaks 
        WHERE user_id IN (SELECT id FROM employees WHERE tenant_id = $1)
      `, [tenantId]);
      console.log(`✅ Deleted breaks for tenant ${tenantId}`);
    } catch(e) {
      console.log('⚠️ Breaks deletion warning:', e.message);
    }
    
    // 3. Delete all leave requests for this tenant  
    try {
      await pool.query('DELETE FROM leave_requests WHERE tenant_id = $1', [tenantId]);
      console.log(`✅ Deleted ${totalLeaveRequests} leave requests`);
    } catch(e) {
      console.log('⚠️ Leave requests deletion warning:', e.message);
    }
    
    // 4. Delete all leave types for this tenant (custom ones only)
    try {
      await pool.query('DELETE FROM leave_types WHERE tenant_id = $1', [tenantId]);
    } catch(e) {
      console.log('⚠️ Leave types deletion warning:', e.message);
    }
    
    // 5. Delete all departments for this tenant
    try {
      await pool.query('DELETE FROM departments WHERE tenant_id = $1', [tenantId]);
    } catch(e) {
      console.log('⚠️ Departments deletion warning:', e.message);
    }
    
    // 6. Delete all employees for this tenant (do this after deleting related records)
    try {
      await pool.query('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
      console.log(`✅ Deleted ${totalEmployees} employees`);
    } catch(e) {
      console.log('⚠️ Employees deletion warning:', e.message);
    }
    
    // 7. Delete company settings for this tenant
    try {
      await pool.query('DELETE FROM company_settings WHERE tenant_id = $1', [tenantId]);
    } catch(e) {
      console.log('⚠️ Company settings deletion warning:', e.message);
    }
    
    // 8. Delete company details for this tenant
    try {
      await pool.query('DELETE FROM company_details WHERE tenant_id = $1', [tenantId]);
    } catch(e) {
      console.log('⚠️ Company details deletion warning:', e.message);
    }
    
    // 9. Delete tenant record
    try {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } catch(e) {
      console.log('⚠️ Tenant deletion warning:', e.message);
    }

    console.log(`🗑️ COMPANY ACCOUNT DELETED PERMANENTLY - Tenant ID: ${tenantId}`);
    console.log(`📊 Deleted: ${totalEmployees} employees, ${totalTimers} timers, ${totalLeaveRequests} leave requests`);

    // Send confirmation email to admin
    const emailSubject = `Company Account Deleted - ${deletedCompany.name}`;
    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #c92a2a 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .warning-box { background: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff6b6b; }
        .stats-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; color: #888; padding: 20px; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ Company Account Deleted</h1>
        </div>
        <div class="content">
          <p>This email confirms that the company account for <strong>${deletedCompany.name}</strong> has been permanently deleted.</p>
          
          <div class="warning-box">
            <h3>⚠️ IMPORTANT: This Action is Irreversible</h3>
            <p>All company data has been permanently deleted and cannot be recovered.</p>
          </div>
          
          <div class="stats-box">
            <h3>Deleted Data Summary:</h3>
            <p><strong>Company Name:</strong> ${deletedCompany.name}</p>
            <p><strong>Industry:</strong> ${deletedCompany.industry}</p>
            <p><strong>Total Employees Deleted:</strong> ${totalEmployees}</p>
            <p><strong>Total Timers Deleted:</strong> ${totalTimers}</p>
            <p><strong>Total Leave Requests Deleted:</strong> ${totalLeaveRequests}</p>
            <p><strong>Deleted By:</strong> ${deletedCompany.deleted_by} (${deletedCompany.deleted_by_email})</p>
            <p><strong>Deletion Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
          
          <p>If this deletion was made in error, please contact support immediately. However, please note that data recovery may not be possible.</p>
          
          <p style="color: #888; font-size: 14px; margin-top: 30px;">If you did not authorize this deletion, please contact our support team immediately.</p>
        </div>
        <div class="footer">
          <p>© 2026 Time Management System. All rights reserved.</p>
          <p>This is an automated email, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

    // Send email notification (SMTP with relay fallback)
    const deleteMailOpts = {
      from: '"Time Management System" <info@champdynamics.in>',
      to: deletedCompany.deleted_by_email,
      subject: emailSubject,
      html: emailHtml
    };
    emailTransporter.sendMail(deleteMailOpts, (error, info) => {
      if (error) {
        console.log(`❌ SMTP failed for deletion email, trying relay...`);
        sendEmailViaRelay(deleteMailOpts).then(() => {
          console.log(`✅ Deletion email sent via relay to ${deletedCompany.deleted_by_email}`);
        }).catch(e => console.log(`❌ Relay also failed: ${e.message}`));
      } else {
        console.log(`✅ Deletion confirmation email sent to ${deletedCompany.deleted_by_email}`);
      }
    });

    res.json({
      success: true,
      message: "Company account deleted permanently",
      data: {
        deleted_company: deletedCompany,
        deleted_at: new Date().toISOString(),
        deleted_by: {
          id: adminId,
          name: deletedCompany.deleted_by,
          email: deletedCompany.deleted_by_email,
          role: 'Admin'
        },
        deletion_summary: {
          total_employees_deleted: totalEmployees,
          total_timers_deleted: totalTimers,
          total_leave_requests_deleted: totalLeaveRequests,
          company_data_cleared: true,
          all_data_cleared: true
        },
        warnings: [
          "This action is IRREVERSIBLE",
          "All company data has been permanently deleted",
          "All employee accounts have been removed",
          "All time tracking data has been erased",
          "A confirmation email has been sent to the admin"
        ],
        next_steps: [
          "All users will be logged out on next request",
          "Previous data cannot be recovered"
        ]
      }
    });
  } catch (error) {
    console.error('❌ Delete company account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete company account',
      error: error.message
    });
  }
});


  return router;
};
