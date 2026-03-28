/**
 * profile Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== GET /api/me - Main Profile Endpoint =====
router.get('/me', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    console.log(`👤 Profile requested for user ID: ${userId}`);
    
    // Get user from database
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = result.rows[0];
    
    console.log(`👤 Found user: ${user.full_name || user.first_name + ' ' + user.last_name} (ID: ${userId})`);
    
    // Generate employee_id if not exists
    let employeeId = user.employee_id;
    if (!employeeId) {
      // Auto-generate: EMP-{tenant_id}-{user_id}
      const prefix = user.tenant_id ? `T${user.tenant_id}` : 'EMP';
      employeeId = `${prefix}-${String(user.id).padStart(4, '0')}`;
      
      // Update database with generated employee_id
      try {
        await pool.query('UPDATE employees SET employee_id = $1 WHERE id = $2', [employeeId, user.id]);
        console.log(`✅ Auto-generated employee_id: ${employeeId} for user ${user.id}`);
      } catch (err) {
        console.error('⚠️ Could not update employee_id:', err.message);
      }
    }
    
    res.json({
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        id: user.id,
        employee_id: employeeId,
        full_name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone_number: user.phone,
        address: user.address,
        date_of_birth: user.date_of_birth,
        profile_image: user.profile_photo,
        role: user.role || 'Employee',
        department: user.department || 'General',
        working_hours: user.working_hours,
        work_model: user.work_model || 'Office',
        manager: user.manager,
        status: user.status || 'Active',
        tenant_id: user.tenant_id,
        can_edit_profile: true,
        can_change_password: true,
        can_delete_account: true
      }
    });
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
});

// PUT /api/me - Update Profile
router.put('/me', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { full_name, firstName, lastName, email, phone_number, address, date_of_birth } = req.body;
  
  console.log(`📝 Profile update for user ${userId}:`, { full_name, firstName, lastName, email, phone_number, date_of_birth });
  
  try {
    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (firstName || full_name) {
      const fName = firstName || full_name?.split(' ')[0];
      updates.push(`first_name = $${paramCount}`);
      values.push(fName);
      paramCount++;
    }
    if (lastName || full_name) {
      const lName = lastName || full_name?.split(' ').slice(1).join(' ');
      updates.push(`last_name = $${paramCount}`);
      values.push(lName);
      paramCount++;
    }
    if (full_name || firstName || lastName) {
      updates.push(`full_name = $${paramCount}`);
      values.push(full_name || `${firstName || ''} ${lastName || ''}`.trim());
      paramCount++;
    }
    if (email) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }
    if (phone_number) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone_number);
      paramCount++;
    }
    if (address) {
      updates.push(`address = $${paramCount}`);
      values.push(address);
      paramCount++;
    }
    if (date_of_birth) {
      updates.push(`date_of_birth = $${paramCount}`);
      values.push(date_of_birth);
      paramCount++;
    }
    
    updates.push(`updated_at = $${paramCount}`);
    values.push(new Date());
    paramCount++;
    
    values.push(userId);
    
    const query = `UPDATE employees SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const updatedUser = result.rows[0];
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      notification: {
        type: 'success',
        title: 'Profile Updated',
        message: 'Your personal information has been updated successfully.'
      },
      data: {
        id: updatedUser.id,
        full_name: updatedUser.full_name,
        email: updatedUser.email,
        phone_number: updatedUser.phone,
        address: updatedUser.address,
        date_of_birth: updatedUser.date_of_birth,
        updated_at: updatedUser.updated_at
      }
    });
  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

// PUT /api/me/password - Change Password
router.put('/me/password', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { current_password, new_password, confirm_password } = req.body;
  
  console.log(`🔐 Password change request for user ${userId}`);
  
  try {
    // Validation
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
        errors: {
          current_password: !current_password ? 'Current password is required' : undefined,
          new_password: !new_password ? 'New password is required' : undefined,
          confirm_password: !confirm_password ? 'Confirm password is required' : undefined
        }
      });
    }
    
    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        errors: {
          confirm_password: 'New password and confirm password must match'
        }
      });
    }
    
    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password too short',
        errors: {
          new_password: 'Password must be at least 6 characters long'
        }
      });
    }
    
    // Get user from database
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = result.rows[0];
    
    // Verify current password
    const isPasswordValid = await bcrypt.compare(current_password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
        errors: {
          current_password: 'The current password you entered is incorrect'
        }
      });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);
    
    // Update password
    await pool.query(
      'UPDATE employees SET password = $1, updated_at = $2 WHERE id = $3',
      [hashedPassword, new Date(), userId]
    );
    
    console.log(`✅ Password changed successfully for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Password changed successfully',
      notification: {
        type: 'success',
        title: 'Password Updated',
        message: 'Your password has been changed successfully. Please use your new password for future logins.'
      },
      data: {
        password_changed_at: new Date().toISOString(),
        requires_re_login: false
      }
    });
  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
});

// ===== FIX 2: PROFILE API - Dynamic, not hardcoded Jenny Wilson =====
router.get('/me/profile', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const tenantId = req.user?.tenantId;
  
  try {
    console.log(`👤 Profile requested for user ID: ${userId}`);
    
    // Get user from employees table first
    let result = await pool.query('SELECT * FROM employees WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
    
    let user;
    let isAdmin = false;
    
    if (result.rows.length > 0) {
      user = result.rows[0];
    } else {
      // Fallback to company_details for admin users
      const cdResult = await pool.query('SELECT * FROM company_details WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
      if (cdResult.rows.length > 0) {
        const cd = cdResult.rows[0];
        isAdmin = true;
        user = {
          id: cd.id,
          first_name: cd.first_name || cd.company_name,
          last_name: cd.last_name || '',
          full_name: cd.first_name && cd.last_name ? `${cd.first_name} ${cd.last_name}` : cd.company_name,
          email: cd.email,
          phone: cd.phone || cd.phone_number || '',
          profile_photo: cd.profile_image || cd.company_logo,
          role: 'Admin',
          department: 'Management',
          status: 'Active',
          employee_number: null
        };
      }
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log(`👤 Found user: ${user.full_name || user.first_name + ' ' + user.last_name} (ID: ${userId})`);
    
    res.json({
      success: true,
      message: "Profile information retrieved successfully",
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name || `${user.first_name} ${user.last_name}`,
          email: user.email,
          phone: formatPhoneNumber(user.phone || ''),
          profile_photo: user.profile_photo,
          role: user.role || 'Employee',
          department: user.department || 'General',
          manager: user.manager,
          working_hours: user.working_hours,
          work_model: user.work_model,
          start_date: user.start_date,
          date_of_birth: user.date_of_birth,
          status: user.status || 'Active',
          employee_id: user.employee_number
        },
        permissions: {
          can_edit_profile: true,
          can_change_password: true,
          can_delete_account: true,
          can_upload_photo: true
        }
      }
    });
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
});

// ===== FIX 3: PROFILE UPDATE API - Persistent changes =====
router.put('/me/profile', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  const { first_name, last_name, email, phone, department, manager, working_hours, work_model, date_of_birth } = req.body;
  
  console.log(`📝 Profile update for user ${userId}:`, { first_name, last_name, email, phone, date_of_birth });
  
  try {
    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (first_name) {
      updates.push(`first_name = $${paramCount}`);
      values.push(first_name);
      paramCount++;
    }
    if (last_name) {
      updates.push(`last_name = $${paramCount}`);
      values.push(last_name);
      paramCount++;
    }
    if (first_name || last_name) {
      updates.push(`full_name = $${paramCount}`);
      values.push(`${first_name || ''} ${last_name || ''}`.trim());
      paramCount++;
    }
    if (email) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }
    if (department) {
      updates.push(`department = $${paramCount}`);
      values.push(department);
      paramCount++;
    }
    if (manager) {
      updates.push(`manager = $${paramCount}`);
      values.push(manager);
      paramCount++;
    }
    if (working_hours) {
      updates.push(`working_hours = $${paramCount}`);
      values.push(working_hours);
      paramCount++;
    }
    if (work_model) {
      updates.push(`work_model = $${paramCount}`);
      values.push(work_model);
      paramCount++;
    }
    if (date_of_birth) {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date_of_birth)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use YYYY-MM-DD (e.g., 1990-01-15)'
        });
      }
      updates.push(`date_of_birth = $${paramCount}`);
      values.push(date_of_birth);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    updates.push(`updated_at = $${paramCount}`);
    values.push(new Date());
    paramCount++;
    
    values.push(userId);
    
    const query = `UPDATE employees SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const updatedUser = result.rows[0];
    
    console.log(`✅ Profile updated successfully: ${updatedUser.full_name}`);
    
    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: {
          id: updatedUser.id,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name,
          full_name: updatedUser.full_name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          department: updatedUser.department,
          manager: updatedUser.manager,
          working_hours: updatedUser.working_hours,
          work_model: updatedUser.work_model,
          date_of_birth: updatedUser.date_of_birth
        },
        persistent: true
      }
    });
  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

// ===== PROFILE PHOTO UPLOAD API =====
router.post('/me/profile/photo', authenticateToken, uploadProfilePhoto.single('profile_photo'), async (req, res) => {
  const userId = req.user?.userId || req.user?.id || 1;
  
  try {
    console.log(`📸 Profile photo upload request from user ID: ${userId}`);
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Please select an image file.",
        data: {
          accepted_formats: ["jpg", "jpeg", "png", "gif", "webp"],
          max_size: "4MB"
        }
      });
    }

    console.log(`📁 Uploading to Cloudinary: ${req.file.originalname}, Size: ${req.file.size} bytes`);

    // Upload to Cloudinary
    let photoUrl;
    try {
      photoUrl = await uploadToCloudinary(req.file.buffer, 'profile-photos');
      console.log(`✅ Photo uploaded to Cloudinary: ${photoUrl}`);
    } catch (uploadError) {
      console.error('❌ Cloudinary upload error:', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload photo to cloud storage',
        error: uploadError.message
      });
    }

    // Update database
    await pool.query(
      'UPDATE employees SET profile_photo = $1, updated_at = NOW() WHERE id = $2',
      [photoUrl, userId]
    );

    // Get updated user info
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    const user = result.rows[0];

    console.log(`✅ Profile photo updated for user ID: ${userId}`);

    res.json({
      success: true,
      message: "Profile photo uploaded successfully",
      data: {
        user: {
          id: user.id,
          name: user.full_name || `${user.first_name} ${user.last_name}`,
          email: user.email,
          profile_photo: photoUrl,
          photo_updated_at: new Date().toISOString()
        },
        upload: {
          status: "success",
          cloud_url: photoUrl,
          original_name: req.file.originalname,
          file_size: `${(req.file.size / 1024).toFixed(2)} KB`,
          mime_type: req.file.mimetype
        }
      }
    });
  } catch (error) {
    console.error('❌ Profile photo upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile photo',
      error: error.message
    });
  }
});

// ===== PROFILE PHOTO DELETE API =====
router.delete('/me/profile/photo', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user info
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`🗑️ Profile photo delete request from user ID: ${userId}`);
    
    // Set default avatar
    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name || user.first_name + ' ' + user.last_name)}&size=150&background=6366F1&color=ffffff`;
    
    // Update database
    await pool.query(
      'UPDATE employees SET profile_photo = $1, updated_at = NOW() WHERE id = $2',
      [defaultAvatar, userId]
    );

    console.log(`✅ Profile photo deleted for user ID: ${userId} - Reset to default avatar`);
    
    res.json({
      success: true,
      message: "Profile photo deleted successfully",
      data: {
        user: {
          id: user.id,
          name: user.full_name || `${user.first_name} ${user.last_name}`,
          email: user.email,
          profile_photo: defaultAvatar,
          photo_updated_at: new Date().toISOString()
        },
        delete: {
          status: "success",
          default_avatar: defaultAvatar,
          note: "Profile photo reset to generated avatar"
        }
      }
    });
  } catch (error) {
    console.error('❌ Profile photo delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile photo',
      error: error.message
    });
  }
});

// ===== PROFILE NAME UPDATE API =====
router.put('/me/profile/name', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || 1;
  
  try {
    // Get user from database
    const userResult = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    console.log(`📝 Profile name update request from user: ${user.full_name} (ID: ${userId})`);
    
    const { name, first_name, last_name } = req.body;
    
    // Validate input
    if (!name && !first_name && !last_name) {
      return res.status(400).json({
        success: false,
        message: 'Name, first_name, or last_name is required',
        data: {
          required_fields: ['name (full name)', 'first_name + last_name', 'first_name', 'last_name'],
          current_name: user.full_name
        }
      });
    }
    
    let updatedFirstName = user.first_name;
    let updatedLastName = user.last_name;
    let updatedFullName = user.full_name;
    
    // Handle different input patterns
    if (name) {
      // If full name is provided, try to split it
      const nameParts = name.trim().split(' ');
      updatedFirstName = nameParts[0] || user.first_name;
      updatedLastName = nameParts.slice(1).join(' ') || user.last_name || '';
      updatedFullName = name.trim();
    } else {
      // If individual parts are provided
      if (first_name) updatedFirstName = first_name.trim();
      if (last_name) updatedLastName = last_name.trim();
      updatedFullName = `${updatedFirstName} ${updatedLastName}`.trim();
    }
    
    // Validate name length
    if (updatedFullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters long',
        data: {
          provided_name: updatedFullName,
          min_length: 2
        }
      });
    }
    
    // Store old name for comparison
    const oldName = user.full_name;
    
    // Update user data in database
    await pool.query(
      `UPDATE employees 
       SET first_name = $1, last_name = $2, full_name = $3, updated_at = NOW()
       WHERE id = $4`,
      [updatedFirstName, updatedLastName, updatedFullName, userId]
    );
    
    console.log(`✅ Profile name updated successfully: ${oldName} → ${updatedFullName}`);
    
    res.json({
      success: true,
      message: "Profile name updated successfully",
      data: {
        user: {
          id: user.id,
          first_name: updatedFirstName,
          last_name: updatedLastName,
          full_name: updatedFullName,
          email: user.email,
          profile_photo: user.profile_photo
        },
        changes: {
          old_name: oldName,
          new_name: updatedFullName,
          first_name: updatedFirstName,
          last_name: updatedLastName
        }
      }
    });
  } catch (error) {
    console.error('❌ Error updating profile name:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile name',
      error: error.message
    });
  }
});

// ===== PROFILE EMAIL UPDATE API =====
router.put('/me/profile/email', authenticateToken, (req, res) => {
  const userId = req.user?.userId || 1;
  const user = persistentUsers[userId];
  
  console.log(`📧 Profile email update request from user: ${user.full_name} (ID: ${userId})`);
  
  const { email, current_password } = req.body;
  
  // Validate input
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'New email is required',
      data: {
        required_fields: ['email'],
        current_email: user.email
      }
    });
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address',
      data: {
        provided_email: email,
        format_required: 'user@domain.com'
      }
    });
  }
  
  // Check if email is already in use
  const existingUser = Object.values(persistentUsers).find(u => u.email === email && u.id !== userId);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: 'This email is already registered with another account',
      data: {
        email: email,
        error: 'email_already_exists'
      }
    });
  }
  
  // Verify current password for security (optional but recommended)
  if (current_password && user.password !== current_password) {
    return res.status(401).json({
      success: false,
      message: 'Current password is incorrect',
      data: {
        error: 'invalid_password'
      }
    });
  }
  
  // Store old email
  const oldEmail = user.email;
  
  // Update email
  persistentUsers[userId].email = email;
  persistentUsers[userId].email_updated_at = new Date().toISOString();
  
  // Save changes
  savePersistentData();
  
  console.log(`✅ Profile email updated successfully: ${oldEmail} → ${email}`);
  
  res.json({
    success: true,
    message: "Profile email updated successfully",
    data: {
      user: {
        id: user.id,
        name: user.full_name,
        email: email,
        profile_photo: user.profile_photo,
        email_updated_at: persistentUsers[userId].email_updated_at
      },
      changes: {
        old_email: oldEmail,
        new_email: email
      },
      security_note: "Please update your login credentials and verify the new email address"
    }
  });
});

// ===== PROFILE PHONE UPDATE API =====
// ===== PHONE CHANGE WITH OTP VERIFICATION =====
// Storage for phone change OTPs
let phoneChangeOtps = {};

// Static OTP for testing (TODO: Replace with SMS/Email service)
const STATIC_PHONE_OTP = '123456';

// POST Request Phone Change - Send OTP to email
router.post('/me/profile/phone/request-change', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const userEmail = req.user?.email;
  
  console.log(`📞 Phone change request from user ID: ${userId}`);
  
  const { new_phone } = req.body;
  
  // Validate input
  if (!new_phone) {
    return res.status(400).json({
      success: false,
      message: 'New phone number is required',
      data: {
        required_fields: ['new_phone'],
        example: '+41791234567'
      }
    });
  }
  
  // Basic phone validation
  const cleanPhone = new_phone.replace(/[\s\-\(\)\+]/g, '');
  
  if (cleanPhone.length < 7 || cleanPhone.length > 15) {
    return res.status(400).json({
      success: false,
      message: 'Phone number must be between 7 and 15 digits',
      data: {
        provided_phone: new_phone,
        clean_digits: cleanPhone.length,
        valid_length: '7-15 digits'
      }
    });
  }
  
  if (!/^\d+$/.test(cleanPhone)) {
    return res.status(400).json({
      success: false,
      message: 'Phone number can only contain digits, spaces, hyphens, parentheses, and plus sign',
      data: { allowed_characters: '0-9, space, -, (, ), +' }
    });
  }
  
  try {
    // Check if phone already exists
    const existingCheck = await pool.query(
      'SELECT id FROM employees WHERE phone = $1 AND id != $2',
      [new_phone, userId]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered with another account',
        data: { phone: new_phone }
      });
    }
    
    // Get current user info
    const userResult = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Use static OTP for testing
    const otp = STATIC_PHONE_OTP;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    // Store OTP
    phoneChangeOtps[userId] = {
      otp: otp,
      new_phone: new_phone,
      email: user.email,
      expires_at: expiresAt,
      created_at: new Date()
    };
    
    console.log(`✅ Phone change OTP generated for user ${userId}, new phone: ${new_phone}`);
    
    res.json({
      success: true,
      message: 'OTP generated successfully. Use the static OTP for verification.',
      data: {
        email_sent_to: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
        new_phone: new_phone,
        expires_in: '10 minutes',
        next_step: 'POST /api/me/profile/phone/verify with otp field',
        // For testing only - remove in production
        test_otp: STATIC_PHONE_OTP,
        note: 'Static OTP for testing. In production, OTP will be sent via SMS/Email.'
      }
    });
  } catch (error) {
    console.error('❌ Phone change request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process phone change request',
      error: error.message
    });
  }
});

// POST Verify Phone Change OTP
router.post('/me/profile/phone/verify', authenticateToken, async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  
  console.log(`📞 Phone change OTP verification from user ID: ${userId}`);
  
  const { otp } = req.body;
  
  if (!otp) {
    return res.status(400).json({
      success: false,
      message: 'OTP is required',
      data: { required_fields: ['otp'] }
    });
  }
  
  // Check if OTP exists
  const otpData = phoneChangeOtps[userId];
  
  if (!otpData) {
    return res.status(400).json({
      success: false,
      message: 'No phone change request found. Please request a new OTP first.',
      data: { 
        hint: 'POST /api/me/profile/phone/request-change with new_phone'
      }
    });
  }
  
  // Check expiry
  if (new Date() > new Date(otpData.expires_at)) {
    delete phoneChangeOtps[userId];
    return res.status(400).json({
      success: false,
      message: 'OTP has expired. Please request a new one.',
      data: { expired_at: otpData.expires_at }
    });
  }
  
  // Verify OTP
  if (otpData.otp !== otp.toString()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid OTP',
      data: { attempts_hint: 'Check your email for the correct OTP' }
    });
  }
  
  try {
    // Get current phone
    const userResult = await pool.query('SELECT phone FROM employees WHERE id = $1', [userId]);
    const oldPhone = userResult.rows[0]?.phone || 'Not set';
    
    // Update phone in database
    await pool.query(
      'UPDATE employees SET phone = $1, updated_at = NOW() WHERE id = $2',
      [otpData.new_phone, userId]
    );
    
    // Clear OTP
    const newPhone = otpData.new_phone;
    delete phoneChangeOtps[userId];
    
    // Get updated user
    const updatedResult = await pool.query('SELECT * FROM employees WHERE id = $1', [userId]);
    const user = updatedResult.rows[0];
    
    console.log(`✅ Phone updated successfully: ${oldPhone} → ${newPhone}`);
    
    res.json({
      success: true,
      message: 'Phone number updated successfully',
      data: {
        user: {
          id: user.id,
          name: user.full_name,
          email: user.email,
          phone: user.phone,
          profile_photo: user.profile_photo,
          updated_at: user.updated_at
        },
        changes: {
          old_phone: oldPhone,
          new_phone: newPhone
        },
        verified: true
      }
    });
  } catch (error) {
    console.error('❌ Phone update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update phone number',
      error: error.message
    });
  }
});

// PUT Direct phone update (backward compatibility - deprecated)
router.put('/me/profile/phone', authenticateToken, (req, res) => {
  // Redirect to OTP flow
  return res.status(400).json({
    success: false,
    message: 'Phone change requires OTP verification',
    data: {
      step_1: 'POST /api/me/profile/phone/request-change with { "new_phone": "+41..." }',
      step_2: 'POST /api/me/profile/phone/verify with { "otp": "123456" }',
      reason: 'Security - Phone changes require email verification'
    }
  });
});

// ===== DELETE ACCOUNT API - Employee can delete their own account =====
router.delete('/me/account', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const { confirmation } = req.body;
  
  console.log(`🗑️ Account deletion request from user ID: ${userId}`);
  
  try {
    // Validate confirmation text
    if (confirmation !== 'DELETE') {
      return res.status(400).json({
        success: false,
        message: 'Please type DELETE to confirm account deletion',
        data: {
          required_confirmation: 'DELETE',
          provided_confirmation: confirmation || 'null',
          note: 'Confirmation text is case-sensitive'
        }
      });
    }
    
    // Get user details before deletion
    const userResult = await pool.query(
      'SELECT email, full_name, tenant_id, employee_id FROM employees WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    const { email, full_name, tenant_id, employee_id: employeeId } = user;
    
    // Delete user's related data in transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete user's timer records
      await client.query('DELETE FROM timers WHERE user_id = $1', [userId]);
      
      // Delete user's break records
      await client.query('DELETE FROM breaks WHERE user_id = $1', [userId]);
      
      // Delete user's leave requests
      await client.query('DELETE FROM leave_requests WHERE employee_id = $1', [userId]);
      
      // Delete user's correction requests
      await client.query('DELETE FROM correction_requests WHERE employee_id = $1', [employeeId]);
      
      // Delete user's vacation balances
      await client.query('DELETE FROM vacation_balances WHERE user_id = $1', [userId]);
      
      // Delete the user account
      await client.query('DELETE FROM employees WHERE id = $1', [userId]);
      
      await client.query('COMMIT');
      
      console.log(`✅ Account deleted successfully for: ${email} (${full_name})`);
      
      res.json({
        success: true,
        message: 'Your account has been permanently deleted',
        data: {
          deleted_user: {
            email: email,
            name: full_name,
            tenant_id: tenant_id
          },
          deleted_at: new Date().toISOString(),
          deleted_records: {
            timers: true,
            breaks: true,
            leave_requests: true,
            correction_requests: true,
            vacation_balances: true,
            user_account: true
          },
          note: 'All your data has been permanently removed from the system'
        }
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    });
  }
});


  return router;
};
