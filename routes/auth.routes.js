/**
 * auth Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== FIX 1: LOGIN API - WITH PASSWORD VERIFICATION =====
// NOTE: In serverless environment, persistentUsers may be empty after function restart
// Invited employees will fail to login until data persistence solution is implemented
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log(`🔑 Login attempt for: ${email}`);
  
  try {
    // First try employees table (only if they have a password set)
    let result = await pool.query(
      `SELECT e.*, 
              cd.name as company_name, cd.address as company_address, cd.phone as company_phone, 
              cd.email as company_email, cd.logo as company_logo, cd.timezone as company_timezone,
              'employee' as user_type
       FROM employees e
       LEFT JOIN company_details cd ON e.tenant_id = cd.tenant_id
       WHERE e.email = $1 AND e.password IS NOT NULL AND e.password != ''
       LIMIT 1`,
      [email]
    );
    
    // If not found in employees (or no password), try company_details (for admin/owner)
    if (result.rows.length === 0) {
      console.log(`🔍 User not in employees (or no password), checking company_details...`);
      result = await pool.query(
        `SELECT id, name as full_name, email, password, phone, role, 
                tenant_id, logo as profile_photo, timezone,
                name as company_name, address as company_address, phone as company_phone,
                email as company_email, logo as company_logo, timezone as company_timezone,
                'admin' as user_type
         FROM company_details 
         WHERE email = $1 
         LIMIT 1`,
        [email]
      );
    }
    
    if (result.rows.length === 0) {
      console.log(`❌ User not found: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const user = result.rows[0];
    
    // Check password
    if (!user.password) {
      console.log(`❌ No password set for: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Compare password with bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log(`❌ Invalid password for: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Generate access token (24h) and refresh token (30 days)
    const tokenPayload = { 
      userId: user.id, 
      email: user.email,
      name: user.full_name,
      tenantId: user.tenant_id,
      userType: user.user_type
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const refreshToken = jwt.sign({ ...tokenPayload, type: 'refresh' }, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
    
    console.log(`✅ Login successful for: ${user.full_name} (ID: ${user.id}, Type: ${user.user_type})`);
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.full_name,
          email: user.email,
          role: user.role || 'Admin',
          full_name: user.full_name,
          employee_id: user.employee_id,
          department: user.department,
          status: user.status || 'Active',
          profile_photo: user.profile_photo,
          tenant_id: user.tenant_id,
          user_type: user.user_type
        },
        company: {
          name: user.company_name,
          address: user.company_address,
          phone: user.company_phone,
          email: user.company_email,
          logo: user.company_logo,
          timezone: user.company_timezone
        },
        token: token,
        refreshToken: refreshToken,
        tokenExpiresIn: '24h',
        refreshTokenExpiresIn: '30d'
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// ===== REGISTER API - User Registration =====
router.post('/auth/register', async (req, res) => {
  const { 
    first_name, 
    last_name, 
    email, 
    password, 
    phone, 
    company, 
    department, 
    role 
  } = req.body;
  
  console.log(`📝 Registration request for: ${email}`);
  
  try {
    // Validate required fields
    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email and password are required',
        data: {
          required_fields: ['first_name', 'last_name', 'email', 'password']
        }
      });
    }
    
    // Check if user already exists in database
    const existingCheck = await pool.query('SELECT id FROM employees WHERE email = $1', [email]);
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
        data: {
          email: email,
          exists: true
        }
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user in database
    const result = await pool.query(`
      INSERT INTO employees (
        first_name, last_name, full_name, email, password, phone,
        profile_photo, role, department, status, hire_date, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, employee_number, first_name, last_name, email, role, department
    `, [
      first_name,
      last_name,
      `${first_name} ${last_name}`,
      email,
      hashedPassword,
      phone || '',
      `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&size=150`,
      role || 'Employee',
      department || 'General',
      'Active',
      new Date(),
      true,
      new Date()
    ]);
    
    const newUser = result.rows[0];
    
    // Generate token
    const token = jwt.sign({ 
      userId: newUser.id, 
      email: newUser.email,
      name: `${newUser.first_name} ${newUser.last_name}`
    }, JWT_SECRET, { expiresIn: '24h' });
    
    console.log(`✅ User registered successfully: ${newUser.first_name} ${newUser.last_name} (ID: ${newUser.id})`);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: newUser.id,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          full_name: `${newUser.first_name} ${newUser.last_name}`,
          email: newUser.email,
          phone: phone || '',
          company: company || '',
          department: newUser.department,
          role: newUser.role,
          employee_id: newUser.employee_number
        },
        token: token,
        auto_login: true
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register user',
      error: error.message
    });
  }
});

// ===== MULTI-STEP COMPANY REGISTRATION APIs =====

// Middleware to handle file from express-fileupload for step-1
const handleStep1Upload = (req, res, next) => {
  console.log('[Step1 Upload] Content-Type:', req.headers['content-type']);
  console.log('[Step1 Upload] Body:', JSON.stringify(req.body));
  console.log('[Step1 Upload] Body keys:', Object.keys(req.body || {}));
  console.log('[Step1 Upload] Files:', req.files ? Object.keys(req.files) : 'none');
  console.log('[Step1 Upload] _skipBodyParse:', req._skipBodyParse);
  
  // express-fileupload puts files in req.files as object, convert company_logo to req.file format
  if (req.files && req.files.company_logo) {
    const logo = req.files.company_logo;
    req.file = {
      buffer: logo.data,
      originalname: logo.name,
      mimetype: logo.mimetype,
      size: logo.size
    };
    console.log('[Step1 Upload] Logo file found:', logo.name);
  }
  
  next();
};

// PHASE 1: Company Information
// PHASE 1: Company Information with Logo Upload (Supports both JSON and multipart/form-data)
router.post('/auth/company-registration/step-1', handleStep1Upload, async (req, res) => {
  // Debug: Log everything about the request
  console.log('=== STEP 1 DEBUG ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Body type:', typeof req.body);
  console.log('Body:', JSON.stringify(req.body));
  console.log('Body keys:', Object.keys(req.body || {}));
  console.log('Files:', req.files);
  console.log('===================');

  const {
    company_name,
    company_email,
    country,
    timezone
  } = req.body || {};

  console.log(`🏢 Step 1: Company Information - ${company_name}`);
  console.log('Request body:', req.body);
  console.log('File attached:', req.file ? 'Yes' : 'No');

  // Validate required fields
  if (!company_name || !company_email || !country || !timezone) {
    // Return debug info for troubleshooting
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      data: {
        required_fields: ['company_name', 'company_email', 'country', 'timezone'],
        missing_fields: [
          !company_name && 'company_name',
          !company_email && 'company_email',
          !country && 'country',
          !timezone && 'timezone'
        ].filter(Boolean)
      },
      debug: {
        content_type: req.headers['content-type'],
        body_received: req.body,
        body_keys: Object.keys(req.body || {}),
        files_received: req.files ? Object.keys(req.files) : null
      }
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(company_email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format',
      data: {
        email: company_email
      }
    });
  }

  // Generate unique registration session ID
  const sessionId = `REG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Upload logo to Cloudinary if file exists
  let logoUrl = null;
  if (req.file) {
    try {
      logoUrl = await uploadToCloudinary(req.file.buffer, 'company-logos');
      console.log(`✅ Logo uploaded to Cloudinary: ${logoUrl}`);
    } catch (error) {
      console.error('❌ Cloudinary upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload logo',
        error: error.message
      });
    }
  }

  // Store step 1 data in MEMORY (not database) - data will be saved in step-4
  tempCompanyRegistrations[sessionId] = {
    company_info: {
      company_name,
      company_email,
      country,
      timezone,
      logo: logoUrl
    },
    current_step: 1,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min expiry
  };

  console.log(`✅ Step 1 completed - Session: ${sessionId} (stored in memory)`);

  res.status(200).json({
    success: true,
    message: 'Company information saved successfully',
    data: {
      session_id: sessionId,
      current_step: 1,
      next_step: 2,
      completed_data: {
        company_name,
        company_email,
        country,
        timezone,
        logo: logoUrl
      },
      expires_in_minutes: 30
    }
  });
});

// PHASE 2: Work Model Configuration
router.post('/auth/company-registration/step-2', async (req, res) => {
  const {
    session_id,
    default_work_model,
    working_hours_per_day,
    working_days_per_week,
    default_break_duration,
    overtime_calculation
  } = req.body;

  console.log(`⚙️ Step 2: Work Model Configuration - Session: ${session_id}`);

  // Validate session from MEMORY
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        session_id: session_id || null,
        error: 'Please start registration from step 1'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again from step 1'
      }
    });
  }

  // Check if step 1 was completed
  if (registration.current_step < 1) {
    return res.status(400).json({
      success: false,
      message: 'Please complete step 1 first',
      data: {
        current_step: registration.current_step
      }
    });
  }

  // Validate required fields
  if (!default_work_model || !working_hours_per_day || !working_days_per_week || !default_break_duration || !overtime_calculation) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      data: {
        required_fields: ['default_work_model', 'working_hours_per_day', 'working_days_per_week', 'default_break_duration', 'overtime_calculation']
      }
    });
  }

  // Validate work model values
  const validWorkModels = ['office', 'remote', 'hybrid'];
  if (!validWorkModels.includes(default_work_model)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid work model',
      data: {
        valid_options: validWorkModels,
        received: default_work_model
      }
    });
  }

  // Validate numeric values
  if (working_hours_per_day < 1 || working_hours_per_day > 24) {
    return res.status(400).json({
      success: false,
      message: 'Working hours per day must be between 1 and 24',
      data: { working_hours_per_day }
    });
  }

  if (working_days_per_week < 1 || working_days_per_week > 7) {
    return res.status(400).json({
      success: false,
      message: 'Working days per week must be between 1 and 7',
      data: { working_days_per_week }
    });
  }

  // Update registration with step 2 data in MEMORY
  registration.work_model = {
    default_work_model,
    working_hours_per_day: parseFloat(working_hours_per_day),
    working_days_per_week: parseInt(working_days_per_week),
    default_break_duration: parseInt(default_break_duration),
    overtime_calculation
  };
  registration.current_step = 2;
  registration.updated_at = new Date().toISOString();

  console.log(`✅ Step 2 completed - Session: ${session_id} (stored in memory)`);

  res.status(200).json({
    success: true,
    message: 'Work model configuration saved successfully',
    data: {
      session_id: session_id,
      current_step: 2,
      next_step: 3,
      completed_data: {
        company_info: registration.company_info,
        work_model: registration.work_model
      },
      expires_in_minutes: 30
    }
  });
});

// PHASE 3: Admin Account Setup
router.post('/auth/company-registration/step-3', async (req, res) => {
  const {
    session_id,
    full_name,
    email_address,
    password,
    confirm_password,
    department  // Optional - department from departments table
  } = req.body;

  console.log(`👤 Step 3: Admin Account Setup - Session: ${session_id}`);

  // Validate session from MEMORY
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Please complete previous steps first'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again from step 1'
      }
    });
  }

  // Check if step 2 was completed
  if (registration.current_step < 2) {
    return res.status(400).json({
      success: false,
      message: 'Please complete step 2 first',
      data: {
        current_step: registration.current_step
      }
    });
  }

  try {

  // Validate required fields
  if (!full_name || !email_address || !password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      data: {
        required_fields: ['full_name', 'email_address', 'password', 'confirm_password']
      }
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email_address)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format',
      data: {
        email: email_address
      }
    });
  }

  // Check if email already exists in company_details
  const existingCompany = await pool.query('SELECT id FROM company_details WHERE email = $1 AND is_active = true', [email_address]);
  if (existingCompany.rows.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Admin email already exists',
      data: {
        email: email_address,
        suggestion: 'Please use a different email address'
      }
    });
  }

  // Validate password match
  if (password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match',
      data: {
        error: 'Password and confirm password must be the same'
      }
    });
  }

  // Validate password strength (minimum 6 characters)
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password is too weak',
      data: {
        error: 'Password must be at least 6 characters long',
        current_length: password.length
      }
    });
  }

  // Update registration with step 3 data in MEMORY
  registration.admin_account = {
    full_name,
    email_address,
    password, // Will be hashed in step-4
    department: department || null  // Optional department
  };
  registration.current_step = 3;
  registration.updated_at = new Date().toISOString();

  console.log(`✅ Step 3 completed - Session: ${session_id} (stored in memory)`);

  res.status(200).json({
    success: true,
    message: 'Admin account details saved successfully',
    data: {
      session_id: session_id,
      current_step: 3,
      next_step: 4,
      completed_data: {
        company_info: registration.company_info,
        work_model: registration.work_model,
        admin_account: {
          full_name,
          email_address
        }
      },
      expires_in_minutes: 30
    }
  });
  } catch (error) {
    console.error('❌ Step 3 error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save admin account details',
      error: error.message
    });
  }
});

// PHASE 4: Review and Finish (Create Company)
router.post('/auth/company-registration/step-4', async (req, res) => {
  const { session_id } = req.body;

  console.log(`✅ Step 4: Review and Finish - Session: ${session_id}`);

  // Validate session from MEMORY
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Please complete all previous steps first'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again from step 1'
      }
    });
  }

  // Check if step 3 was completed
  if (registration.current_step < 3) {
    return res.status(400).json({
      success: false,
      message: 'Please complete all previous steps first',
      data: {
        current_step: registration.current_step
      }
    });
  }

  try {
    // Hash admin password
    const hashedPassword = await bcrypt.hash(registration.admin_account.password, 10);

    // First, create company to get tenant_id
    // INSERT all data into company_details table (SINGLE INSERT at step-4)
    const result = await pool.query(
      `INSERT INTO company_details (
        name, tenant_id, email, country, timezone, logo,
        full_name, password,
        profile_photo, role, department, status, hire_date,
        company, is_admin, is_active, account_setup_completed, account_activated_at,
        default_work_model, working_hours_per_day, working_days_per_week,
        default_break_duration, overtime_calculation, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      RETURNING id`,
      [
        registration.company_info.company_name,  // $1 name
        null,                                     // $2 tenant_id (will be set after insert)
        registration.company_info.company_email,  // $3 email
        registration.company_info.country,        // $4 country
        registration.company_info.timezone,       // $5 timezone
        registration.company_info.logo,           // $6 logo
        registration.admin_account.full_name,     // $7 full_name
        hashedPassword,                           // $8 password
        `https://ui-avatars.com/api/?name=${encodeURIComponent(registration.admin_account.full_name)}&size=150`, // $9 profile_photo
        'Admin',                                  // $10 role
        registration.admin_account.department || null,  // $11 department (optional, can be set later)
        'Active',                                 // $12 status
        new Date().toISOString().split('T')[0],   // $13 hire_date
        registration.company_info.company_name,   // $14 company
        true,                                     // $15 is_admin
        true,                                     // $16 is_active
        true,                                     // $17 account_setup_completed
        new Date().toISOString(),                 // $18 account_activated_at
        registration.work_model?.default_work_model || null,      // $19
        registration.work_model?.working_hours_per_day || null,   // $20
        registration.work_model?.working_days_per_week || null,   // $21
        registration.work_model?.default_break_duration || null,  // $22
        registration.work_model?.overtime_calculation || null,    // $23
        new Date().toISOString(),                 // $24 created_at
        new Date().toISOString()                  // $25 updated_at
      ]
    );

    const companyId = result.rows[0].id;

    // Generate employee number
    const employeeNumber = `ADM${companyId.toString().padStart(5, '0')}`;

    // Update tenant_id to own id and set employee_number
    await pool.query(
      `UPDATE company_details SET tenant_id = $1, employee_number = $2 WHERE id = $1`,
      [companyId, employeeNumber]
    );

    // If department was provided, create it in departments table
    if (registration.admin_account.department) {
      const deptName = registration.admin_account.department.trim();
      
      // Check if department already exists for this tenant
      const existingDept = await pool.query(
        `SELECT id FROM departments WHERE name = $1 AND tenant_id = $2`,
        [deptName, companyId]
      );

      // Only insert if it doesn't exist
      if (existingDept.rows.length === 0) {
        await pool.query(
          `INSERT INTO departments (name, tenant_id, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [deptName, companyId, true, new Date().toISOString(), new Date().toISOString()]
        );
        console.log(`📁 Department created in departments table: ${deptName}`);
      } else {
        console.log(`📁 Department already exists: ${deptName}`);
      }
    }

    // Delete from memory after successful save
    delete tempCompanyRegistrations[session_id];

    // Generate authentication token
    const token = jwt.sign({ 
      userId: companyId, 
      email: registration.admin_account.email_address,
      name: registration.admin_account.full_name,
      role: 'Admin',
      tenantId: companyId
    }, JWT_SECRET, { expiresIn: '24h' });

    console.log(`🎉 Company created successfully: ${registration.company_info.company_name} (Company ID: ${companyId})`);
    console.log(`👤 Admin saved in company_details: ${registration.admin_account.full_name} (ID: ${companyId})`);

    res.status(201).json({
      success: true,
      message: 'Company registration completed successfully',
      data: {
        company: {
          id: companyId,
          name: registration.company_info.company_name,
          email: registration.company_info.company_email,
          country: registration.company_info.country,
          timezone: registration.company_info.timezone,
          work_settings: registration.work_model
        },
        admin: {
          id: companyId,
          name: registration.admin_account.full_name,
          email: registration.admin_account.email_address,
          role: 'Admin',
          employee_number: employeeNumber
        },
        token: token,
        auto_login: true,
        next_steps: [
          'Customize company branding',
          'Invite team members',
          'Set up work policies',
          'Configure attendance rules'
        ]
      }
    });
  } catch (error) {
    console.error('❌ Step 4 error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete registration',
      error: error.message
    });
  }
});

// GET Registration Status/Review (for step 4 review)
router.get('/auth/company-registration/review/:session_id', (req, res) => {
  const { session_id } = req.params;

  console.log(`📋 Review registration - Session: ${session_id}`);

  // Fetch from MEMORY
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Session not found'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again'
      }
    });
  }

  res.status(200).json({
    success: true,
    message: 'Registration data retrieved successfully',
    data: {
      session_id: session_id,
      current_step: registration.current_step,
      company_info: registration.company_info || null,
      work_model: registration.work_model || null,
      admin_account: registration.admin_account ? {
        full_name: registration.admin_account.full_name,
        email_address: registration.admin_account.email_address
      } : null,
      is_complete: registration.current_step === 3,
      created_at: registration.created_at,
      expires_at: registration.expires_at
    }
  });
});

// EDIT APIs - Update registration data during review

// EDIT Phase 1: Update Company Information
router.put('/auth/company-registration/edit-step-1', (req, res) => {
  const { session_id, ...updateFields } = req.body;

  console.log(`✏️ Edit Step 1: Company Information - Session: ${session_id}`);

  // Validate session
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Session not found'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again'
      }
    });
  }

  // Validate email format if provided
  if (updateFields.company_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updateFields.company_email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        data: {
          email: updateFields.company_email
        }
      });
    }
  }

  // Update company info dynamically (only update provided fields)
  if (!registration.company_info) {
    registration.company_info = {};
  }

  // Dynamically update all provided fields
  Object.keys(updateFields).forEach(key => {
    if (updateFields[key] !== undefined && updateFields[key] !== null) {
      registration.company_info[key] = updateFields[key];
    }
  });

  registration.updated_at = new Date().toISOString();

  console.log(`✅ Step 1 updated - Session: ${session_id}`);

  res.status(200).json({
    success: true,
    message: 'Company information updated successfully',
    data: {
      session_id: session_id,
      updated_data: registration.company_info,
      expires_at: registration.expires_at
    }
  });
});

// EDIT Phase 2: Update Work Model Configuration
router.put('/auth/company-registration/edit-step-2', (req, res) => {
  const { session_id, ...updateFields } = req.body;

  console.log(`✏️ Edit Step 2: Work Model - Session: ${session_id}`);

  // Validate session
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Session not found'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again'
      }
    });
  }

  // Validate work model if provided
  if (updateFields.default_work_model) {
    const validWorkModels = ['office', 'remote', 'hybrid'];
    if (!validWorkModels.includes(updateFields.default_work_model)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid work model',
        data: {
          valid_options: validWorkModels,
          received: updateFields.default_work_model
        }
      });
    }
  }

  // Validate numeric values if provided
  if (updateFields.working_hours_per_day && (updateFields.working_hours_per_day < 1 || updateFields.working_hours_per_day > 24)) {
    return res.status(400).json({
      success: false,
      message: 'Working hours per day must be between 1 and 24',
      data: { working_hours_per_day: updateFields.working_hours_per_day }
    });
  }

  if (updateFields.working_days_per_week && (updateFields.working_days_per_week < 1 || updateFields.working_days_per_week > 7)) {
    return res.status(400).json({
      success: false,
      message: 'Working days per week must be between 1 and 7',
      data: { working_days_per_week: updateFields.working_days_per_week }
    });
  }

  // Update work model dynamically (only update provided fields)
  if (!registration.work_model) {
    registration.work_model = {};
  }

  // Dynamically update all provided fields with type conversion where needed
  const numericFields = ['working_hours_per_day', 'working_days_per_week', 'default_break_duration'];
  Object.keys(updateFields).forEach(key => {
    if (updateFields[key] !== undefined && updateFields[key] !== null) {
      if (numericFields.includes(key)) {
        registration.work_model[key] = key === 'working_hours_per_day' ? parseFloat(updateFields[key]) : parseInt(updateFields[key]);
      } else {
        registration.work_model[key] = updateFields[key];
      }
    }
  });

  registration.updated_at = new Date().toISOString();

  console.log(`✅ Step 2 updated - Session: ${session_id}`);

  res.status(200).json({
    success: true,
    message: 'Work model configuration updated successfully',
    data: {
      session_id: session_id,
      updated_data: registration.work_model,
      expires_at: registration.expires_at
    }
  });
});

// EDIT Phase 3: Update Admin Account
router.put('/auth/company-registration/edit-step-3', (req, res) => {
  const { session_id, ...updateFields } = req.body;

  console.log(`✏️ Edit Step 3: Admin Account - Session: ${session_id}`);

  // Validate session
  if (!session_id || !tempCompanyRegistrations[session_id]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired registration session',
      data: {
        error: 'Session not found'
      }
    });
  }

  const registration = tempCompanyRegistrations[session_id];

  // Check if session expired
  if (new Date() > new Date(registration.expires_at)) {
    delete tempCompanyRegistrations[session_id];
    return res.status(400).json({
      success: false,
      message: 'Registration session expired',
      data: {
        error: 'Please start registration again'
      }
    });
  }

  // Validate email format if provided
  if (updateFields.email_address) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updateFields.email_address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        data: {
          email: updateFields.email_address
        }
      });
    }

    // Check if email already exists (excluding current registration email)
    const existingUser = Object.values(persistentUsers).find(user => 
      user.email === updateFields.email_address && 
      user.email !== (registration.admin_account?.email_address || '')
    );
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Admin email already exists',
        data: {
          email: updateFields.email_address,
          suggestion: 'Please use a different email address'
        }
      });
    }
  }

  // Validate password if provided
  if (updateFields.password) {
    if (updateFields.password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is too weak',
        data: {
          error: 'Password must be at least 6 characters long',
          current_length: updateFields.password.length
        }
      });
    }

    // Check password match
    if (updateFields.confirm_password && updateFields.password !== updateFields.confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
        data: {
          error: 'Password and confirm password must be the same'
        }
      });
    }
  }

  // Update admin account dynamically (only update provided fields)
  if (!registration.admin_account) {
    registration.admin_account = {};
  }

  // Handle special field processing for full_name
  if (updateFields.full_name) {
    const nameParts = updateFields.full_name.trim().split(' ');
    registration.admin_account.first_name = nameParts[0];
    registration.admin_account.last_name = nameParts.slice(1).join(' ') || nameParts[0];
  }

  // Dynamically update all provided fields (excluding confirm_password)
  const excludeFields = ['confirm_password'];
  Object.keys(updateFields).forEach(key => {
    if (updateFields[key] !== undefined && updateFields[key] !== null && !excludeFields.includes(key)) {
      registration.admin_account[key] = updateFields[key];
    }
  });

  registration.updated_at = new Date().toISOString();

  console.log(`✅ Step 3 updated - Session: ${session_id}`);

  // Build response data dynamically (excluding sensitive fields)
  const sensitiveFields = ['password', 'confirm_password'];
  const responseData = {};
  Object.keys(registration.admin_account).forEach(key => {
    if (!sensitiveFields.includes(key)) {
      responseData[key] = registration.admin_account[key];
    }
  });

  res.status(200).json({
    success: true,
    message: 'Admin account details updated successfully',
    data: {
      session_id: session_id,
      updated_data: responseData,
      expires_at: registration.expires_at
    }
  });
});

// ===== SINGLE-STEP COMPANY REGISTRATION API (OLD) =====
router.post('/auth/register-company', (req, res) => {
  const {
    // Company Details
    company_name,
    industry,
    company_email,
    company_phone,
    website,
    address,
    city,
    state,
    country,
    postal_code,
    
    // Admin Details
    admin_first_name,
    admin_last_name,
    admin_email,
    admin_password,
    admin_phone,
    department,  // Optional - department from departments table
    
    // Additional Info
    employee_count,
    timezone,
    brand_color
  } = req.body;

  console.log(`🏢 Company registration request: ${company_name}`);

  // Validate required fields
  if (!company_name || !admin_first_name || !admin_last_name || !admin_email || !admin_password) {
    return res.status(400).json({
      success: false,
      message: 'Company name, admin first name, last name, email and password are required',
      data: {
        required_fields: ['company_name', 'admin_first_name', 'admin_last_name', 'admin_email', 'admin_password']
      }
    });
  }

  // Check if admin email already exists
  const existingUser = Object.values(persistentUsers).find(user => user.email === admin_email);
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'Admin with this email already exists',
      data: {
        email: admin_email,
        exists: true
      }
    });
  }

  // Generate company ID
  const companyId = Math.floor(Math.random() * 90000) + 10000;

  // Create company settings
  const newCompany = {
    id: companyId,
    name: company_name,
    industry: industry || 'IT Company',
    brand_color: brand_color || '#6366F1',
    brand_color_name: 'Purple',
    support_email: company_email || admin_email,
    company_phone: company_phone || '',
    address: address || '',
    city: city || '',
    state: state || '',
    country: country || '',
    postal_code: postal_code || '',
    logo_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(company_name)}&size=200&background=6366F1&color=ffffff`,
    website: website || '',
    timezone: timezone || 'UTC',
    founded_date: new Date().toISOString().split('T')[0],
    employee_count: employee_count || 1,
    description: `${company_name} - ${industry || 'Business'}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'active',
    subscription_plan: 'trial',
    subscription_expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days trial
  };

  // Update global company settings
  companySettings = newCompany;

  // Generate admin user ID
  const adminUserId = Math.max(...Object.keys(persistentUsers).map(Number), 0) + 1;

  // Create admin user
  const adminUser = {
    id: adminUserId,
    first_name: admin_first_name,
    last_name: admin_last_name,
    full_name: `${admin_first_name} ${admin_last_name}`,
    email: admin_email,
    password: admin_password, // In production, hash this!
    phone: admin_phone || '',
    profile_photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(admin_first_name)}+${encodeURIComponent(admin_last_name)}&size=150`,
    role: 'Admin',
    company: company_name,
    company_id: companyId,
    joined_date: new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }),
    employee_id: `ADM${adminUserId.toString().padStart(3, '0')}`,
    department: department || null,  // Optional - admin can set later
    status: 'Active',
    timezone: timezone || 'UTC',
    is_admin: true,
    is_super_admin: true,
    permissions: ['all'],
    created_at: new Date().toISOString(),
    last_login: new Date().toISOString(),
    project: 'Administration',
    location: city && country ? `${city}, ${country}` : 'Remote'
  };

  // Add admin to persistent storage
  persistentUsers[adminUserId] = adminUser;

  // Save data
  savePersistentData();

  // If department was provided, create it in departments table (for in-memory storage)
  // Note: This is for in-memory users, actual DB-based registrations handled in step-4
  if (department && department.trim()) {
    console.log(`📁 Department provided for in-memory user: ${department}`);
    // For in-memory storage, we just store it in the user object
    // Real database insertion happens in step-4 flow
  }

  // Generate token for admin
  const token = jwt.sign({ 
    userId: adminUser.id, 
    email: adminUser.email,
    name: adminUser.full_name,
    role: 'Admin',
    company_id: companyId
  }, JWT_SECRET, { expiresIn: '24h' });

  console.log(`✅ Company registered: ${company_name} (ID: ${companyId})`);
  console.log(`✅ Admin created: ${adminUser.full_name} (ID: ${adminUserId})`);

  res.status(201).json({
    success: true,
    message: 'Company and admin account created successfully',
    data: {
      company: {
        id: newCompany.id,
        name: newCompany.name,
        industry: newCompany.industry,
        email: newCompany.support_email,
        phone: newCompany.company_phone,
        logo_url: newCompany.logo_url,
        subscription_plan: newCompany.subscription_plan,
        trial_expires: newCompany.subscription_expires
      },
      admin: {
        id: adminUser.id,
        name: adminUser.full_name,
        email: adminUser.email,
        phone: adminUser.phone,
        role: adminUser.role,
        employee_id: adminUser.employee_id,
        profile_photo: adminUser.profile_photo
      },
      token: token,
      auto_login: true,
      next_steps: [
        'Set up company preferences',
        'Invite team members',
        'Configure work policies',
        'Customize branding'
      ]
    }
  });
});

// ===== ADMIN REGISTRATION API (Add Admin to Existing Company) =====
router.post('/auth/register-admin', authenticateToken, (req, res) => {
  const {
    first_name,
    last_name,
    email,
    password,
    phone,
    department,
    permissions
  } = req.body;

  const requestingUserId = req.user.userId;
  const requestingUser = persistentUsers[requestingUserId];

  console.log(`👤 Admin registration request by: ${requestingUser?.full_name}`);

  // Check if requesting user is admin
  if (!requestingUser || !requestingUser.is_admin) {
    return res.status(403).json({
      success: false,
      message: 'Only admins can create new admin accounts',
      data: {
        required_role: 'Admin',
        current_role: requestingUser?.role || 'Unknown'
      }
    });
  }

  // Validate required fields
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'First name, last name, email and password are required',
      data: {
        required_fields: ['first_name', 'last_name', 'email', 'password']
      }
    });
  }

  // Check if email already exists
  const existingUser = Object.values(persistentUsers).find(user => user.email === email);
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'User with this email already exists',
      data: {
        email: email,
        exists: true
      }
    });
  }

  // Generate new admin user ID
  const newAdminId = Math.max(...Object.keys(persistentUsers).map(Number)) + 1;

  // Create new admin user
  const newAdmin = {
    id: newAdminId,
    first_name: first_name,
    last_name: last_name,
    full_name: `${first_name} ${last_name}`,
    email: email,
    password: password, // In production, hash this!
    phone: phone || '',
    profile_photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&size=150`,
    role: 'Admin',
    company: requestingUser.company || companySettings.name,
    company_id: requestingUser.company_id || companySettings.id,
    joined_date: new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }),
    employee_id: `ADM${newAdminId.toString().padStart(3, '0')}`,
    department: department || null,  // Optional - admin can set from departments table
    status: 'Active',
    timezone: requestingUser.timezone || 'UTC',
    is_admin: true,
    is_super_admin: false, // New admins are not super admins by default
    permissions: permissions || ['user_management', 'reports', 'settings'],
    created_at: new Date().toISOString(),
    created_by: requestingUserId,
    last_login: null,
    project: 'Administration',
    location: requestingUser.location || 'Remote'
  };

  // Add to persistent storage
  persistentUsers[newAdminId] = newAdmin;

  // Save data
  savePersistentData();

  // If department was provided, create it in departments table (for in-memory storage)
  // Note: This is for in-memory users, actual DB-based registrations handled in step-4
  if (department && department.trim()) {
    console.log(`📁 Department provided for new admin: ${department}`);
    // For in-memory storage, we just store it in the user object
    // Real database insertion happens when using database-backed registration
  }

  console.log(`✅ New admin created: ${newAdmin.full_name} (ID: ${newAdminId}) by ${requestingUser.full_name}`);

  res.status(201).json({
    success: true,
    message: 'Admin account created successfully',
    data: {
      admin: {
        id: newAdmin.id,
        name: newAdmin.full_name,
        email: newAdmin.email,
        phone: newAdmin.phone,
        role: newAdmin.role,
        employee_id: newAdmin.employee_id,
        department: newAdmin.department,
        permissions: newAdmin.permissions,
        profile_photo: newAdmin.profile_photo,
        created_at: newAdmin.created_at,
        created_by: requestingUser.full_name
      },
      credentials: {
        email: email,
        temporary_password: 'Please ask user to change password on first login'
      }
    }
  });
});

// ===== OTP-BASED FORGOT PASSWORD APIs =====

// STEP 1: Request OTP - Send OTP to email
router.post('/auth/forgot-password/request-otp', async (req, res) => {
  const { email } = req.body;

  console.log(`📧 OTP request for email: ${email}`);

  // Validate email
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
      data: {
        required_fields: ['email']
      }
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format',
      data: {
        email: email
      }
    });
  }

  // Check if user exists in database (employees or company_details)
  try {
    // First check employees table
    let userResult = await pool.query('SELECT id, email, full_name FROM employees WHERE email = $1', [email]);
    
    // If not found, check company_details table
    if (userResult.rows.length === 0) {
      userResult = await pool.query('SELECT id, email, name as full_name FROM company_details WHERE email = $1', [email]);
    }
    
    if (userResult.rows.length === 0) {
      // For security, don't reveal if email exists or not
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive an OTP shortly',
        data: {
          email: email,
          note: 'OTP will be valid for 10 minutes'
        }
      });
    }

    const user = userResult.rows[0];

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
  
    // Store OTP with expiry (10 minutes)
    const otpData = {
      email: email,
      otp: otp,
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      verified: false
    };

    forgotPasswordOTPs[email] = otpData;

    // Send OTP via email
    const mailOptions = {
      from: 'info@champdynamics.in',
      to: email,
      subject: 'Password Reset OTP - Management Time',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 50px auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #6366F1; margin-bottom: 30px; }
            .otp-box { background: #f0f0ff; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
            .otp-code { font-size: 32px; font-weight: bold; color: #6366F1; letter-spacing: 8px; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
            .warning { color: #ff6b6b; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Password Reset Request</h1>
            </div>
            <p>Hello <strong>${user.full_name}</strong>,</p>
            <p>We received a request to reset your password for Management Time account.</p>
            <p>Your One-Time Password (OTP) is:</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            <p><strong>This OTP will expire in 10 minutes.</strong></p>
            <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
            <div class="warning">
              ⚠️ Never share this OTP with anyone. Our team will never ask for your OTP.
            </div>
            <div class="footer">
              <p>Management Time - Time Tracking System</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      // Try SMTP first, fallback to relay
      try {
        await emailTransporter.sendMail(mailOptions);
      } catch (smtpErr) {
        console.log('SMTP failed, using relay:', smtpErr.message);
        await sendEmailViaRelay(mailOptions);
      }

      console.log(`✅ OTP sent successfully to: ${email} - OTP: ${otp}`);

      res.json({
        success: true,
        message: 'OTP sent successfully to your email',
        data: {
          email: email,
          otp_sent: true,
          expires_in: '10 minutes',
          demo_otp: otp // Remove this in production!
        }
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
      
      // Even if email fails, return success for security
      res.json({
        success: true,
        message: 'If your email is registered, you will receive an OTP shortly',
        data: {
          email: email,
          demo_otp: otp, // For demo purposes
          note: 'OTP would be sent via email'
        }
      });
    }
  } catch (error) {
    console.error('❌ Database error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message
    });
  }
});// STEP 2: Verify OTP
router.post('/auth/forgot-password/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  console.log(`🔍 OTP verification for email: ${email}`);

  // Validate input
  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Email and OTP are required',
      data: {
        required_fields: ['email', 'otp']
      }
    });
  }

  // Check if OTP exists
  const otpData = forgotPasswordOTPs[email];
  
  if (!otpData) {
    return res.status(400).json({
      success: false,
      message: 'No OTP request found for this email',
      data: {
        error: 'Please request OTP first'
      }
    });
  }

  // Check if OTP expired
  if (new Date() > new Date(otpData.expiresAt)) {
    delete forgotPasswordOTPs[email];
    return res.status(400).json({
      success: false,
      message: 'OTP has expired',
      data: {
        error: 'Please request a new OTP'
      }
    });
  }

  // Verify OTP
  if (otpData.otp !== otp.toString()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid OTP',
      data: {
        error: 'The OTP you entered is incorrect'
      }
    });
  }

  // Mark OTP as verified
  otpData.verified = true;
  otpData.verifiedAt = new Date().toISOString();

  console.log(`✅ OTP verified successfully for: ${email}`);

  res.json({
    success: true,
    message: 'OTP verified successfully',
    data: {
      email: email,
      verified: true,
      next_step: 'Set new password'
    }
  });
});

// STEP 3: Reset Password with OTP
router.post('/auth/forgot-password/reset-password', async (req, res) => {
  const { email, otp, new_password, confirm_password } = req.body;

  console.log(`🔑 Password reset request for: ${email}`);

  // Validate input
  if (!email || !otp || !new_password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      data: {
        required_fields: ['email', 'otp', 'new_password', 'confirm_password']
      }
    });
  }

  // Check if passwords match
  if (new_password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match',
      data: {
        error: 'New password and confirm password must be the same'
      }
    });
  }

  // Validate password strength
  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password is too weak',
      data: {
        error: 'Password must be at least 6 characters long',
        current_length: new_password.length
      }
    });
  }

  // Check if OTP exists and verified
  const otpData = forgotPasswordOTPs[email];
  
  if (!otpData) {
    return res.status(400).json({
      success: false,
      message: 'No OTP request found',
      data: {
        error: 'Please request OTP first'
      }
    });
  }

  if (!otpData.verified) {
    return res.status(400).json({
      success: false,
      message: 'OTP not verified',
      data: {
        error: 'Please verify OTP first'
      }
    });
  }

  // Check if OTP expired
  if (new Date() > new Date(otpData.expiresAt)) {
    delete forgotPasswordOTPs[email];
    return res.status(400).json({
      success: false,
      message: 'OTP has expired',
      data: {
        error: 'Please request a new OTP'
      }
    });
  }

  // Verify OTP again for security
  if (otpData.otp !== otp.toString()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid OTP',
      data: {
        error: 'The OTP you entered is incorrect'
      }
    });
  }

  // Find user from database (employees or company_details based on otpData)
  try {
    // First check employees table
    let userResult = await pool.query('SELECT id, email, full_name FROM employees WHERE email = $1', [email]);
    let userTable = 'employees';
    
    // If not found, check company_details table
    if (userResult.rows.length === 0) {
      userResult = await pool.query('SELECT id, email, name as full_name FROM company_details WHERE email = $1', [email]);
      userTable = 'company_details';
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: {
          error: 'User account does not exist'
        }
      });
    }

    const user = userResult.rows[0];

    // Hash the new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password in correct table
    await pool.query(
      `UPDATE ${userTable} SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hashedPassword, user.id]
    );

    // Also update in memory
    if (persistentUsers[user.id]) {
      persistentUsers[user.id].password = hashedPassword;
      persistentUsers[user.id].password_updated_at = new Date().toISOString();
    }

    // Delete used OTP
    delete forgotPasswordOTPs[email];

    console.log(`✅ Password reset successful in DB for: ${user.full_name} (${email})`);

    res.json({
      success: true,
      message: 'Password reset successful',
      data: {
        user_id: user.id,
        email: user.email,
        name: user.full_name,
        password_updated: true,
        updated_at: new Date().toISOString(),
        next_steps: [
          'Password has been changed successfully',
          'You can now login with your new password',
          'OTP has been invalidated'
        ]
      }
    });
  } catch (error) {
    console.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: error.message
    });
  }
});

// RESEND OTP (if expired or not received)
router.post('/auth/forgot-password/resend-otp', async (req, res) => {
  const { email } = req.body;

  console.log(`🔄 Resend OTP request for: ${email}`);

  // Validate email
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
      data: {
        required_fields: ['email']
      }
    });
  }

  // Check if user exists
  const user = Object.values(persistentUsers).find(u => u.email === email);
  
  if (!user) {
    return res.json({
      success: true,
      message: 'If your email is registered, you will receive an OTP shortly',
      data: {
        email: email
      }
    });
  }

  // Generate new 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  
  // Store/Update OTP
  forgotPasswordOTPs[email] = {
    email: email,
    otp: otp,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    verified: false,
    resent: true
  };

  // Send OTP via email
  try {
    const mailOptions = {
      from: 'info@champdynamics.in',
      to: email,
      subject: 'Resend: Password Reset OTP - Management Time',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 50px auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #6366F1; margin-bottom: 30px; }
            .otp-box { background: #f0f0ff; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
            .otp-code { font-size: 32px; font-weight: bold; color: #6366F1; letter-spacing: 8px; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 New OTP Request</h1>
            </div>
            <p>Hello <strong>${user.full_name}</strong>,</p>
            <p>Here is your new One-Time Password (OTP):</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            <p><strong>This OTP will expire in 10 minutes.</strong></p>
            <div class="footer">
              <p>Management Time - Time Tracking System</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Try SMTP first, fallback to relay
    try {
      await emailTransporter.sendMail(mailOptions);
    } catch (smtpErr) {
      console.log('SMTP failed, using relay:', smtpErr.message);
      await sendEmailViaRelay(mailOptions);
    }

    console.log(`✅ OTP resent successfully to: ${email} - OTP: ${otp}`);

    res.json({
      success: true,
      message: 'New OTP sent successfully',
      data: {
        email: email,
        otp_sent: true,
        expires_in: '10 minutes',
        demo_otp: otp // Remove in production
      }
    });

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    
    res.json({
      success: true,
      message: 'New OTP sent successfully',
      data: {
        email: email,
        demo_otp: otp,
        note: 'Email service temporarily unavailable, use demo OTP'
      }
    });
  }
});

// ===== LOGOUT API - User Logout =====
router.post('/auth/logout', authenticateToken, (req, res) => {
  const userId = req.user?.userId;
  const userEmail = req.user?.email;
  
  console.log(`🚪 Logout request from user: ${userEmail} (ID: ${userId})`);
  
  // In a real application, you would:
  // 1. Blacklist the token
  // 2. Clear server-side sessions
  // 3. Update last logout time in database
  // 4. Clear any active timers or sessions
  
  // For this implementation, we'll clear any active timers
  if (userId && persistentTimers[userId] && persistentTimers[userId].isActive) {
    console.log(`⏰ Auto-stopping active timer for user ${userId} during logout`);
    
    // Calculate and save final timer state
    const timerData = persistentTimers[userId];
    const now = new Date();
    const startTime = new Date(timerData.startTime);
    const durationMs = now - startTime - (timerData.totalPausedTime || 0);
    const durationSeconds = Math.floor(durationMs / 1000);
    
    // Store final timer state
    persistentTimers[userId] = {
      ...timerData,
      isActive: false,
      isPaused: false,
      totalTime: (timerData.totalTime || 0) + durationSeconds,
      endTime: now,
      stoppedAt: now.toISOString(),
      status: 'auto_stopped_logout'
    };
    
    savePersistentData();
  }
  
  // Update user's last logout time
  if (userId && persistentUsers[userId]) {
    persistentUsers[userId].last_logout = new Date().toISOString();
    savePersistentData();
  }
  
  console.log(`✅ User ${userEmail} logged out successfully`);
  
  res.json({
    success: true,
    message: 'Logout successful',
    data: {
      logged_out: true,
      logout_time: new Date().toISOString(),
      message: 'You have been successfully logged out',
      next_steps: [
        'Clear local storage/session storage',
        'Redirect to login page',
        'Remove authorization headers'
      ]
    }
  });
});

// ===== REFRESH TOKEN API - Get new access token using refresh token =====
router.post('/auth/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required'
    });
  }

  try {
    // Verify the refresh token
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);

    if (decoded.type !== 'refresh') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Verify user still exists and is active
    let userResult = await pool.query(
      'SELECT id, email, full_name, tenant_id, role, status FROM employees WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'SELECT id, email, name as full_name, tenant_id, role FROM company_details WHERE id = $1',
        [decoded.userId]
      );
    }

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }

    const user = userResult.rows[0];

    // Generate new access token
    const newTokenPayload = {
      userId: user.id,
      email: user.email,
      name: user.full_name,
      tenantId: user.tenant_id,
      userType: decoded.userType
    };
    const newToken = jwt.sign(newTokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const newRefreshToken = jwt.sign({ ...newTokenPayload, type: 'refresh' }, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });

    console.log(`🔄 Token refreshed for: ${user.full_name} (ID: ${user.id})`);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        tokenExpiresIn: '24h',
        refreshTokenExpiresIn: '30d',
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          tenantId: user.tenant_id
        }
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired. Please login again.'
      });
    }
    console.error('❌ Refresh token error:', error);
    return res.status(403).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
});

// ===== BULK TIMER SYNC API - Sync multiple offline time entries =====
router.post('/timer/sync', authenticateToken, async (req, res) => {
  const userId = req.user?.userId;
  const tenantId = req.user?.tenantId;
  const { entries } = req.body;

  console.log(`🔄 Bulk timer sync request for user ${userId} - Entries: ${entries?.length || 0}`);

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'entries array is required with at least one entry',
      data: {
        example: {
          entries: [
            {
              clock_in: '2026-03-06T08:00:00.000Z',
              clock_out: '2026-03-06T12:30:00.000Z',
              date: '2026-03-06',
              work_duration_seconds: 16200,
              total_paused_seconds: 900,
              duration_minutes: 270,
              project_id: null,
              work_location: 'office',
              description: 'Working on feature',
              notes: 'Completed task',
              source: 'PWA_OFFLINE',
              breaks: [
                {
                  break_type: 'lunch',
                  start_time: '2026-03-06T12:00:00.000Z',
                  end_time: '2026-03-06T12:30:00.000Z',
                  duration_seconds: 1800
                }
              ]
            }
          ]
        }
      }
    });
  }

  // Limit bulk sync to 50 entries at a time
  if (entries.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Maximum 50 entries can be synced at once'
    });
  }

  try {
    // Get actual employee_id
    const empResult = await pool.query(
      'SELECT employee_id FROM employees WHERE id = $1 AND tenant_id::integer = $2',
      [userId, tenantId]
    );
    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    const actualEmployeeId = empResult.rows[0].employee_id;

    const syncedEntries = [];
    const failedEntries = [];
    const duplicateEntries = [];

    for (const entry of entries) {
      try {
        if (!entry.clock_in || !entry.clock_out || !entry.date) {
          failedEntries.push({ entry, error: 'Missing required fields: clock_in, clock_out, date' });
          continue;
        }

        // Check for duplicate entries (same employee, same clock_in time)
        const dupCheck = await pool.query(
          `SELECT id FROM timers WHERE employee_id = $1 AND clock_in = $2 LIMIT 1`,
          [actualEmployeeId, entry.clock_in]
        );
        if (dupCheck.rows.length > 0) {
          duplicateEntries.push({
            existing_id: dupCheck.rows[0].id,
            date: entry.date,
            clock_in: entry.clock_in,
            message: 'Entry already exists'
          });
          continue;
        }

        // Calculate durations
        const clockIn = new Date(entry.clock_in);
        const clockOut = new Date(entry.clock_out);
        const totalSeconds = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
        const workDurationSeconds = entry.work_duration_seconds ?? totalSeconds;
        const totalPausedSeconds = entry.total_paused_seconds ?? 0;
        const durationMinutes = entry.duration_minutes ?? Math.floor(workDurationSeconds / 60);

        const timerResult = await pool.query(
          `INSERT INTO timers (
            employee_id, date, clock_in, clock_out, duration_minutes,
            work_duration_seconds, total_paused_seconds, source,
            description, notes, work_location, project_id,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id`,
          [
            actualEmployeeId, entry.date, entry.clock_in, entry.clock_out,
            durationMinutes, workDurationSeconds, totalPausedSeconds,
            entry.source || 'PWA_OFFLINE',
            entry.description || null, entry.notes || null,
            entry.work_location || 'office', entry.project_id || null,
            new Date().toISOString(), new Date().toISOString()
          ]
        );

        const timerId = timerResult.rows[0].id;

        // Insert breaks if provided
        if (entry.breaks && Array.isArray(entry.breaks)) {
          for (const brk of entry.breaks) {
            if (brk.start_time && brk.end_time) {
              const brkDuration = brk.duration_seconds ?? Math.floor((new Date(brk.end_time).getTime() - new Date(brk.start_time).getTime()) / 1000);
              let breakTypeId = brk.break_type_id || null;
              if (!breakTypeId && brk.break_type) {
                const btLookup = await pool.query(
                  'SELECT id FROM break_types WHERE name = $1 AND is_active = true LIMIT 1',
                  [brk.break_type]
                );
                if (btLookup.rows.length > 0) breakTypeId = btLookup.rows[0].id;
              }
              await pool.query(
                `INSERT INTO breaks (
                  timer_record_id, employee_id, break_type, break_type_id,
                  start_time, end_time, duration_seconds, description, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [timerId, actualEmployeeId, brk.break_type || 'pause', breakTypeId,
                 brk.start_time, brk.end_time, brkDuration, brk.description || null, new Date().toISOString()]
              );
            }
          }
        }

        syncedEntries.push({
          id: timerId,
          date: entry.date,
          clock_in: entry.clock_in,
          clock_out: entry.clock_out,
          duration_minutes: durationMinutes,
          breaks_count: entry.breaks?.length || 0,
          source: entry.source || 'PWA_OFFLINE'
        });
      } catch (entryError) {
        failedEntries.push({ entry: { date: entry.date, clock_in: entry.clock_in }, error: entryError.message });
      }
    }

    console.log(`📊 Bulk sync complete: ${syncedEntries.length} synced, ${duplicateEntries.length} duplicates, ${failedEntries.length} failed`);

    res.json({
      success: syncedEntries.length > 0 || duplicateEntries.length > 0,
      message: `Sync complete: ${syncedEntries.length} synced, ${duplicateEntries.length} duplicates skipped, ${failedEntries.length} failed`,
      data: {
        synced_count: syncedEntries.length,
        duplicate_count: duplicateEntries.length,
        failed_count: failedEntries.length,
        total_submitted: entries.length,
        synced_entries: syncedEntries,
        duplicate_entries: duplicateEntries.length > 0 ? duplicateEntries : undefined,
        failed_entries: failedEntries.length > 0 ? failedEntries : undefined
      }
    });
  } catch (error) {
    console.error('❌ Bulk timer sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync timer entries',
      error: error.message
    });
  }
});

// ===== FORGOT PASSWORD API - Password Reset Request =====
router.post('/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  
  console.log(`🔐 Forgot password request for: ${email}`);
  
  // Validate email
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
      data: {
        required_fields: ['email']
      }
    });
  }
  
  // Check if user exists
  const user = Object.values(persistentUsers).find(user => user.email === email);
  
  if (!user) {
    // For security, we don't reveal if email exists or not
    console.log(`⚠️ Password reset requested for non-existent email: ${email}`);
  } else {
    console.log(`✅ Password reset token generated for user: ${user.full_name} (${email})`);
    
    // In a real application, you would:
    // 1. Generate a secure reset token
    // 2. Store it with expiration time
    // 3. Send email with reset link
    // 4. For demo purposes, we'll simulate this
    
    // Generate mock reset token
    const resetToken = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        purpose: 'password_reset' 
      }, 
      JWT_SECRET, 
      { expiresIn: '1h' }
    );
    
    // Store reset token (in real app, this would be in database with expiration)
    if (!persistentUsers[user.id].reset_tokens) {
      persistentUsers[user.id].reset_tokens = [];
    }
    persistentUsers[user.id].reset_tokens.push({
      token: resetToken,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      used: false
    });
    
    savePersistentData();
  }
  
  // Always return the same response for security (don't reveal if email exists)
  res.json({
    success: true,
    message: 'If your email is registered, you will receive password reset instructions',
    data: {
      email: email,
      instruction: 'Check your email for password reset instructions',
      estimated_delivery: '2-5 minutes',
      reset_link_validity: '1 hour',
      demo_note: 'This is a demo API. In production, an actual email would be sent.',
      ...(user && {
        demo_reset_token: `For demo purposes, your reset token is: ${jwt.sign({ userId: user.id, email: user.email, purpose: 'password_reset' }, JWT_SECRET, { expiresIn: '1h' })}`,
        demo_reset_url: `https://your-frontend.com/reset-password?token=${jwt.sign({ userId: user.id, email: user.email, purpose: 'password_reset' }, JWT_SECRET, { expiresIn: '1h' })}`
      })
    }
  });
});

// ===== RESET PASSWORD API - Complete Password Reset =====
router.post('/auth/reset-password', (req, res) => {
  const { token, new_password, confirm_password } = req.body;
  
  console.log(`🔓 Password reset attempt with token`);
  
  // Validate required fields
  if (!token || !new_password || !confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'Token, new password, and password confirmation are required',
      data: {
        required_fields: ['token', 'new_password', 'confirm_password']
      }
    });
  }
  
  // Check if passwords match
  if (new_password !== confirm_password) {
    return res.status(400).json({
      success: false,
      message: 'Password confirmation does not match',
      data: {
        error: 'password_mismatch'
      }
    });
  }
  
  // Validate password strength (basic validation)
  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long',
      data: {
        error: 'password_too_weak',
        requirements: ['At least 6 characters']
      }
    });
  }
  
  // Verify reset token
  let tokenData;
  try {
    tokenData = jwt.verify(token, JWT_SECRET);
    
    if (tokenData.purpose !== 'password_reset') {
      throw new Error('Invalid token purpose');
    }
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired reset token',
      data: {
        error: 'invalid_token'
      }
    });
  }
  
  // Find user
  const user = persistentUsers[tokenData.userId];
  if (!user || user.email !== tokenData.email) {
    return res.status(400).json({
      success: false,
      message: 'Invalid reset token',
      data: {
        error: 'user_not_found'
      }
    });
  }
  
  // Update password
  user.password = new_password; // In production, hash this!
  user.password_updated_at = new Date().toISOString();
  
  // Invalidate all reset tokens
  if (user.reset_tokens) {
    user.reset_tokens = user.reset_tokens.map(rt => ({ ...rt, used: true }));
  }
  
  savePersistentData();
  
  console.log(`✅ Password reset successful for user: ${user.full_name} (${user.email})`);
  
  res.json({
    success: true,
    message: 'Password reset successful',
    data: {
      user_id: user.id,
      email: user.email,
      password_updated: true,
      updated_at: user.password_updated_at,
      next_steps: [
        'Your password has been updated',
        'You can now login with your new password',
        'All reset tokens have been invalidated'
      ]
    }
  });
});


  return router;
};
