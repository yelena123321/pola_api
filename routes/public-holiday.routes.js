/**
 * public-holiday Routes
 * Auto-extracted from server.js
 */
const express = require('express');
const PublicHoliday = require('../models/PublicHoliday');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ===== GET ALL PUBLIC HOLIDAYS =====
router.get('/public-holidays', authenticateToken, async (req, res) => {
  try {
    const { 
      country_code, 
      region_code, 
      year, 
      is_movable,
      limit,
      offset 
    } = req.query;

    const holidays = await PublicHoliday.getAll({
      country_code,
      region_code,
      year: year ? parseInt(year) : null,
      is_movable: is_movable === 'true' ? true : is_movable === 'false' ? false : undefined,
      tenant_id: req.user.tenantId,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });

    res.json({
      success: true,
      data: holidays,
      count: holidays.length,
      filters: { country_code, region_code, year, is_movable }
    });
  } catch (error) {
    console.error('Error fetching public holidays:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public holidays',
      error: error.message
    });
  }
});

// ===== GET PUBLIC HOLIDAYS BY YEAR AND REGION =====
router.get('/public-holidays/:year', authenticateToken, async (req, res) => {
  try {
    const { year } = req.params;
    const { country_code = 'CH', region_code } = req.query;

    const holidays = await PublicHoliday.getByYearAndRegion(
      parseInt(year),
      country_code,
      region_code,
      req.user.tenantId
    );

    res.json({
      success: true,
      data: holidays,
      count: holidays.length,
      year: parseInt(year),
      country_code,
      region_code: region_code || 'All'
    });
  } catch (error) {
    console.error('Error fetching holidays by year:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holidays for specified year',
      error: error.message
    });
  }
});

// ===== GET REGIONS/CANTONS =====
router.get('/public-holidays/regions/:country_code', authenticateToken, async (req, res) => {
  try {
    const { country_code } = req.params;
    const regions = await PublicHoliday.getRegions(country_code);

    res.json({
      success: true,
      data: regions,
      count: regions.length,
      country_code
    });
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch regions',
      error: error.message
    });
  }
});

// ===== SEARCH PUBLIC HOLIDAYS =====
router.get('/public-holidays/search/:term', authenticateToken, async (req, res) => {
  try {
    const { term } = req.params;
    const { country_code } = req.query;

    const holidays = await PublicHoliday.search(term, country_code, req.user.tenantId);

    res.json({
      success: true,
      data: holidays,
      count: holidays.length,
      search_term: term
    });
  } catch (error) {
    console.error('Error searching holidays:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search holidays',
      error: error.message
    });
  }
});

// ===== GET SINGLE PUBLIC HOLIDAY BY ID =====
router.get('/public-holidays/detail/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const holiday = await PublicHoliday.getById(parseInt(id));

    if (!holiday) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    res.json({
      success: true,
      data: holiday
    });
  } catch (error) {
    console.error('Error fetching holiday by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holiday',
      error: error.message
    });
  }
});

// ===== CREATE NEW PUBLIC HOLIDAY (Admin Only) =====
router.post('/admin/public-holidays', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    // Drop FK constraints (admin is in company_details, not employees; tenant not in tenants table)
    await pool.query('ALTER TABLE public_holiday DROP CONSTRAINT IF EXISTS public_holiday_created_by_fkey');
    await pool.query('ALTER TABLE public_holiday DROP CONSTRAINT IF EXISTS public_holiday_updated_by_fkey');
    await pool.query('ALTER TABLE public_holiday DROP CONSTRAINT IF EXISTS public_holiday_tenant_id_fkey');

    const holidayData = {
      ...req.body,
      tenant_id: tenantId,
      created_by: userId
    };

    // Validate required fields
    if (!holidayData.name || !holidayData.country_code) {
      return res.status(400).json({
        success: false,
        message: 'Name and country_code are required'
      });
    }

    // Validate date logic
    if (!holidayData.is_movable && !holidayData.date_fixed) {
      return res.status(400).json({
        success: false,
        message: 'date_fixed is required for non-movable holidays'
      });
    }

    if (holidayData.is_movable && !holidayData.calculation_formula) {
      return res.status(400).json({
        success: false,
        message: 'calculation_formula is required for movable holidays'
      });
    }

    const newHoliday = await PublicHoliday.create(holidayData);

    res.status(201).json({
      success: true,
      message: 'Public holiday created successfully',
      data: newHoliday
    });
  } catch (error) {
    console.error('Error creating public holiday:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create public holiday',
      error: error.message
    });
  }
});

// ===== UPDATE PUBLIC HOLIDAY (Admin Only) =====
router.put('/admin/public-holidays/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;
    const holidayData = {
      ...req.body,
      tenant_id: tenantId,
      updated_by: userId
    };

    const updatedHoliday = await PublicHoliday.update(parseInt(id), holidayData);

    if (!updatedHoliday) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    res.json({
      success: true,
      message: 'Public holiday updated successfully',
      data: updatedHoliday
    });
  } catch (error) {
    console.error('Error updating public holiday:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update public holiday',
      error: error.message
    });
  }
});

// ===== DELETE PUBLIC HOLIDAY (Admin Only) =====
router.delete('/admin/public-holidays/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { hard_delete } = req.query;

    const success = await PublicHoliday.delete(
      parseInt(id), 
      hard_delete === 'true'
    );

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    res.json({
      success: true,
      message: hard_delete === 'true' 
        ? 'Holiday permanently deleted' 
        : 'Holiday deactivated successfully'
    });
  } catch (error) {
    console.error('Error deleting public holiday:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete public holiday',
      error: error.message
    });
  }
});

// ===== FIX NULL TENANT_ID IN PUBLIC HOLIDAYS (Admin Only) =====
router.post('/admin/public-holidays/fix-tenant-id', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'No tenant_id found in your account'
      });
    }

    // Update all public_holiday records with NULL tenant_id
    const result = await pool.query(
      `UPDATE public_holiday 
       SET tenant_id = $1, updated_by = $2, updated_at = NOW() 
       WHERE tenant_id IS NULL
       RETURNING id, name`,
      [tenantId, userId]
    );

    res.json({
      success: true,
      message: `Updated ${result.rowCount} public holidays with tenant_id`,
      data: {
        updated_count: result.rowCount,
        tenant_id: tenantId,
        updated_holidays: result.rows
      }
    });
  } catch (error) {
    console.error('Error fixing tenant_id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix tenant_id',
      error: error.message
    });
  }
});

// =====================================================================================
// ABSENCE MANAGEMENT APIs
// =====================================================================================
const AbsenceEntry = require('../models/AbsenceEntry');


  return router;
};
