require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fileUpload = require('express-fileupload');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'your-cloud-name',
  api_key: process.env.CLOUDINARY_API_KEY || 'your-api-key',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'your-api-secret'
});

// Multer configuration for Cloudinary uploads (memory storage for serverless)
const storage = multer.memoryStorage();

const fileFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

const uploadCompanyLogo = multer({
  storage: storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB - Vercel limit is 4.5MB
  fileFilter: fileFilter
});

const uploadProfilePhoto = multer({
  storage: storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB - Vercel limit is 4.5MB
  fileFilter: fileFilter
});

// Helper function to upload buffer to Cloudinary
async function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folder, resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}

// PostgreSQL Database Connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Test database connection and setup schema
pool.query('SELECT NOW()', async (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connected successfully');
    
    // Auto-migrate: Add required columns if they don't exist
    try {
      await pool.query(`
        ALTER TABLE tenants 
        ADD COLUMN IF NOT EXISTS registration_session VARCHAR(255),
        ADD COLUMN IF NOT EXISTS registration_step INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS registration_data JSONB,
        ADD COLUMN IF NOT EXISTS registration_expires TIMESTAMP WITH TIME ZONE;
      `);
      
      // Create company_details table for company registration (with user-like fields)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS company_details (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          country VARCHAR(100),
          timezone VARCHAR(100),
          logo TEXT,
          employee_id VARCHAR(100),
          full_name VARCHAR(255),
          password VARCHAR(255),
          phone VARCHAR(50),
          role VARCHAR(50) DEFAULT 'Admin',
          profile_photo TEXT,
          department VARCHAR(100),
          manager VARCHAR(255),
          working_hours VARCHAR(100),
          work_model VARCHAR(50),
          start_date DATE,
          status VARCHAR(50) DEFAULT 'Active',
          account_setup_completed BOOLEAN DEFAULT false,
          account_activated_at TIMESTAMP,
          address TEXT,
          date_of_birth DATE,
          hire_date DATE,
          employee_number VARCHAR(50),
          is_active BOOLEAN DEFAULT false,
          project VARCHAR(255),
          location VARCHAR(255),
          joined_date VARCHAR(100),
          company VARCHAR(255),
          is_admin BOOLEAN DEFAULT true,
          permissions JSONB,
          default_work_model VARCHAR(50),
          working_hours_per_day NUMERIC(5,2),
          working_days_per_week INTEGER,
          default_break_duration INTEGER,
          overtime_calculation VARCHAR(100),
          registration_session VARCHAR(255) UNIQUE,
          registration_step INTEGER DEFAULT 0,
          registration_data JSONB,
          registration_expires TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      
      // Add missing columns to company_details if table already exists
      await pool.query(`
        ALTER TABLE company_details 
        ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
        ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS password VARCHAR(255),
        ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS role VARCHAR(50),
        ADD COLUMN IF NOT EXISTS profile_photo TEXT,
        ADD COLUMN IF NOT EXISTS department VARCHAR(100),
        ADD COLUMN IF NOT EXISTS manager VARCHAR(255),
        ADD COLUMN IF NOT EXISTS working_hours VARCHAR(100),
        ADD COLUMN IF NOT EXISTS work_model VARCHAR(50),
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS status VARCHAR(50),
        ADD COLUMN IF NOT EXISTS account_setup_completed BOOLEAN,
        ADD COLUMN IF NOT EXISTS account_activated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS date_of_birth DATE,
        ADD COLUMN IF NOT EXISTS hire_date DATE,
        ADD COLUMN IF NOT EXISTS employee_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
        ADD COLUMN IF NOT EXISTS project VARCHAR(255),
        ADD COLUMN IF NOT EXISTS location VARCHAR(255),
        ADD COLUMN IF NOT EXISTS joined_date VARCHAR(100),
        ADD COLUMN IF NOT EXISTS company VARCHAR(255),
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN,
        ADD COLUMN IF NOT EXISTS permissions JSONB,
        ADD COLUMN IF NOT EXISTS default_work_model VARCHAR(50),
        ADD COLUMN IF NOT EXISTS working_hours_per_day NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS working_days_per_week INTEGER,
        ADD COLUMN IF NOT EXISTS default_break_duration INTEGER,
        ADD COLUMN IF NOT EXISTS overtime_calculation VARCHAR(100);
      `);
      
      // Drop first_name and last_name columns if they exist (cleanup)
      await pool.query(`
        ALTER TABLE company_details DROP COLUMN IF EXISTS first_name;
        ALTER TABLE company_details DROP COLUMN IF EXISTS last_name;
      `);
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_company_details_email ON company_details(email);
        CREATE INDEX IF NOT EXISTS idx_company_details_session ON company_details(registration_session);
        CREATE INDEX IF NOT EXISTS idx_company_details_tenant_id ON company_details(tenant_id);
      `);
      
      await pool.query(`
        ALTER TABLE employees 
        ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS last_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS password VARCHAR(255),
        ADD COLUMN IF NOT EXISTS profile_photo TEXT,
        ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS role VARCHAR(100),
        ADD COLUMN IF NOT EXISTS department VARCHAR(100),
        ADD COLUMN IF NOT EXISTS manager VARCHAR(255),
        ADD COLUMN IF NOT EXISTS working_hours VARCHAR(100),
        ADD COLUMN IF NOT EXISTS work_model VARCHAR(50),
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active',
        ADD COLUMN IF NOT EXISTS account_setup_completed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS account_activated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS date_of_birth DATE,
        ADD COLUMN IF NOT EXISTS project VARCHAR(255),
        ADD COLUMN IF NOT EXISTS location VARCHAR(255),
        ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS joined_date VARCHAR(100),
        ADD COLUMN IF NOT EXISTS company VARCHAR(255),
        ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS permissions JSONB,
        ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(255),
        ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      `);
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS timers (
          id SERIAL PRIMARY KEY,
          timer_id VARCHAR(255) UNIQUE NOT NULL,
          user_id INTEGER REFERENCES employees(id) NOT NULL,
          start_time TIMESTAMP WITH TIME ZONE NOT NULL,
          end_time TIMESTAMP WITH TIME ZONE,
          description TEXT,
          project_id INTEGER,
          location_id INTEGER,
          notes TEXT,
          work_duration INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          is_running BOOLEAN DEFAULT TRUE,
          is_paused BOOLEAN DEFAULT FALSE,
          total_paused_time INTEGER DEFAULT 0,
          pause_start_time TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS breaks (
          break_id SERIAL PRIMARY KEY,
          timer_id VARCHAR(255) REFERENCES timers(timer_id) NOT NULL,
          user_id INTEGER REFERENCES employees(id) NOT NULL,
          break_type VARCHAR(50) NOT NULL,
          break_type_id INTEGER REFERENCES break_types(id),
          start_time TIMESTAMP WITH TIME ZONE NOT NULL,
          end_time TIMESTAMP WITH TIME ZONE,
          duration INTEGER,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      
      // Migration: Drop created_by column and ensure tenant_id exists in old leave_types
      try {
        await pool.query(`ALTER TABLE leave_types DROP COLUMN IF EXISTS created_by`);
        await pool.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
        console.log('✅ leave_types table migrated - removed created_by, using tenant_id');
      } catch (err) {
        console.log('⚠️ leave_types migration:', err.message);
      }

      // Create leave_requests table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER REFERENCES employees(id) NOT NULL,
          leave_type_id INTEGER REFERENCES leave_types(id) NOT NULL,
          leave_type VARCHAR(50) NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          total_days DECIMAL(4,1) NOT NULL,
          reason TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          approved_by INTEGER REFERENCES employees(id),
          approved_at TIMESTAMP WITH TIME ZONE,
          rejection_reason TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create departments table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS departments (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          manager_id INTEGER,
          is_active BOOLEAN DEFAULT true,
          tenant_id INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(name, tenant_id)
        );
      `);

      // Drop old FK constraint on manager_id if it exists (manager can be user or employee)
      await pool.query(`
        ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_manager_id_fkey;
      `).catch(() => {});

      // Create break_types table (Dynamic break types management)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS break_types (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL,
          display_name VARCHAR(100) NOT NULL,
          duration_minutes INTEGER,
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          tenant_id INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(name, tenant_id)
        );
      `);
      console.log('✅ break_types table ready');

      // Migration: Add break_type_id column to breaks table if it doesn't exist
      try {
        await pool.query(`
          ALTER TABLE breaks 
          ADD COLUMN IF NOT EXISTS break_type_id INTEGER REFERENCES break_types(id)
        `);
        console.log('✅ breaks table: break_type_id column ready');
      } catch (err) {
        console.log('⚠️ breaks break_type_id migration:', err.message);
      }

      // Create leave_types table (Swiss-compliant dynamic leave types)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS leave_types (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          code VARCHAR(50) NOT NULL UNIQUE,
          is_paid BOOLEAN DEFAULT true,
          requires_approval BOOLEAN DEFAULT true,
          legal_minimum INTEGER DEFAULT 0,
          accrual_type VARCHAR(20) DEFAULT 'yearly',
          salary_percentage INTEGER DEFAULT 100,
          max_days_per_year INTEGER,
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          tenant_id INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Migrate existing leave_types table to Swiss-compliant schema
      try {
        await pool.query(`
          ALTER TABLE leave_types 
          ADD COLUMN IF NOT EXISTS code VARCHAR(50),
          ADD COLUMN IF NOT EXISTS legal_minimum INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS accrual_type VARCHAR(20) DEFAULT 'yearly',
          ADD COLUMN IF NOT EXISTS salary_percentage INTEGER DEFAULT 100,
          ADD COLUMN IF NOT EXISTS max_days_per_year INTEGER;
        `);
        
        // Update existing records with code values based on their names (all WHERE clauses check code IS NULL)
        await pool.query(`
          UPDATE leave_types SET code = 'paid_annual' WHERE name ILIKE '%annual%' AND code IS NULL;
          UPDATE leave_types SET code = 'sick_leave' WHERE name ILIKE '%sick%' AND code IS NULL;
          UPDATE leave_types SET code = 'maternity' WHERE name ILIKE '%maternity%' AND code IS NULL;
          UPDATE leave_types SET code = 'paternity' WHERE name ILIKE '%paternity%' AND code IS NULL;
          UPDATE leave_types SET code = 'bereavement' WHERE (name ILIKE '%bereavement%' OR name ILIKE '%death%') AND code IS NULL;
          UPDATE leave_types SET code = 'unpaid' WHERE name ILIKE '%unpaid%' AND code IS NULL;
          UPDATE leave_types SET code = LOWER(REPLACE(name, ' ', '_')) WHERE code IS NULL;
        `);
        
        console.log('✅ leave_types table migrated to Swiss schema');
      } catch (err) {
        console.log('⚠️ leave_types migration warning:', err.message);
      }

      // Fix unique constraints: name and code should be unique per tenant, not globally
      try {
        // Drop old global unique constraints (could be constraints or indexes)
        await pool.query(`ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_name_key`);
        await pool.query(`ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_code_key`);
        await pool.query(`DROP INDEX IF EXISTS leave_types_name_key`);
        await pool.query(`DROP INDEX IF EXISTS leave_types_code_key`);
        // Drop tenant-scoped ones too in case of re-run
        await pool.query(`ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_name_tenant_unique`);
        await pool.query(`ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_code_tenant_unique`);
        // Re-create as per-tenant unique
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leave_types_name_tenant_unique ON leave_types(name, tenant_id)`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leave_types_code_tenant_unique ON leave_types(code, tenant_id)`);
        console.log('✅ leave_types unique constraints fixed (per-tenant)');
      } catch (err) {
        console.log('⚠️ leave_types constraint fix warning:', err.message);
      }

      // Create company_leave_policies table (tenant-specific overrides)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS company_leave_policies (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            leave_type_id INTEGER REFERENCES leave_types(id),
            canton VARCHAR(2),
            default_days INTEGER NOT NULL,
            accrual_rule JSONB,
            description TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(tenant_id, leave_type_id)
          );
        `);
        console.log('✅ company_leave_policies table created');
      } catch (err) {
        console.log('⚠️ company_leave_policies creation:', err.message);
      }

      // Create employee_leave_balances table (individual employee balances)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS employee_leave_balances (
            id SERIAL PRIMARY KEY,
            employee_id VARCHAR(50) NOT NULL,
            tenant_id INTEGER NOT NULL,
            leave_type_id INTEGER REFERENCES leave_types(id),
            total_allocated INTEGER DEFAULT 0,
            used_days DECIMAL(5,2) DEFAULT 0,
            pending_days DECIMAL(5,2) DEFAULT 0,
            available_days DECIMAL(5,2) GENERATED ALWAYS AS (total_allocated - used_days - pending_days) STORED,
            accrual_start_date DATE,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(employee_id, tenant_id, leave_type_id)
          );
        `);
        console.log('✅ employee_leave_balances table created');
      } catch (err) {
        console.log('⚠️ employee_leave_balances creation:', err.message);
      }

      // Create public_holidays table (Swiss canton-specific holidays)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS public_holidays (
            id SERIAL PRIMARY KEY,
            canton VARCHAR(2),
            name VARCHAR(100) NOT NULL,
            date DATE NOT NULL,
            year INTEGER NOT NULL,
            is_recurring BOOLEAN DEFAULT false,
            is_paid BOOLEAN DEFAULT true,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(canton, date)
          );
        `);
        console.log('✅ public_holidays table created');
      } catch (err) {
        console.log('⚠️ public_holidays creation:', err.message);
      }

      // Create correction_types table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS correction_types (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          custom_fields JSONB,
          is_active BOOLEAN DEFAULT true,
          tenant_id INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create correction_requests table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS correction_requests (
          id SERIAL PRIMARY KEY,
          employee_id VARCHAR(100) REFERENCES employees(employee_id) NOT NULL,
          correction_type_id INTEGER REFERENCES correction_types(id) NOT NULL,
          date DATE NOT NULL,
          correction_data JSONB NOT NULL,
          comment TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          approved_by INTEGER REFERENCES employees(id),
          approved_at TIMESTAMP WITH TIME ZONE,
          rejection_reason TEXT,
          tenant_id INTEGER,
          admin_comment TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Add tenant_id to correction tables if missing
      await pool.query(`
        ALTER TABLE correction_types ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
        ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
        ALTER TABLE correction_requests ADD COLUMN IF NOT EXISTS admin_comment TEXT;
      `);

      // Create projects table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          color VARCHAR(20),
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create locations table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS locations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          address TEXT,
          city VARCHAR(100),
          country VARCHAR(100),
          timezone VARCHAR(100),
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create FAQs table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS faqs (
          id SERIAL PRIMARY KEY,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          category VARCHAR(100),
          order_index INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          tenant_id INTEGER,
          created_by INTEGER REFERENCES employees(id),
          updated_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        -- Add tenant_id if missing
        ALTER TABLE faqs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
      `);

      // Create problem_reports table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS problem_reports (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES employees(id) NOT NULL,
          problem_type VARCHAR(255) NOT NULL,
          additional_details TEXT,
          status VARCHAR(50) DEFAULT 'open',
          priority VARCHAR(20) DEFAULT 'normal',
          admin_response TEXT,
          responded_by INTEGER REFERENCES employees(id),
          responded_at TIMESTAMP WITH TIME ZONE,
          resolved_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create company_settings table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS company_settings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER,
          name VARCHAR(255),
          industry VARCHAR(100),
          brand_color VARCHAR(20),
          brand_color_name VARCHAR(50),
          support_email VARCHAR(255),
          company_phone VARCHAR(50),
          address TEXT,
          logo_url TEXT,
          website VARCHAR(255),
          timezone VARCHAR(100),
          founded_date DATE,
          employee_count INTEGER,
          description TEXT,
          work_days JSONB DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
          start_time VARCHAR(10) DEFAULT '09:00',
          end_time VARCHAR(10) DEFAULT '17:00',
          break_required BOOLEAN DEFAULT true,
          auto_deduct_break BOOLEAN DEFAULT false,
          break_duration INTEGER DEFAULT 60,
          enable_overtime BOOLEAN DEFAULT false,
          overtime_starts_after INTEGER DEFAULT 8,
          max_overtime_per_day INTEGER DEFAULT 2,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Drop old FK constraint on company_settings.tenant_id if it exists
      await pool.query(`
        ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_tenant_id_fkey;
      `).catch(() => {});

      // Create user_preferences table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES employees(id) UNIQUE NOT NULL,
          language VARCHAR(50) DEFAULT 'English',
          language_code VARCHAR(10) DEFAULT 'en',
          time_format VARCHAR(20) DEFAULT '24-hour',
          first_day_of_week VARCHAR(20) DEFAULT 'Monday',
          timezone VARCHAR(100) DEFAULT 'UTC',
          date_format VARCHAR(50) DEFAULT 'YYYY-MM-DD',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create time_entries table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS time_entries (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER REFERENCES employees(id) NOT NULL,
          date DATE NOT NULL,
          clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
          clock_out TIMESTAMP WITH TIME ZONE,
          duration_minutes INTEGER,
          source VARCHAR(50) DEFAULT 'API',
          work_location VARCHAR(100) DEFAULT 'office',
          contract_id INTEGER,
          remarks TEXT,
          is_adjusted BOOLEAN DEFAULT false,
          adjusted_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create activities table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS activities (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES employees(id) NOT NULL,
          type VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create activity_logs table for admin Activity Log (Figma design)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER,
          actor_id INTEGER,
          actor_name VARCHAR(255),
          actor_type VARCHAR(20) NOT NULL DEFAULT 'system',
          category VARCHAR(30) NOT NULL DEFAULT 'system',
          action VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          target_type VARCHAR(50),
          target_id INTEGER,
          target_name VARCHAR(255),
          metadata JSONB,
          ip_address VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      // Index for fast filtering
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant ON activity_logs(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(category)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_type ON activity_logs(actor_type)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC)`);

      // Create vacation_balances table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vacation_balances (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES employees(id) UNIQUE NOT NULL,
          total_days INTEGER DEFAULT 20,
          used_days INTEGER DEFAULT 0,
          pending_days INTEGER DEFAULT 0,
          available_days INTEGER DEFAULT 20,
          year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Add leave_type_id column to existing leave_requests table if it doesn't exist
      try {
        await pool.query(`
          ALTER TABLE leave_requests 
          ADD COLUMN IF NOT EXISTS leave_type_id INTEGER REFERENCES leave_types(id);
        `);
        console.log('✅ Added leave_type_id column to leave_requests table');
      } catch (err) {
        console.log('⚠️ leave_type_id column may already exist:', err.message);
      }

      // Add working hours columns to company_settings table if they don't exist
      try {
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS work_days JSONB`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS start_time VARCHAR(10)`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS end_time VARCHAR(10)`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS break_required BOOLEAN`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS auto_deduct_break BOOLEAN`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS break_duration INTEGER`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS enable_overtime BOOLEAN`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS overtime_starts_after INTEGER`);
        await pool.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS max_overtime_per_day INTEGER`);
        
        // Set default values for existing rows
        await pool.query(`
          UPDATE company_settings 
          SET 
            work_days = COALESCE(work_days, '["Mon","Tue","Wed","Thu","Fri"]'::jsonb),
            start_time = COALESCE(start_time, '09:00'),
            end_time = COALESCE(end_time, '17:00'),
            break_required = COALESCE(break_required, true),
            auto_deduct_break = COALESCE(auto_deduct_break, false),
            break_duration = COALESCE(break_duration, 60),
            enable_overtime = COALESCE(enable_overtime, false),
            overtime_starts_after = COALESCE(overtime_starts_after, 8),
            max_overtime_per_day = COALESCE(max_overtime_per_day, 2)
          WHERE work_days IS NULL OR start_time IS NULL
        `);
        
        console.log('✅ Added working hours columns to company_settings table');
      } catch (err) {
        console.log('⚠️ Working hours columns error:', err.message);
      }

      // Add missing columns to timers table if they don't exist
      try {
        await pool.query(`
          ALTER TABLE timers 
          ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id),
          ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS clock_in TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS clock_out TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS work_duration_seconds INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'completed',
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS remarks TEXT,
          ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual',
          ADD COLUMN IF NOT EXISTS is_adjusted BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS project_id INTEGER,
          ADD COLUMN IF NOT EXISTS description TEXT;
        `);
        console.log('✅ Added missing columns to timers table');
      } catch (err) {
        console.log('⚠️ Timers columns migration error:', err.message);
      }

      // Migration: Add timer_record_id to breaks table (integer FK to timers.id)
      try {
        await pool.query(`
          ALTER TABLE breaks
          ADD COLUMN IF NOT EXISTS timer_record_id INTEGER REFERENCES timers(id),
          ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100),
          ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 0
        `);
        console.log('✅ breaks table: timer_record_id, employee_id, duration_seconds columns ready');
      } catch (err) {
        console.log('⚠️ breaks timer_record_id migration:', err.message);
      }
      // Note: breaks table already exists (created above), work_break is legacy alias
      // CREATE TABLE IF NOT EXISTS ensures no error if already present
      await pool.query(`
        CREATE TABLE IF NOT EXISTS work_break (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER REFERENCES employees(id) NOT NULL,
          break_type VARCHAR(50) NOT NULL,
          start_time TIMESTAMP WITH TIME ZONE NOT NULL,
          end_time TIMESTAMP WITH TIME ZONE,
          duration_minutes INTEGER,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      console.log('✅ work_break table ready (legacy)');

      // Add/Update columns to time_entries table for production structure
      try {
        await pool.query(`
          ALTER TABLE time_entries 
          ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id),
          ADD COLUMN IF NOT EXISTS clock_in TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS clock_out TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
          ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'API',
          ADD COLUMN IF NOT EXISTS work_location VARCHAR(100) DEFAULT 'office',
          ADD COLUMN IF NOT EXISTS contract_id INTEGER,
          ADD COLUMN IF NOT EXISTS remarks TEXT,
          ADD COLUMN IF NOT EXISTS is_adjusted BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS adjusted_by INTEGER REFERENCES employees(id);
        `);
        console.log('✅ Updated time_entries table with production schema');
      } catch (err) {
        console.log('⚠️ time_entries migration info:', err.message);
      }

      // Drop old columns if they exist (migration from old schema)
      try {
        await pool.query(`
          ALTER TABLE time_entries 
          DROP COLUMN IF EXISTS user_id,
          DROP COLUMN IF EXISTS project_id,
          DROP COLUMN IF EXISTS description,
          DROP COLUMN IF EXISTS start_time,
          DROP COLUMN IF EXISTS end_time,
          DROP COLUMN IF EXISTS duration,
          DROP COLUMN IF EXISTS is_billable;
        `);
        console.log('✅ Cleaned up old time_entries columns');
      } catch (err) {
        // Ignore errors - columns might not exist
      }

      // Create indexes after all columns have been added
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_tenants_registration_session ON tenants(registration_session);
          CREATE INDEX IF NOT EXISTS idx_timers_user_id ON timers(user_id);
          CREATE INDEX IF NOT EXISTS idx_timers_is_active ON timers(is_active);
          CREATE INDEX IF NOT EXISTS idx_breaks_timer_id ON breaks(timer_id);
          CREATE INDEX IF NOT EXISTS idx_breaks_user_active ON breaks(user_id, is_active);
          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
          CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
          CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
          CREATE INDEX IF NOT EXISTS idx_correction_requests_employee ON correction_requests(employee_id);
          CREATE INDEX IF NOT EXISTS idx_correction_requests_status ON correction_requests(status);
          CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id);
          CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
          CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in);
          CREATE INDEX IF NOT EXISTS idx_time_entries_source ON time_entries(source);
          CREATE INDEX IF NOT EXISTS idx_time_entries_adjusted ON time_entries(is_adjusted);
          CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
        `);
        console.log('✅ Database indexes created successfully');
      } catch (err) {
        console.log('⚠️ Index creation info:', err.message);
      }

      // Insert seed data for projects if table is empty
      const projectsCount = await pool.query('SELECT COUNT(*) FROM projects');
      if (parseInt(projectsCount.rows[0].count) === 0) {
        await pool.query(`
          INSERT INTO projects (name, description, color, status) VALUES
          ('E-Commerce Platform', 'Building next-gen shopping experience', '#3B82F6', 'active'),
          ('Mobile App Design', 'iOS and Android app redesign', '#10B981', 'active'),
          ('Team Management', 'Internal team collaboration tools', '#F59E0B', 'active'),
          ('Administration', 'Company administration and management', '#6366F1', 'active'),
          ('Customer Support', 'Customer service and support system', '#EF4444', 'active')
        `);
        console.log('✅ Seed data inserted for projects');
      }

      // Insert seed data for break_types if table is empty
      const breakTypesCount = await pool.query('SELECT COUNT(*) FROM break_types');
      if (parseInt(breakTypesCount.rows[0].count) === 0) {
        await pool.query(`
          INSERT INTO break_types (name, display_name, duration_minutes, description, is_active) VALUES
          ('lunch', 'Lunch Break', 60, 'Standard lunch break', true),
          ('coffee', 'Coffee Break', 15, 'Short coffee/tea break', true),
          ('personal', 'Personal Break', 30, 'Personal time off', true),
          ('meeting', 'Meeting Break', 45, 'Break for meetings', true),
          ('short', 'Short Break', 10, 'Quick break', true),
          ('other', 'Other', NULL, 'Custom break type', true)
        `);
        console.log('✅ Seed data inserted for break_types');
      }

      // Insert seed data for locations if table is empty
      const locationsCount = await pool.query('SELECT COUNT(*) FROM locations');
      if (parseInt(locationsCount.rows[0].count) === 0) {
        await pool.query(`
          INSERT INTO locations (name, address, city, country, timezone) VALUES
          ('Head Office', '45 Cloudy Bay', 'Auckland', 'New Zealand', 'Pacific/Auckland'),
          ('New York Office', '123 Broadway', 'New York', 'USA', 'America/New_York'),
          ('California Office', '456 Silicon Valley', 'San Francisco', 'USA', 'America/Los_Angeles'),
          ('Remote', 'Work from anywhere', NULL, 'Global', 'UTC'),
          ('London Office', '789 Oxford Street', 'London', 'UK', 'Europe/London')
        `);
        console.log('✅ Seed data inserted for locations');
      }

      // Insert seed data for Swiss-compliant leave types if table is empty
      const leaveTypesCount = await pool.query('SELECT COUNT(*) FROM leave_types');
      if (parseInt(leaveTypesCount.rows[0].count) === 0) {
        await pool.query(`
          INSERT INTO leave_types (name, code, is_paid, requires_approval, legal_minimum, accrual_type, salary_percentage, max_days_per_year, description, is_active) VALUES
          ('Annual Leave', 'paid_annual', true, true, 20, 'yearly', 100, 25, 'Statutory minimum 4 weeks (20 days) paid vacation. Employees under 20 years receive 5 weeks.', true),
          ('Sick Leave', 'sick_leave', true, false, 21, 'tenure_based', 100, NULL, 'At least 3 weeks paid sick leave in first year, increases with tenure. Usually covered by employer insurance.', true),
          ('Maternity Leave', 'maternity', true, false, 98, 'once', 80, 98, '14 weeks paid at 80% salary via social insurance (EO). Some employers/cantons offer more.', true),
          ('Paternity Leave', 'paternity', true, false, 10, 'once', 80, 10, '2 weeks (10 working days) paid at 80% salary via social insurance, within 6 months of birth.', true),
          ('Adoption Leave', 'adoption', true, false, 10, 'once', 80, 10, '2 weeks paid at 80% salary for adoptive parents (since 2023).', true),
          ('Family Care Leave', 'family_care', true, false, 3, 'per_event', 100, 14, 'Up to 3 paid days per event for sick children/relatives. Extended leave (14 weeks, EO-financed) for seriously ill children.', true),
          ('Bereavement Leave', 'bereavement', true, true, 1, 'per_event', 100, 5, 'Paid leave (1-5 days) for family funerals. Duration depends on employment contract or CLA.', true),
          ('Special Leave', 'special', true, true, 0, 'per_event', 100, 10, 'Time off for own wedding, moving, military/civil service, jury duty, medical appointments, etc.', true),
          ('Unpaid Leave', 'unpaid', false, true, 0, 'by_agreement', 0, NULL, 'No statutory right. Must be agreed with employer. Limited duration, affects insurance coverage.', true),
          ('Education Leave', 'education', true, true, 0, 'by_agreement', 100, NULL, 'Time off for job-related training or education. Subject to company policy or contract.', true),
          ('Military/Civil Service', 'military', true, false, NULL, 'unlimited', 100, NULL, 'Paid leave for mandatory Swiss military or civil service. Salary partially compensated by EO.', true)
        `);
        console.log('✅ Swiss-compliant leave types inserted');
      }

      // Insert default company settings if table is empty
      const settingsCount = await pool.query('SELECT COUNT(*) FROM company_settings');
      if (parseInt(settingsCount.rows[0].count) === 0) {
        await pool.query(`
          INSERT INTO company_settings (
            name, industry, brand_color, brand_color_name, support_email, 
            company_phone, address, logo_url, website, timezone, 
            founded_date, employee_count, description
          ) VALUES (
            'Acme Inc.', 'IT Company', '#6366F1', 'Purple', 'Acmeinc@gmail.com',
            '(+1) 740-8521', '45 Cloudy Bay, Auckland, NZ', 
            'https://ui-avatars.com/api/?name=Acme+Inc&size=200&background=6366F1&color=ffffff',
            'https://acme.inc', 'Pacific/Auckland', '2020-01-01', 150,
            'Leading technology company providing innovative solutions'
          )
        `);
        console.log('✅ Default company settings created');
      }
      
      // Migrate timers.employee_id from INTEGER to VARCHAR
      try {
        await pool.query(`
          ALTER TABLE timers 
          ALTER COLUMN employee_id TYPE VARCHAR(100) USING employee_id::VARCHAR;
        `);
        console.log('✅ timers.employee_id migrated to VARCHAR');
      } catch (e) {
        // Column might already be VARCHAR or other issue - ignore
      }

      // ==================== ROW-LEVEL SECURITY (RLS) ====================
      // Enable RLS on tenant-scoped tables for DB-level isolation
      const rlsTables = ['employees', 'timers', 'leave_requests', 'leave_types', 'employee_leave_balances', 'company_settings'];
      for (const table of rlsTables) {
        try {
          await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
          // Create policy to restrict rows by tenant_id (if column exists)
          await pool.query(`
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${table}_tenant_isolation') THEN
                EXECUTE 'CREATE POLICY ${table}_tenant_isolation ON ${table} USING (tenant_id = current_setting(''app.current_tenant_id'', true)::integer)';
              END IF;
            EXCEPTION WHEN OTHERS THEN NULL;
            END $$;
          `);
        } catch (rlsErr) {
          // Table may not have tenant_id column or RLS may already be enabled
        }
      }
      console.log('✅ Row-Level Security (RLS) configured');
      
      console.log('✅ Database schema verified/updated');
    } catch (schemaError) {
      console.log('⚠️ Schema update warning:', schemaError.message);
    }
  }
});

const app = express();

// Load Swagger specification
let swaggerDocument;
try {
  const swaggerPath = path.join(__dirname, 'swagger-spec.json');
  swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
  console.log('📚 Swagger documentation loaded successfully');
  console.log(`📊 Total APIs documented: ${Object.keys(swaggerDocument.paths || {}).length}`);
} catch (error) {
  console.log('⚠️ Could not load swagger documentation:', error.message);
  swaggerDocument = {
    openapi: '3.0.0',
    info: {
      title: 'Complete Working Time Management API',
      version: '3.0.0',
      description: 'Complete API collection with all endpoints for Working Time Management System'
    },
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login'
        }
      }
    },
    paths: {}
  };
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-for-development-only';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || JWT_SECRET + '-refresh-token-secret';

// ==================== RATE LIMITING PER TENANT ====================
const tenantRateLimits = {};
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 200; // Max 200 requests per minute per tenant

function tenantRateLimiter(req, res, next) {
  // Extract tenant from token if available
  const authHeader = req.headers['authorization'];
  let tenantKey = req.ip; // Fallback to IP

  if (authHeader) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.tenantId) tenantKey = `tenant_${decoded.tenantId}`;
    } catch (e) { /* use IP fallback */ }
  }

  const now = Date.now();
  if (!tenantRateLimits[tenantKey]) {
    tenantRateLimits[tenantKey] = { count: 1, windowStart: now };
  } else {
    const entry = tenantRateLimits[tenantKey];
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      // Reset window
      entry.count = 1;
      entry.windowStart = now;
    } else {
      entry.count++;
      if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
        res.set('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          retryAfterSeconds: retryAfter
        });
      }
    }
  }
  next();
}

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const key in tenantRateLimits) {
    if (now - tenantRateLimits[key].windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      delete tenantRateLimits[key];
    }
  }
}, 5 * 60 * 1000);

// Swiss Canton Configuration
const SWISS_CANTONS = {
  ZH: { name: 'Zurich', publicHolidays: 9 },
  BE: { name: 'Bern', publicHolidays: 10 },
  LU: { name: 'Lucerne', publicHolidays: 11 },
  UR: { name: 'Uri', publicHolidays: 12 },
  SZ: { name: 'Schwyz', publicHolidays: 11 },
  OW: { name: 'Obwalden', publicHolidays: 13 },
  NW: { name: 'Nidwalden', publicHolidays: 13 },
  GL: { name: 'Glarus', publicHolidays: 10 },
  ZG: { name: 'Zug', publicHolidays: 11 },
  FR: { name: 'Fribourg', publicHolidays: 11 },
  SO: { name: 'Solothurn', publicHolidays: 10 },
  BS: { name: 'Basel-Stadt', publicHolidays: 10 },
  BL: { name: 'Basel-Landschaft', publicHolidays: 10 },
  SH: { name: 'Schaffhausen', publicHolidays: 10 },
  AR: { name: 'Appenzell Ausserrhoden', publicHolidays: 11 },
  AI: { name: 'Appenzell Innerrhoden', publicHolidays: 14 },
  SG: { name: 'St. Gallen', publicHolidays: 11 },
  GR: { name: 'Graubünden', publicHolidays: 10 },
  AG: { name: 'Aargau', publicHolidays: 10 },
  TG: { name: 'Thurgau', publicHolidays: 9 },
  TI: { name: 'Ticino', publicHolidays: 13 },
  VD: { name: 'Vaud', publicHolidays: 10 },
  VS: { name: 'Valais', publicHolidays: 12 },
  NE: { name: 'Neuchâtel', publicHolidays: 10 },
  GE: { name: 'Geneva', publicHolidays: 11 },
  JU: { name: 'Jura', publicHolidays: 12 }
};

// Swiss Legal Leave Minimums (in days)
const SWISS_LEAVE_MINIMUMS = {
  annual_leave: { under20: 25, default: 20 },
  sick_leave_year1: 21, // 3 weeks
  maternity: 98, // 14 weeks
  paternity: 10, // 2 weeks
  adoption: 10, // 2 weeks
  family_care: 3, // per event
  family_care_extended: 98 // 14 weeks for seriously ill children
};

// Helper function to format phone numbers with space after dial code
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  const cleaned = phone.trim();
  
  // If phone starts with + (international format)
  if (cleaned.startsWith('+')) {
    // Match pattern like +1234567890 or +91234567890
    const match = cleaned.match(/^(\+\d{1,4})(\d+)$/);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
  }
  
  return cleaned;
}

// Email Configuration (SMTP) - Use environment variables in production
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.champdynamics.in',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true, // use SSL on port 465
  auth: {
    user: process.env.SMTP_USER || 'info@champdynamics.in',
    pass: process.env.SMTP_PASS || 'Arun@9812Champ'
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 45000,
  pool: false
});

// Email relay URL for serverless environments where SMTP is blocked
const EMAIL_RELAY_URL = process.env.EMAIL_RELAY_URL || 'http://72.60.220.135:4000/send-email';
const EMAIL_RELAY_SECRET = process.env.EMAIL_RELAY_SECRET || 'mtime-email-relay-2026-secure';

// Send email via HTTP relay (works on Vercel where SMTP is blocked)
async function sendEmailViaRelay(mailOptions) {
  const response = await fetch(EMAIL_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: EMAIL_RELAY_SECRET,
      from: mailOptions.from || 'info@champdynamics.in',
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html
    })              
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message || 'Relay email failed');
  return data;
}

// Helper function to send email - tries SMTP first, falls back to relay
async function sendEmailWithRetry(mailOptions, maxRetries = 2) {
  // Try SMTP first
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await emailTransporter.sendMail(mailOptions);
      return { success: true, result };
    } catch (error) {
      console.log(`SMTP attempt ${attempt}/${maxRetries} failed:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  // Fallback to HTTP relay
  try {
    console.log('📧 Falling back to email relay...');
    const result = await sendEmailViaRelay(mailOptions);
    console.log('✅ Email sent via relay');
    return { success: true, result };
  } catch (relayError) {
    console.log('❌ Relay also failed:', relayError.message);
    return { success: false, error: relayError.message };
  }
}

// Test email configuration
emailTransporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email configuration error:', error.message);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// Enhanced CORS Configuration - Allow all origins and methods
app.use((req, res, next) => {
  // Allow requests from any origin
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Apply cors middleware as backup
app.use(cors({ 
  origin: true, 
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
}));

// Apply tenant-based rate limiting to all API routes
app.use('/api/', tenantRateLimiter);

// ==================== TENANT ISOLATION MIDDLEWARE ====================

// ==================== ACTIVITY LOG HELPER ====================
async function logActivity({ tenantId, actorId, actorName, actorType = 'system', category = 'system', action, title, description, targetType, targetId, targetName, metadata, ipAddress }) {
  try {
    await pool.query(`
      INSERT INTO activity_logs (tenant_id, actor_id, actor_name, actor_type, category, action, title, description, target_type, target_id, target_name, metadata, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [tenantId, actorId, actorName, actorType, category, action, title, description, targetType, targetId, targetName, metadata ? JSON.stringify(metadata) : null, ipAddress]);
  } catch (err) {
    console.error('⚠️ Failed to log activity:', err.message);
  }
}

// Cross-tenant violation log table (created on startup)
async function createSecurityLogTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_security_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_email VARCHAR(255),
        user_tenant_id INTEGER,
        requested_tenant_id INTEGER,
        endpoint VARCHAR(500),
        method VARCHAR(10),
        ip_address VARCHAR(100),
        user_agent TEXT,
        severity VARCHAR(20) DEFAULT 'warning',
        details TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ tenant_security_logs table ready');
  } catch (err) {
    console.log('⚠️ Security log table creation:', err.message);
  }
}
createSecurityLogTable();

// Log cross-tenant violation to database
async function logTenantViolation(req, details) {
  try {
    await pool.query(
      `INSERT INTO tenant_security_logs 
       (user_id, user_email, user_tenant_id, requested_tenant_id, endpoint, method, ip_address, user_agent, severity, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.user?.userId || null,
        req.user?.email || 'unknown',
        req.user?.tenantId || null,
        details.requestedTenantId || null,
        req.originalUrl,
        req.method,
        req.ip || req.headers['x-forwarded-for'] || 'unknown',
        (req.headers['user-agent'] || 'unknown').substring(0, 500),
        details.severity || 'warning',
        details.message || 'Cross-tenant access attempt detected'
      ]
    );
    console.log(`🚨 SECURITY: Cross-tenant violation logged - User ${req.user?.userId} (tenant ${req.user?.tenantId}) tried to access tenant ${details.requestedTenantId}`);
  } catch (err) {
    console.error('❌ Failed to log security event:', err.message);
  }
}

// Tenant isolation helper - validates tenant_id in request body/params/query
function tenantGuard(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return next(); // unauthenticated routes skip
  }

  const userTenantId = parseInt(req.user.tenantId);

  // Check body for tenant_id mismatch
  if (req.body && req.body.tenant_id && parseInt(req.body.tenant_id) !== userTenantId) {
    logTenantViolation(req, {
      requestedTenantId: parseInt(req.body.tenant_id),
      severity: 'critical',
      message: `Body tenant_id ${req.body.tenant_id} does not match user tenant_id ${userTenantId}`
    });
    return res.status(403).json({
      success: false,
      message: 'Access denied: tenant mismatch'
    });
  }

  // Check query params for tenant_id mismatch
  if (req.query && req.query.tenant_id && parseInt(req.query.tenant_id) !== userTenantId) {
    logTenantViolation(req, {
      requestedTenantId: parseInt(req.query.tenant_id),
      severity: 'critical',
      message: `Query tenant_id ${req.query.tenant_id} does not match user tenant_id ${userTenantId}`
    });
    return res.status(403).json({
      success: false,
      message: 'Access denied: tenant mismatch'
    });
  }

  next();
}

// Apply tenant guard to all API routes
// Note: tenantGuard is called inside authenticateToken after req.user is set

// FIRST: Check content-type and set flag for multipart
app.use((req, res, next) => {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  req._isMultipart = contentType.includes('multipart');
  console.log('[Middleware] Content-Type:', contentType, '| isMultipart:', req._isMultipart);
  next();
});

// Routes that use multer (NOT express-fileupload)
const multerRoutes = [
  '/api/me/profile/photo',
  '/api/company/registration/logo',
  '/api/company/settings/logo',
  '/api/company/logo'
];

// Conditionally use express-fileupload ONLY for multipart/form-data requests
// But NOT for routes that use multer
app.use((req, res, next) => {
  // Check if this route uses multer
  const usesMulter = multerRoutes.some(route => req.path.startsWith(route));
  
  if (req._isMultipart && !usesMulter) {
    // Use express-fileupload for multipart requests (except multer routes)
    fileUpload({
      limits: { fileSize: 4 * 1024 * 1024 },
      abortOnLimit: false,
      parseNested: true,
      useTempFiles: false,
      debug: false
    })(req, res, next);
  } else {
    next();
  }
});

// JSON body parser - only for non-multipart requests with error recovery
app.use((req, res, next) => {
  if (req._isMultipart) {
    return next();
  }
  express.json({ limit: '50mb' })(req, res, (err) => {
    if (err && err.type === 'entity.parse.failed') {
      // Check if the body looks like multipart (starts with dashes)
      if (err.body && typeof err.body === 'string' && err.body.startsWith('------')) {
        console.log('[JSON Parser] Detected multipart body, skipping');
        req._isMultipart = true;
        req.body = {};
        return next();
      }
      // Try to auto-fix unquoted strings in JSON (e.g. [EMP002] -> ["EMP002"])
      if (err.body && typeof err.body === 'string') {
        try {
          const raw = err.body;
          // Replace unquoted bare words in arrays/values that aren't true/false/null/numbers
          const fixed = raw.replace(/([\[,:\s])([A-Za-z][A-Za-z0-9_]*)(\s*[,\]\}])/g, (m, before, word, after) => {
            if (['true', 'false', 'null'].includes(word)) return m;
            return before + '"' + word + '"' + after;
          });
          const parsed = JSON.parse(fixed);
          req.body = parsed;
          console.log('[JSON Parser] Auto-fixed malformed JSON:', JSON.stringify(parsed));
          return next();
        } catch (fixErr) {
          // auto-fix failed, pass original error
        }
      }
    }
    if (err) return next(err);
    next();
  });
});

// URL encoded body parser - only for application/x-www-form-urlencoded  
app.use((req, res, next) => {
  if (req._isMultipart) {
    return next();
  }
  express.urlencoded({ limit: '50mb', extended: true })(req, res, next);
});

// DEBUG ENDPOINT - Test multipart handling (protected)
app.post('/api/debug/multipart-test', authenticateToken, uploadCompanyLogo.single('file'), (req, res) => {
  res.json({
    success: true,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length']
    },
    body: req.body,
    file: req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : null,
    skipBodyParse: req._skipBodyParse || false
  });
});

// EARLY REGISTRATION: Admin Leave Requests GET
app.get('/api/admin/leave-requests', authenticateToken, async (req, res) => {
  const userId = parseInt(req.user.userId);
  const tenantId = parseInt(req.user.tenantId);
  const userType = req.user.userType;

  try {
    let user = null;
    let isAdmin = false;

    // Check both employees and company_details tables based on userType
    if (userType === 'admin') {
      // Admin from company_details table
      const adminResult = await pool.query(
        'SELECT id, name as full_name, role, tenant_id FROM company_details WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = adminResult.rows[0];
      isAdmin = true;
    } else {
      // Employee from employees table
      const userResult = await pool.query(
        'SELECT id, full_name, role, is_admin, tenant_id FROM employees WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = userResult.rows[0];
      isAdmin = user && (user.role === 'Admin' || user.role === 'Manager' || user.is_admin);
    }

    // Check admin/manager permission
    if (!user || !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can view all leave requests'
      });
    }

    const { status, user_id, employee_id, leave_type_id, leave_type, start_date, end_date, department, search, sort_by = 'created_at', sort_order = 'desc', page = 1, limit = 50 } = req.query;

    // Support both user_id and employee_id params
    const filterEmployeeId = employee_id || user_id;

    // Build query with filters - filter by tenant_id to get all employees' leave requests
    let query = `
      SELECT lr.*, 
             e.full_name as user_name,
             e.email as user_email,
             e.department as user_department,
             e.employee_id as real_employee_id,
             e.profile_photo as user_profile_photo,
             lt.name as leave_type_name,
             lt.color as leave_type_color,
             lt.requires_approval,
             lt.is_paid
      FROM leave_requests lr
      LEFT JOIN employees e ON lr.employee_id = e.employee_id
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE e.tenant_id::integer = $1
    `;
    
    const params = [tenantId];
    let paramCount = 2;

    if (status) {
      query += ` AND lr.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (filterEmployeeId) {
      query += ` AND e.id = $${paramCount}`;
      params.push(parseInt(filterEmployeeId));
      paramCount++;
    }

    if (leave_type_id) {
      query += ` AND lr.leave_type_id = $${paramCount}`;
      params.push(parseInt(leave_type_id));
      paramCount++;
    }

    if (leave_type) {
      query += ` AND LOWER(lr.leave_type) = LOWER($${paramCount})`;
      params.push(leave_type);
      paramCount++;
    }

    if (start_date) {
      query += ` AND lr.start_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND lr.end_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    if (department) {
      query += ` AND LOWER(e.department) = LOWER($${paramCount})`;
      params.push(department);
      paramCount++;
    }

    if (search) {
      query += ` AND (LOWER(e.full_name) LIKE LOWER($${paramCount}) OR LOWER(e.employee_id) LIKE LOWER($${paramCount}) OR LOWER(lr.leave_type) LIKE LOWER($${paramCount}))`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Sorting - whitelist allowed columns
    const allowedSortColumns = ['created_at', 'start_date', 'end_date', 'status', 'leave_type', 'total_days'];
    const safeSortBy = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY lr.${safeSortBy} ${safeSortOrder}`;

    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

    // Get total count with same filters
    let countQuery = `
      SELECT COUNT(*) 
      FROM leave_requests lr
      LEFT JOIN employees e ON lr.employee_id = e.employee_id
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE e.tenant_id::integer = $1
    `;
    const countParams = [tenantId];
    let countParamNum = 2;

    if (status) {
      countQuery += ` AND lr.status = $${countParamNum}`;
      countParams.push(status);
      countParamNum++;
    }

    if (filterEmployeeId) {
      countQuery += ` AND e.id = $${countParamNum}`;
      countParams.push(parseInt(filterEmployeeId));
      countParamNum++;
    }

    if (leave_type_id) {
      countQuery += ` AND lr.leave_type_id = $${countParamNum}`;
      countParams.push(parseInt(leave_type_id));
      countParamNum++;
    }

    if (leave_type) {
      countQuery += ` AND LOWER(lr.leave_type) = LOWER($${countParamNum})`;
      countParams.push(leave_type);
      countParamNum++;
    }

    if (start_date) {
      countQuery += ` AND lr.start_date >= $${countParamNum}`;
      countParams.push(start_date);
      countParamNum++;
    }

    if (end_date) {
      countQuery += ` AND lr.end_date <= $${countParamNum}`;
      countParams.push(end_date);
      countParamNum++;
    }

    if (department) {
      countQuery += ` AND LOWER(e.department) = LOWER($${countParamNum})`;
      countParams.push(department);
      countParamNum++;
    }

    if (search) {
      countQuery += ` AND (LOWER(e.full_name) LIKE LOWER($${countParamNum}) OR LOWER(e.employee_id) LIKE LOWER($${countParamNum}) OR LOWER(lr.leave_type) LIKE LOWER($${countParamNum}))`;
      countParams.push(`%${search}%`);
      countParamNum++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    console.log(`✅ Admin ${user.full_name} (tenant_id: ${tenantId}) retrieved ${result.rows.length} leave requests`);

    // Map results to include employee_id
    const leaveRequests = result.rows.map(lr => ({
      ...lr,
      employee_id: lr.real_employee_id
    }));

    res.json({
      success: true,
      message: 'Leave requests retrieved successfully',
      data: {
        leave_requests: leaveRequests,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          total_pages: Math.ceil(totalCount / parseInt(limit))
        },
        filters: {
          status: status || 'all',
          employee_id: filterEmployeeId || 'all',
          leave_type_id: leave_type_id || 'all',
          leave_type: leave_type || 'all',
          start_date: start_date || 'all',
          end_date: end_date || 'all',
          department: department || 'all',
          search: search || null,
          sort_by: safeSortBy,
          sort_order: safeSortOrder
        }
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving leave requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve leave requests',
      error: error.message
    });
  }
});

// GET Single Leave Request by ID (Admin/Manager)
app.get('/api/admin/leave-requests/:id', authenticateToken, async (req, res) => {
  const userId = parseInt(req.user.userId);
  const tenantId = parseInt(req.user.tenantId);
  const userType = req.user.userType;
  const requestId = parseInt(req.params.id);

  try {
    let user = null;
    let isAdmin = false;

    // Check both employees and company_details tables based on userType
    if (userType === 'admin') {
      // Admin from company_details table
      const adminResult = await pool.query(
        'SELECT id, name as full_name, role, tenant_id FROM company_details WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = adminResult.rows[0];
      isAdmin = true;
    } else {
      // Employee from employees table
      const userResult = await pool.query(
        'SELECT id, full_name, role, is_admin, tenant_id FROM employees WHERE id = $1 AND tenant_id::integer = $2',
        [userId, tenantId]
      );
      user = userResult.rows[0];
      isAdmin = user && (user.role === 'Admin' || user.role === 'Manager' || user.is_admin);
    }
    
    // Check admin/manager permission
    if (!user || !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and managers can view leave request details'
      });
    }

    // Get the leave request - ensure it belongs to the same tenant_id
    const result = await pool.query(
      `SELECT lr.* 
       FROM leave_requests lr
       LEFT JOIN employees e ON lr.employee_id = e.employee_id
       WHERE lr.id = $1 AND e.tenant_id::integer = $2`,
      [requestId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const leaveRequest = result.rows[0];

    // Get employee details separately
    let employeeDetails = null;
    if (leaveRequest.employee_id) {
      const empResult = await pool.query(
        'SELECT id, full_name, email, department, employee_id FROM employees WHERE employee_id = $1 AND tenant_id::integer = $2',
        [leaveRequest.employee_id, tenantId]
      );
      employeeDetails = empResult.rows[0] || null;
    }

    // Get leave type details separately
    let leaveTypeDetails = null;
    if (leaveRequest.leave_type_id) {
      const ltResult = await pool.query(
        'SELECT id, name, color, requires_approval, is_paid FROM leave_types WHERE id = $1',
        [leaveRequest.leave_type_id]
      );
      leaveTypeDetails = ltResult.rows[0] || null;
    }

    // Get approver details separately
    let approverDetails = null;
    if (leaveRequest.approved_by) {
      const approverResult = await pool.query(
        'SELECT id, full_name FROM employees WHERE id = $1',
        [leaveRequest.approved_by]
      );
      approverDetails = approverResult.rows[0] || null;
    }

    console.log(`✅ Admin ${user.full_name} retrieved leave request #${requestId}`);

    res.json({
      success: true,
      message: 'Leave request retrieved successfully',
      data: {
        ...leaveRequest,
        user_name: employeeDetails?.full_name || null,
        user_email: employeeDetails?.email || null,
        user_department: employeeDetails?.department || null,
        real_employee_id: employeeDetails?.employee_id || null,
        leave_type_name: leaveTypeDetails?.name || null,
        leave_type_color: leaveTypeDetails?.color || null,
        requires_approval: leaveTypeDetails?.requires_approval || null,
        is_paid: leaveTypeDetails?.is_paid || null,
        approved_by_name: approverDetails?.full_name || null
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving leave request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve leave request',
      error: error.message
    });
  }
});

// EARLY REGISTRATION: /api/me/leave-balance - Swiss-compliant dynamic system
app.get('/api/me/leave-balance', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const tenantId = req.user.tenantId;

  try {
    // Get employee info for tenure and age calculation
    const empResult = await pool.query(
      'SELECT employee_id, start_date, date_of_birth FROM employees WHERE id = $1',
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const employee = empResult.rows[0];
    const employeeId = employee.employee_id;

    // Get all active leave types (tenant-specific first, fallback to system defaults)
    let leaveTypesResult = await pool.query(`
      SELECT id, name, code, is_paid, days_allowed, legal_minimum, accrual_type, salary_percentage, max_days_per_year, description
      FROM leave_types
      WHERE is_active = true AND tenant_id = $1
      ORDER BY id
    `, [tenantId]);

    // Fallback to system defaults if no tenant-specific leave types
    if (leaveTypesResult.rows.length === 0) {
      leaveTypesResult = await pool.query(`
        SELECT id, name, code, is_paid, days_allowed, legal_minimum, accrual_type, salary_percentage, max_days_per_year, description
        FROM leave_types
        WHERE is_active = true AND tenant_id IS NULL
        ORDER BY id
      `);
    }

    // Get company policies for this tenant
    const policiesResult = await pool.query(`
      SELECT leave_type_id, default_days, accrual_rule
      FROM company_leave_policies
      WHERE tenant_id = $1 AND is_active = true
    `, [tenantId || 0]);

    const companyPolicies = {};
    policiesResult.rows.forEach(row => {
      companyPolicies[row.leave_type_id] = {
        defaultDays: row.default_days,
        accrualRule: row.accrual_rule
      };
    });

    // Get employee-specific balances
    const empBalancesResult = await pool.query(`
      SELECT leave_type_id, total_allocated, used_days, pending_days, available_days
      FROM employee_leave_balances
      WHERE employee_id = $1 AND tenant_id = $2
    `, [employeeId, tenantId || 0]);

    const empBalances = {};
    empBalancesResult.rows.forEach(row => {
      empBalances[row.leave_type_id] = {
        totalAllocated: parseFloat(row.total_allocated),
        usedDays: parseFloat(row.used_days),
        pendingDays: parseFloat(row.pending_days),
        availableDays: parseFloat(row.available_days)
      };
    });

    // Get used and pending leaves from leave_requests
    const leavesResult = await pool.query(`
      SELECT 
        lt.id as leave_type_id,
        SUM(CASE WHEN lr.status = 'approved' THEN 
          CASE 
            WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1)
            ELSE 1
          END
        ELSE 0 END) as used_days,
        SUM(CASE WHEN lr.status = 'pending' THEN 
          CASE 
            WHEN lr.end_date IS NOT NULL THEN (lr.end_date::date - lr.start_date::date + 1)
            ELSE 1
          END
        ELSE 0 END) as pending_days
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id OR lr.leave_type = lt.name
      WHERE lr.employee_id = $1
      GROUP BY lt.id
    `, [employeeId]);

    const usedAndPending = {};
    leavesResult.rows.forEach(row => {
      if (row.leave_type_id) {
        usedAndPending[row.leave_type_id] = {
          used: parseFloat(row.used_days) || 0,
          pending: parseFloat(row.pending_days) || 0
        };
      }
    });

    // Calculate tenure in years for sick leave accrual
    const startDate = employee.start_date ? new Date(employee.start_date) : new Date();
    const tenureYears = Math.floor((new Date() - startDate) / (365.25 * 24 * 60 * 60 * 1000));

    // Calculate age for annual leave (under 20 gets 25 days)
    const age = employee.date_of_birth 
      ? Math.floor((new Date() - new Date(employee.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000))
      : 20;

    // Build leave balances array
    const leaveBalances = [];

    leaveTypesResult.rows.forEach(leaveType => {
      // Start with days_allowed from leave_types table
      let totalAllocated = leaveType.days_allowed || leaveType.legal_minimum || 0;

      // Apply company policy override if exists
      if (companyPolicies[leaveType.id]) {
        totalAllocated = companyPolicies[leaveType.id].defaultDays;
      }

      // Apply employee-specific balance override if set
      if (empBalances[leaveType.id]) {
        totalAllocated = empBalances[leaveType.id].totalAllocated;
      }

      const used = usedAndPending[leaveType.id]?.used || 0;
      const pending = usedAndPending[leaveType.id]?.pending || 0;
      const available = Math.max(0, totalAllocated - used - pending);

      leaveBalances.push({
        leaveTypeId: leaveType.id,
        name: leaveType.name,
        code: leaveType.code,
        isPaid: leaveType.is_paid,
        salaryPercentage: leaveType.salary_percentage,
        totalAllocated: totalAllocated,
        usedDays: used,
        pendingDays: pending,
        availableDays: available,
        description: leaveType.description
      });
    });

    // Get total pending requests count
    const pendingCount = await pool.query(
      "SELECT COUNT(*) as count FROM leave_requests WHERE employee_id = $1 AND status = 'pending'",
      [employeeId]
    );

    res.json({
      success: true,
      message: "Leave balance retrieved successfully",
      data: {
        employeeId: employeeId,
        tenureYears: tenureYears,
        age: age,
        leaveBalances: leaveBalances,
        pendingRequestsCount: parseInt(pendingCount.rows[0]?.count) || 0
      }
    });
  } catch (error) {
    console.error('Leave balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave balance',
      error: error.message
    });
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve HTML files from root
app.use(express.static(__dirname));

// Routes for HTML pages
app.get('/setup-account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup-account.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// PERSISTENT USER DATA STORAGE - This fixes the "Jenny Wilson" revert issue
let persistentUsers = {
  1: {
    id: 1,
    first_name: "Admin",
    last_name: "User",
    full_name: "Admin User",
    email: "admin@company.com",
    password: "$2b$10$Sz8ypMkuv5RoapiwozsMXOY5Q6lc.6l/cd0lPF0LInvm4pHnaQ4a.", // admin123
    phone: "(+1) 555-0001",
    role: "Admin",
    profile_photo: "https://ui-avatars.com/api/?name=Admin+User&size=150",
    project: "Administration",
    location: "Head Office",
    department: "Management",
    employee_id: "ADM001",
    status: "Active",
    is_admin: true,
    permissions: ["all"]
  },
  2: {
    id: 2,
    first_name: "John",
    last_name: "Doe", 
    full_name: "John Doe",
    email: "john.doe@email.com",
    phone: "(+1) 555-0123",
    role: "Developer",
    profile_photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    project: "E-Commerce Platform",
    location: "New York, USA"
  },
  3: {
    id: 3,
    first_name: "Sarah",
    last_name: "Johnson",
    full_name: "Sarah Johnson", 
    email: "sarah.johnson@email.com",
    phone: "(+1) 555-0456",
    role: "Designer",
    profile_photo: "https://images.unsplash.com/photo-1494790108755-2616b612c937?w=150",
    project: "Mobile App Design",
    location: "California, USA"
  },
  4: {
    id: 4,
    first_name: "Mike",
    last_name: "Chen",
    full_name: "Mike Chen",
    email: "mike.chen@email.com", 
    phone: "(+1) 555-0789",
    role: "Manager",
    profile_photo: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150",
    project: "Team Management",
    location: "Remote"
  }
};

// PERSISTENT TIMER STORAGE - This fixes the auto-stop issue
let persistentTimers = {};
let dailyLimits = {};

// PERSISTENT VACATION BALANCES STORAGE
let persistentVacationBalances = {
  1: { total_days: 20, used_days: 5, pending_days: 2, available_days: 13 },
  2: { total_days: 20, used_days: 3, pending_days: 0, available_days: 17 },
  3: { total_days: 25, used_days: 8, pending_days: 1, available_days: 16 },
  4: { total_days: 20, used_days: 0, pending_days: 0, available_days: 20 }
};

// PERSISTENT EMPLOYEE ACTIVITIES STORAGE
let persistentActivities = {};

// Helper function to add activity
function addActivity(userId, type, message, metadata = {}) {
  if (!persistentActivities[userId]) {
    persistentActivities[userId] = [];
  }
  
  const activity = {
    id: `ACT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    user_id: userId,
    type: type,
    message: message,
    timestamp: new Date().toISOString(),
    metadata: metadata
  };
  
  persistentActivities[userId].unshift(activity);
  
  if (persistentActivities[userId].length > 100) {
    persistentActivities[userId] = persistentActivities[userId].slice(0, 100);
  }
  
  return activity;
}

// TEMPORARY COMPANY REGISTRATION STORAGE (Multi-step registration)
let tempCompanyRegistrations = {};

// FORGOT PASSWORD OTP STORAGE
let forgotPasswordOTPs = {};

// PERSISTENT COMPANY SETTINGS STORAGE
let companySettings = {
  id: 1,
  name: "Acme Inc.",
  industry: "IT Company",
  brand_color: "#6366F1",
  brand_color_name: "Purple",
  support_email: "Acmeinc@gmail.com",
  company_phone: "(+1) 740-8521",
  address: "45 Cloudy Bay, Auckland, NZ",
  logo_url: "https://ui-avatars.com/api/?name=Acme+Inc&size=200&background=6366F1&color=ffffff",
  website: "https://acme.inc",
  timezone: "Pacific/Auckland",
  founded_date: "2020-01-01",
  employee_count: 150,
  description: "Leading technology company providing innovative solutions",
  updated_at: new Date().toISOString()
};

// PERSISTENT USER PREFERENCES STORAGE
let userPreferences = {
  1: {
    user_id: 1,
    language: "English",
    language_code: "en",
    time_format: "24-hour",
    first_day_of_week: "Monday",
    timezone: "UTC",
    date_format: "YYYY-MM-DD",
    updated_at: new Date().toISOString()
  },
  2: {
    user_id: 2,
    language: "English",
    language_code: "en",
    time_format: "24-hour",
    first_day_of_week: "Monday",
    timezone: "UTC",
    date_format: "YYYY-MM-DD",
    updated_at: new Date().toISOString()
  },
  3: {
    user_id: 3,
    language: "English",
    language_code: "en",
    time_format: "24-hour",
    first_day_of_week: "Monday",
    timezone: "UTC",
    date_format: "YYYY-MM-DD",
    updated_at: new Date().toISOString()
  }
};

// Load data from DATABASE and sync to memory for fast access (HYBRID APPROACH)
async function loadPersistentData() {
  console.log('📂 Loading data from PostgreSQL database...');
  
  try {
    // Load users from database
    const usersResult = await pool.query('SELECT * FROM employees ORDER BY id');
    if (usersResult.rows.length > 0) {
      persistentUsers = {};
      usersResult.rows.forEach(user => {
        persistentUsers[user.id] = user;
      });
      console.log(`✅ Loaded ${usersResult.rows.length} users from database`);
    }
    
    // Load company settings
    const settingsResult = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (settingsResult.rows.length > 0) {
      companySettings = settingsResult.rows[0];
      console.log(`✅ Loaded company settings from database`);
    }
    
    // Load user preferences
    const prefsResult = await pool.query('SELECT * FROM user_preferences');
    if (prefsResult.rows.length > 0) {
      userPreferences = {};
      prefsResult.rows.forEach(pref => {
        userPreferences[pref.user_id] = pref;
      });
      console.log(`✅ Loaded ${prefsResult.rows.length} user preferences from database`);
    }
    
    // Load vacation balances
    const vacationResult = await pool.query('SELECT * FROM vacation_balances');
    if (vacationResult.rows.length > 0) {
      persistentVacationBalances = {};
      vacationResult.rows.forEach(vb => {
        persistentVacationBalances[vb.user_id] = vb;
      });
      console.log(`✅ Loaded ${vacationResult.rows.length} vacation balances from database`);
    }
    
  } catch (error) {
    console.log('⚠️ Could not load from database, using defaults:', error.message);
  }
  
  // Initialize timer storage (these are session-based, so memory is OK)
  if (!persistentTimers) {
    persistentTimers = {};
  }
  
  if (!dailyLimits) {
    dailyLimits = {};
  }
  
  console.log('✅ Data loaded successfully (hybrid mode)');
}

// Save data to DATABASE (called after any write operation)
async function savePersistentData() {
  console.log('💾 Syncing data to PostgreSQL database...');
  
  try {
    // Sync users to database
    for (const userId in persistentUsers) {
      const user = persistentUsers[userId];
      await pool.query(`
        INSERT INTO employees (
          id, first_name, last_name, full_name, email, phone, password,
          profile_photo, role, department, status, project, location
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          password = EXCLUDED.password,
          profile_photo = EXCLUDED.profile_photo,
          role = EXCLUDED.role,
          department = EXCLUDED.department,
          status = EXCLUDED.status,
          project = EXCLUDED.project,
          location = EXCLUDED.location,
          updated_at = NOW()
      `, [
        user.id, user.first_name, user.last_name, user.full_name, 
        user.email, user.phone, user.password, user.profile_photo,
        user.role, user.department, user.status, user.project, user.location
      ]);
    }
    
    // Sync company settings
    if (companySettings && companySettings.id) {
      await pool.query(`
        UPDATE company_settings SET
          name = $1, industry = $2, brand_color = $3, brand_color_name = $4,
          support_email = $5, company_phone = $6, address = $7, logo_url = $8,
          website = $9, timezone = $10, founded_date = $11, employee_count = $12,
          description = $13, updated_at = NOW()
        WHERE id = $14
      `, [
        companySettings.name, companySettings.industry, companySettings.brand_color,
        companySettings.brand_color_name, companySettings.support_email, 
        companySettings.company_phone, companySettings.address, companySettings.logo_url,
        companySettings.website, companySettings.timezone, companySettings.founded_date,
        companySettings.employee_count, companySettings.description, companySettings.id
      ]);
    }
    
    // Sync user preferences
    for (const userId in userPreferences) {
      const pref = userPreferences[userId];
      await pool.query(`
        INSERT INTO user_preferences (
          user_id, language, language_code, time_format, 
          first_day_of_week, timezone, date_format
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE SET
          language = EXCLUDED.language,
          language_code = EXCLUDED.language_code,
          time_format = EXCLUDED.time_format,
          first_day_of_week = EXCLUDED.first_day_of_week,
          timezone = EXCLUDED.timezone,
          date_format = EXCLUDED.date_format,
          updated_at = NOW()
      `, [
        userId, pref.language, pref.language_code, pref.time_format,
        pref.first_day_of_week, pref.timezone, pref.date_format
      ]);
    }
    
    // Sync vacation balances
    for (const userId in persistentVacationBalances) {
      const vb = persistentVacationBalances[userId];
      await pool.query(`
        INSERT INTO vacation_balances (
          user_id, total_days, used_days, pending_days, available_days
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
          total_days = EXCLUDED.total_days,
          used_days = EXCLUDED.used_days,
          pending_days = EXCLUDED.pending_days,
          available_days = EXCLUDED.available_days,
          updated_at = NOW()
      `, [userId, vb.total_days, vb.used_days, vb.pending_days, vb.available_days]);
    }
    
    console.log('✅ All data synced to database successfully');
  } catch (error) {
    console.error('❌ Error syncing to database:', error.message);
  }
}

// Initialize data (async wrapper)
setTimeout(async () => {
  await loadPersistentData();
}, 2000); // Wait for DB connection

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log(`🔐 Authenticated user: ${decoded.userId} (${decoded.email})`);
    
    // Enforce tenant isolation at DB level for RLS
    if (decoded.tenantId) {
      pool.query(`SET LOCAL app.current_tenant_id = '${parseInt(decoded.tenantId)}'`).catch(() => {});
    }

    // Cross-tenant detection: check body and query for tenant_id mismatch
    const userTenantId = parseInt(decoded.tenantId);
    if (req.body && req.body.tenant_id && parseInt(req.body.tenant_id) !== userTenantId) {
      logTenantViolation(req, {
        requestedTenantId: parseInt(req.body.tenant_id),
        severity: 'critical',
        message: `Body tenant_id ${req.body.tenant_id} != user tenant_id ${userTenantId}`
      });
      return res.status(403).json({ success: false, message: 'Access denied: tenant mismatch' });
    }
    if (req.query && req.query.tenant_id && parseInt(req.query.tenant_id) !== userTenantId) {
      logTenantViolation(req, {
        requestedTenantId: parseInt(req.query.tenant_id),
        severity: 'critical',
        message: `Query tenant_id ${req.query.tenant_id} != user tenant_id ${userTenantId}`
      });
      return res.status(403).json({ success: false, message: 'Access denied: tenant mismatch' });
    }
    
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

// ===== HELPER: Verify Admin/Manager Role from Multiple Sources =====
// Checks token userType, employees table, and company_details table
async function verifyAdminRole(user, pool) {
  const { userId, tenantId, userType, email } = user;
  
  // 1. Check token userType field first
  if (userType === 'admin' || userType === 'Admin') {
    return { isAdmin: true, role: 'Admin (from token)', source: 'token' };
  }
  
  // 2. Check employees table for role
  if (userId && tenantId) {
    const adminResult = await pool.query(
      'SELECT role FROM employees WHERE id = $1 AND tenant_id = $2',
      [userId, tenantId]
    );
    const admin = adminResult.rows[0];
    
    if (admin && (admin.role === 'Admin' || admin.role === 'Manager')) {
      return { isAdmin: true, role: admin.role, source: 'employees' };
    }
  }
  
  // 3. Check company_details table for admin user
  if (email && tenantId) {
    const companyAdminResult = await pool.query(
      'SELECT role, is_admin FROM company_details WHERE email = $1 AND tenant_id = $2',
      [email, tenantId]
    );
    const companyAdmin = companyAdminResult.rows[0];
    
    if (companyAdmin && (companyAdmin.role === 'Admin' || companyAdmin.is_admin === true)) {
      return { isAdmin: true, role: 'Admin (company)', source: 'company_details' };
    }
  }
  
  return { isAdmin: false, role: 'unknown', source: 'none' };
}



// =====================================
// SWAGGER / API DOCS (root level, not under /api)
// =====================================
app.options('/swagger.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const doc = JSON.parse(JSON.stringify(swaggerDocument));
  if (!doc.components) doc.components = {};
  if (!doc.components.securitySchemes) doc.components.securitySchemes = {};
  if (!doc.components.securitySchemes.BearerAuth) {
    doc.components.securitySchemes.BearerAuth = {
      type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
      description: 'JWT token obtained from /api/auth/login'
    };
  }
  if (!doc.security) doc.security = [{ BearerAuth: [] }];
  for (const methods of Object.values(doc.paths || {})) {
    for (const op of Object.values(methods)) {
      if (op.security) {
        op.security = op.security.map(s => {
          if (s.bearerAuth !== undefined && s.BearerAuth === undefined) {
            return { BearerAuth: s.bearerAuth };
          }
          return s;
        });
      }
    }
  }
  res.json(doc);
});

app.get('/api-docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Time Management API</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
<style>.swagger-ui .topbar{display:none}.swagger-ui .info{margin:20px 0}body{margin:0;padding:0}</style>
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
<script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
<script>window.onload=function(){var u=location.protocol+'//'+location.host+'/swagger.json?v='+Date.now();fetch(u).then(r=>r.json()).then(spec=>{if(!spec.components)spec.components={};if(!spec.components.securitySchemes)spec.components.securitySchemes={};if(!spec.components.securitySchemes.BearerAuth)spec.components.securitySchemes.BearerAuth={type:'http',scheme:'bearer',bearerFormat:'JWT',description:'JWT token from /api/auth/login'};if(!spec.security)spec.security=[{BearerAuth:[]}];SwaggerUIBundle({spec:spec,dom_id:'#swagger-ui',deepLinking:true,tryItOutEnabled:true,persistAuthorization:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],plugins:[SwaggerUIBundle.plugins.DownloadUrl],layout:'StandaloneLayout',validatorUrl:null,withCredentials:false})}).catch(e=>{document.getElementById('swagger-ui').innerHTML='<div style=\"padding:40px;text-align:center;color:red;\">Failed to load API docs</div>'})}</script>
</body></html>`);
});

app.get('/docs', (req, res) => { res.redirect('/api-docs'); });
app.get('/swagger-ui', (req, res) => { res.redirect('/api-docs'); });

// =====================================
// MVC ROUTE IMPORTS
// =====================================
const deps = { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload };

// Department CRUD
app.use('/api', require('./routes/department.routes')(deps));

// Break Types CRUD (Admin)
app.use('/api', require('./routes/break-type.routes')(deps));

// Auth (Login, Register, Company Registration, Forgot Password, Logout, Refresh Token)
app.use('/api', require('./routes/auth.routes')(deps));

// Profile (GET/UPDATE profile, photo, name, email, phone, delete account)
app.use('/api', require('./routes/profile.routes')(deps));

// Timer (Overview, Start, Stop, Pause, Resume, Break, History)
app.use('/api', require('./routes/timer.routes')(deps));

// Employee Admin (CRUD, Invite, Setup Account, Security Logs)
app.use('/api', require('./routes/employee.routes')(deps));

// Delete Company Account
app.use('/api', require('./routes/company-account.routes')(deps));

// Break Management
app.use('/api', require('./routes/break-management.routes')(deps));

// Timer API Aliases
app.use('/api', require('./routes/timer-alias.routes')(deps));

// Leave API Aliases
app.use('/api', require('./routes/leave-alias.routes')(deps));

// Project + Location Management
app.use('/api', require('./routes/project.routes')(deps));

// Leave Management + Admin Leave Requests
app.use('/api', require('./routes/leave.routes')(deps));

// Correction Type + Request APIs
app.use('/api', require('./routes/correction.routes')(deps));

// Company Settings + Working Hours + Preferences
app.use('/api', require('./routes/company-setting.routes')(deps));

// User Preferences
app.use('/api', require('./routes/user-preference.routes')(deps));

// Work Summary
app.use('/api', require('./routes/work-summary.routes')(deps));

// Employee Activity Updates
app.use('/api', require('./routes/activity.routes')(deps));

// Employment Contract
app.use('/api', require('./routes/employment-contract.routes')(deps));

// Leave Policies + Vacation + Time Entries
app.use('/api', require('./routes/leave-policy.routes')(deps));

// Overtime + Missing APIs
app.use('/api', require('./routes/overtime.routes')(deps));

// Dashboard (Admin + User)
app.use('/api', require('./routes/dashboard.routes')(deps));

// Admin Activity Log
app.use('/api', require('./routes/activity-log.routes')(deps));

// Company Settings + Notifications + Work Summary Aliases
app.use('/api', require('./routes/settings-alias.routes')(deps));

// FAQ + Contact Support + Problem Reports
app.use('/api', require('./routes/faq-support.routes')(deps));

// Database Viewer + Gyanpith APIs
app.use('/api', require('./routes/database-viewer.routes')(deps));

// Notifications (Polling, Actions, Preferences)
app.use('/api', require('./routes/notification.routes')(deps));

// Public Holiday APIs
app.use('/api', require('./routes/public-holiday.routes')(deps));

// Absence Management APIs
app.use('/api', require('./routes/absence.routes')(deps));


// Holiday Management Routes
const holidayRoutes = require('./routes/holidayRoutes');
app.use('/api/holidays', holidayRoutes);

// API Routes (Time Tracking, Leave Management, Profile, etc.)
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Global error handler - MUST be after all routes
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.message, '| Type:', err.type);
  
  // Handle multipart body parsing errors - recover gracefully
  if (err.type === 'entity.parse.failed') {
    const bodyStr = err.body || '';
    // If it looks like multipart data that got parsed as JSON
    if (bodyStr.startsWith('------') || bodyStr.includes('Content-Disposition')) {
      console.log('Detected multipart body in JSON parser, forwarding to route');
      req._isMultipart = true;
      req.body = {};
      // Try to continue to the actual route handler
      return next();
    }
    // Try to auto-fix common JSON errors (unquoted strings like EMP002)
    try {
      // Quote any unquoted word tokens that aren't true/false/null/numbers
      const fixed = bodyStr.replace(/\b([A-Za-z][A-Za-z0-9_]*)\b/g, (match) => {
        if (['true', 'false', 'null'].includes(match)) return match;
        return '"' + match + '"';
      });
      const parsed = JSON.parse(fixed);
      req.body = parsed;
      console.log('Auto-fixed malformed JSON body:', JSON.stringify(parsed));
      return next();
    } catch (fixErr) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON in request body. String values must be in double quotes. Example: "employee_ids": ["EMP002"] not [EMP002]',
        error: 'INVALID_JSON'
      });
    }
  }
  
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum size is 4MB',
      error: 'PAYLOAD_TOO_LARGE'
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: err.type || 'SERVER_ERROR'
  });
});

// Only start server if run directly (not when required by index.js or Vercel)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 CLIENT FIX SERVER running on http://localhost:${PORT}`);
    console.log(`🔧 All client issues have been addressed:`);
    console.log(`   ✅ Profile data persistence (no more Jenny Wilson revert)`);
    console.log(`   ✅ Timer auto-stop after 24 hours enabled`);  
    console.log(`   ✅ Pause/Resume API fully implemented`);
    console.log(`   ✅ Login/Profile email consistency`);
    console.log(`   ✅ Data persistence across server restarts`);
    console.log(`📧 Test with: curl http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
