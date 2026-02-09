import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 3002;
const SERVICE_NAME = 'auth-service';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================================
// Auth Routes (placeholder)
// ============================================================================

// Validate token
app.post('/api/auth/validate', (req: Request, res: Response) => {
  // TODO: Implement JWT validation
  res.json({
    valid: true,
    user: {
      id: 'placeholder-user-id',
      email: 'user@example.com',
      tenantId: 'placeholder-tenant-id',
      roles: ['user'],
    },
  });
});

// Get current user
app.get('/api/auth/user', (req: Request, res: Response) => {
  // TODO: Extract from JWT
  res.json({
    id: 'placeholder-user-id',
    email: 'user@example.com',
    tenantId: 'placeholder-tenant-id',
    roles: ['user'],
  });
});

// Get tenant info
app.get('/api/auth/tenant', (req: Request, res: Response) => {
  // TODO: Implement
  res.json({
    id: 'placeholder-tenant-id',
    name: 'Demo Tenant',
    tier: 'standard',
  });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Running on port ${PORT}`);
});

export default app;
