/**
 * Holiday Controller
 * Handles all holiday management operations with Swiss canton support
 */

const { pool } = require('../config/database');
const {
  getHolidayDate,
  formatDateISO,
  getDayOfWeek,
  isValidCanton,
  getSwissCantons
} = require('../utils/dateUtils');

/**
 * GET /api/holidays
 * Fetch holidays filtered by canton and year
 * Query params: canton (optional), year (optional, default: current year)
 */
const getHolidays = async (req, res) => {
  try {
    const { canton, year: yearParam, type, include_optional } = req.query;
    const year = parseInt(yearParam, 10) || new Date().getFullYear();

    // Validate canton if provided
    if (canton && !isValidCanton(canton)) {
      return res.status(400).json({
        success: false,
        message: `Invalid canton code: ${canton}`,
        valid_cantons: getSwissCantons()
      });
    }

    // Build query based on filters
    let query = `
      SELECT 
        id, 
        name, 
        date_type, 
        fixed_date, 
        calculation, 
        applies_to, 
        excluded_cantons, 
        religion, 
        type, 
        is_optional,
        description
      FROM holidays
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Filter by canton if provided
    if (canton) {
      const cantonUpper = canton.toUpperCase();
      // Include if: (canton in applies_to OR 'ALL' in applies_to) AND canton NOT in excluded_cantons
      query += `
        AND (
          'ALL' = ANY(applies_to) 
          OR $${paramIndex} = ANY(applies_to)
        )
        AND (
          excluded_cantons IS NULL 
          OR NOT ($${paramIndex} = ANY(excluded_cantons))
        )
      `;
      params.push(cantonUpper);
      paramIndex++;
    }

    // Filter by type if provided
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Filter optional holidays
    if (include_optional !== 'true') {
      query += ` AND (is_optional = FALSE OR is_optional IS NULL)`;
    }

    query += ` ORDER BY 
      CASE 
        WHEN date_type = 'FIXED' THEN fixed_date 
        ELSE '99-99' 
      END,
      name
    `;

    const result = await pool.query(query, params);

    // Calculate actual dates and format response
    const holidays = result.rows.map(holiday => {
      const date = getHolidayDate(holiday, year);
      return {
        id: holiday.id,
        name: holiday.name,
        date: formatDateISO(date),
        day_of_week: getDayOfWeek(date),
        type: holiday.type,
        date_type: holiday.date_type,
        religion: holiday.religion,
        is_optional: holiday.is_optional,
        description: holiday.description,
        applies_to: holiday.applies_to,
        excluded_cantons: holiday.excluded_cantons
      };
    }).filter(h => h.date !== null) // Remove holidays with invalid dates
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort by date

    return res.status(200).json({
      success: true,
      year,
      canton: canton ? canton.toUpperCase() : 'ALL',
      count: holidays.length,
      holidays
    });

  } catch (error) {
    console.error('Error fetching holidays:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch holidays',
      error: error.message
    });
  }
};

/**
 * GET /api/holidays/:id
 * Get single holiday by ID
 */
const getHolidayById = async (req, res) => {
  try {
    const { id } = req.params;
    const { year: yearParam } = req.query;
    const year = parseInt(yearParam, 10) || new Date().getFullYear();

    const result = await pool.query(
      `SELECT * FROM holidays WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Holiday with ID ${id} not found`
      });
    }

    const holiday = result.rows[0];
    const date = getHolidayDate(holiday, year);

    return res.status(200).json({
      success: true,
      holiday: {
        ...holiday,
        calculated_date: formatDateISO(date),
        day_of_week: getDayOfWeek(date),
        year
      }
    });

  } catch (error) {
    console.error('Error fetching holiday:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch holiday',
      error: error.message
    });
  }
};

/**
 * POST /api/holidays
 * Create a new holiday
 */
const createHoliday = async (req, res) => {
  try {
    const {
      name,
      date_type = 'FIXED',
      fixed_date,
      calculation,
      applies_to = ['ALL'],
      excluded_cantons,
      religion,
      type = 'Regional',
      is_optional = false,
      description
    } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Holiday name is required'
      });
    }

    if (!['FIXED', 'MOVABLE'].includes(date_type)) {
      return res.status(400).json({
        success: false,
        message: 'date_type must be FIXED or MOVABLE'
      });
    }

    if (date_type === 'FIXED' && !fixed_date) {
      return res.status(400).json({
        success: false,
        message: 'fixed_date (MM-DD format) is required for FIXED date_type'
      });
    }

    if (date_type === 'MOVABLE' && !calculation) {
      return res.status(400).json({
        success: false,
        message: 'calculation (e.g., EASTER+1) is required for MOVABLE date_type'
      });
    }

    // Validate fixed_date format
    if (fixed_date && !/^\d{2}-\d{2}$/.test(fixed_date)) {
      return res.status(400).json({
        success: false,
        message: 'fixed_date must be in MM-DD format (e.g., 01-01, 08-15)'
      });
    }

    // Validate calculation format
    if (calculation && !/^EASTER([+-]\d+)?$/i.test(calculation)) {
      return res.status(400).json({
        success: false,
        message: 'calculation must be EASTER or EASTER+/-N format (e.g., EASTER, EASTER+1, EASTER-2)'
      });
    }

    const result = await pool.query(
      `INSERT INTO holidays (
        name, date_type, fixed_date, calculation, 
        applies_to, excluded_cantons, religion, 
        type, is_optional, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        name.trim(),
        date_type,
        date_type === 'FIXED' ? fixed_date : null,
        date_type === 'MOVABLE' ? calculation.toUpperCase() : null,
        applies_to,
        excluded_cantons || null,
        religion || null,
        type,
        is_optional,
        description || null
      ]
    );

    const newHoliday = result.rows[0];
    const year = new Date().getFullYear();
    const date = getHolidayDate(newHoliday, year);

    return res.status(201).json({
      success: true,
      message: 'Holiday created successfully',
      holiday: {
        ...newHoliday,
        calculated_date: formatDateISO(date),
        day_of_week: getDayOfWeek(date),
        year
      }
    });

  } catch (error) {
    console.error('Error creating holiday:', error);
    
    // Handle enum type error
    if (error.code === '22P02') {
      return res.status(400).json({
        success: false,
        message: 'Invalid date_type value. Must be FIXED or MOVABLE'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create holiday',
      error: error.message
    });
  }
};

/**
 * PUT /api/holidays/:id
 * Update an existing holiday
 */
const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      date_type,
      fixed_date,
      calculation,
      applies_to,
      excluded_cantons,
      religion,
      type,
      is_optional,
      description
    } = req.body;

    // Check if holiday exists
    const existingResult = await pool.query(
      `SELECT * FROM holidays WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Holiday with ID ${id} not found`
      });
    }

    const existing = existingResult.rows[0];

    // Merge with existing values
    const updatedDateType = date_type || existing.date_type;
    const updatedFixedDate = updatedDateType === 'FIXED' 
      ? (fixed_date !== undefined ? fixed_date : existing.fixed_date) 
      : null;
    const updatedCalculation = updatedDateType === 'MOVABLE' 
      ? (calculation !== undefined ? calculation?.toUpperCase() : existing.calculation) 
      : null;

    // Validation
    if (updatedDateType === 'FIXED' && !updatedFixedDate) {
      return res.status(400).json({
        success: false,
        message: 'fixed_date is required for FIXED date_type'
      });
    }

    if (updatedDateType === 'MOVABLE' && !updatedCalculation) {
      return res.status(400).json({
        success: false,
        message: 'calculation is required for MOVABLE date_type'
      });
    }

    const result = await pool.query(
      `UPDATE holidays SET
        name = $1,
        date_type = $2,
        fixed_date = $3,
        calculation = $4,
        applies_to = $5,
        excluded_cantons = $6,
        religion = $7,
        type = $8,
        is_optional = $9,
        description = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *`,
      [
        name !== undefined ? name.trim() : existing.name,
        updatedDateType,
        updatedFixedDate,
        updatedCalculation,
        applies_to !== undefined ? applies_to : existing.applies_to,
        excluded_cantons !== undefined ? excluded_cantons : existing.excluded_cantons,
        religion !== undefined ? religion : existing.religion,
        type !== undefined ? type : existing.type,
        is_optional !== undefined ? is_optional : existing.is_optional,
        description !== undefined ? description : existing.description,
        id
      ]
    );

    const updatedHoliday = result.rows[0];
    const year = new Date().getFullYear();
    const date = getHolidayDate(updatedHoliday, year);

    return res.status(200).json({
      success: true,
      message: 'Holiday updated successfully',
      holiday: {
        ...updatedHoliday,
        calculated_date: formatDateISO(date),
        day_of_week: getDayOfWeek(date),
        year
      }
    });

  } catch (error) {
    console.error('Error updating holiday:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update holiday',
      error: error.message
    });
  }
};

/**
 * DELETE /api/holidays/:id
 * Delete a holiday
 */
const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM holidays WHERE id = $1 RETURNING id, name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Holiday with ID ${id} not found`
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Holiday deleted successfully',
      deleted: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting holiday:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete holiday',
      error: error.message
    });
  }
};

/**
 * GET /api/holidays/cantons
 * Get list of all Swiss cantons
 */
const getCantons = async (req, res) => {
  const cantons = [
    { code: 'ZH', name: 'Zürich' },
    { code: 'BE', name: 'Bern' },
    { code: 'LU', name: 'Luzern' },
    { code: 'UR', name: 'Uri' },
    { code: 'SZ', name: 'Schwyz' },
    { code: 'OW', name: 'Obwalden' },
    { code: 'NW', name: 'Nidwalden' },
    { code: 'GL', name: 'Glarus' },
    { code: 'ZG', name: 'Zug' },
    { code: 'FR', name: 'Fribourg' },
    { code: 'SO', name: 'Solothurn' },
    { code: 'BS', name: 'Basel-Stadt' },
    { code: 'BL', name: 'Basel-Landschaft' },
    { code: 'SH', name: 'Schaffhausen' },
    { code: 'AR', name: 'Appenzell Ausserrhoden' },
    { code: 'AI', name: 'Appenzell Innerrhoden' },
    { code: 'SG', name: 'St. Gallen' },
    { code: 'GR', name: 'Graubünden' },
    { code: 'AG', name: 'Aargau' },
    { code: 'TG', name: 'Thurgau' },
    { code: 'TI', name: 'Ticino' },
    { code: 'VD', name: 'Vaud' },
    { code: 'VS', name: 'Valais' },
    { code: 'NE', name: 'Neuchâtel' },
    { code: 'GE', name: 'Geneva' },
    { code: 'JU', name: 'Jura' }
  ];

  return res.status(200).json({
    success: true,
    count: cantons.length,
    cantons
  });
};

/**
 * GET /api/holidays/upcoming
 * Get upcoming holidays for next N days
 */
const getUpcomingHolidays = async (req, res) => {
  try {
    const { canton, days = 30 } = req.query;
    const today = new Date();
    const year = today.getFullYear();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + parseInt(days, 10));

    // Build query
    let query = `SELECT * FROM holidays WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (canton) {
      const cantonUpper = canton.toUpperCase();
      query += `
        AND (
          'ALL' = ANY(applies_to) 
          OR $${paramIndex} = ANY(applies_to)
        )
        AND (
          excluded_cantons IS NULL 
          OR NOT ($${paramIndex} = ANY(excluded_cantons))
        )
      `;
      params.push(cantonUpper);
    }

    const result = await pool.query(query, params);

    // Calculate dates and filter upcoming
    const upcomingHolidays = result.rows
      .map(holiday => {
        const date = getHolidayDate(holiday, year);
        // Check next year too if end date crosses year boundary
        const dateNextYear = getHolidayDate(holiday, year + 1);
        
        return {
          id: holiday.id,
          name: holiday.name,
          date: formatDateISO(date),
          dateObj: date,
          day_of_week: getDayOfWeek(date),
          type: holiday.type,
          // Include next year date if within range
          dates: [
            { year, date: formatDateISO(date), dateObj: date },
            { year: year + 1, date: formatDateISO(dateNextYear), dateObj: dateNextYear }
          ]
        };
      })
      .flatMap(h => 
        h.dates
          .filter(d => d.dateObj >= today && d.dateObj <= endDate)
          .map(d => ({
            id: h.id,
            name: h.name,
            date: d.date,
            day_of_week: getDayOfWeek(d.dateObj),
            type: h.type,
            days_until: Math.ceil((d.dateObj - today) / (1000 * 60 * 60 * 24))
          }))
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.status(200).json({
      success: true,
      from: formatDateISO(today),
      to: formatDateISO(endDate),
      canton: canton ? canton.toUpperCase() : 'ALL',
      count: upcomingHolidays.length,
      holidays: upcomingHolidays
    });

  } catch (error) {
    console.error('Error fetching upcoming holidays:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming holidays',
      error: error.message
    });
  }
};

module.exports = {
  getHolidays,
  getHolidayById,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  getCantons,
  getUpcomingHolidays
};
