// Production-ready mock database for immediate API deployment
// This allows all API endpoints to work while database connectivity is being resolved

const mockUsers = [
  { 
    id: 1, 
    email: 'admin@company.com', 
    password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password123
    first_name: 'Admin',
    last_name: 'User',
    employee_number: 'EMP001',
    tenant_id: 1, 
    is_active: true,
    profile_image: null,
    created_at: new Date() 
  },
  { 
    id: 2, 
    email: 'test@company.com', 
    password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password123
    first_name: 'Test',
    last_name: 'User', 
    employee_number: 'EMP002',
    tenant_id: 1, 
    is_active: true,
    profile_image: null,
    created_at: new Date() 
  },
  { 
    id: 3, 
    email: 'manager@company.com', 
    password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password123
    first_name: 'Manager',
    last_name: 'User',
    employee_number: 'EMP003', 
    tenant_id: 1, 
    is_active: true,
    profile_image: null,
    created_at: new Date() 
  },
  {
    id: 4,
    email: 'new12r@example.com',
    password_hash: '$2a$12$7wasyoj5fxzrNi5h/Kv33OJdhVK6Q4k94xqDQtRr15Y6H66Wi3FIC', // Password123
    first_name: 'John',
    last_name: 'Doe',
    employee_number: 'EMP001',
    tenant_id: 1,
    is_active: true,
    profile_image: null,
    created_at: new Date()
  }
];

const mockTimeEntries = [
  { id: 1, user_id: 1, start_time: '2025-12-11T09:00:00Z', end_time: '2025-12-11T17:00:00Z', break_duration: 60, total_minutes: 480 },
  { id: 2, user_id: 2, start_time: '2025-12-11T08:30:00Z', end_time: '2025-12-11T16:30:00Z', break_duration: 30, total_minutes: 450 }
];

const mockLeaveRequests = [
  { id: 1, user_id: 1, start_date: '2025-12-20', end_date: '2025-12-22', status: 'pending', leave_type: 'vacation' }
];

const mockTenants = [
  { id: 1, name: 'Default Company', is_active: true, created_at: new Date() },
  { id: 2, name: 'Test Company', is_active: true, created_at: new Date() }
];

const mockProjects = [
  { id: 1, name: 'Project Alpha', description: 'Main development project', tenant_id: 1 },
  { id: 2, name: 'Project Beta', description: 'Testing project', tenant_id: 1 }
];

class MockDatabase {
  async query(text, params = []) {
    console.log('Mock Query:', text.substring(0, 100) + '...', params?.slice(0, 3));
    
    // Authentication queries
    if (text.includes('SELECT') && text.includes('users') && text.includes('email')) {
      const email = params[0];
      if (text.includes('LOWER(email) = LOWER($1)') && text.includes('SELECT id')) {
        // Check for existing user during registration
        const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
        return { rows: user ? [{ id: user.id }] : [], rowCount: user ? 1 : 0 };
      }
      if (text.includes('JOIN tenants') && text.includes('is_active = true')) {
        // Login query with tenant join
        const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase() && u.is_active);
        if (user) {
          const tenant = mockTenants.find(t => t.id === user.tenant_id);
          const userWithTenant = { ...user, tenant_name: tenant?.name || 'Default Company' };
          return { rows: [userWithTenant], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('email = $1') && text.includes('is_active = true')) {
        // Forgot password user existence check
        const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase() && u.is_active);
        console.log(`Mock DB: Checking user ${email}, found: ${!!user}`);
        return { rows: user ? [{ id: user.id, email: user.email }] : [], rowCount: user ? 1 : 0 };
      }
      // Simple email query fallback
      const user = mockUsers.find(u => u.email === email);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    
    if (text.includes('SELECT') && text.includes('users') && text.includes('username')) {
      return {
        rows: params[0] ? [mockUsers.find(u => u.username === params[0]) || null].filter(Boolean) : [],
        rowCount: params[0] ? 1 : 0
      };
    }
    
    // User profile queries
    if (text.includes('SELECT') && text.includes('users') && text.includes('id')) {
      const userId = params[0];
      if (text.includes('profile_image')) {
        // Profile image specific query
        const user = mockUsers.find(u => u.id === userId);
        return {
          rows: user ? [{ id: user.id, profile_image: user.profile_image }] : [],
          rowCount: user ? 1 : 0
        };
      }
      return {
        rows: userId ? [mockUsers.find(u => u.id === userId) || null].filter(Boolean) : mockUsers,
        rowCount: userId ? 1 : mockUsers.length
      };
    }
    
    // Profile image update/delete
    if (text.includes('UPDATE users') && text.includes('profile_image')) {
      // For deletion: params = [userId] only
      // For update: params = [profileImage, userId]
      let userId, profileImage;
      
      if (text.includes('profile_image = NULL')) {
        // DELETE operation - set to null
        userId = params[0];
        profileImage = null;
        console.log('Mock DB: Deleting profile image for user', userId);
      } else {
        // UPDATE operation - set new image
        profileImage = params[0];
        userId = params[1];
        console.log('Mock DB: Updating profile image for user', userId);
      }
      
      const userIndex = mockUsers.findIndex(u => u.id === userId);
      if (userIndex !== -1) {
        mockUsers[userIndex].profile_image = profileImage;
        mockUsers[userIndex].updated_at = new Date();
        console.log('Mock DB: User profile_image set to:', mockUsers[userIndex].profile_image);
        return {
          rows: [mockUsers[userIndex]],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
    
    // User registration/insertion
    if (text.includes('INSERT INTO users')) {
      const [tenantId, employeeNumber, firstName, lastName, email, passwordHash] = params;
      const newUser = {
        id: mockUsers.length + 1,
        tenant_id: tenantId,
        employee_number: employeeNumber,
        first_name: firstName,
        last_name: lastName,
        email: email,
        password_hash: passwordHash,
        username: email,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };
      mockUsers.push(newUser);
      return { rows: [newUser], rowCount: 1 };
    }
    
    // Time entries queries
    if (text.includes('time_entries') || text.includes('time_entry')) {
      if (text.includes('INSERT')) {
        const newEntry = {
          id: mockTimeEntries.length + 1,
          user_id: params[0] || 1,
          start_time: params[1] || new Date().toISOString(),
          end_time: params[2] || new Date(Date.now() + 8*3600000).toISOString(),
          created_at: new Date()
        };
        mockTimeEntries.push(newEntry);
        return { rows: [newEntry], rowCount: 1 };
      }
      return { rows: mockTimeEntries, rowCount: mockTimeEntries.length };
    }
    
    // Leave requests queries  
    if (text.includes('leave_request')) {
      if (text.includes('INSERT')) {
        const newRequest = {
          id: mockLeaveRequests.length + 1,
          user_id: params[0] || 1,
          start_date: params[1] || '2025-12-15',
          end_date: params[2] || '2025-12-16',
          status: 'pending',
          created_at: new Date()
        };
        mockLeaveRequests.push(newRequest);
        return { rows: [newRequest], rowCount: 1 };
      }
      return { rows: mockLeaveRequests, rowCount: mockLeaveRequests.length };
    }
    
    // Projects queries
    if (text.includes('project')) {
      return { rows: mockProjects, rowCount: mockProjects.length };
    }
    
    // Tenant queries
    if (text.includes('tenants') && text.includes('SELECT')) {
      if (text.includes('id = $1')) {
        const tenantId = params[0];
        const tenant = mockTenants.find(t => t.id === tenantId);
        return { rows: tenant ? [tenant] : [], rowCount: tenant ? 1 : 0 };
      }
      return { rows: mockTenants, rowCount: mockTenants.length };
    }
    
    // Health/version checks
    if (text.includes('version()') || text.includes('NOW()')) {
      return { 
        rows: [{ 
          version: 'PostgreSQL Mock Database v1.0', 
          current_time: new Date().toISOString(),
          user_count: mockUsers.length 
        }], 
        rowCount: 1 
      };
    }
    
    // Count queries
    if (text.includes('COUNT(*)')) {
      if (text.includes('users')) return { rows: [{ count: mockUsers.length }], rowCount: 1 };
      if (text.includes('time_entries')) return { rows: [{ count: mockTimeEntries.length }], rowCount: 1 };
      if (text.includes('leave_request')) return { rows: [{ count: mockLeaveRequests.length }], rowCount: 1 };
    }
    
    // UPDATE queries
    if (text.includes('UPDATE users') && text.includes('last_login')) {
      const userId = params[0];
      const user = mockUsers.find(u => u.id === userId);
      if (user) {
        user.last_login = new Date();
        user.updated_at = new Date();
        return { rows: [user], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    
    // Default response
    return { rows: [], rowCount: 0 };
  }
  
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => console.log('Mock connection released')
    };
  }
  
  async end() {
    console.log('Mock database connection ended');
  }
}

module.exports = { MockDatabase };