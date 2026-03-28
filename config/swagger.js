const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Working Time & Absence Management API',
      version: '1.0.0',
      description: 'A comprehensive API for managing working time tracking, leave requests, and employee data in a multi-tenant environment.',
      contact: {
        name: 'API Support',
        email: 'support@workingtimeapi.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'https://api-layer.vercel.app',
        description: 'Vercel server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token in the format: Bearer <token>'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error type'
            },
            message: {
              type: 'string',
              description: 'Error message'
            }
          },
          required: ['error', 'message']
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string'
            },
            data: {
              type: 'object'
            }
          },
          required: ['success']
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'User ID'
            },
            tenantId: {
              type: 'integer',
              description: 'Tenant ID'
            },
            employeeNumber: {
              type: 'string',
              description: 'Employee number'
            },
            firstName: {
              type: 'string',
              description: 'First name'
            },
            lastName: {
              type: 'string',
              description: 'Last name'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'Email address'
            },
            tenantName: {
              type: 'string',
              description: 'Tenant name'
            }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'user@example.com'
            },
            password: {
              type: 'string',
              minLength: 6,
              description: 'User password',
              example: 'password123'
            }
          }
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'firstName', 'lastName', 'tenantId'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'newuser@example.com'
            },
            password: {
              type: 'string',
              minLength: 6,
              description: 'User password',
              example: 'password123'
            },
            firstName: {
              type: 'string',
              description: 'First name',
              example: 'John'
            },
            lastName: {
              type: 'string',
              description: 'Last name',
              example: 'Doe'
            },
            employeeNumber: {
              type: 'string',
              description: 'Employee number (optional)',
              example: 'EMP001'
            },
            tenantId: {
              type: 'integer',
              description: 'Tenant ID',
              example: 1
            }
          }
        },
        TimeEntry: {
          type: 'object',
          properties: {
            time_entry_id: {
              type: 'integer',
              description: 'Time entry ID'
            },
            entry_date: {
              type: 'string',
              format: 'date',
              description: 'Entry date'
            },
            clock_in: {
              type: 'string',
              format: 'time',
              description: 'Clock in time (HH:MM)',
              example: '09:00'
            },
            clock_out: {
              type: 'string',
              format: 'time',
              description: 'Clock out time (HH:MM)',
              example: '17:00'
            },
            break_duration: {
              type: 'number',
              description: 'Break duration in minutes',
              example: 30
            },
            total_hours: {
              type: 'number',
              description: 'Total hours worked',
              example: 7.5
            },
            notes: {
              type: 'string',
              description: 'Notes for the entry'
            },
            project_name: {
              type: 'string',
              description: 'Project name'
            },
            task_name: {
              type: 'string',
              description: 'Task name'
            },
            is_approved: {
              type: 'boolean',
              description: 'Whether the entry is approved'
            }
          }
        },
        TimeEntryRequest: {
          type: 'object',
          required: ['date', 'clockIn'],
          properties: {
            date: {
              type: 'string',
              format: 'date',
              description: 'Entry date',
              example: '2023-11-10'
            },
            clockIn: {
              type: 'string',
              format: 'time',
              description: 'Clock in time (HH:MM)',
              example: '09:00'
            },
            clockOut: {
              type: 'string',
              format: 'time',
              description: 'Clock out time (HH:MM)',
              example: '17:00'
            },
            breakDuration: {
              type: 'number',
              minimum: 0,
              description: 'Break duration in minutes',
              example: 30
            },
            notes: {
              type: 'string',
              description: 'Notes for the entry'
            },
            projectId: {
              type: 'integer',
              description: 'Project ID'
            },
            taskId: {
              type: 'integer',
              description: 'Task ID'
            }
          }
        },
        LeaveRequest: {
          type: 'object',
          properties: {
            leave_request_id: {
              type: 'integer',
              description: 'Leave request ID'
            },
            start_date: {
              type: 'string',
              format: 'date',
              description: 'Leave start date'
            },
            end_date: {
              type: 'string',
              format: 'date',
              description: 'Leave end date'
            },
            reason: {
              type: 'string',
              description: 'Reason for leave'
            },
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'rejected'],
              description: 'Leave request status'
            },
            leave_type_name: {
              type: 'string',
              description: 'Type of leave'
            },
            is_half_day: {
              type: 'boolean',
              description: 'Whether it is a half day leave'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            }
          }
        },
        LeaveRequestCreate: {
          type: 'object',
          required: ['leaveTypeId', 'startDate', 'endDate', 'reason'],
          properties: {
            leaveTypeId: {
              type: 'integer',
              description: 'Leave type ID',
              example: 1
            },
            startDate: {
              type: 'string',
              format: 'date',
              description: 'Leave start date',
              example: '2023-12-01'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'Leave end date',
              example: '2023-12-05'
            },
            reason: {
              type: 'string',
              description: 'Reason for leave',
              example: 'Family vacation'
            },
            isHalfDay: {
              type: 'boolean',
              description: 'Whether it is a half day leave',
              example: false
            },
            halfDayPeriod: {
              type: 'string',
              enum: ['morning', 'afternoon'],
              description: 'Half day period (if applicable)'
            }
          }
        },
        VacationBalance: {
          type: 'object',
          properties: {
            vacation_days_total: {
              type: 'number',
              description: 'Total vacation days allocated'
            },
            vacation_days_used: {
              type: 'number',
              description: 'Vacation days used'
            },
            vacation_days_remaining: {
              type: 'number',
              description: 'Remaining vacation days'
            },
            sick_days_used: {
              type: 'number',
              description: 'Sick days used'
            },
            year: {
              type: 'integer',
              description: 'Year for the balance'
            }
          }
        },
        Project: {
          type: 'object',
          properties: {
            project_id: {
              type: 'integer',
              description: 'Project ID'
            },
            project_name: {
              type: 'string',
              description: 'Project name'
            },
            description: {
              type: 'string',
              description: 'Project description'
            },
            is_active: {
              type: 'boolean',
              description: 'Whether project is active'
            },
            start_date: {
              type: 'string',
              format: 'date',
              description: 'Project start date'
            },
            end_date: {
              type: 'string',
              format: 'date',
              description: 'Project end date'
            }
          }
        },
        Task: {
          type: 'object',
          properties: {
            task_id: {
              type: 'integer',
              description: 'Task ID'
            },
            task_name: {
              type: 'string',
              description: 'Task name'
            },
            description: {
              type: 'string',
              description: 'Task description'
            },
            estimated_hours: {
              type: 'number',
              description: 'Estimated hours for task'
            },
            is_active: {
              type: 'boolean',
              description: 'Whether task is active'
            }
          }
        },
        LeaveType: {
          type: 'object',
          properties: {
            leave_type_id: {
              type: 'integer',
              description: 'Leave type ID'
            },
            leave_type_name: {
              type: 'string',
              description: 'Leave type name'
            },
            description: {
              type: 'string',
              description: 'Leave type description'
            },
            is_paid: {
              type: 'boolean',
              description: 'Whether leave is paid'
            },
            max_days_per_year: {
              type: 'integer',
              description: 'Maximum days per year'
            },
            requires_approval: {
              type: 'boolean',
              description: 'Whether requires approval'
            },
            advance_notice_days: {
              type: 'integer',
              description: 'Required advance notice days'
            }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              description: 'Current page number'
            },
            limit: {
              type: 'integer',
              description: 'Items per page'
            },
            total: {
              type: 'integer',
              description: 'Total items'
            },
            totalPages: {
              type: 'integer',
              description: 'Total pages'
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./routes/*.js', './server.js'], // paths to files containing OpenAPI definitions
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs
};