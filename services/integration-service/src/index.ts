import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';

const app = express();
const PORT = process.env.PORT || 3004;
const SERVICE_NAME = 'integration-service';

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
    });
  }
});

// ============================================================================
// Integration Catalog
// ============================================================================

const INTEGRATION_CATALOG = [
  {
    name: 'servicenow',
    displayName: 'ServiceNow',
    description: 'ITSM platform for incident, problem, and change management',
    status: 'available',
    requiredConfig: ['instance', 'username', 'password'],
    capabilities: ['incidents', 'changes', 'problems', 'cmdb', 'knowledge'],
  },
  {
    name: 'jira',
    displayName: 'Jira',
    description: 'Project and issue tracking',
    status: 'available',
    requiredConfig: ['domain', 'email', 'apiToken'],
    capabilities: ['issues', 'projects', 'sprints', 'boards'],
  },
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Code repository and CI/CD',
    status: 'available',
    requiredConfig: ['token', 'org'],
    capabilities: ['repos', 'issues', 'pullRequests', 'actions'],
  },
  {
    name: 'azure-devops',
    displayName: 'Azure DevOps',
    description: 'Microsoft DevOps platform',
    status: 'planned',
    requiredConfig: ['organization', 'project', 'pat'],
    capabilities: ['workItems', 'repos', 'pipelines'],
  },
  {
    name: 'slack',
    displayName: 'Slack',
    description: 'Team communication',
    status: 'available',
    requiredConfig: ['botToken', 'signingSecret'],
    capabilities: ['messages', 'channels', 'users'],
  },
];

// List available integrations
app.get('/api/integrations/catalog', (req: Request, res: Response) => {
  res.json({
    integrations: INTEGRATION_CATALOG,
    count: INTEGRATION_CATALOG.length,
  });
});

// Get integration details
app.get('/api/integrations/catalog/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const integration = INTEGRATION_CATALOG.find(i => i.name === name);
  
  if (!integration) {
    return res.status(404).json({
      error: 'Not Found',
      message: `Integration ${name} not found`,
    });
  }
  
  res.json(integration);
});

// ============================================================================
// ServiceNow Integration (Stub)
// ============================================================================

// Test ServiceNow connection
app.post('/api/integrations/servicenow/test', async (req: Request, res: Response) => {
  const { instance, username, password } = req.body;
  
  // Stub: In production, this would actually test the connection
  if (!instance || !username || !password) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'instance, username, and password are required',
    });
  }
  
  // Simulate connection test
  res.json({
    integration: 'servicenow',
    status: 'connected',
    instance,
    message: 'Connection successful (stub)',
    capabilities: ['incidents', 'changes', 'problems'],
  });
});

// Create incident (stub)
app.post('/api/integrations/servicenow/incidents', async (req: Request, res: Response) => {
  const { shortDescription, description, priority, callerId } = req.body;
  
  if (!shortDescription) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'shortDescription is required',
    });
  }
  
  // Stub response
  const incidentNumber = `INC${String(Math.floor(Math.random() * 9999999)).padStart(7, '0')}`;
  
  res.status(201).json({
    result: {
      sys_id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      number: incidentNumber,
      short_description: shortDescription,
      description: description || '',
      priority: priority || '3',
      state: '1', // New
      caller_id: callerId || '',
      created_on: new Date().toISOString(),
    },
    _stub: true,
    message: 'This is a stub response. Connect to real ServiceNow for actual data.',
  });
});

// Get incident (stub)
app.get('/api/integrations/servicenow/incidents/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  res.json({
    result: {
      sys_id: id,
      number: 'INC0000001',
      short_description: 'Sample incident',
      state: '2', // In Progress
      priority: '3',
      assigned_to: 'admin',
    },
    _stub: true,
  });
});

// ============================================================================
// Jira Integration (Stub)
// ============================================================================

// Test Jira connection
app.post('/api/integrations/jira/test', async (req: Request, res: Response) => {
  const { domain, email, apiToken } = req.body;
  
  if (!domain || !email || !apiToken) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'domain, email, and apiToken are required',
    });
  }
  
  res.json({
    integration: 'jira',
    status: 'connected',
    domain,
    message: 'Connection successful (stub)',
    capabilities: ['issues', 'projects'],
  });
});

// Create Jira issue (stub)
app.post('/api/integrations/jira/issues', async (req: Request, res: Response) => {
  const { projectKey, summary, description, issueType } = req.body;
  
  if (!projectKey || !summary) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'projectKey and summary are required',
    });
  }
  
  const issueKey = `${projectKey}-${Math.floor(Math.random() * 9999)}`;
  
  res.status(201).json({
    id: Date.now().toString(),
    key: issueKey,
    self: `https://your-domain.atlassian.net/rest/api/3/issue/${issueKey}`,
    fields: {
      summary,
      description,
      issuetype: { name: issueType || 'Task' },
      status: { name: 'To Do' },
    },
    _stub: true,
  });
});

// ============================================================================
// GitHub Integration (Stub)
// ============================================================================

// Test GitHub connection
app.post('/api/integrations/github/test', async (req: Request, res: Response) => {
  const { token, org } = req.body;
  
  if (!token) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'token is required',
    });
  }
  
  res.json({
    integration: 'github',
    status: 'connected',
    organization: org || 'personal',
    message: 'Connection successful (stub)',
    capabilities: ['repos', 'issues', 'pullRequests'],
  });
});

// Create GitHub issue (stub)
app.post('/api/integrations/github/repos/:owner/:repo/issues', async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const { title, body, labels } = req.body;
  
  if (!title) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'title is required',
    });
  }
  
  const issueNumber = Math.floor(Math.random() * 9999);
  
  res.status(201).json({
    id: Date.now(),
    number: issueNumber,
    title,
    body: body || '',
    state: 'open',
    html_url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
    labels: labels || [],
    _stub: true,
  });
});

// ============================================================================
// Generic Integration Status
// ============================================================================

// Get integration status for an agent
app.get('/api/integrations/agent/:agentId/status', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    
    const result = await pool.query(
      `SELECT integration_type, status, config, last_sync_at
       FROM agent_integrations
       WHERE agent_id = $1`,
      [agentId]
    );
    
    res.json({
      agentId,
      integrations: result.rows.map(row => ({
        type: row.integration_type,
        status: row.status,
        lastSync: row.last_sync_at,
        config: row.config,
      })),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get integration status error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Update integration config for agent
app.put('/api/integrations/agent/:agentId/:integrationType', async (req: Request, res: Response) => {
  try {
    const { agentId, integrationType } = req.params;
    const { config, status } = req.body;
    
    const result = await pool.query(
      `UPDATE agent_integrations
       SET config = COALESCE($1, config),
           status = COALESCE($2, status),
           updated_at = NOW()
       WHERE agent_id = $3 AND integration_type = $4
       RETURNING *`,
      [config, status, agentId, integrationType]
    );
    
    if (result.rows.length === 0) {
      // Create new integration
      const insertResult = await pool.query(
        `INSERT INTO agent_integrations (agent_id, integration_type, config, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [agentId, integrationType, config || {}, status || 'pending']
      );
      return res.status(201).json(insertResult.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Update integration error:`, error);
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
  console.log(`[${SERVICE_NAME}] Available integrations: ${INTEGRATION_CATALOG.map(i => i.name).join(', ')}`);
});

export default app;
