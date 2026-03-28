const { pool } = require('../config/database');

/**
 * AbsenceEntry Model
 * 
 * Manages employee absences/leaves with support for:
 * - Multiple absence types (GAV, EO, Medical, etc.)
 * - Approval workflows
 * - Duration tracking
 * - Document management
 */
class AbsenceEntry {
  
  /**
   * Get all absence entries with optional filters
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Array of absence entries
   */
  static async getAll(filters = {}) {
    const { 
      employee_id,
      absence_type_id,
      approval_status,
      start_date,
      end_date,
      tenant_id,
      limit = 100,
      offset = 0
    } = filters;

    let query = `
      SELECT 
        ae.*,
        u.first_name || ' ' || u.last_name as employee_name,
        u.email as employee_email,
        at.type_name as absence_type_name,
        at.type_code,
        at.category,
        at.color_code,
        adt.type_name as duration_type_name,
        approver.first_name || ' ' || approver.last_name as approver_name
      FROM absence_entry ae
      LEFT JOIN employees u ON ae.employee_id = u.id
      LEFT JOIN absence_type at ON ae.absence_type_id = at.id
      LEFT JOIN absence_duration_type adt ON ae.duration_type_id = adt.id
      LEFT JOIN employees approver ON ae.approved_by = approver.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;

    if (employee_id) {
      query += ` AND ae.employee_id = $${paramIndex++}`;
      params.push(employee_id);
    }

    if (absence_type_id) {
      query += ` AND ae.absence_type_id = $${paramIndex++}`;
      params.push(absence_type_id);
    }

    if (approval_status) {
      query += ` AND ae.approval_status = $${paramIndex++}`;
      params.push(approval_status);
    }

    if (start_date) {
      query += ` AND ae.start_date >= $${paramIndex++}`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND ae.end_date <= $${paramIndex++}`;
      params.push(end_date);
    }

    if (tenant_id) {
      query += ` AND ae.tenant_id = $${paramIndex++}`;
      params.push(tenant_id);
    }

    query += ` ORDER BY ae.start_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get a single absence entry by ID
   * @param {number} id - Absence entry ID
   * @returns {Promise<Object|null>} Absence entry or null
   */
  static async getById(id) {
    const query = `
      SELECT 
        ae.*,
        u.first_name || ' ' || u.last_name as employee_name,
        u.email as employee_email,
        at.type_name as absence_type_name,
        at.type_code,
        at.category,
        at.color_code,
        adt.type_name as duration_type_name,
        approver.first_name || ' ' || approver.last_name as approver_name
      FROM absence_entry ae
      LEFT JOIN employees u ON ae.employee_id = u.id
      LEFT JOIN absence_type at ON ae.absence_type_id = at.id
      LEFT JOIN absence_duration_type adt ON ae.duration_type_id = adt.id
      LEFT JOIN employees approver ON ae.approved_by = approver.id
      WHERE ae.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create a new absence entry
   * @param {Object} absenceData - Absence entry data
   * @returns {Promise<Object>} Created absence entry
   */
  static async create(absenceData) {
    const {
      employee_id,
      absence_type_id,
      start_date,
      end_date,
      start_time,
      end_time,
      duration_minutes,
      duration_type_id,
      approval_status = 'pending',
      remarks,
      document_url,
      tenant_id,
      created_by
    } = absenceData;

    const query = `
      INSERT INTO absence_entry (
        employee_id, absence_type_id, start_date, end_date,
        start_time, end_time, duration_minutes, duration_type_id,
        approval_status, remarks, document_url, tenant_id,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING *
    `;

    const params = [
      employee_id,
      absence_type_id,
      start_date,
      end_date,
      start_time || null,
      end_time || null,
      duration_minutes || null,
      duration_type_id || null,
      approval_status,
      remarks || null,
      document_url || null,
      tenant_id || null,
      created_by || null
    ];

    const result = await pool.query(query, params);
    return result.rows[0];
  }

  /**
   * Update an existing absence entry
   * @param {number} id - Absence entry ID
   * @param {Object} absenceData - Updated data
   * @returns {Promise<Object|null>} Updated absence entry or null
   */
  static async update(id, absenceData) {
    const {
      absence_type_id,
      start_date,
      end_date,
      start_time,
      end_time,
      duration_minutes,
      duration_type_id,
      remarks,
      document_url,
      updated_by
    } = absenceData;

    const query = `
      UPDATE absence_entry 
      SET 
        absence_type_id = COALESCE($1, absence_type_id),
        start_date = COALESCE($2, start_date),
        end_date = COALESCE($3, end_date),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        duration_minutes = COALESCE($6, duration_minutes),
        duration_type_id = COALESCE($7, duration_type_id),
        remarks = COALESCE($8, remarks),
        document_url = COALESCE($9, document_url),
        updated_by = COALESCE($10, updated_by),
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;

    const params = [
      absence_type_id,
      start_date,
      end_date,
      start_time,
      end_time,
      duration_minutes,
      duration_type_id,
      remarks,
      document_url,
      updated_by,
      id
    ];

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Approve or reject an absence entry
   * @param {number} id - Absence entry ID
   * @param {string} status - 'approved' or 'rejected'
   * @param {number} approvedBy - User ID of approver
   * @param {string} rejectionReason - Reason if rejected
   * @returns {Promise<Object|null>} Updated absence entry or null
   */
  static async updateStatus(id, status, approvedBy, rejectionReason = null) {
    const query = `
      UPDATE absence_entry 
      SET 
        approval_status = $1::text,
        approved_by = $2,
        approved_at = CASE WHEN $1::text = 'approved' THEN NOW() ELSE approved_at END,
        rejection_reason = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;

    const params = [status, approvedBy, rejectionReason, id];
    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Delete an absence entry
   * @param {number} id - Absence entry ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(id) {
    const query = 'DELETE FROM absence_entry WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    return result.rowCount > 0;
  }

  /**
   * Get employee absences for a date range
   * @param {number} employeeId - Employee ID
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Promise<Array>} Absence entries
   */
  static async getByEmployeeAndDateRange(employeeId, startDate, endDate) {
    const query = `
      SELECT 
        ae.*,
        at.type_name as absence_type_name,
        at.type_code,
        at.category,
        at.color_code
      FROM absence_entry ae
      LEFT JOIN absence_type at ON ae.absence_type_id = at.id
      WHERE ae.employee_id = $1
        AND ae.start_date <= $3
        AND ae.end_date >= $2
      ORDER BY ae.start_date ASC
    `;
    const result = await pool.query(query, [employeeId, startDate, endDate]);
    return result.rows;
  }

  /**
   * Get pending approvals
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Pending absence entries
   */
  static async getPendingApprovals(limit = 50) {
    const query = `
      SELECT 
        ae.*,
        u.first_name || ' ' || u.last_name as employee_name,
        u.email as employee_email,
        at.type_name as absence_type_name,
        at.type_code,
        at.category
      FROM absence_entry ae
      LEFT JOIN employees u ON ae.employee_id = u.id
      LEFT JOIN absence_type at ON ae.absence_type_id = at.id
      WHERE ae.approval_status = 'pending'
      ORDER BY ae.created_at ASC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get absence statistics for an employee
   * @param {number} employeeId - Employee ID
   * @param {number} year - Year (optional)
   * @returns {Promise<Object>} Statistics
   */
  static async getEmployeeStatistics(employeeId, year = null) {
    const yearFilter = year ? `AND EXTRACT(YEAR FROM start_date) = $2` : '';
    const params = year ? [employeeId, year] : [employeeId];

    const query = `
      SELECT 
        COUNT(*) as total_absences,
        COUNT(CASE WHEN approval_status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN approval_status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN approval_status = 'rejected' THEN 1 END) as rejected_count,
        SUM(CASE 
          WHEN duration_minutes IS NOT NULL THEN duration_minutes 
          ELSE EXTRACT(EPOCH FROM (end_date - start_date)) / 60 / 60 / 24 * 480
        END) as total_minutes
      FROM absence_entry
      WHERE employee_id = $1 ${yearFilter}
    `;
    
    const result = await pool.query(query, params);
    return result.rows[0];
  }

  /**
   * Get all absence types
   * @param {boolean} activeOnly - Only active types
   * @returns {Promise<Array>} Absence types
   */
  static async getAbsenceTypes(activeOnly = true, tenantId = null) {
    let query = 'SELECT * FROM absence_type';
    const params = [];
    const conditions = [];
    if (activeOnly) {
      conditions.push('is_active = TRUE');
    }
    if (tenantId) {
      conditions.push(`(tenant_id::integer = $${params.length + 1} OR tenant_id IS NULL)`);
      params.push(tenantId);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY category, type_name';
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get all duration types
   * @returns {Promise<Array>} Duration types
   */
  static async getDurationTypes() {
    const query = 'SELECT * FROM absence_duration_type WHERE is_active = TRUE ORDER BY id';
    const result = await pool.query(query);
    return result.rows;
  }
}

module.exports = AbsenceEntry;
