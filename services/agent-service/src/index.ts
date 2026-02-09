import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'agent-service';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness check
app.get('/ready', async (req: Request, res: Response) => {
  // TODO: Check database connection
  res.json({ status: 'ready' });
});

// ============================================================================
// Agent Routes (placeholder)
// ============================================================================

// List agents
app.get('/api/agents', (req: Request, res: Response) => {
  // TODO: Implement with database
  res.json({
    data: [],
    meta: {
      total: 0,
      page: 1,
      limit: 20,
    },
  });
});

// Get agent by ID
app.get('/api/agents/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: Implement with database
  res.status(404).json({
    error: 'Not Found',
    message: `Agent ${id} not found`,
  });
});

// Create agent
app.post('/api/agents', (req: Request, res: Response) => {
  // TODO: Implement with database
  res.status(201).json({
    id: 'placeholder-id',
    ...req.body,
    createdAt: new Date().toISOString(),
  });
});

// Update agent
app.put('/api/agents/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: Implement with database
  res.json({
    id,
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
});

// Delete agent
app.delete('/api/agents/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: Implement with database
  res.status(204).send();
});

// ============================================================================
// Error handling
// ============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ============================================================================
// Start server
// ============================================================================

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Running on port ${PORT}`);
  console.log(`[${SERVICE_NAME}] Health check: http://localhost:${PORT}/health`);
});

export default app;
