const { Pool } = require('pg');
const { MockDatabase } = require('./mock_database');

// Check if using Neon Cloud Database
const useNeon = process.env.USE_NEON === 'true' || process.env.NEON_DATABASE_URL;

// Database Connection Configuration
let dbConfig;

if (useNeon && process.env.NEON_DATABASE_URL) {
  // Neon Cloud Database Configuration
  dbConfig = {
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 10, // Higher for cloud
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
  console.log('🌐 Using Neon Cloud Database');
  console.log('Database config:', {
    connectionString: process.env.NEON_DATABASE_URL.replace(/:[^:@]+@/, ':***@'), // Hide password
    ssl: true,
    environment: process.env.NODE_ENV
  });
} else {
  // Local PostgreSQL Configuration
  dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5433,
    database: process.env.DB_NAME || 'timemanagement',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  };
  console.log('🔗 Using Local PostgreSQL Database');
  console.log('Database config:', {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    ssl: dbConfig.ssl,
    environment: process.env.NODE_ENV
  });
}

// Use mock database only if explicitly requested AND no real DB credentials provided
// Never use mock if Neon or real PostgreSQL credentials are available
const hasRealDbCredentials = process.env.DB_HOST && process.env.DB_PASSWORD;
const useMockDatabase = !useNeon && !hasRealDbCredentials && process.env.USE_MOCK_DB === 'true';

let pool;
if (useMockDatabase) {
  console.log('🔄 Using Mock Database (No credentials provided)');
  pool = new MockDatabase();
} else {
  console.log('✅ Connecting to Real Database...');
  pool = new Pool(dbConfig);
}

// Set session variables for Row Level Security
const setSessionVariables = async (client, userId, tenantId) => {
  try {
    await client.query(`SET session.current_user_id = '${userId}'`);
    await client.query(`SET session.current_tenant_id = '${tenantId}'`);
  } catch (error) {
    console.error('Error setting session variables:', error);
    throw error;
  }
};

// Execute query with RLS context
const executeWithRLS = async (query, params, userId, tenantId) => {
  const client = await pool.connect();
  try {
    await setSessionVariables(client, userId, tenantId);
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
};

// Execute transaction with RLS context
const executeTransactionWithRLS = async (queries, userId, tenantId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setSessionVariables(client, userId, tenantId);
    
    const results = [];
    for (const { query, params } of queries) {
      const result = await client.query(query, params);
      results.push(result);
    }
    
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Test database connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connection successful:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Initialize database connection
testConnection();

module.exports = {
  pool,
  executeWithRLS,
  executeTransactionWithRLS,
  testConnection
};