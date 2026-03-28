/**
 * absence Routes
 * Auto-extracted from server.js
 */
const express = require('express');
const AbsenceEntry = require('../models/AbsenceEntry');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== SETUP ABSENCE TABLES (One-time setup endpoint) =====
router.post('/admin/setup-absence-tables', authenticateToken, async (req, res) => {
  try {
    console.log('Setting up absence management tables...');
    
    // Create absence_duration_type table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS absence_duration_type (
        id SERIAL PRIMARY KEY,
        type_name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      INSERT INTO absence_duration_type (type_name, description) VALUES
      ('full_day', 'Full day absence'),
      ('half_day_morning', 'Half day - Morning'),
      ('half_day_afternoon', 'Half day - Afternoon'),
      ('hours', 'Specific hours'),
      ('multiple_days', 'Multiple consecutive days')
      ON CONFLICT (type_name) DO NOTHING
    `);
    
    // Create absence_type table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS absence_type (
        id SERIAL PRIMARY KEY,
        type_name VARCHAR(100) NOT NULL,
        type_code VARCHAR(50) UNIQUE,
        category VARCHAR(50),
        description TEXT,
        is_paid BOOLEAN DEFAULT TRUE,
        requires_approval BOOLEAN DEFAULT TRUE,
        requires_document BOOLEAN DEFAULT FALSE,
        max_days_per_year INTEGER,
        advance_notice_days INTEGER DEFAULT 0,
        color_code VARCHAR(7),
        icon VARCHAR(50),
        tenant_id INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      INSERT INTO absence_type (type_name, type_code, category, description, is_paid, requires_approval, requires_document, color_code) VALUES
      ('Krankheit (GAV)', 'GAV_SICK', 'medical', 'Sick leave per GAV', TRUE, TRUE, TRUE, '#FF6B6B'),
      ('Unfall (GAV)', 'GAV_ACCIDENT', 'medical', 'Accident leave per GAV', TRUE, TRUE, TRUE, '#FF4444'),
      ('Mutterschaft (GAV)', 'GAV_MATERNITY', 'statutory', 'Maternity leave per GAV', TRUE, TRUE, TRUE, '#FF69B4'),
      ('Vaterschaft (GAV)', 'GAV_PATERNITY', 'statutory', 'Paternity leave per GAV', TRUE, TRUE, FALSE, '#4169E1'),
      ('Militärdienst (EO)', 'EO_MILITARY', 'statutory', 'Military service', TRUE, TRUE, TRUE, '#228B22'),
      ('Zivildienst (EO)', 'EO_CIVIL', 'statutory', 'Civil service', TRUE, TRUE, TRUE, '#32CD32'),
      ('Zivilschutz (EO)', 'EO_CIVIL_DEFENSE', 'statutory', 'Civil defense', TRUE, TRUE, TRUE, '#90EE90'),
      ('Arzttermin', 'MEDICAL_APPOINTMENT', 'medical', 'Doctor appointment', TRUE, FALSE, FALSE, '#FFA07A'),
      ('Krankenhausaufenthalt', 'HOSPITAL_STAY', 'medical', 'Hospital stay', TRUE, TRUE, TRUE, '#DC143C'),
      ('Rehabilitation', 'REHABILITATION', 'medical', 'Rehabilitation', TRUE, TRUE, TRUE, '#CD5C5C'),
      ('Quarantäne', 'QUARANTINE', 'medical', 'Quarantine', TRUE, TRUE, TRUE, '#FF8C00'),
      ('Jahresurlaub', 'ANNUAL_LEAVE', 'vacation', 'Annual vacation', TRUE, TRUE, FALSE, '#4CAF50'),
      ('Unbezahlter Urlaub', 'UNPAID_LEAVE', 'unpaid', 'Unpaid leave', FALSE, TRUE, FALSE, '#9E9E9E'),
      ('Sonderurlaub', 'SPECIAL_LEAVE', 'special', 'Special leave', TRUE, TRUE, FALSE, '#9C27B0'),
      ('Bildungsurlaub', 'EDUCATION_LEAVE', 'education', 'Education leave', TRUE, TRUE, TRUE, '#2196F3'),
      ('Homeoffice', 'HOME_OFFICE', 'remote', 'Work from home', TRUE, FALSE, FALSE, '#00BCD4'),
      ('Geschäftsreise', 'BUSINESS_TRIP', 'business', 'Business trip', TRUE, FALSE, FALSE, '#FF9800'),
      ('Gleitzeit', 'FLEXTIME', 'flexible', 'Flextime', TRUE, FALSE, FALSE, '#673AB7')
      ON CONFLICT (type_code) DO NOTHING
    `);
    
    // Create absence_entry table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS absence_entry (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL,
        absence_type_id INTEGER REFERENCES absence_type(id) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        duration_minutes INTEGER,
        duration_type_id INTEGER REFERENCES absence_duration_type(id),
        approval_status VARCHAR(20) DEFAULT 'pending',
        approved_by INTEGER,
        approved_at TIMESTAMP WITH TIME ZONE,
        rejection_reason TEXT,
        remarks TEXT,
        document_url TEXT,
        tenant_id INTEGER,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT check_dates CHECK (end_date >= start_date),
        CONSTRAINT check_approval_status CHECK (approval_status IN ('pending', 'approved', 'rejected', 'cancelled'))
      )
    `);
    
    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_absence_entry_employee ON absence_entry(employee_id);
      CREATE INDEX IF NOT EXISTS idx_absence_entry_dates ON absence_entry(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_absence_entry_status ON absence_entry(approval_status);
      CREATE INDEX IF NOT EXISTS idx_absence_entry_type ON absence_entry(absence_type_id);
      CREATE INDEX IF NOT EXISTS idx_absence_type_active ON absence_type(is_active);
      CREATE INDEX IF NOT EXISTS idx_absence_type_category ON absence_type(category);
    `);
    
    // Get counts
    const durationCount = await pool.query('SELECT COUNT(*) FROM absence_duration_type');
    const typesCount = await pool.query('SELECT COUNT(*) FROM absence_type');
    
    res.json({
      success: true,
      message: 'Absence management tables created successfully',
      data: {
        duration_types: parseInt(durationCount.rows[0].count),
        absence_types: parseInt(typesCount.rows[0].count),
        tables_created: ['absence_duration_type', 'absence_type', 'absence_entry']
      }
    });
    
  } catch (error) {
    console.error('Error setting up absence tables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to setup absence tables',
      error: error.message
    });
  }
});

// ===== GET ALL ABSENCE ENTRIES =====
router.get('/absences', authenticateToken, async (req, res) => {
  try {
    const { 
      employee_id, 
      absence_type_id, 
      approval_status,
      start_date,
      end_date,
      limit,
      offset 
    } = req.query;

    const absences = await AbsenceEntry.getAll({
      employee_id: employee_id ? parseInt(employee_id) : null,
      absence_type_id: absence_type_id ? parseInt(absence_type_id) : null,
      approval_status,
      start_date,
      end_date,
      tenant_id: req.user.tenantId,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });

    res.json({
      success: true,
      data: absences,
      count: absences.length
    });
  } catch (error) {
    console.error('Error fetching absences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch absences',
      error: error.message
    });
  }
});

// ===== GET SINGLE ABSENCE BY ID =====
router.get('/absences/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const absence = await AbsenceEntry.getById(parseInt(id));

    if (!absence) {
      return res.status(404).json({
        success: false,
        message: 'Absence entry not found'
      });
    }

    res.json({
      success: true,
      data: absence
    });
  } catch (error) {
    console.error('Error fetching absence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch absence',
      error: error.message
    });
  }
});

// ===== GET MY ABSENCES =====
router.get('/me/absences', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.user.userId;
    const { start_date, end_date, year } = req.query;

    let absences;
    if (start_date && end_date) {
      absences = await AbsenceEntry.getByEmployeeAndDateRange(employeeId, start_date, end_date);
    } else {
      const currentYear = year || new Date().getFullYear();
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      absences = await AbsenceEntry.getByEmployeeAndDateRange(employeeId, yearStart, yearEnd);
    }

    res.json({
      success: true,
      data: absences,
      count: absences.length
    });
  } catch (error) {
    console.error('Error fetching my absences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your absences',
      error: error.message
    });
  }
});

// ===== GET MY ABSENCE STATISTICS =====
router.get('/me/absences/statistics', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.user.userId;
    const { year } = req.query;

    const stats = await AbsenceEntry.getEmployeeStatistics(
      employeeId, 
      year ? parseInt(year) : new Date().getFullYear()
    );

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching absence statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
});

// ===== GET PENDING APPROVALS =====
router.get('/absences/pending', authenticateToken, async (req, res) => {
  try {
    const { limit } = req.query;
    const pendingAbsences = await AbsenceEntry.getPendingApprovals(
      limit ? parseInt(limit) : 50
    );

    res.json({
      success: true,
      data: pendingAbsences,
      count: pendingAbsences.length
    });
  } catch (error) {
    console.error('Error fetching pending absences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending absences',
      error: error.message
    });
  }
});

// ===== GET ABSENCE TYPES =====
router.get('/absence-types', authenticateToken, async (req, res) => {
  try {
    const { active_only } = req.query;
    const types = await AbsenceEntry.getAbsenceTypes(active_only !== 'false', req.user.tenantId);

    res.json({
      success: true,
      data: types,
      count: types.length
    });
  } catch (error) {
    console.error('Error fetching absence types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch absence types',
      error: error.message
    });
  }
});

// ===== GET DURATION TYPES =====
router.get('/absence-duration-types', authenticateToken, async (req, res) => {
  try {
    const types = await AbsenceEntry.getDurationTypes();

    res.json({
      success: true,
      data: types,
      count: types.length
    });
  } catch (error) {
    console.error('Error fetching duration types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch duration types',
      error: error.message
    });
  }
});

// ===== CREATE NEW ABSENCE ENTRY =====
router.post('/absences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const absenceData = {
      ...req.body,
      employee_id: req.body.employee_id || userId, // Default to current user
      created_by: userId
    };

    // Validate required fields
    if (!absenceData.absence_type_id || !absenceData.start_date || !absenceData.end_date) {
      return res.status(400).json({
        success: false,
        message: 'absence_type_id, start_date, and end_date are required'
      });
    }

    const newAbsence = await AbsenceEntry.create(absenceData);

    res.status(201).json({
      success: true,
      message: 'Absence entry created successfully',
      data: newAbsence
    });
  } catch (error) {
    console.error('Error creating absence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create absence entry',
      error: error.message
    });
  }
});

// ===== UPDATE ABSENCE ENTRY =====
router.put('/absences/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const absenceData = {
      ...req.body,
      updated_by: userId
    };

    const updatedAbsence = await AbsenceEntry.update(parseInt(id), absenceData);

    if (!updatedAbsence) {
      return res.status(404).json({
        success: false,
        message: 'Absence entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Absence entry updated successfully',
      data: updatedAbsence
    });
  } catch (error) {
    console.error('Error updating absence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update absence entry',
      error: error.message
    });
  }
});

// ===== APPROVE/REJECT ABSENCE =====
router.put('/absences/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { status, rejection_reason } = req.body;

    if (!status || !['approved', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status required: approved, rejected, or cancelled'
      });
    }

    if (status === 'rejected' && !rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'rejection_reason is required when rejecting'
      });
    }

    const updatedAbsence = await AbsenceEntry.updateStatus(
      parseInt(id),
      status,
      userId,
      rejection_reason
    );

    if (!updatedAbsence) {
      return res.status(404).json({
        success: false,
        message: 'Absence entry not found'
      });
    }

    res.json({
      success: true,
      message: `Absence ${status} successfully`,
      data: updatedAbsence
    });
  } catch (error) {
    console.error('Error updating absence status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update absence status',
      error: error.message
    });
  }
});

// ===== DELETE ABSENCE ENTRY =====
router.delete('/absences/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await AbsenceEntry.delete(parseInt(id));

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Absence entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Absence entry deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting absence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete absence entry',
      error: error.message
    });
  }
});

// Holiday Management Routes


  return router;
};
