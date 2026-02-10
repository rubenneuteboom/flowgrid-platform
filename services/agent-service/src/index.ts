import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'agent-service';
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

// Database connection
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

app.use('/api', requireAuth);

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
    const tenantId = req.tenantId;
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

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    query += ` AND a.tenant_id = $${paramIndex}`;
    params.push(tenantId);
    paramIndex++;

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

// Agent interaction relationships (for Design Studio graph rendering)
app.get('/api/agents/relationships', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authenticated tenant context required',
      });
    }

    const result = await pool.query(
      `SELECT
         i.id,
         i.source_agent_id,
         i.target_agent_id,
         i.message_type,
         i.description,
         i.config,
         i.is_active,
         i.created_at,
         i.updated_at,
         s.name AS source_name,
         t.name AS target_name
       FROM agent_interactions i
       JOIN agents s ON i.source_agent_id = s.id
       JOIN agents t ON i.target_agent_id = t.id
       WHERE s.tenant_id = $1
         AND t.tenant_id = $1
       ORDER BY i.created_at DESC`,
      [tenantId]
    );

    res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        sourceId: row.source_agent_id,
        targetId: row.target_agent_id,
        type: row.message_type,
        description: row.description,
        config: row.config,
        isActive: row.is_active,
        sourceName: row.source_name,
        targetName: row.target_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List relationships error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list relationships',
    });
  }
});

// Get agent by ID
app.get('/api/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const agentResult = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
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
       WHERE (i.source_agent_id = $1 OR i.target_agent_id = $1)
         AND s.tenant_id = $2
         AND t.tenant_id = $2`,
      [id, tenantId]
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
    const tenantId = req.tenantId;
    const { name, type, description, config, status } = req.body;

    if (!tenantId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authenticated tenant context required',
      });
    }

    if (!name || !type) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name and type are required',
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
    const tenantId = req.tenantId;
    const { name, type, description, config, status } = req.body;

    const result = await pool.query(
      `UPDATE agents 
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           description = COALESCE($3, description),
           config = COALESCE($4, config),
           status = COALESCE($5, status),
           version = version + 1
       WHERE id = $6 AND tenant_id = $7
       RETURNING *`,
      [name, type, description, config, status, id, tenantId]
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
    const tenantId = req.tenantId;

    const result = await pool.query(
      'DELETE FROM agents WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, tenantId]
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
    const tenantId = req.tenantId;
    const { capabilityName, capabilityType, config } = req.body;

    const agentOwnership = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (agentOwnership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: `Agent ${id} not found` });
    }

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
// Relationships & Integrations Routes (legacy parity)
// ============================================================================

app.get('/api/relationships', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { source, target, type, limit = '250' } = req.query;
    const parsedLimit = Math.min(parseInt(limit as string, 10) || 250, 1000);

    let query = `SELECT
      i.id,
      i.source_agent_id,
      i.target_agent_id,
      i.message_type,
      i.description,
      i.config,
      s.name AS source_name,
      t.name AS target_name,
      s.type AS source_type,
      t.type AS target_type,
      i.created_at,
      i.updated_at
    FROM agent_interactions i
    JOIN agents s ON i.source_agent_id = s.id
    JOIN agents t ON i.target_agent_id = t.id
    WHERE s.tenant_id = $1 AND t.tenant_id = $1`;

    const params: any[] = [tenantId];
    let idx = 2;

    if (source) {
      query += ` AND i.source_agent_id = $${idx++}`;
      params.push(source);
    }
    if (target) {
      query += ` AND i.target_agent_id = $${idx++}`;
      params.push(target);
    }
    if (type) {
      query += ` AND i.message_type = $${idx++}`;
      params.push(type);
    }

    query += ` ORDER BY i.created_at DESC LIMIT $${idx}`;
    params.push(parsedLimit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List relationships (legacy) error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list relationships' });
  }
});

app.post('/api/relationships', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { sourceAgentId, targetAgentId, messageType, description, config } = req.body;
    if (!sourceAgentId || !targetAgentId) {
      return res.status(400).json({ error: 'Bad Request', message: 'sourceAgentId and targetAgentId are required' });
    }

    const ownership = await pool.query(
      'SELECT id FROM agents WHERE tenant_id = $1 AND (id = $2 OR id = $3)',
      [tenantId, sourceAgentId, targetAgentId]
    );

    if (ownership.rows.length !== 2) {
      return res.status(404).json({ error: 'Not Found', message: 'One or more agents not found for tenant' });
    }

    const result = await pool.query(
      `INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sourceAgentId, targetAgentId, messageType || 'message', description || null, config || {}]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Create relationship error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create relationship' });
  }
});

app.get('/api/agent-interactions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { agent } = req.query;

    let query = `SELECT
      i.id,
      i.source_agent_id,
      i.target_agent_id,
      i.message_type,
      i.description,
      i.config,
      i.created_at,
      i.updated_at,
      s.name AS source_name,
      t.name AS target_name
    FROM agent_interactions i
    JOIN agents s ON i.source_agent_id = s.id
    JOIN agents t ON i.target_agent_id = t.id
    WHERE s.tenant_id = $1 AND t.tenant_id = $1`;

    const params: any[] = [tenantId];
    if (agent) {
      query += ' AND (i.source_agent_id::text = $2 OR i.target_agent_id::text = $2 OR s.name ILIKE $3 OR t.name ILIKE $3)';
      params.push(String(agent), `%${String(agent)}%`);
    }

    query += ' ORDER BY i.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List agent interactions error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list interactions' });
  }
});

app.get('/api/agents/:id/integrations', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const ownership = await pool.query('SELECT id FROM agents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: `Agent ${id} not found` });
    }

    const result = await pool.query(
      'SELECT id, integration_type, config, status, last_sync_at, created_at, updated_at FROM agent_integrations WHERE agent_id = $1 ORDER BY created_at DESC',
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get agent integrations error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to get integrations' });
  }
});

app.get('/api/agent-data-contracts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { agent } = req.query;

    let query = `SELECT
      i.id,
      i.source_agent_id,
      i.target_agent_id,
      i.message_type,
      i.config,
      s.name AS producer_name,
      t.name AS consumer_name
    FROM agent_interactions i
    JOIN agents s ON i.source_agent_id = s.id
    JOIN agents t ON i.target_agent_id = t.id
    WHERE s.tenant_id = $1 AND t.tenant_id = $1`;

    const params: any[] = [tenantId];
    if (agent) {
      query += ' AND (i.source_agent_id::text = $2 OR i.target_agent_id::text = $2 OR s.name ILIKE $3 OR t.name ILIKE $3)';
      params.push(String(agent), `%${String(agent)}%`);
    }

    query += ' ORDER BY i.created_at DESC';
    const result = await pool.query(query, params);

    const contracts = result.rows.map((row) => {
      const config = row.config || {};
      const dataContract = config.dataContract || config.contract || {};
      const schemaFields = Array.isArray(dataContract.fields)
        ? dataContract.fields
        : Array.isArray(config.payloadSchema)
          ? config.payloadSchema
          : [];

      return {
        id: row.id,
        contractName: dataContract.name || `${row.producer_name} → ${row.consumer_name} (${row.message_type})`,
        producerAgentId: row.source_agent_id,
        producerAgentName: row.producer_name,
        consumerAgentId: row.target_agent_id,
        consumerAgentName: row.consumer_name,
        messageType: row.message_type,
        schema: {
          format: dataContract.format || config.format || 'json',
          fields: schemaFields,
          required: Array.isArray(dataContract.required) ? dataContract.required : [],
        },
        accessPolicy: dataContract.accessPolicy || config.accessPolicy || 'tenant-scoped',
      };
    });

    res.json(contracts);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List agent data contracts error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list data contracts' });
  }
});

app.get('/api/agent-network-graph', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const [agentResult, interactionResult] = await Promise.all([
      pool.query('SELECT id, name, type, description FROM agents WHERE tenant_id = $1 ORDER BY name', [tenantId]),
      pool.query(
        `SELECT i.id, i.source_agent_id, i.target_agent_id, i.message_type
         FROM agent_interactions i
         JOIN agents s ON i.source_agent_id = s.id
         JOIN agents t ON i.target_agent_id = t.id
         WHERE s.tenant_id = $1 AND t.tenant_id = $1
         ORDER BY i.created_at DESC`,
        [tenantId]
      ),
    ]);

    const nodes = agentResult.rows.map((row) => ({
      id: row.id,
      label: row.name,
      type: row.type || 'Agent',
      description: row.description || '',
    }));

    const edges = interactionResult.rows.map((row) => ({
      id: row.id,
      from: row.source_agent_id,
      to: row.target_agent_id,
      relType: row.message_type,
      label: row.message_type || 'message',
    }));

    res.json({ nodes, edges });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Agent network graph error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to build network graph' });
  }
});

app.get('/api/agent-interaction-graph/:agentRef', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { agentRef } = req.params;

    const agentResult = await pool.query(
      `SELECT id, name
       FROM agents
       WHERE tenant_id = $1
         AND (id::text = $2 OR lower(name) = lower($2))
       LIMIT 1`,
      [tenantId, agentRef]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: `Agent ${agentRef} not found` });
    }

    const focusAgent = agentResult.rows[0];

    const interactionResult = await pool.query(
      `SELECT i.id, i.source_agent_id, i.target_agent_id, i.message_type,
              s.name AS source_name, t.name AS target_name
       FROM agent_interactions i
       JOIN agents s ON i.source_agent_id = s.id
       JOIN agents t ON i.target_agent_id = t.id
       WHERE s.tenant_id = $1
         AND t.tenant_id = $1
         AND (i.source_agent_id = $2 OR i.target_agent_id = $2)
       ORDER BY i.created_at DESC`,
      [tenantId, focusAgent.id]
    );

    const nodeMap = new Map<string, any>();
    const edges = interactionResult.rows.map((row) => {
      nodeMap.set(row.source_agent_id, { id: row.source_agent_id, label: row.source_name });
      nodeMap.set(row.target_agent_id, { id: row.target_agent_id, label: row.target_name });
      return {
        id: row.id,
        from: row.source_agent_id,
        to: row.target_agent_id,
        label: row.message_type || 'message',
        arrows: 'to',
      };
    });

    const nodes = Array.from(nodeMap.values()).map((node) => ({
      ...node,
      color: node.id === focusAgent.id ? '#3b82f6' : '#10b981',
    }));

    res.json({ nodes, edges });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Agent interaction graph error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to build interaction graph' });
  }
});

app.get('/api/agents/design/export', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const [agentsResult, interactionsResult] = await Promise.all([
      pool.query(
        'SELECT id, name, type, description, config, status, version, created_at, updated_at FROM agents WHERE tenant_id = $1 ORDER BY name',
        [tenantId]
      ),
      pool.query(
        `SELECT i.id, i.source_agent_id, i.target_agent_id, i.message_type, i.description, i.config, i.is_active, i.created_at, i.updated_at,
                s.name AS source_name, t.name AS target_name
         FROM agent_interactions i
         JOIN agents s ON i.source_agent_id = s.id
         JOIN agents t ON i.target_agent_id = t.id
         WHERE s.tenant_id = $1 AND t.tenant_id = $1
         ORDER BY i.created_at DESC`,
        [tenantId]
      ),
    ]);

    res.json({
      schemaVersion: 'flowgrid.design-export.v1',
      exportedAt: new Date().toISOString(),
      tenantId,
      agents: agentsResult.rows,
      relationships: interactionsResult.rows.map((row) => ({
        id: row.id,
        sourceAgentId: row.source_agent_id,
        targetAgentId: row.target_agent_id,
        sourceAgentName: row.source_name,
        targetAgentName: row.target_name,
        messageType: row.message_type,
        description: row.description,
        config: row.config,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Design export error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to export design' });
  }
});

app.post('/api/agents/design/import', async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const payload = req.body || {};
    const incomingAgents = Array.isArray(payload.agents) ? payload.agents : [];
    const incomingRelationships = Array.isArray(payload.relationships) ? payload.relationships : [];

    await client.query('BEGIN');

    const idMapByOriginal = new Map<string, string>();
    const idMapByName = new Map<string, string>();
    let createdAgents = 0;
    let updatedAgents = 0;

    for (const agent of incomingAgents) {
      const name = String(agent?.name || '').trim();
      if (!name) continue;

      const existing = await client.query(
        'SELECT id FROM agents WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1',
        [tenantId, name]
      );

      if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE agents
           SET type = COALESCE($1, type),
               description = COALESCE($2, description),
               config = COALESCE($3, config),
               status = COALESCE($4, status),
               version = version + 1
           WHERE id = $5 AND tenant_id = $6`,
          [agent.type || null, agent.description || null, agent.config || null, agent.status || null, id, tenantId]
        );
        updatedAgents += 1;
        idMapByName.set(name.toLowerCase(), id);
        if (agent.id) idMapByOriginal.set(String(agent.id), id);
      } else {
        const inserted = await client.query(
          `INSERT INTO agents (tenant_id, name, type, description, config, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [tenantId, name, agent.type || 'Agent', agent.description || null, agent.config || {}, agent.status || 'draft']
        );
        const id = inserted.rows[0].id;
        createdAgents += 1;
        idMapByName.set(name.toLowerCase(), id);
        if (agent.id) idMapByOriginal.set(String(agent.id), id);
      }
    }

    let createdRelationships = 0;

    for (const relationship of incomingRelationships) {
      const sourceId = relationship.sourceAgentId
        ? idMapByOriginal.get(String(relationship.sourceAgentId))
        : idMapByName.get(String(relationship.sourceAgentName || '').toLowerCase());

      const targetId = relationship.targetAgentId
        ? idMapByOriginal.get(String(relationship.targetAgentId))
        : idMapByName.get(String(relationship.targetAgentName || '').toLowerCase());

      if (!sourceId || !targetId || sourceId === targetId) continue;

      const messageType = relationship.messageType || relationship.type || 'message';

      const existingRel = await client.query(
        `SELECT id FROM agent_interactions
         WHERE source_agent_id = $1
           AND target_agent_id = $2
           AND message_type = $3
         LIMIT 1`,
        [sourceId, targetId, messageType]
      );

      if (existingRel.rows.length > 0) {
        continue;
      }

      await client.query(
        `INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description, config, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sourceId, targetId, messageType, relationship.description || null, relationship.config || {}, relationship.isActive !== false]
      );

      createdRelationships += 1;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      imported: {
        agentsCreated: createdAgents,
        agentsUpdated: updatedAgents,
        relationshipsCreated: createdRelationships,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[${SERVICE_NAME}] Design import error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to import design' });
  } finally {
    client.release();
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
