/**
 * Department Controller
 * Handles CRUD operations for departments
 */

module.exports = function(deps) {
  const { pool } = deps;

  // GET All Departments
  async function getAll(req, res) {
    try {
      const tenantId = parseInt(req.user.tenantId);
      const { is_active } = req.query;

      let query = 'SELECT d.*, e.full_name as manager_name FROM departments d LEFT JOIN employees e ON d.manager_id = e.id WHERE d.tenant_id::integer = $1';
      const params = [tenantId];
      let paramCount = 2;

      if (is_active !== undefined) {
        query += ` AND d.is_active = $${paramCount}`;
        params.push(is_active === 'true');
        paramCount++;
      }

      query += ' ORDER BY d.name ASC';

      const result = await pool.query(query, params);

      console.log(`✅ Retrieved ${result.rows.length} departments`);

      res.json({
        success: true,
        message: 'Departments retrieved successfully',
        data: {
          departments: result.rows,
          total: result.rows.length
        }
      });
    } catch (error) {
      console.error('❌ Error retrieving departments:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve departments',
        error: error.message
      });
    }
  }

  // GET Single Department by ID
  async function getById(req, res) {
    const departmentId = parseInt(req.params.id);
    const tenantId = parseInt(req.user.tenantId);

    try {
      const result = await pool.query(`
        SELECT d.*, e.full_name as manager_name, e.email as manager_email 
        FROM departments d 
        LEFT JOIN employees e ON d.manager_id = e.id 
        WHERE d.id = $1 AND d.tenant_id::integer = $2
      `, [departmentId, tenantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Department not found'
        });
      }

      const employeeCount = await pool.query(
        'SELECT COUNT(*) as count FROM employees WHERE department = $1 AND tenant_id::integer = $2',
        [result.rows[0].name, tenantId]
      );

      console.log(`✅ Retrieved department #${departmentId}`);

      res.json({
        success: true,
        message: 'Department retrieved successfully',
        data: {
          ...result.rows[0],
          employee_count: parseInt(employeeCount.rows[0].count)
        }
      });
    } catch (error) {
      console.error('❌ Error retrieving department:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve department',
        error: error.message
      });
    }
  }

  // POST Create Department
  async function create(req, res) {
    const userId = parseInt(req.user.userId);

    try {
      let user = null;
      try {
        const userResult = await pool.query(
          'SELECT id, full_name, role, is_admin, tenant_id FROM company_details WHERE id = $1',
          [userId]
        );
        user = userResult.rows[0];
      } catch (dbErr) {
        console.log('⚠️ company_details query failed, using JWT data:', dbErr.message);
      }

      const isAdmin = user 
        ? (user.role === 'Admin' || user.is_admin === true)
        : (req.user.userType === 'admin' || req.user.role === 'Admin' || req.user.role === 'admin');

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only admins can create departments'
        });
      }

      const { name, description, manager_id, is_active = true } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Department name is required'
        });
      }

      const tenantId = user ? user.tenant_id : req.user.tenantId;

      const existingDept = await pool.query(
        'SELECT id FROM departments WHERE name = $1 AND tenant_id = $2',
        [name, tenantId]
      );

      if (existingDept.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Department with this name already exists'
        });
      }

      const result = await pool.query(`
        INSERT INTO departments (name, description, manager_id, is_active, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [name, description, manager_id || null, is_active, tenantId]);

      console.log(`✅ Admin ${user ? user.full_name : req.user.name} created department: ${name}`);

      res.status(201).json({
        success: true,
        message: 'Department created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('❌ Error creating department:', error);
      if (error.message && error.message.includes('departments_manager_id_fkey')) {
        return res.status(400).json({
          success: false,
          message: `Manager with the provided manager_id does not exist in the employees table. Please create the employee first or use a valid employee id.`
        });
      }
      res.status(500).json({
        success: false,
        message: 'Failed to create department',
        error: error.message
      });
    }
  }

  // PUT Update Department
  async function update(req, res) {
    const userId = parseInt(req.user.userId);
    const departmentId = parseInt(req.params.id);

    try {
      let user = null;
      try {
        const userResult = await pool.query(
          'SELECT id, full_name, role, is_admin, tenant_id FROM company_details WHERE id = $1',
          [userId]
        );
        user = userResult.rows[0];
      } catch (dbErr) {
        console.log('⚠️ company_details query failed, using JWT data:', dbErr.message);
      }
      const tenantId = user ? user.tenant_id : req.user.tenantId;

      const isAdmin = user 
        ? (user.role === 'Admin' || user.is_admin === true)
        : (req.user.userType === 'admin' || req.user.role === 'Admin' || req.user.role === 'admin');

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only admins can update departments'
        });
      }

      const deptCheck = await pool.query(
        'SELECT * FROM departments WHERE id = $1 AND tenant_id::integer = $2',
        [departmentId, tenantId]
      );

      if (deptCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Department not found'
        });
      }

      const { name, description, manager_id, is_active } = req.body;

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramCount}`);
        values.push(name);
        paramCount++;
      }

      if (description !== undefined) {
        updates.push(`description = $${paramCount}`);
        values.push(description);
        paramCount++;
      }

      if (manager_id !== undefined) {
        updates.push(`manager_id = $${paramCount}`);
        values.push(manager_id);
        paramCount++;
      }

      if (is_active !== undefined) {
        updates.push(`is_active = $${paramCount}`);
        values.push(is_active);
        paramCount++;
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      updates.push(`updated_at = NOW()`);
      values.push(departmentId, tenantId);

      const query = `
        UPDATE departments 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount} AND tenant_id = $${paramCount + 1}
        RETURNING *
      `;

      const result = await pool.query(query, values);

      console.log(`✅ Admin ${user ? user.full_name : req.user.name} updated department #${departmentId}`);

      res.json({
        success: true,
        message: 'Department updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('❌ Error updating department:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update department',
        error: error.message
      });
    }
  }

  // DELETE Department
  async function remove(req, res) {
    const userId = parseInt(req.user.userId);
    const departmentId = parseInt(req.params.id);

    try {
      let user = null;
      try {
        const userResult = await pool.query(
          'SELECT id, full_name, role, is_admin, tenant_id FROM company_details WHERE id = $1',
          [userId]
        );
        user = userResult.rows[0];
      } catch (dbErr) {
        console.log('⚠️ company_details query failed, using JWT data:', dbErr.message);
      }
      const tenantId = user ? user.tenant_id : req.user.tenantId;

      const isAdmin = user 
        ? (user.role === 'Admin' || user.is_admin === true)
        : (req.user.userType === 'admin' || req.user.role === 'Admin' || req.user.role === 'admin');

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only admins can delete departments'
        });
      }

      const deptCheck = await pool.query(
        'SELECT * FROM departments WHERE id = $1 AND tenant_id::integer = $2',
        [departmentId, tenantId]
      );

      if (deptCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Department not found'
        });
      }

      const employeeCheck = await pool.query(
        'SELECT COUNT(*) as count FROM employees WHERE department = $1 AND tenant_id::integer = $2',
        [deptCheck.rows[0].name, tenantId]
      );

      if (parseInt(employeeCheck.rows[0].count) > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete department. ${employeeCheck.rows[0].count} employee(s) are assigned to this department.`
        });
      }

      await pool.query('DELETE FROM departments WHERE id = $1 AND tenant_id::integer = $2', [departmentId, tenantId]);

      console.log(`✅ Admin ${user ? user.full_name : req.user.name} deleted department #${departmentId}`);

      res.json({
        success: true,
        message: 'Department deleted successfully'
      });
    } catch (error) {
      console.error('❌ Error deleting department:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete department',
        error: error.message
      });
    }
  }

  return { getAll, getById, create, update, remove };
};
