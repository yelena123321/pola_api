/**
 * employee Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== ADMIN APIs =====

// GET User Complete Profile (Admin)
router.get('/admin/users/:userId', authenticateToken, (req, res) => {
  const adminId = req.user.userId;
  const targetUserId = parseInt(req.params.userId);

  // Get target user
  const user = persistentUsers[targetUserId];
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  // Get user's timer data
  const timerData = persistentTimers[targetUserId] || {};
  
  // Get user's leave requests
  const leaveRequests = Object.values(persistentLeaveRequests || {}).filter(lr => lr.userId === targetUserId);
  
  // Get user's break history
  const breakHistory = Object.values(persistentBreaks || {}).filter(b => b.userId === targetUserId);

  // Calculate work summary
  const totalWorkTime = timerData.totalTime || 0;
  const totalWorkHours = (totalWorkTime / 3600).toFixed(2);
  const avgDailyHours = (totalWorkHours / 30).toFixed(2); // Last 30 days average
  
  // Calculate timesheet summary
  const thisWeekHours = (totalWorkTime / 3600 * 0.3).toFixed(2); // Simulated
  const lastWeekHours = (totalWorkTime / 3600 * 0.25).toFixed(2); // Simulated
  const thisMonthHours = totalWorkHours;
  
  // Get recent activity
  const recentActivity = [];
  
  // Add timer activities
  if (timerData.isActive) {
    recentActivity.push({
      id: 1,
      type: "timer_start",
      action: "Started work timer",
      timestamp: timerData.startTime,
      details: {
        project: user.project || "General Work",
        status: "active"
      }
    });
  }
  
  // Add leave request activities
  leaveRequests.slice(-5).forEach((leave, idx) => {
    recentActivity.push({
      id: recentActivity.length + 1,
      type: "leave_request",
      action: `${leave.status === 'approved' ? 'Approved' : leave.status === 'rejected' ? 'Rejected' : 'Submitted'} leave request`,
      timestamp: leave.approvedAt || leave.createdAt,
      details: {
        leave_type: leave.leaveType,
        duration: `${leave.startDate} to ${leave.endDate}`,
        status: leave.status
      }
    });
  });

  // Add profile update activity
  if (user.photo_updated_at) {
    recentActivity.push({
      id: recentActivity.length + 1,
      type: "profile_update",
      action: "Updated profile photo",
      timestamp: user.photo_updated_at,
      details: {
        field: "profile_photo"
      }
    });
  }

  // Sort by timestamp (most recent first)
  recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Prepare complete user profile
  const completeProfile = {
    // Basic Info
    basic_info: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      profile_photo: user.profile_photo,
      role: user.role,
      status: timerData.isActive ? "active" : user.last_logout ? "offline" : "idle",
      date_joined: user.created_at || "2025-12-01T00:00:00Z",
      last_login: user.last_login || new Date().toISOString(),
      last_logout: user.last_logout || null
    },

    // Personal Info
    personal_info: {
      location: user.location,
      address: user.address || null,
      city: user.city || null,
      state: user.state || null,
      country: user.country || null,
      postal_code: user.postal_code || null,
      date_of_birth: user.date_of_birth || null,
      gender: user.gender || null,
      emergency_contact: user.emergency_contact || null,
      emergency_phone: user.emergency_phone || null
    },

    // Work Summary
    work_summary: {
      project: user.project,
      department: user.department || "Engineering",
      position: user.role,
      employment_type: user.employment_type || "Full-time",
      total_work_hours: parseFloat(totalWorkHours),
      average_daily_hours: parseFloat(avgDailyHours),
      current_timer_status: timerData.isActive ? "running" : "stopped",
      total_sessions: timerData.sessionCount || 0,
      productivity_score: Math.min(100, Math.round((parseFloat(totalWorkHours) / 160) * 100)), // Based on monthly hours
      last_work_date: timerData.lastStopTime || timerData.startTime || null
    },

    // Timesheet Summary
    timesheet_summary: {
      this_week: {
        total_hours: parseFloat(thisWeekHours),
        days_worked: 4,
        status: "in_progress"
      },
      last_week: {
        total_hours: parseFloat(lastWeekHours),
        days_worked: 5,
        status: "completed"
      },
      this_month: {
        total_hours: parseFloat(thisMonthHours),
        days_worked: 18,
        status: "in_progress"
      },
      all_time: {
        total_hours: parseFloat(totalWorkHours),
        total_days: Math.ceil(parseFloat(totalWorkHours) / 8),
        first_entry: user.created_at || "2025-12-01T00:00:00Z"
      }
    },

    // Requests Summary
    requests: {
      leave_requests: {
        total: leaveRequests.length,
        pending: leaveRequests.filter(lr => lr.status === 'pending').length,
        approved: leaveRequests.filter(lr => lr.status === 'approved').length,
        rejected: leaveRequests.filter(lr => lr.status === 'rejected').length,
        recent_requests: leaveRequests.slice(-5).map(lr => ({
          id: lr.id,
          type: lr.leaveType,
          start_date: lr.startDate,
          end_date: lr.endDate,
          status: lr.status,
          submitted_at: lr.createdAt
        }))
      },
      break_requests: {
        total: breakHistory.length,
        recent_breaks: breakHistory.slice(-5).map(br => ({
          id: br.id,
          type: br.break_type,
          start_time: br.start_time,
          end_time: br.end_time,
          duration_minutes: br.duration_minutes
        }))
      },
      correction_requests: {
        total: Object.values(persistentCorrectionRequests).filter(cr => cr.userId === targetUserId).length,
        pending: Object.values(persistentCorrectionRequests).filter(cr => cr.userId === targetUserId && cr.status === 'pending').length,
        approved: Object.values(persistentCorrectionRequests).filter(cr => cr.userId === targetUserId && cr.status === 'approved').length,
        rejected: Object.values(persistentCorrectionRequests).filter(cr => cr.userId === targetUserId && cr.status === 'rejected').length
      }
    },

    // Recent Activity
    recent_activity: recentActivity.slice(0, 10),

    // Statistics
    statistics: {
      attendance_rate: 95.5,
      punctuality_score: 92.3,
      overtime_hours: Math.max(0, parseFloat(totalWorkHours) - 160),
      average_break_duration: breakHistory.length > 0 
        ? (breakHistory.reduce((sum, br) => sum + (br.duration_minutes || 0), 0) / breakHistory.length).toFixed(1)
        : 0,
      projects_assigned: 1,
      tasks_completed: Math.floor(parseFloat(totalWorkHours) / 4) // Simulated: 1 task per 4 hours
    }
  };

  res.json({
    success: true,
    message: "User profile retrieved successfully",
    data: {
      user: completeProfile,
      fetched_at: new Date().toISOString(),
      fetched_by: adminId
    }
  });
});

// ===== EDIT EMPLOYEE API (Company Admin) =====
router.put('/admin/employees/:employeeId', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const employeeId = req.params.employeeId; // String like "EMP001"

  console.log(`✏️ Edit employee request - Admin: ${adminId}, Employee: ${employeeId}`);

  try {
    // Find employee in database by employee_id
    const findResult = await pool.query(
      'SELECT * FROM employees WHERE employee_id = $1',
      [employeeId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
        data: {
          employee_id: employeeId
        }
      });
    }

    const employee = findResult.rows[0];

    // Extract editable fields from request body
    const {
      first_name,
      last_name,
      email,
      phone,
      address,
      date_of_birth,
      role,
      department,
      working_hours,
      work_model,
      manager,
      status
    } = req.body;

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    const updatedFields = [];

    if (first_name !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      values.push(first_name);
      updatedFields.push('first_name');
      
      // Update full_name
      const newFullName = `${first_name} ${last_name || employee.last_name}`;
      updates.push(`full_name = $${paramIndex++}`);
      values.push(newFullName);
    }

    if (last_name !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      values.push(last_name);
      updatedFields.push('last_name');
      
      // Update full_name if not already updated
      if (!first_name) {
        const newFullName = `${employee.first_name} ${last_name}`;
        updates.push(`full_name = $${paramIndex++}`);
        values.push(newFullName);
      }
    }

    if (email !== undefined) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email format",
          data: { email }
        });
      }

      // Check if email already exists for another employee
      const emailCheck = await pool.query(
        'SELECT id FROM employees WHERE email = $1 AND employee_id != $2',
        [email, employeeId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Email already exists for another employee",
          data: { email }
        });
      }

      updates.push(`email = $${paramIndex++}`);
      values.push(email);
      updatedFields.push('email');
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
      updatedFields.push('phone');
    }

    if (address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(address);
      updatedFields.push('address');
    }

    if (date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramIndex++}`);
      values.push(date_of_birth);
      updatedFields.push('date_of_birth');
    }

    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
      updatedFields.push('role');
    }

    if (department !== undefined) {
      updates.push(`department = $${paramIndex++}`);
      values.push(department);
      updatedFields.push('department');
    }

    if (working_hours !== undefined) {
      updates.push(`working_hours = $${paramIndex++}`);
      values.push(working_hours);
      updatedFields.push('working_hours');
    }

    if (work_model !== undefined) {
      updates.push(`work_model = $${paramIndex++}`);
      values.push(work_model);
      updatedFields.push('work_model');
    }

    if (manager !== undefined) {
      updates.push(`manager = $${paramIndex++}`);
      values.push(manager);
      updatedFields.push('manager');
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
      updatedFields.push('status');
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
        data: { employee_id: employeeId }
      });
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Execute UPDATE query
    values.push(employeeId);
    const updateQuery = `
      UPDATE employees 
      SET ${updates.join(', ')}
      WHERE employee_id = $${paramIndex}
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, values);
    const updatedEmployee = updateResult.rows[0];

    console.log(`✅ Employee updated successfully: ${updatedEmployee.full_name} (ID: ${employeeId})`);
    console.log(`📝 Updated fields: ${updatedFields.join(', ')}`);

    res.json({
      success: true,
      message: "Employee updated successfully",
      data: {
        employee: {
          id: updatedEmployee.id,
          employee_id: updatedEmployee.employee_id,
          first_name: updatedEmployee.first_name,
          last_name: updatedEmployee.last_name,
          full_name: updatedEmployee.full_name,
          email: updatedEmployee.email,
          phone: updatedEmployee.phone,
          address: updatedEmployee.address,
          date_of_birth: updatedEmployee.date_of_birth,
          profile_photo: updatedEmployee.profile_photo,
          role: updatedEmployee.role,
          department: updatedEmployee.department,
          working_hours: updatedEmployee.working_hours,
          work_model: updatedEmployee.work_model,
          manager: updatedEmployee.manager,
          status: updatedEmployee.status,
          joined_date: updatedEmployee.joined_date || updatedEmployee.created_at,
          updated_at: updatedEmployee.updated_at
        },
        updated_fields: updatedFields,
        update_count: updatedFields.length
      }
    });

  } catch (error) {
    console.error('❌ Edit employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update employee',
      error: error.message
    });
  }
});

// ===== GET AVAILABLE ROLES (For Dropdown) =====
router.get('/roles', authenticateToken, (req, res) => {
  const roles = [
    { id: 1, name: 'Employee', value: 'Employee', description: 'Regular employee with standard access' },
    { id: 2, name: 'Manager', value: 'Manager', description: 'Manager with team oversight permissions' },
    { id: 3, name: 'Admin', value: 'Admin', description: 'Administrator with full system access' }
  ];

  res.json({
    success: true,
    message: 'Roles retrieved successfully',
    data: {
      roles: roles,
      total: roles.length
    }
  });
});

// ===== GET AVAILABLE DEPARTMENTS (For Dropdown) =====
router.get('/departments', authenticateToken, (req, res) => {
  const departments = [
    { id: 1, name: 'Design', value: 'Design', description: 'UI/UX and graphic design', icon: '🎨' },
    { id: 2, name: 'Engineering', value: 'Engineering', description: 'Software development', icon: '💻' },
    { id: 3, name: 'Product', value: 'Product', description: 'Product management', icon: '📦' },
    { id: 4, name: 'Marketing', value: 'Marketing', description: 'Marketing and advertising', icon: '📢' },
    { id: 5, name: 'Sales', value: 'Sales', description: 'Sales and business development', icon: '💼' },
    { id: 6, name: 'Human Resources', value: 'Human Resources', description: 'HR and recruitment', icon: '👥' },
    { id: 7, name: 'Finance', value: 'Finance', description: 'Finance and accounting', icon: '💰' },
    { id: 8, name: 'Operations', value: 'Operations', description: 'Operations management', icon: '⚙️' },
    { id: 9, name: 'Customer Support', value: 'Customer Support', description: 'Customer service', icon: '🎧' },
    { id: 10, name: 'Legal', value: 'Legal', description: 'Legal and compliance', icon: '⚖️' },
    { id: 11, name: 'IT', value: 'IT', description: 'Information technology', icon: '🖥️' },
    { id: 12, name: 'Research', value: 'Research', description: 'Research and development', icon: '🔬' },
    { id: 13, name: 'Quality Assurance', value: 'Quality Assurance', description: 'QA and testing', icon: '✅' },
    { id: 14, name: 'Data Science', value: 'Data Science', description: 'Data analysis and ML', icon: '📊' },
    { id: 15, name: 'Security', value: 'Security', description: 'Security and compliance', icon: '🔒' }
  ];

  res.json({
    success: true,
    message: 'Departments retrieved successfully',
    data: {
      departments: departments,
      total: departments.length
    }
  });
});

// ===== SETUP ACCOUNT API (New Employee - Complete Registration) =====
router.post('/setup-account', async (req, res) => {
  const { token, password, confirm_password } = req.body;

  console.log(`🔐 Account setup request with token`);

  // Validate required fields
  if (!token || !password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
      data: {
        required_fields: ["token", "password", "confirm_password"],
        missing: [
          !token && "token",
          !password && "password",
          !confirm_password && "confirm_password"
        ].filter(Boolean)
      }
    });
  }

  // Validate passwords match
  if (password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match",
      data: {
        hint: "Please ensure both password fields are identical"
      }
    });
  }

  // Validate password strength
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters long",
      data: {
        min_length: 8,
        current_length: password.length
      }
    });
  }

  // Verify JWT token
  let decodedToken;
  try {
    decodedToken = jwt.verify(token, JWT_SECRET);
    if (decodedToken.type !== 'invitation') {
      return res.status(400).json({
        success: false,
        message: "Invalid token type",
        data: {
          hint: "This token is not an invitation token"
        }
      });
    }
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired invitation token",
      data: {
        hint: "Token may be invalid or expired. Please contact your admin.",
        error: error.message
      }
    });
  }

  // Extract employee data from JWT token (works in serverless)
  // All employee data is in the token itself, no database lookup needed
  const employeeData = {
    id: decodedToken.id,
    employee_id: decodedToken.employee_id,
    first_name: decodedToken.first_name,
    last_name: decodedToken.last_name,
    full_name: decodedToken.full_name,
    email: decodedToken.email,
    phone: decodedToken.phone,
    address: decodedToken.address,
    date_of_birth: decodedToken.date_of_birth,
    profile_photo: decodedToken.profile_photo,
    role: decodedToken.role,
    department: decodedToken.department,
    manager: decodedToken.manager,
    working_hours: decodedToken.working_hours,
    work_model: decodedToken.work_model,
    start_date: decodedToken.start_date,
    tenantId: decodedToken.tenantId
  };

  // Check if account already setup (check in memory first)
  const existingEmployee = persistentUsers[employeeData.id];
  if (existingEmployee && existingEmployee.account_setup_completed) {
    return res.status(400).json({
      success: false,
      message: "Account already set up",
      data: {
        hint: "This invitation has already been used. Please login with your credentials.",
        email: employeeData.email
      }
    });
  }

  try {
    // Hash password with bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date();

    // Create/update employee record with activated account
    const activatedEmployee = {
      ...employeeData,
      password: hashedPassword,
      status: "Active", // Change from Pending to Active
      account_setup_completed: true,
      account_activated_at: now.toISOString(),
      invitation_token: null, // Invalidate token (one-time use)
      first_login: true,
      last_login: now.toISOString(),
      created_at: now.toISOString(),
      joined_date: employeeData.start_date || now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    };

    // Save to persistent storage
    persistentUsers[employeeData.id] = activatedEmployee;
    savePersistentData();

    console.log(`✅ Account setup completed for: ${employeeData.full_name} (${employeeData.email})`);

    // Send welcome email with login instructions
    const welcomeEmailSubject = `Welcome! Your Account is Ready`;
    const welcomeEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .credentials-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
          .success-icon { font-size: 48px; text-align: center; margin: 20px 0; }
          .footer { text-align: center; color: #888; padding: 20px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Account Activated!</h1>
          </div>
          <div class="content">
            <div class="success-icon">✅</div>
            
            <p>Hi <strong>${employee.first_name}</strong>,</p>
            
            <p>Great news! Your account has been successfully set up and activated. You can now login to the time tracking system.</p>
            
            <div class="credentials-box">
              <h3>🔐 Your Login Credentials:</h3>
              <p><strong>Email:</strong> ${employee.email}</p>
              <p><strong>Password:</strong> The password you just created</p>
              <p><strong>Status:</strong> Active ✅</p>
            </div>
            
            <div style="text-align: center;">
              <a href="https://workingtime-two.vercel.app/login?changePassword=true" class="button">🚀 Login Now</a>
            </div>
            
            <h3>📋 Your Profile Summary:</h3>
            <ul>
              <li><strong>Employee ID:</strong> ${employee.employee_id}</li>
              <li><strong>Full Name:</strong> ${employee.full_name}</li>
              <li><strong>Role:</strong> ${employee.role}</li>
              <li><strong>Department:</strong> ${employee.department}</li>
              <li><strong>Working Hours:</strong> ${employee.working_hours}</li>
              <li><strong>Work Model:</strong> ${employee.work_model}</li>
              <li><strong>Start Date:</strong> ${employee.start_date}</li>
            </ul>
            
            <h3>🚀 Next Steps:</h3>
            <ol>
              <li>Click the "Login Now" button above</li>
              <li>Enter your email and password</li>
              <li>Start tracking your time</li>
              <li>Complete your profile if needed</li>
            </ol>
            
            <p style="background: #fff3cd; padding: 15px; border-radius: 5px; margin-top: 20px;">
              <strong>⚠️ Security Tip:</strong> Keep your password secure and never share it with anyone. If you forget your password, you can use the "Forgot Password" feature on the login page.
            </p>
          </div>
          <div class="footer">
            <p>© 2026 Your Company. All rights reserved.</p>
            <p>Need help? Contact your manager or HR department.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send welcome email (SMTP with relay fallback)
    const welcomeMailOpts = {
      from: '"Champ Dynamics HR" <info@champdynamics.in>',
      to: employeeData.email,
      subject: welcomeEmailSubject,
      html: welcomeEmailHtml
    };
    emailTransporter.sendMail(welcomeMailOpts, (error, info) => {
      if (error) {
        console.log(`❌ SMTP failed for welcome email, trying relay...`);
        sendEmailViaRelay(welcomeMailOpts).then(() => {
          console.log(`✅ Welcome email sent via relay to ${employeeData.email}`);
        }).catch(e => console.log(`❌ Relay also failed: ${e.message}`));
      } else {
        console.log(`✅ Welcome email sent to ${employeeData.email}`);
      }
    });

    // Return success response
    res.status(200).json({
      success: true,
      message: "Account setup successful! You can now login",
      data: {
        employee: {
          id: employeeData.id,
          employee_id: employeeData.employee_id,
          full_name: employeeData.full_name,
          email: employeeData.email,
          role: employeeData.role,
          department: employeeData.department,
          status: activatedEmployee.status,
          working_hours: employeeData.working_hours,
          work_model: employeeData.work_model,
          start_date: employeeData.start_date,
          profile_photo: employeeData.profile_photo
        },
        account_activated_at: activatedEmployee.account_activated_at,
        login_instructions: {
          login_url: "http://localhost:3000/login",
          email: employeeData.email,
          message: "Use your email and the password you just created to login"
        },
        next_steps: [
          "Check your email for welcome message",
          "Login using your credentials",
          "Complete your profile if needed",
          "Start tracking your time"
        ]
      }
    });

  } catch (error) {
    console.error(`❌ Error during account setup: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to set up account",
      error: error.message
    });
  }
});

// ===== INVITE EMPLOYEE API WITH FILE UPLOAD (multipart/form-data) =====
router.post('/admin/employees/invite', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  
  // Handle profile photo from express-fileupload
  if (req.files && req.files.profile_photo) {
    const photo = req.files.profile_photo;
    req.file = {
      buffer: photo.data,
      originalname: photo.name,
      mimetype: photo.mimetype,
      size: photo.size
    };
    console.log(`📸 Profile photo received via express-fileupload: ${photo.name}`);
  }
  
  // Get data from form-data
  const {
    first_name,
    last_name,
    email,
    phone,
    date_of_birth,
    address,
    role,
    department,
    manager,
    working_hours,
    work_model,
    start_date
  } = req.body;

  console.log(`📧 Invite employee request - Admin: ${adminId}, Email: ${email}`);

  // Validate required fields
  if (!first_name || !last_name || !email || !role || !department) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
      data: {
        required_fields: ["first_name", "last_name", "email", "role", "department"],
        missing: [
          !first_name && "first_name",
          !last_name && "last_name",
          !email && "email",
          !role && "role",
          !department && "department"
        ].filter(Boolean)
      }
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format",
      data: { email }
    });
  }

  try {
    // Check if email already exists in database
    const existingCheck = await pool.query(
      'SELECT id, full_name FROM employees WHERE email = $1',
      [email]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Employee with this email already exists",
        data: {
          email,
          existing_employee_id: existingCheck.rows[0].id,
          existing_employee_name: existingCheck.rows[0].full_name
        }
      });
    }

    // Handle profile photo - uploaded file or default
    let employeeProfilePhoto;
    if (req.file && req.file.buffer) {
      // Upload to Cloudinary
      try {
        employeeProfilePhoto = await uploadToCloudinary(req.file.buffer, 'profile-photos');
        console.log(`📸 Profile photo uploaded to Cloudinary: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);
      } catch (uploadError) {
        console.error('Failed to upload profile photo:', uploadError);
        // Use default avatar on upload failure
        employeeProfilePhoto = "https://ui-avatars.com/api/?name=" + encodeURIComponent(`${first_name} ${last_name}`);
      }
    } else {
      // Default avatar
      employeeProfilePhoto = "https://ui-avatars.com/api/?name=" + encodeURIComponent(`${first_name} ${last_name}`);
    }

    // Generate random 8-character alphanumeric password
    const randomPassword = Math.random().toString(36).substring(2, 7) + Math.random().toString(36).substring(2, 5).toUpperCase();
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    
    console.log(`🔐 Generated password for ${email}: ${randomPassword}`);

    // Get admin's tenant_id and full_name - check employees table first
    const adminResult = await pool.query('SELECT tenant_id, full_name, email FROM employees WHERE id = $1', [adminId]);
    let tenantId = adminResult.rows.length > 0 ? adminResult.rows[0].tenant_id : null;
    let adminName = adminResult.rows.length > 0 ? adminResult.rows[0].full_name : 'Your Manager';
    let adminEmail = adminResult.rows.length > 0 ? adminResult.rows[0].email : null;

    // FALLBACK: Admin is in company_details table (registered via company registration)
    if (!tenantId) {
      console.log(`⚠️ Admin ${adminId} not found in employees or tenant_id is NULL, checking company_details by ID...`);
      const companyAdminResult = await pool.query(
        'SELECT tenant_id, full_name, email FROM company_details WHERE id = $1 AND is_admin = true LIMIT 1',
        [adminId]
      );
      if (companyAdminResult.rows.length > 0) {
        tenantId = companyAdminResult.rows[0].tenant_id;
        adminName = companyAdminResult.rows[0].full_name || adminName;
        adminEmail = companyAdminResult.rows[0].email || adminEmail;
        console.log(`✅ Found admin in company_details - tenant_id: ${tenantId}, name: ${adminName}`);
      }
    }

    // Get company name dynamically based on tenant_id
    let companyName = 'Your Company'; // Default fallback
    if (tenantId) {
      const companyResult = await pool.query('SELECT name FROM company_details WHERE tenant_id = $1 AND is_active = true LIMIT 1', [tenantId]);
      if (companyResult.rows.length > 0) {
        companyName = companyResult.rows[0].name;
        console.log(`✅ Using company name: ${companyName} for tenant: ${tenantId}`);
      }
    }

    // Generate unique employee_id with global uniqueness check
    let generatedEmployeeId = null;
    let attemptCount = 0;
    const maxAttempts = 100;
    
    while (!generatedEmployeeId && attemptCount < maxAttempts) {
      // Get the highest employee number globally (to ensure uniqueness across all tenants)
      const maxIdResult = await pool.query(
        `SELECT employee_id FROM employees 
         WHERE employee_id LIKE 'EMP%'
         ORDER BY CAST(SUBSTRING(employee_id FROM 4) AS INTEGER) DESC 
         LIMIT 1`
      );
      
      let nextEmployeeNumber = 1;
      if (maxIdResult.rows.length > 0 && maxIdResult.rows[0].employee_id) {
        const lastId = maxIdResult.rows[0].employee_id;
        const numPart = parseInt(lastId.replace('EMP', '')) || 0;
        nextEmployeeNumber = numPart + 1;
      }
      
      const candidateId = `EMP${nextEmployeeNumber.toString().padStart(3, '0')}`;
      
      // Double-check if this ID exists
      const existingIdCheck = await pool.query(
        'SELECT id FROM employees WHERE employee_id = $1',
        [candidateId]
      );
      
      if (existingIdCheck.rows.length === 0) {
        generatedEmployeeId = candidateId;
        console.log(`✅ Generated unique employee_id: ${generatedEmployeeId}`);
      } else {
        attemptCount++;
        console.log(`⚠️ Employee ID ${candidateId} already exists, retrying... (attempt ${attemptCount})`);
        // If already exists, this shouldn't happen with our query, but add small delay
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    if (!generatedEmployeeId) {
      console.error('❌ Failed to generate unique employee ID after max attempts');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate unique employee ID',
        error: 'MAX_ATTEMPTS_EXCEEDED'
      });
    }

    // Insert employee into database with tenant_id and employee_id
    const insertResult = await pool.query(
      `INSERT INTO employees (
        first_name, last_name, full_name, email, password, phone, address, 
        date_of_birth, profile_photo, role, department, manager, 
        working_hours, work_model, start_date, status, tenant_id, employee_id,
        account_setup_completed, account_activated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING id, employee_id, tenant_id`,
      [
        first_name,
        last_name,
        `${first_name} ${last_name}`,
        email,
        hashedPassword,
        phone || '',
        address || '',
        date_of_birth || null,
        employeeProfilePhoto,
        role,
        department,
        manager && typeof manager === 'string' && manager.trim() ? manager.trim() : null,
        working_hours || '09:00 AM - 05:00 PM',
        work_model || 'Office',
        start_date || new Date().toISOString().split('T')[0],
        'Active',
        tenantId,
        generatedEmployeeId,
        true,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    const newEmployee = insertResult.rows[0];
    const newEmployeeId = newEmployee.id;
    const employeeIdFormatted = newEmployee.employee_id; // Now always populated from database

    // Employee data to encode in JWT
    const employeeData = {
      id: newEmployeeId,
      employee_id: employeeIdFormatted,
    first_name,
    last_name,
    full_name: `${first_name} ${last_name}`,
    email,
    phone: phone || '',
    address: address || '',
    date_of_birth: date_of_birth || null,
    profile_photo: employeeProfilePhoto,
    role,
    department,
    manager: manager && typeof manager === 'string' && manager.trim() ? manager.trim() : null,
    working_hours: working_hours || '09:00 AM - 05:00 PM',
    work_model: work_model || 'Office',
    start_date: start_date || new Date().toISOString().split('T')[0],
    tenantId: newEmployee.tenant_id,
    password: hashedPassword
  };

  // Generate JWT invitation token with complete employee data
  const invitationToken = jwt.sign(
    { 
      ...employeeData,
      type: 'invitation',
      timestamp: Date.now()
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  const invitationLink = `https://api-layer.vercel.app/setup-account?token=${invitationToken}`;

  // Send invitation email via SMTP with login credentials
  const emailSubject = `Welcome to ${companyName} - Your Login Credentials`;
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; 
          line-height: 1.6; 
          color: #ffffff;
          background-color: #000000;
          margin: 0;
          padding: 0;
        }
        .container { 
          max-width: 600px; 
          margin: 0 auto; 
          padding: 40px 20px;
        }
        .content {
          padding: 20px;
        }
        h1 {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 20px;
        }
        p {
          font-size: 16px;
          line-height: 1.8;
          margin-bottom: 15px;
        }
        .button { 
          display: inline-block; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; 
          padding: 16px 40px; 
          text-decoration: none; 
          border-radius: 50px; 
          margin: 30px 0;
          font-weight: 600;
          font-size: 16px;
          text-align: center;
          width: 100%;
          max-width: 400px;
          box-sizing: border-box;
        }
        .button-container {
          text-align: center;
          margin: 30px 0;
        }
        ul {
          list-style: none;
          padding-left: 0;
        }
        ul li {
          padding-left: 30px;
          position: relative;
          margin-bottom: 10px;
        }
        ul li:before {
          content: "•";
          position: absolute;
          left: 10px;
        }
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #333;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h1>Hi ${first_name},</h1>
          
          <p>You have been invited by <strong>${adminName}</strong> to join <strong>${companyName}</strong> on <strong>Working Time Management System</strong>.</p>
          
          <p><strong>Working Time Management System</strong> is the internal system used to manage working time, absences, and employee requests.</p>
          
          <p>Your account has been created! Here are your login credentials:</p>
          
          <div style="background: #1a1a1a; border-left: 4px solid #667eea; padding: 20px; margin: 30px 0; border-radius: 8px;">
            <p style="margin: 10px 0; font-size: 16px;"><strong>📧 Email:</strong> <span style="background: #2a2a2a; padding: 8px 12px; border-radius: 4px; font-family: monospace; display: inline-block; margin-left: 10px;">${email}</span></p>
            <p style="margin: 10px 0; font-size: 16px;"><strong>🔑 Password:</strong> <span style="background: #2a2a2a; padding: 8px 12px; border-radius: 4px; font-family: monospace; display: inline-block; margin-left: 10px;">${randomPassword}</span></p>
            <p style="margin: 20px 0 10px 0; font-size: 14px; color: #ffc107;">⚠️ Please change your password after first login for security</p>
          </div>
          
          <div class="button-container">
            <a href="https://workingtime-two.vercel.app/login?changePassword=true" class="button">🚀 Login Now</a>
          </div>
          
          <p>Once you log in:</p>
          <ul>
            <li>Your company and role will already be assigned</li>
            <li>You can start tracking your working time and submitting requests immediately</li>
          </ul>
          
          <p>If you did not expect this invitation, you can safely ignore this email.</p>
          
          <p>If you have any questions, please contact your company administrator.</p>
          
          <div class="footer">
            <p>Best regards,<br>
            ${companyName} Team<br>
            <strong>Working Time Management</strong></p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send email synchronously (await) to ensure it sends before Vercel terminates
  let emailSent = false;
  try {
    const emailResult = await sendEmailWithRetry({
      from: '"Champ Dynamics HR" <info@champdynamics.in>',
      to: email,
      subject: emailSubject,
      html: emailHtml
    });
    if (emailResult.success) {
      console.log(`✅ Invitation email sent to ${email}`);
      emailSent = true;
    } else {
      console.log(`❌ Failed to send invitation email to ${email}:`, emailResult.error);
    }
  } catch (err) {
    console.log(`❌ Email error for ${email}:`, err.message);
  }
  
  // Return response after email attempt
  console.log(`✅ Employee invited successfully: ${newEmployee.full_name} (${newEmployee.employee_id})`);

  res.status(201).json({
    success: true,
    message: emailSent ? "Employee invitation sent successfully with login credentials" : "Employee created but email may be delayed",
    data: {
      employee: {
        id: newEmployee.id,
        employee_id: newEmployee.employee_id,
        tenant_id: newEmployee.tenant_id,
        full_name: newEmployee.full_name,
        first_name: newEmployee.first_name,
        last_name: newEmployee.last_name,
        email: newEmployee.email,
        phone: newEmployee.phone,
        date_of_birth: newEmployee.date_of_birth,
        address: newEmployee.address,
        profile_photo: newEmployee.profile_photo,
        role: newEmployee.role,
        department: newEmployee.department,
        working_hours: newEmployee.working_hours,
        work_model: newEmployee.work_model,
        manager: newEmployee.manager,
        status: newEmployee.status,
        start_date: newEmployee.start_date,
        invitation_sent_at: newEmployee.invitation_sent_at
      },
      credentials: {
        email: email,
        password: randomPassword,
        note: "Password has been sent to employee's email. They can login immediately."
      },
      invitation: {
        token: invitationToken,
        link: invitationLink,
        email_sent: emailSent,
        note: emailSent ? "Email sent successfully" : "Email sending attempted"
      },
      next_steps: [
        "Employee will receive login credentials via email shortly",
        "They can login immediately with email and password",
        "Status is already 'Active' - no setup required",
        "Recommend employee to change password after first login"
      ]
    }
  });
  
  } catch (error) {
    console.error('❌ Error inviting employee:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to invite employee',
      error: error.message
    });
  }
});

// ===== OLD INVITE EMPLOYEE API (JSON with base64) - Keeping for backward compatibility =====
router.post('/admin/employees/invite-json', authenticateToken, (req, res) => {
  // This endpoint supports JSON with base64 encoded images
  // For file upload, use POST /api/admin/employees/invite with multipart/form-data
  return res.status(200).json({
    success: true,
    message: "This endpoint is deprecated. Please use POST /api/admin/employees/invite with multipart/form-data for file uploads, or send base64 in JSON.",
    documentation: "Send base64 image in 'profile_photo' field or use multipart/form-data with the main invite endpoint"
  });
});

// ===== GET EMPLOYEES BY DATE OF JOINING =====
router.get('/admin/employees', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const tenantId = parseInt(req.user.tenantId);
  const userType = req.user.userType;
  const { from_date, to_date, month, year, sort, status, department, role, search, page = 1, limit = 10 } = req.query;

  console.log(`📋 Get employees request - Filters: from_date=${from_date}, to_date=${to_date}, month=${month}, year=${year}, search=${search}, page=${page}, limit=${limit}`);

  try {
    // Verify admin permission from both tables
    let isAdmin = false;
    if (userType === 'admin') {
      const adminResult = await pool.query(
        'SELECT id FROM company_details WHERE id = $1 AND tenant_id::integer = $2',
        [adminId, tenantId]
      );
      isAdmin = adminResult.rows.length > 0;
    } else {
      const userResult = await pool.query(
        'SELECT id, role, is_admin FROM employees WHERE id = $1 AND tenant_id::integer = $2',
        [adminId, tenantId]
      );
      const user = userResult.rows[0];
      isAdmin = user && (user.role === 'Admin' || user.role === 'Manager' || user.is_admin);
    }

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can view employees'
      });
    }

    // Build dynamic query - filter by tenant_id
    let query = `
      SELECT 
        id, employee_id, full_name, first_name, last_name, email, phone,
        profile_photo, role, department, status, work_model, manager,
        joined_date, working_hours, tenant_id, created_at, updated_at
      FROM employees
      WHERE tenant_id::integer = $1
    `;
    const params = [tenantId];
    let paramIndex = 2;

    // Filter by date range (use created_at as the reliable timestamp field)
    if (from_date) {
      query += ` AND DATE(created_at) >= $${paramIndex}::date`;
      params.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      query += ` AND DATE(created_at) <= $${paramIndex}::date`;
      params.push(to_date);
      paramIndex++;
    }

    // Filter by month and year
    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM created_at) = $${paramIndex} AND EXTRACT(YEAR FROM created_at) = $${paramIndex + 1}`;
      params.push(parseInt(month), parseInt(year));
      paramIndex += 2;
    } else if (year && !month) {
      query += ` AND EXTRACT(YEAR FROM created_at) = $${paramIndex}`;
      params.push(parseInt(year));
      paramIndex++;
    }

    // Filter by status (case-insensitive)
    if (status) {
      query += ` AND LOWER(status) = LOWER($${paramIndex})`;
      params.push(status);
      paramIndex++;
    }

    // Filter by department
    if (department) {
      query += ` AND department ILIKE $${paramIndex}`;
      params.push(`%${department}%`);
      paramIndex++;
    }

    // Filter by role
    if (role) {
      query += ` AND role ILIKE $${paramIndex}`;
      params.push(`%${role}%`);
      paramIndex++;
    }

    // Search across name, email, employee_id, phone
    if (search) {
      query += ` AND (full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR employee_id ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Sort
    if (sort === 'newest' || sort === 'latest') {
      query += ' ORDER BY created_at DESC';
    } else if (sort === 'oldest') {
      query += ' ORDER BY created_at ASC';
    } else {
      query += ' ORDER BY id DESC';
    }

    // Count total before pagination (build separate count query)
    let countQuery = `
      SELECT COUNT(*) as total
      FROM employees
      WHERE tenant_id::integer = $1
    `;
    const countParams = [tenantId];
    let countIndex = 2;

    if (from_date) {
      countQuery += ` AND DATE(created_at) >= $${countIndex}::date`;
      countParams.push(from_date);
      countIndex++;
    }
    if (to_date) {
      countQuery += ` AND DATE(created_at) <= $${countIndex}::date`;
      countParams.push(to_date);
      countIndex++;
    }
    if (month && year) {
      countQuery += ` AND EXTRACT(MONTH FROM created_at) = $${countIndex} AND EXTRACT(YEAR FROM created_at) = $${countIndex + 1}`;
      countParams.push(parseInt(month), parseInt(year));
      countIndex += 2;
    } else if (year && !month) {
      countQuery += ` AND EXTRACT(YEAR FROM created_at) = $${countIndex}`;
      countParams.push(parseInt(year));
      countIndex++;
    }
    if (status) {
      countQuery += ` AND LOWER(status) = LOWER($${countIndex})`;
      countParams.push(status);
      countIndex++;
    }
    if (department) {
      countQuery += ` AND department ILIKE $${countIndex}`;
      countParams.push(`%${department}%`);
      countIndex++;
    }
    if (role) {
      countQuery += ` AND role ILIKE $${countIndex}`;
      countParams.push(`%${role}%`);
      countIndex++;
    }
    if (search) {
      countQuery += ` AND (full_name ILIKE $${countIndex} OR email ILIKE $${countIndex} OR employee_id ILIKE $${countIndex} OR phone ILIKE $${countIndex} OR first_name ILIKE $${countIndex} OR last_name ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
      countIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);

    // Add pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    // Format response
    const formattedEmployees = result.rows.map(emp => ({
      id: emp.id,
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      phone: emp.phone,
      profile_photo: emp.profile_photo,
      role: emp.role,
      department: emp.department,
      status: emp.status,
      work_model: emp.work_model,
      manager: emp.manager,
      joined_date: emp.joined_date || emp.created_at,
      working_hours: emp.working_hours
    }));

    const totalPages = Math.ceil(totalCount / limitNum);

    res.json({
      success: true,
      message: "Employees retrieved successfully",
      data: {
        employees: formattedEmployees,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          total_pages: totalPages,
          has_next: pageNum < totalPages,
          has_prev: pageNum > 1
        },
        filters_applied: {
          from_date: from_date || null,
          to_date: to_date || null,
          month: month || null,
          year: year || null,
          status: status || null,
          department: department || null,
          role: role || null,
          search: search || null,
          sort: sort || 'newest'
        }
      }
    });

  } catch (error) {
    console.error('❌ Get employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve employees',
      error: error.message
    });
  }
});

// ===== GET SECURITY LOGS (Admin Only) =====
router.get('/admin/security-logs', authenticateToken, async (req, res) => {
  const tenantId = parseInt(req.user.tenantId);
  const userType = req.user.userType;
  const { page = 1, limit = 20, severity } = req.query;

  try {
    // Only admin can view security logs
    if (userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can view security logs' });
    }

    let query = `SELECT * FROM tenant_security_logs WHERE user_tenant_id = $1`;
    const params = [tenantId];
    let paramIdx = 2;

    if (severity) {
      query += ` AND severity = $${paramIdx}`;
      params.push(severity);
      paramIdx++;
    }

    // Count
    const countResult = await pool.query(query.replace('*', 'COUNT(*) as total'), params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    params.push(limitNum, (pageNum - 1) * limitNum);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        logs: result.rows,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve security logs', error: error.message });
  }
});

// ===== DELETE EMPLOYEE API (Company Admin) =====
router.delete('/admin/employees/:employeeId', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const employeeId = req.params.employeeId; // Keep as string (e.g., "EMP001")
  const { confirmation } = req.body;

  console.log(`🗑️ Delete employee request - Admin: ${adminId}, Employee: ${employeeId}`);

  try {
    // Find employee in database
    const employeeResult = await pool.query(
      'SELECT id, employee_id, full_name, email, role, department FROM employees WHERE employee_id = $1',
      [employeeId]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
        data: {
          employee_id: employeeId
        }
      });
    }

    const employee = employeeResult.rows[0];

    // Validate confirmation text
    if (!confirmation || confirmation.toLowerCase() !== 'delete') {
      return res.status(400).json({
        success: false,
        message: "Please type 'DELETE' to confirm employee deletion",
        data: {
          required_confirmation: "DELETE",
          received_confirmation: confirmation || null,
          hint: "Type DELETE (case-insensitive) in the confirmation field"
        }
      });
    }

    // Store employee data before deletion (for response)
    const deletedEmployee = {
      id: employee.id,
      employee_id: employee.employee_id,
      full_name: employee.full_name,
      email: employee.email,
      role: employee.role,
      department: employee.department
    };

    // Delete related data from database
    let timersDeleted = false;
    let leaveRequestsDeleted = false;
    let breaksDeleted = false;

    // Delete timer data
    try {
      const timerResult = await pool.query('DELETE FROM timer_sessions WHERE user_id = $1', [employee.id]);
      timersDeleted = timerResult.rowCount > 0;
    } catch (err) {
      console.log('Timer sessions table may not exist:', err.message);
    }

    // Delete leave requests
    try {
      const leaveResult = await pool.query('DELETE FROM leave_requests WHERE user_id = $1', [employee.id]);
      leaveRequestsDeleted = leaveResult.rowCount > 0;
    } catch (err) {
      console.log('Leave requests table may not exist:', err.message);
    }

    // Delete break history
    try {
      const breakResult = await pool.query('DELETE FROM break_sessions WHERE user_id = $1', [employee.id]);
      breaksDeleted = breakResult.rowCount > 0;
    } catch (err) {
      console.log('Break sessions table may not exist:', err.message);
    }

    // Delete employee from database
    await pool.query('DELETE FROM employees WHERE employee_id = $1', [employeeId]);

    console.log(`✅ Employee deleted permanently: ${deletedEmployee.full_name} (ID: ${employeeId})`);
    console.log(`⚠️ All related data (timers, leaves, breaks) also deleted`);

    res.json({
      success: true,
      message: "Employee account deleted permanently",
      data: {
        deleted_employee: deletedEmployee,
        deleted_at: new Date().toISOString(),
        deleted_by: adminId,
        related_data_deleted: {
          timers: timersDeleted,
          leave_requests: leaveRequestsDeleted,
          break_history: breaksDeleted,
          preferences: true
        },
        warning: "This action is irreversible. Employee data cannot be restored."
      }
    });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({
      success: false,
      message: 'Database error while deleting employee',
      error: error.message
    });
  }
});


  return router;
};
