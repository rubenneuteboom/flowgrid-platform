import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 3004;
const SERVICE_NAME = 'integration-service';

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
// Integration Routes (placeholder)
// ============================================================================

// List available integrations
app.get('/api/integrations/catalog', (req: Request, res: Response) => {
  res.json({
    integrations: [
      { name: 'servicenow', displayName: 'ServiceNow', status: 'available' },
      { name: 'jira', displayName: 'Jira', status: 'available' },
      { name: 'github', displayName: 'GitHub', status: 'available' },
      { name: 'azure-devops', displayName: 'Azure DevOps', status: 'planned' },
    ],
  });
});

// Test integration connection
app.post('/api/integrations/:name/test', async (req: Request, res: Response) => {
  const { name } = req.params;
  // TODO: Implement connection test
  res.json({
    integration: name,
    status: 'connected',
    message: 'Connection successful',
  });
});

// Get integration status
app.get('/api/integrations/:name/status', (req: Request, res: Response) => {
  const { name } = req.params;
  res.json({
    integration: name,
    status: 'healthy',
    lastSync: new Date().toISOString(),
  });
});

// ServiceNow: Create incident
app.post('/api/integrations/servicenow/incident', async (req: Request, res: Response) => {
  // TODO: Implement ServiceNow API call
  res.status(201).json({
    incidentNumber: 'INC0000001',
    sysId: 'placeholder-sys-id',
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
