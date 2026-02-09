import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const app = express();
const PORT = process.env.PORT || 3002;
const SERVICE_NAME = 'auth-service';
const JWT_SECRET = process.env.JWT_SECRET || 'flowgrid_jwt_secret_dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: SERVICE_NAME,
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Auth Routes
// ============================================================================

interface LoginRequest {
  email: string;
  password: string;
}

interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
}

// Login - Generate JWT
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password }: LoginRequest = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    // Look up user in database
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.tenant_id, t.name as tenant_name, t.slug as tenant_slug
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate JWT
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as string,
    } as jwt.SignOptions);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
      },
      expiresIn: JWT_EXPIRES_IN,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Login error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process login',
    });
  }
});

// Verify token
app.post('/api/auth/verify', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : req.body.token;

    if (!token) {
      return res.status(400).json({
        valid: false,
        error: 'Token is required',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

    // Verify user still exists and is active
    const userResult = await pool.query(
      'SELECT id, email, role, tenant_id FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        valid: false,
        error: 'User not found or inactive',
      });
    }

    res.json({
      valid: true,
      user: {
        id: decoded.userId,
        email: decoded.email,
        tenantId: decoded.tenantId,
        role: decoded.role,
      },
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        valid: false,
        error: 'Token expired',
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        valid: false,
        error: 'Invalid token',
      });
    }
    console.error(`[${SERVICE_NAME}] Verify error:`, error);
    res.status(500).json({
      valid: false,
      error: 'Failed to verify token',
    });
  }
});

// Get current user (from token)
app.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, t.id as tenant_id, t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const user = userResult.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.created_at,
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
      },
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
    }
    console.error(`[${SERVICE_NAME}] Get user error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Get tenant info
app.get('/api/auth/tenant', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

    const tenantResult = await pool.query(
      'SELECT id, name, slug, tier, settings, created_at FROM tenants WHERE id = $1',
      [decoded.tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Tenant not found',
      });
    }

    const tenant = tenantResult.rows[0];
    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tier: tenant.tier,
      settings: tenant.settings,
      createdAt: tenant.created_at,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get tenant error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Running on port ${PORT}`);
  console.log(`[${SERVICE_NAME}] Health check: http://localhost:${PORT}/health`);
});

export default app;
