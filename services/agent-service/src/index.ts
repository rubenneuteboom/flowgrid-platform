import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'agent-service';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Health check endpoint
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

// Readiness check
app.get('/ready', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready' });
  }
});

// ============================================================================
// Agent Routes
// ============================================================================

// List agents (with optional tenant filter)
app.get('/api/agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const type = req.query.type as string;
    const status = req.query.status as string;

    let query = `
      SELECT a.*, 
             (SELECT COUNT(*) FROM agent_capabilities WHERE agent_id = a.id) as capability_count,
             (SELECT COUNT(*) FROM agent_integrations WHERE agent_id = a.id) as integration_count
      FROM agents a
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (tenantId) {
      query += ` AND a.tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }

    if (type) {
      query += ` AND a.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (status) {
      query += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Get total count
    const countQuery = query.replace(/SELECT a\.\*.*FROM/, 'SELECT COUNT(*) FROM');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      data: result.rows.map(row => ({
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        type: row.type,
        description: row.description,
        config: row.config,
        status: row.status,
        version: row.version,
        capabilityCount: parseInt(row.capability_count),
        integrationCount: parseInt(row.integration_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List agents error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list agents',
    });
  }
});

// Get agent by ID
app.get('/api/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const agentResult = await pool.query(
      'SELECT * FROM agents WHERE id = $1',
      [id]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    const agent = agentResult.rows[0];

    // Get capabilities
    const capsResult = await pool.query(
      'SELECT capability_name, capability_type, config, is_enabled FROM agent_capabilities WHERE agent_id = $1',
      [id]
    );

    // Get integrations
    const intResult = await pool.query(
      'SELECT integration_type, config, status, last_sync_at FROM agent_integrations WHERE agent_id = $1',
      [id]
    );

    // Get interactions (as source or target)
    const interResult = await pool.query(
      `SELECT i.*, 
              s.name as source_name, 
              t.name as target_name
       FROM agent_interactions i
       JOIN agents s ON i.source_agent_id = s.id
       JOIN agents t ON i.target_agent_id = t.id
       WHERE i.source_agent_id = $1 OR i.target_agent_id = $1`,
      [id]
    );

    res.json({
      id: agent.id,
      tenantId: agent.tenant_id,
      name: agent.name,
      type: agent.type,
      description: agent.description,
      config: agent.config,
      status: agent.status,
      version: agent.version,
      createdAt: agent.created_at,
      updatedAt: agent.updated_at,
      capabilities: capsResult.rows,
      integrations: intResult.rows,
      interactions: interResult.rows,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get agent',
    });
  }
});

// Create agent
app.post('/api/agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers['x-tenant-id'] as string || req.body.tenantId;
    const { name, type, description, config, status } = req.body;

    if (!tenantId || !name || !type) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'tenantId, name, and type are required',
      });
    }

    const result = await pool.query(
      `INSERT INTO agents (tenant_id, name, type, description, config, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, name, type, description || null, config || {}, status || 'draft']
    );

    const agent = result.rows[0];
    res.status(201).json({
      id: agent.id,
      tenantId: agent.tenant_id,
      name: agent.name,
      type: agent.type,
      description: agent.description,
      config: agent.config,
      status: agent.status,
      createdAt: agent.created_at,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Create agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create agent',
    });
  }
});

// Update agent
app.put('/api/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, description, config, status } = req.body;

    const result = await pool.query(
      `UPDATE agents 
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           description = COALESCE($3, description),
           config = COALESCE($4, config),
           status = COALESCE($5, status),
           version = version + 1
       WHERE id = $6
       RETURNING *`,
      [name, type, description, config, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    const agent = result.rows[0];
    res.json({
      id: agent.id,
      tenantId: agent.tenant_id,
      name: agent.name,
      type: agent.type,
      description: agent.description,
      config: agent.config,
      status: agent.status,
      version: agent.version,
      updatedAt: agent.updated_at,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Update agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update agent',
    });
  }
});

// Delete agent
app.delete('/api/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM agents WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    res.status(204).send();
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Delete agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete agent',
    });
  }
});

// ============================================================================
// Agent Capabilities Routes
// ============================================================================

// Add capability to agent
app.post('/api/agents/:id/capabilities', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { capabilityName, capabilityType, config } = req.body;

    const result = await pool.query(
      `INSERT INTO agent_capabilities (agent_id, capability_name, capability_type, config)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, capabilityName, capabilityType || 'action', config || {}]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Add capability error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add capability',
    });
  }
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
