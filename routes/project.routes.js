/**
 * project Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== PROJECT MANAGEMENT APIs =====
// GET User's Projects (User-Specific)
router.get('/me/projects', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    // First check if project_employees table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'project_employees'
      )
    `);
    
    let projects = [];
    
    if (tableCheck.rows[0].exists) {
      // Get projects assigned to this employee
      const result = await pool.query(`
        SELECT 
          p.id,
          p.name,
          p.description,
          p.color,
          p.status,
          pe.role as project_role,
          pe.assigned_at
        FROM projects p
        JOIN project_employees pe ON p.id = pe.project_id
        WHERE pe.employee_id = $1 AND p.status = 'active'
        ORDER BY pe.assigned_at DESC
      `, [userId]);
      
      projects = result.rows;
    }
    
    // If no assigned projects, show all active projects for this tenant (fallback)
    if (projects.length === 0) {
      const allProjects = await pool.query(`
        SELECT 
          id,
          name,
          description,
          color,
          status
        FROM projects 
        WHERE status = 'active' AND tenant_id::integer = $1
        ORDER BY name
      `, [req.user.tenantId]);
      projects = allProjects.rows;
    }
    
    res.json({
      success: true,
      message: 'User projects retrieved successfully',
      data: {
        projects: projects,
        total: projects.length,
        userId: userId
      }
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch projects',
      error: error.message
    });
  }
});

// ===== LOCATIONS API (For Dropdown) =====
router.get('/locations', authenticateToken, (req, res) => {
  const locations = [
    {
      id: 1,
      name: "Office",
      description: "Main office location",
      icon: "🏢",
      address: "Company Headquarters",
      type: "physical"
    },
    {
      id: 2,
      name: "Home",
      description: "Work from home",
      icon: "🏠",
      address: "Remote - Home Office",
      type: "remote"
    },
    {
      id: 3,
      name: "Client Site",
      description: "At client premises",
      icon: "🏬",
      address: "Client Office Location",
      type: "physical"
    },
    {
      id: 4,
      name: "Remote",
      description: "Other remote location",
      icon: "🌍",
      address: "Any Remote Location",
      type: "remote"
    }
  ];

  res.json({
    success: true,
    message: 'Work locations retrieved successfully',
    data: {
      locations: locations,
      total: locations.length
    }
  });
});

// ===== LOCATION MANAGEMENT APIs =====
// GET Location Details
router.get('/me/location', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user?.tenantId;
  let user = persistentUsers[userId];
  
  // DB fallback if not in memory
  if (!user) {
    try {
      let result = await pool.query('SELECT * FROM employees WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
      if (result.rows.length > 0) {
        user = result.rows[0];
        persistentUsers[userId] = user;
      } else {
        let cdResult = await pool.query('SELECT * FROM company_details WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
        if (cdResult.rows.length > 0) {
          user = cdResult.rows[0];
          persistentUsers[userId] = user;
        }
      }
    } catch (e) {
      console.error('Location user lookup error:', e.message);
    }
  }
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    message: 'Location retrieved successfully',
    data: {
      location: user.location || 'Not specified',
      timezone: user.timezone || 'UTC',
      office: user.office || 'Remote',
      address: user.address || null,
      city: user.city || null,
      state: user.state || null,
      country: user.country || null,
      postal_code: user.postal_code || null
    }
  });
});

// PUT Update Location
router.put('/me/location', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const user = persistentUsers[userId];
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const {
    location,
    timezone,
    office,
    address,
    city,
    state,
    country,
    postal_code
  } = req.body;

  // Update location fields
  if (location !== undefined) user.location = location;
  if (timezone !== undefined) user.timezone = timezone;
  if (office !== undefined) user.office = office;
  if (address !== undefined) user.address = address;
  if (city !== undefined) user.city = city;
  if (state !== undefined) user.state = state;
  if (country !== undefined) user.country = country;
  if (postal_code !== undefined) user.postal_code = postal_code;

  // Save changes
  savePersistentData();

  console.log(`✅ Location updated for user ${userId}: ${location || 'Not specified'}`);

  res.json({
    success: true,
    message: 'Location updated successfully',
    data: {
      location: user.location || 'Not specified',
      timezone: user.timezone || 'UTC',
      office: user.office || 'Remote',
      address: user.address || null,
      city: user.city || null,
      state: user.state || null,
      country: user.country || null,
      postal_code: user.postal_code || null
    }
  });
});


  return router;
};
