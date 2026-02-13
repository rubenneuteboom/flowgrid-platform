import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { FlowRunner } from './engine/flow-runner';
import { createRuntimeRouter } from './routes/runtime';

const app = express();
const PORT = process.env.PORT || 3007;
const SERVICE_NAME = 'runtime-service';
const JWT_SECRET = process.env.JWT_SECRET || 'flowgrid_jwt_secret_dev_CHANGE_IN_PRODUCTION';

interface AuthTokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  type: 'access' | 'refresh';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
      tenantId?: string;
    }
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as AuthTokenPayload;
    if (decoded.type !== 'access' || !decoded.tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    }
    req.user = decoded;
    req.tenantId = decoded.tenantId;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: SERVICE_NAME, database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, database: 'disconnected' });
  }
});

// Create runner
const runner = new FlowRunner(pool);

// Apply auth to all /api routes
app.use('/api', requireAuth);

// Mount runtime routes
app.use('/api/runtime', createRuntimeRouter(pool, runner));

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Running on port ${PORT}`);
});

export default app;
