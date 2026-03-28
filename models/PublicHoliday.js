const { pool } = require('../config/database');

/**
 * PublicHoliday Model
 * 
 * Manages public holidays with support for:
 * - Multiple countries, regions, municipalities
 * - Fixed and movable holidays
 * - Dynamic date calculations
 * - Multi-tenant support
 */
class PublicHoliday {
  
  /**
   * Get all public holidays with optional filters
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Array of holidays
   */
  static async getAll(filters = {}) {
    const { 
      country_code, 
      region_code, 
      year,
      is_movable,
      is_active = true,
      tenant_id = null,
      limit = 100,
      offset = 0
    } = filters;

    let query = 'SELECT * FROM public_holiday WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (country_code) {
      query += ` AND country_code = $${paramIndex++}`;
      params.push(country_code);
    }

    if (region_code) {
      query += ` AND (region_code = $${paramIndex++} OR region_code IS NULL)`;
      params.push(region_code);
    }

    if (is_movable !== undefined) {
      query += ` AND is_movable = $${paramIndex++}`;
      params.push(is_movable);
    }

    if (is_active !== undefined) {
      query += ` AND is_active = $${paramIndex++}`;
      params.push(is_active);
    }

    if (tenant_id) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(tenant_id);
    }

    if (year) {
      query += ` AND (valid_from IS NULL OR valid_from = 0 OR valid_from <= $${paramIndex}) 
                 AND (valid_to IS NULL OR valid_to = 0 OR valid_to >= $${paramIndex++})`;
      params.push(year);
    }

    query += ` ORDER BY 
      CASE WHEN date_fixed ~ '^[0-9]{2}-[0-9]{2}$' 
        THEN TO_DATE(date_fixed || '-' || COALESCE($${paramIndex}::TEXT, '2026'), 'MM-DD-YYYY')
        ELSE NULL 
      END ASC NULLS LAST, 
      name ASC 
      LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`;
    
    params.push(year || new Date().getFullYear(), limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get a single holiday by ID
   * @param {number} id - Holiday ID
   * @returns {Promise<Object|null>} Holiday object or null
   */
  static async getById(id) {
    const query = 'SELECT * FROM public_holiday WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create a new public holiday
   * @param {Object} holidayData - Holiday data
   * @returns {Promise<Object>} Created holiday
   */
  static async create(holidayData) {
    const {
      name,
      description,
      country_code,
      region_code,
      local_code,
      applies_in,
      not_applies_in,
      date_fixed,
      is_movable = false,
      calculation_formula,
      valid_from,
      valid_to,
      tenant_id = null,
      is_active = true,
      created_by
    } = holidayData;

    const query = `
      INSERT INTO public_holiday (
        name, description, country_code, region_code, local_code,
        applies_in, not_applies_in, date_fixed, is_movable,
        calculation_formula, valid_from, valid_to, tenant_id,
        is_active, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
      RETURNING *
    `;

    const params = [
      name,
      description,
      country_code,
      region_code || null,
      local_code || null,
      applies_in || null,
      not_applies_in || null,
      date_fixed || null,
      is_movable,
      calculation_formula || null,
      valid_from || null,
      valid_to || null,
      tenant_id,
      is_active,
      created_by || null
    ];

    const result = await pool.query(query, params);
    return result.rows[0];
  }

  /**
   * Update an existing public holiday
   * @param {number} id - Holiday ID
   * @param {Object} holidayData - Updated holiday data
   * @returns {Promise<Object|null>} Updated holiday or null
   */
  static async update(id, holidayData) {
    const {
      name,
      description,
      country_code,
      region_code,
      local_code,
      applies_in,
      not_applies_in,
      date_fixed,
      is_movable,
      calculation_formula,
      valid_from,
      valid_to,
      tenant_id,
      is_active,
      updated_by
    } = holidayData;

    const query = `
      UPDATE public_holiday 
      SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        country_code = COALESCE($3, country_code),
        region_code = COALESCE($4, region_code),
        local_code = COALESCE($5, local_code),
        applies_in = COALESCE($6, applies_in),
        not_applies_in = COALESCE($7, not_applies_in),
        date_fixed = COALESCE($8, date_fixed),
        is_movable = COALESCE($9, is_movable),
        calculation_formula = COALESCE($10, calculation_formula),
        valid_from = COALESCE($11, valid_from),
        valid_to = COALESCE($12, valid_to),
        tenant_id = COALESCE($13, tenant_id),
        is_active = COALESCE($14, is_active),
        updated_by = COALESCE($15, updated_by),
        updated_at = NOW()
      WHERE id = $16
      RETURNING *
    `;

    const params = [
      name,
      description,
      country_code,
      region_code,
      local_code,
      applies_in,
      not_applies_in,
      date_fixed,
      is_movable,
      calculation_formula,
      valid_from,
      valid_to,
      tenant_id,
      is_active,
      updated_by,
      id
    ];

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Delete a public holiday (soft delete by default)
   * @param {number} id - Holiday ID
   * @param {boolean} hardDelete - If true, permanently delete
   * @returns {Promise<boolean>} Success status
   */
  static async delete(id, hardDelete = false) {
    if (hardDelete) {
      const query = 'DELETE FROM public_holiday WHERE id = $1 RETURNING id';
      const result = await pool.query(query, [id]);
      return result.rowCount > 0;
    } else {
      // Soft delete
      const query = 'UPDATE public_holiday SET is_active = FALSE WHERE id = $1 RETURNING id';
      const result = await pool.query(query, [id]);
      return result.rowCount > 0;
    }
  }

  /**
   * Get holidays for a specific year and region
   * @param {number} year - Year to get holidays for
   * @param {string} countryCode - Country code
   * @param {string} regionCode - Optional region code
   * @returns {Promise<Array>} Array of holidays for that year/region
   */
  static async getByYearAndRegion(year, countryCode, regionCode = null, tenantId = null) {
    let query = `
      SELECT * FROM public_holiday 
      WHERE country_code = $1 
        AND (valid_from IS NULL OR valid_from = 0 OR valid_from <= $2)
        AND (valid_to IS NULL OR valid_to = 0 OR valid_to >= $2)
        AND is_active = TRUE
    `;
    
    const params = [countryCode, year];
    let paramIndex = 3;
    
    if (regionCode) {
      query += ` AND (region_code IS NULL OR region_code = $${paramIndex})`;
      params.push(regionCode);
      paramIndex++;
    }

    if (tenantId) {
      query += ` AND tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }

    query += ` ORDER BY 
      CASE WHEN date_fixed IS NOT NULL 
        THEN TO_DATE(date_fixed || '-' || $2::TEXT, 'MM-DD-YYYY')
        ELSE NULL 
      END ASC NULLS LAST`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get all regions/cantons for a country
   * @param {string} countryCode - Country code
   * @returns {Promise<Array>} Array of unique regions
   */
  static async getRegions(countryCode) {
    const query = `
      SELECT DISTINCT region_code 
      FROM public_holiday 
      WHERE country_code = $1 
        AND region_code IS NOT NULL
        AND is_active = TRUE
      ORDER BY region_code
    `;
    const result = await pool.query(query, [countryCode]);
    return result.rows.map(row => row.region_code);
  }

  /**
   * Search holidays by name or description
   * @param {string} searchTerm - Search term
   * @param {string} countryCode - Optional country filter
   * @returns {Promise<Array>} Matching holidays
   */
  static async search(searchTerm, countryCode = null, tenantId = null) {
    let query = `
      SELECT * FROM public_holiday 
      WHERE (name ILIKE $1 OR description ILIKE $1)
        AND is_active = TRUE
    `;
    
    const params = [`%${searchTerm}%`];
    let paramIndex = 2;
    
    if (countryCode) {
      query += ` AND country_code = $${paramIndex}`;
      params.push(countryCode);
      paramIndex++;
    }

    if (tenantId) {
      query += ` AND tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }

    query += ` ORDER BY name LIMIT 50`;

    const result = await pool.query(query, params);
    return result.rows;
  }
}

module.exports = PublicHoliday;
