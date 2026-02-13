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
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 500);
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

    // Get total count (build separately to avoid regex issues with multiline)
    let countQuery = `SELECT COUNT(*) FROM agents a WHERE 1=1`;
    if (tenantId) countQuery += ` AND a.tenant_id = $1`;
    const countParams = tenantId ? [tenantId] : [];
    if (type) {
      countQuery += ` AND a.type = $${countParams.length + 1}`;
      countParams.push(type);
    }
    if (status) {
      countQuery += ` AND a.status = $${countParams.length + 1}`;
      countParams.push(status);
    }
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.count || '0');

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
        elementType: row.element_type || 'Agent',
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

    // Get skills (A2A Protocol)
    const skillsResult = await pool.query(
      'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples, is_active FROM agent_skills WHERE agent_id = $1 ORDER BY created_at',
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
      skills: skillsResult.rows,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get agent',
    });
  }
});

// Get A2A Card for agent
app.get('/api/agents/:id/a2a-card', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const baseUrl = req.query.baseUrl as string || `https://agents.example.com`;

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
    const config = agent.config || {};

    // Get actual skills from agent_skills table (A2A Protocol compliant)
    const skillsResult = await pool.query(
      'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples FROM agent_skills WHERE agent_id = $1 AND is_active = true ORDER BY created_at',
      [id]
    );

    // Get capabilities (for fallback if no skills defined)
    const capsResult = await pool.query(
      'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1',
      [id]
    );

    // Get relationships for defaultInputModes
    const relResult = await pool.query(
      `SELECT i.message_type, i.config
       FROM agent_interactions i
       WHERE i.target_agent_id = $1`,
      [id]
    );

    // Build A2A skills: prefer actual skills from database, fallback to generated
    const a2aSkills = skillsResult.rows.length > 0
      ? skillsResult.rows.map((skill: any) => ({
          id: skill.name,
          name: skill.display_name || skill.name,
          description: skill.description || `${skill.display_name || skill.name} skill`,
          tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
          examples: (skill.examples || []).map((ex: any) => ({
            name: ex.name || skill.display_name || skill.name,
            input: ex.input || {},
            output: ex.output
          })),
          inputModes: ["text"],
          outputModes: ["text"],
          inputSchema: skill.input_schema,
          outputSchema: skill.output_schema
        }))
      : buildSkillsFromAgent(agent, capsResult.rows);

    // Build A2A Protocol v0.2 compliant Agent Card
    const agentCard = {
      // Required fields
      name: agent.name,
      url: `${baseUrl}/${agent.id}`,
      version: `${agent.version || 1}.0.0`,
      
      // Recommended fields
      description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
      protocolVersion: "0.2",
      documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
      
      provider: {
        organization: config.provider?.organization || "FlowGrid Platform",
        url: config.provider?.url || "https://flowgrid.io"
      },
      
      capabilities: {
        streaming: config.a2aCapabilities?.streaming || false,
        pushNotifications: config.a2aCapabilities?.pushNotifications || false,
        stateTransitionHistory: true
      },
      
      authentication: {
        schemes: config.authentication?.schemes || ["bearer"]
      },
      
      defaultInputModes: config.defaultInputModes || ["text"],
      defaultOutputModes: config.defaultOutputModes || ["text"],
      
      // Skills: actual stored skills or fallback to generated from capabilities
      skills: a2aSkills,
      
      // FlowGrid extensions (prefixed with underscore per spec recommendation)
      _flowgrid: {
        id: agent.id,
        elementType: agent.element_type || 'Agent',
        pattern: config.pattern || agent.type,
        valueStream: config.valueStream,
        autonomyLevel: config.autonomyLevel || 'supervised',
        decisionAuthority: config.decisionAuthority || 'propose-and-execute',
        riskAppetite: config.riskAppetite || 'medium',
        triggers: config.triggers || [],
        outputs: config.outputs || [],
        escalationPath: config.escalationPath,
        relationships: relResult.rows.map((r: any) => ({
          messageType: r.message_type,
          config: r.config
        }))
      }
    };

    res.json(agentCard);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get A2A card error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate A2A card',
    });
  }
});

// Helper function to build skills from agent data
function buildSkillsFromAgent(agent: any, capabilities: any[]): any[] {
  const config = agent.config || {};
  const skills: any[] = [];
  const agentSlug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // If agent has explicit a2aSkills in config, use those (fully compliant)
  if (config.a2aSkills && Array.isArray(config.a2aSkills)) {
    return config.a2aSkills.map((skill: any) => ({
      id: skill.skillId || skill.id || `${agentSlug}-${skill.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: skill.name,
      description: skill.description,
      tags: skill.tags || [config.pattern || 'agent', config.valueStream || 'general'].filter(Boolean),
      examples: skill.examples || [],
      inputModes: skill.inputModes || ["text"],
      outputModes: skill.outputModes || ["text"],
    }));
  }

  // Generate pattern-based tags
  const baseTags = [
    config.pattern?.toLowerCase() || 'agent',
    config.valueStream?.toLowerCase().replace(/\s+/g, '-'),
    config.capabilityGroup?.toLowerCase().replace(/\s+/g, '-'),
  ].filter(Boolean);

  // Create a primary skill based on agent purpose
  const primarySkillId = `${agentSlug}-primary`;
  skills.push({
    id: primarySkillId,
    name: `${agent.name} - Primary Action`,
    description: config.detailedPurpose || agent.description || config.purpose || `Primary capability of ${agent.name}`,
    tags: [...baseTags, 'primary'],
    examples: config.skillExamples?.[primarySkillId] || [
      {
        name: "Basic Request",
        input: { request: `Perform ${agent.name} primary function`, context: {} },
        output: { result: "Task completed successfully", confidence: 0.95 }
      }
    ],
    inputModes: ["text"],
    outputModes: ["text"],
  });

  // Add skills from capabilities
  capabilities.forEach((cap: any) => {
    const capSlug = cap.capability_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const skillId = `${agentSlug}-${capSlug}`;
    skills.push({
      id: skillId,
      name: cap.capability_name,
      description: cap.config?.description || `${cap.capability_name} capability`,
      tags: [...baseTags, cap.capability_type?.toLowerCase() || 'capability', capSlug],
      examples: cap.config?.examples || config.skillExamples?.[skillId] || [],
      inputModes: cap.config?.inputModes || ["text"],
      outputModes: cap.config?.outputModes || ["text"],
    });
  });

  return skills;
}

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

// Reset all tenant data (for demos)
app.delete('/api/agents/reset', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const tenantId = req.tenantId;
    console.log(`[${SERVICE_NAME}] Resetting all data for tenant ${tenantId}`);

    await client.query('BEGIN');

    // Delete in order respecting foreign keys
    const integrations = await client.query(
      'DELETE FROM agent_integrations WHERE agent_id IN (SELECT id FROM agents WHERE tenant_id = $1) RETURNING id',
      [tenantId]
    );

    // agent_interactions doesn't have tenant_id, delete via agent join
    const relationships = await client.query(
      'DELETE FROM agent_interactions WHERE source_agent_id IN (SELECT id FROM agents WHERE tenant_id = $1) RETURNING id',
      [tenantId]
    );

    const capabilities = await client.query(
      'DELETE FROM agent_capabilities WHERE agent_id IN (SELECT id FROM agents WHERE tenant_id = $1) RETURNING id',
      [tenantId]
    );

    const agents = await client.query(
      'DELETE FROM agents WHERE tenant_id = $1 RETURNING id',
      [tenantId]
    );

    // Also clear wizard sessions
    await client.query(
      'DELETE FROM wizard_sessions WHERE tenant_id = $1',
      [tenantId]
    );

    await client.query('COMMIT');

    console.log(`[${SERVICE_NAME}] Reset complete: ${agents.rowCount} agents, ${relationships.rowCount} relationships, ${integrations.rowCount} integrations`);

    res.json({
      success: true,
      deleted: {
        agents: agents.rowCount,
        relationships: relationships.rowCount,
        integrations: integrations.rowCount,
        capabilities: capabilities.rowCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[${SERVICE_NAME}] Reset error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset tenant data',
    });
  } finally {
    client.release();
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
// Integration Catalog Endpoints
// ============================================================================

// GET /api/integrations/catalog - List all available integrations
app.get('/api/integrations/catalog', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM integration_catalog ORDER BY type, name');
    res.json(result.rows);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get catalog error:`, error);
    res.status(500).json({ error: 'Failed to get integration catalog' });
  }
});

// GET /api/agents/:id/integrations/suggest - Suggest integrations based on agent
app.get('/api/agents/:id/integrations/suggest', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    
    const agent = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    
    if (agent.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const a = agent.rows[0];
    const text = `${a.name} ${a.description || ''} ${a.type || ''}`.toLowerCase();
    
    const rules = [
      { keywords: ['incident', 'problem', 'change', 'ticket', 'itsm', 'service'], types: ['ITSM', 'Communication'] },
      { keywords: ['build', 'deploy', 'release', 'pipeline', 'ci', 'cd'], types: ['DevOps'] },
      { keywords: ['monitor', 'alert', 'metric', 'log', 'observ'], types: ['Monitoring'] },
      { keywords: ['knowledge', 'document', 'content', 'curator'], types: ['Knowledge'] },
      { keywords: ['security', 'compliance', 'audit', 'legal'], types: ['Security'] },
      { keywords: ['infrastructure', 'cloud', 'provision'], types: ['Cloud'] },
      { keywords: ['marketing', 'sales', 'product'], types: ['Communication'] },
    ];
    
    const suggestedTypes = new Set<string>(['AI']); // Always suggest AI
    for (const rule of rules) {
      if (rule.keywords.some(kw => text.includes(kw))) {
        rule.types.forEach(t => suggestedTypes.add(t));
      }
    }
    
    const catalog = await pool.query(
      'SELECT * FROM integration_catalog WHERE type = ANY($1) ORDER BY type, name',
      [Array.from(suggestedTypes)]
    );
    
    // Get already added integrations
    const existing = await pool.query(
      'SELECT integration_name FROM agent_integrations WHERE agent_id = $1',
      [id]
    );
    const existingNames = existing.rows.map(r => r.integration_name);
    
    res.json({
      suggestions: catalog.rows,
      existing: existingNames
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Suggest integrations error:`, error);
    res.status(500).json({ error: 'Failed to suggest integrations' });
  }
});

// POST /api/agents/:id/integrations - Add integration to agent
app.post('/api/agents/:id/integrations', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { integration_name, config_endpoint, config_auth_type, config_api_key, config, is_configured } = req.body;
    
    // Verify agent belongs to tenant
    const agent = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agent.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get integration type from catalog
    const catalog = await pool.query(
      'SELECT type, icon FROM integration_catalog WHERE name = $1',
      [integration_name]
    );
    
    const result = await pool.query(`
      INSERT INTO agent_integrations (
        agent_id, integration_name, integration_type, 
        config_endpoint, config_auth_type, config_api_key, 
        config, is_configured
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      id, 
      integration_name, 
      catalog.rows[0]?.type || 'Custom',
      config_endpoint || null,
      config_auth_type || 'API Key',
      config_api_key || null,
      JSON.stringify(config || {}),
      is_configured || false
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Add integration error:`, error);
    res.status(500).json({ error: 'Failed to add integration' });
  }
});

// PUT /api/agents/:id/integrations/:integrationId - Update integration config
app.put('/api/agents/:id/integrations/:integrationId', async (req: Request, res: Response) => {
  try {
    const { id, integrationId } = req.params;
    const tenantId = req.tenantId;
    const { config_endpoint, config_auth_type, config_api_key, config, is_configured } = req.body;
    
    // Verify agent belongs to tenant
    const agent = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agent.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const result = await pool.query(`
      UPDATE agent_integrations 
      SET config_endpoint = COALESCE($1, config_endpoint),
          config_auth_type = COALESCE($2, config_auth_type),
          config_api_key = COALESCE($3, config_api_key),
          config = COALESCE($4, config),
          is_configured = COALESCE($5, is_configured),
          updated_at = NOW()
      WHERE id = $6 AND agent_id = $7
      RETURNING *
    `, [config_endpoint, config_auth_type, config_api_key, JSON.stringify(config || {}), is_configured, integrationId, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Integration not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Update integration error:`, error);
    res.status(500).json({ error: 'Failed to update integration' });
  }
});

// DELETE /api/agents/:id/integrations/:integrationId - Remove integration
app.delete('/api/agents/:id/integrations/:integrationId', async (req: Request, res: Response) => {
  try {
    const { id, integrationId } = req.params;
    const tenantId = req.tenantId;
    
    // Verify agent belongs to tenant
    const agent = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agent.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    await pool.query(
      'DELETE FROM agent_integrations WHERE id = $1 AND agent_id = $2',
      [integrationId, id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Remove integration error:`, error);
    res.status(500).json({ error: 'Failed to remove integration' });
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

// =============================================================================
// Agent Skills API (A2A Protocol)
// =============================================================================

// GET /api/agents/:id/skills - List skills for an agent
app.get('/api/agents/:id/skills', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const ownership = await pool.query('SELECT id FROM agents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: `Agent ${id} not found` });
    }

    const result = await pool.query(
      `SELECT id, name, display_name, description, input_schema, output_schema, tags, examples, is_active, created_at, updated_at 
       FROM agent_skills WHERE agent_id = $1 ORDER BY created_at`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get agent skills error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to get skills' });
  }
});

// POST /api/agents/:id/skills - Create a skill
app.post('/api/agents/:id/skills', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { name, display_name, description, input_schema, output_schema, tags, examples } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Bad Request', message: 'name is required' });
    }

    const ownership = await pool.query('SELECT id FROM agents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: `Agent ${id} not found` });
    }

    // Ensure JSON fields are properly formatted
    // Note: tags is text[] (array), not jsonb
    const inputSchemaJson = input_schema ? JSON.stringify(input_schema) : '{}';
    const outputSchemaJson = output_schema ? JSON.stringify(output_schema) : '{}';
    const tagsArray = Array.isArray(tags) ? tags : [];
    const examplesJson = examples ? JSON.stringify(examples) : '[]';

    const result = await pool.query(
      `INSERT INTO agent_skills (agent_id, tenant_id, name, display_name, description, input_schema, output_schema, tags, examples)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::text[], $9::jsonb)
       RETURNING *`,
      [id, tenantId, name, display_name || name, description, inputSchemaJson, outputSchemaJson, tagsArray, examplesJson]
    );

    console.log(`[${SERVICE_NAME}] Created skill ${name} for agent ${id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Create skill error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create skill' });
  }
});

// PUT /api/agents/:id/skills/:skillId - Update a skill
app.put('/api/agents/:id/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { id, skillId } = req.params;
    const tenantId = req.tenantId;
    const { name, display_name, description, input_schema, output_schema, tags, examples, is_active } = req.body;

    const ownership = await pool.query(
      'SELECT s.id FROM agent_skills s JOIN agents a ON s.agent_id = a.id WHERE s.id = $1 AND a.id = $2 AND a.tenant_id = $3',
      [skillId, id, tenantId]
    );
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Skill not found' });
    }

    const result = await pool.query(
      `UPDATE agent_skills SET
        name = COALESCE($1, name),
        display_name = COALESCE($2, display_name),
        description = COALESCE($3, description),
        input_schema = COALESCE($4, input_schema),
        output_schema = COALESCE($5, output_schema),
        tags = COALESCE($6, tags),
        examples = COALESCE($7, examples),
        is_active = COALESCE($8, is_active),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [name, display_name, description, input_schema, output_schema, tags, examples, is_active, skillId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Update skill error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update skill' });
  }
});

// DELETE /api/agents/:id/skills/:skillId - Delete a skill
app.delete('/api/agents/:id/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { id, skillId } = req.params;
    const tenantId = req.tenantId;

    const ownership = await pool.query(
      'SELECT s.id FROM agent_skills s JOIN agents a ON s.agent_id = a.id WHERE s.id = $1 AND a.id = $2 AND a.tenant_id = $3',
      [skillId, id, tenantId]
    );
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Skill not found' });
    }

    await pool.query('DELETE FROM agent_skills WHERE id = $1', [skillId]);
    res.json({ success: true, message: 'Skill deleted' });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Delete skill error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete skill' });
  }
});

// =============================================================================
// AGENT REGISTRY API - Multi-Tenant Agent Discovery
// =============================================================================

// GET /api/registry/agents - List all deployed agents for tenant (with A2A cards)
app.get('/api/registry/agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = (page - 1) * limit;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    // Only return agents with deployment.status = 'running' in config
    const query = `
      SELECT a.*, 
             (SELECT COUNT(*) FROM agent_skills WHERE agent_id = a.id AND is_active = true) as skill_count
      FROM agents a
      WHERE a.tenant_id = $1
        AND a.config->'deployment'->>'status' = 'running'
      ORDER BY a.name
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) 
      FROM agents 
      WHERE tenant_id = $1 
        AND config->'deployment'->>'status' = 'running'
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, [tenantId, limit, offset]),
      pool.query(countQuery, [tenantId])
    ]);

    const total = parseInt(countResult.rows[0]?.count || '0');

    // Build A2A cards for each agent
    const agents = await Promise.all(
      result.rows.map(async (agent) => {
        const skillsResult = await pool.query(
          'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples FROM agent_skills WHERE agent_id = $1 AND is_active = true ORDER BY created_at',
          [agent.id]
        );

        const capsResult = await pool.query(
          'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1 AND is_enabled = true',
          [agent.id]
        );

        const config = agent.config || {};
        const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}/agents`;

        // Build A2A skills
        const a2aSkills = skillsResult.rows.length > 0
          ? skillsResult.rows.map((skill: any) => ({
              id: skill.name,
              name: skill.display_name || skill.name,
              description: skill.description || `${skill.display_name || skill.name} skill`,
              tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
              examples: (skill.examples || []).map((ex: any) => ({
                name: ex.name || skill.display_name || skill.name,
                input: ex.input || {},
                output: ex.output
              })),
              inputModes: ["text"],
              outputModes: ["text"],
              inputSchema: skill.input_schema,
              outputSchema: skill.output_schema
            }))
          : buildSkillsFromAgent(agent, capsResult.rows);

        return {
          // A2A Protocol fields
          name: agent.name,
          url: `${baseUrl}/${agent.id}`,
          version: `${agent.version || 1}.0.0`,
          description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
          protocolVersion: "0.2",
          documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
          
          provider: {
            organization: config.provider?.organization || "FlowGrid Platform",
            url: config.provider?.url || "https://flowgrid.io"
          },
          
          capabilities: {
            streaming: config.a2aCapabilities?.streaming || false,
            pushNotifications: config.a2aCapabilities?.pushNotifications || false,
            stateTransitionHistory: true
          },
          
          authentication: {
            schemes: config.authentication?.schemes || ["bearer"]
          },
          
          defaultInputModes: config.defaultInputModes || ["text"],
          defaultOutputModes: config.defaultOutputModes || ["text"],
          
          skills: a2aSkills,
          
          // FlowGrid extensions
          _flowgrid: {
            id: agent.id,
            tenantId: agent.tenant_id,
            elementType: agent.element_type || 'Agent',
            pattern: config.pattern || agent.type,
            valueStream: config.valueStream,
            autonomyLevel: config.autonomyLevel || 'supervised',
            status: agent.status,
            deploymentStatus: config.deployment?.status || 'running',
            skillCount: parseInt(agent.skill_count || '0')
          }
        };
      })
    );

    res.json({
      data: agents,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List registry agents error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list registry agents',
    });
  }
});

// GET /api/registry/agents/:id - Get single agent's A2A card
app.get('/api/registry/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const agentResult = await pool.query(
      `SELECT * FROM agents 
       WHERE id = $1 
         AND tenant_id = $2 
         AND config->'deployment'->>'status' = 'running'`,
      [id, tenantId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found or not deployed`,
      });
    }

    const agent = agentResult.rows[0];
    const config = agent.config || {};
    const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}/agents`;

    // Get skills
    const skillsResult = await pool.query(
      'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples FROM agent_skills WHERE agent_id = $1 AND is_active = true ORDER BY created_at',
      [id]
    );

    // Get capabilities (for fallback)
    const capsResult = await pool.query(
      'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1 AND is_enabled = true',
      [id]
    );

    // Get relationships
    const relResult = await pool.query(
      `SELECT i.message_type, i.config
       FROM agent_interactions i
       WHERE i.target_agent_id = $1`,
      [id]
    );

    // Build A2A skills
    const a2aSkills = skillsResult.rows.length > 0
      ? skillsResult.rows.map((skill: any) => ({
          id: skill.name,
          name: skill.display_name || skill.name,
          description: skill.description || `${skill.display_name || skill.name} skill`,
          tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
          examples: (skill.examples || []).map((ex: any) => ({
            name: ex.name || skill.display_name || skill.name,
            input: ex.input || {},
            output: ex.output
          })),
          inputModes: ["text"],
          outputModes: ["text"],
          inputSchema: skill.input_schema,
          outputSchema: skill.output_schema
        }))
      : buildSkillsFromAgent(agent, capsResult.rows);

    // Build A2A Protocol v0.2 compliant Agent Card
    const agentCard = {
      // Required fields
      name: agent.name,
      url: `${baseUrl}/${agent.id}`,
      version: `${agent.version || 1}.0.0`,
      
      // Recommended fields
      description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
      protocolVersion: "0.2",
      documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
      
      provider: {
        organization: config.provider?.organization || "FlowGrid Platform",
        url: config.provider?.url || "https://flowgrid.io"
      },
      
      capabilities: {
        streaming: config.a2aCapabilities?.streaming || false,
        pushNotifications: config.a2aCapabilities?.pushNotifications || false,
        stateTransitionHistory: true
      },
      
      authentication: {
        schemes: config.authentication?.schemes || ["bearer"]
      },
      
      defaultInputModes: config.defaultInputModes || ["text"],
      defaultOutputModes: config.defaultOutputModes || ["text"],
      
      skills: a2aSkills,
      
      // FlowGrid extensions
      _flowgrid: {
        id: agent.id,
        tenantId: agent.tenant_id,
        elementType: agent.element_type || 'Agent',
        pattern: config.pattern || agent.type,
        valueStream: config.valueStream,
        autonomyLevel: config.autonomyLevel || 'supervised',
        decisionAuthority: config.decisionAuthority || 'propose-and-execute',
        riskAppetite: config.riskAppetite || 'medium',
        triggers: config.triggers || [],
        outputs: config.outputs || [],
        escalationPath: config.escalationPath,
        deploymentStatus: config.deployment?.status || 'running',
        relationships: relResult.rows.map((r: any) => ({
          messageType: r.message_type,
          config: r.config
        }))
      }
    };

    res.json(agentCard);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get registry agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get registry agent',
    });
  }
});

// GET /api/registry/agents/search - Search by skill, tag, pattern, capability
app.get('/api/registry/agents/search', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { 
      skill, 
      tag, 
      pattern, 
      capability, 
      valueStream,
      q // general text search
    } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    let query = `
      SELECT DISTINCT a.*, 
             (SELECT COUNT(*) FROM agent_skills WHERE agent_id = a.id AND is_active = true) as skill_count
      FROM agents a
      LEFT JOIN agent_skills s ON a.id = s.agent_id AND s.is_active = true
      LEFT JOIN agent_capabilities c ON a.id = c.agent_id AND c.is_enabled = true
      WHERE a.tenant_id = $1
        AND a.config->'deployment'->>'status' = 'running'
    `;

    const params: any[] = [tenantId];
    let paramIndex = 2;

    // Search by skill name
    if (skill) {
      query += ` AND s.name ILIKE $${paramIndex}`;
      params.push(`%${skill}%`);
      paramIndex++;
    }

    // Search by tag (skills have tags array)
    if (tag) {
      query += ` AND $${paramIndex} = ANY(s.tags)`;
      params.push(String(tag));
      paramIndex++;
    }

    // Search by pattern (in config)
    if (pattern) {
      query += ` AND a.config->>'pattern' = $${paramIndex}`;
      params.push(String(pattern));
      paramIndex++;
    }

    // Search by capability name
    if (capability) {
      query += ` AND c.capability_name ILIKE $${paramIndex}`;
      params.push(`%${capability}%`);
      paramIndex++;
    }

    // Search by value stream
    if (valueStream) {
      query += ` AND a.config->>'valueStream' = $${paramIndex}`;
      params.push(String(valueStream));
      paramIndex++;
    }

    // General text search (name, description, type)
    if (q) {
      query += ` AND (
        a.name ILIKE $${paramIndex} 
        OR a.description ILIKE $${paramIndex}
        OR a.type ILIKE $${paramIndex}
      )`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    query += ` ORDER BY a.name LIMIT 100`;

    const result = await pool.query(query, params);

    // Build A2A cards for results
    const agents = await Promise.all(
      result.rows.map(async (agent) => {
        const skillsResult = await pool.query(
          'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples FROM agent_skills WHERE agent_id = $1 AND is_active = true ORDER BY created_at',
          [agent.id]
        );

        const config = agent.config || {};
        const baseUrl = `${req.protocol}://${req.get('host')}/agents`;

        const a2aSkills = skillsResult.rows.map((skill: any) => ({
          id: skill.name,
          name: skill.display_name || skill.name,
          description: skill.description,
          tags: skill.tags || [],
          inputSchema: skill.input_schema,
          outputSchema: skill.output_schema
        }));

        return {
          name: agent.name,
          url: `${baseUrl}/${agent.id}`,
          version: `${agent.version || 1}.0.0`,
          description: config.detailedPurpose || agent.description || config.shortDescription,
          skills: a2aSkills,
          _flowgrid: {
            id: agent.id,
            pattern: config.pattern || agent.type,
            valueStream: config.valueStream,
            skillCount: parseInt(agent.skill_count || '0')
          }
        };
      })
    );

    res.json({
      data: agents,
      meta: {
        total: agents.length,
        searchParams: { skill, tag, pattern, capability, valueStream, q }
      }
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Search registry agents error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search registry agents',
    });
  }
});

// POST /api/registry/agents/:id/register - Agent self-registration
app.post('/api/registry/agents/:id/register', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { endpoint, healthCheckUrl, metadata } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    // Verify agent exists and belongs to tenant
    const agentResult = await pool.query(
      'SELECT id, config FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    const agent = agentResult.rows[0];
    const config = agent.config || {};

    // Update deployment status to 'running'
    const updatedConfig = {
      ...config,
      deployment: {
        ...config.deployment,
        status: 'running',
        endpoint: endpoint || config.deployment?.endpoint,
        healthCheckUrl: healthCheckUrl || config.deployment?.healthCheckUrl,
        registeredAt: new Date().toISOString(),
        metadata: metadata || config.deployment?.metadata
      }
    };

    await pool.query(
      'UPDATE agents SET config = $1, updated_at = NOW() WHERE id = $2',
      [updatedConfig, id]
    );

    console.log(`[${SERVICE_NAME}] Agent ${id} registered as running`);

    res.json({
      success: true,
      message: 'Agent registered successfully',
      agentId: id,
      status: 'running',
      registeredAt: updatedConfig.deployment.registeredAt
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Register agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register agent',
    });
  }
});

// DELETE /api/registry/agents/:id/unregister - Agent deregistration
app.delete('/api/registry/agents/:id/unregister', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    // Verify agent exists and belongs to tenant
    const agentResult = await pool.query(
      'SELECT id, config FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    const agent = agentResult.rows[0];
    const config = agent.config || {};

    // Update deployment status to 'stopped'
    const updatedConfig = {
      ...config,
      deployment: {
        ...config.deployment,
        status: 'stopped',
        unregisteredAt: new Date().toISOString()
      }
    };

    await pool.query(
      'UPDATE agents SET config = $1, updated_at = NOW() WHERE id = $2',
      [updatedConfig, id]
    );

    console.log(`[${SERVICE_NAME}] Agent ${id} unregistered`);

    res.json({
      success: true,
      message: 'Agent unregistered successfully',
      agentId: id,
      status: 'stopped',
      unregisteredAt: updatedConfig.deployment.unregisteredAt
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Unregister agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to unregister agent',
    });
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
      pool.query('SELECT id, name, type, element_type, description FROM agents WHERE tenant_id = $1 ORDER BY name', [tenantId]),
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
      elementType: row.element_type || 'Agent',
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
// Agent Registry Endpoints (Multi-Tenant Runtime Discovery)
// ============================================================================

// GET /api/registry/agents - List all deployed agents for tenant with A2A cards
app.get('/api/registry/agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const baseUrl = req.query.baseUrl as string || `https://agents.example.com`;

    if (!tenantId) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authenticated tenant context required' 
      });
    }

    // Only return running agents (deployment.status = 'running')
    const result = await pool.query(
      `SELECT a.* 
       FROM agents a
       WHERE a.tenant_id = $1
         AND a.config->'deployment'->>'status' = 'running'
       ORDER BY a.name`,
      [tenantId]
    );

    // Build A2A cards for each agent
    const agentCards = await Promise.all(
      result.rows.map(async (agent) => {
        // Get skills for this agent
        const skillsResult = await pool.query(
          `SELECT id, name, display_name, description, input_schema, output_schema, tags, examples 
           FROM agent_skills 
           WHERE agent_id = $1 AND is_active = true 
           ORDER BY created_at`,
          [agent.id]
        );

        // Get capabilities (for fallback if no skills)
        const capsResult = await pool.query(
          'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1',
          [agent.id]
        );

        const config = agent.config || {};
        
        // Build A2A skills
        const a2aSkills = skillsResult.rows.length > 0
          ? skillsResult.rows.map((skill: any) => ({
              id: skill.name,
              name: skill.display_name || skill.name,
              description: skill.description || `${skill.display_name || skill.name} skill`,
              tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
              examples: (skill.examples || []).map((ex: any) => ({
                name: ex.name || skill.display_name || skill.name,
                input: ex.input || {},
                output: ex.output
              })),
              inputModes: ["text"],
              outputModes: ["text"],
              inputSchema: skill.input_schema,
              outputSchema: skill.output_schema
            }))
          : buildSkillsFromAgent(agent, capsResult.rows);

        // Build A2A card
        return {
          name: agent.name,
          url: `${baseUrl}/${agent.id}`,
          version: `${agent.version || 1}.0.0`,
          description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
          protocolVersion: "0.2",
          documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
          provider: {
            organization: config.provider?.organization || "FlowGrid Platform",
            url: config.provider?.url || "https://flowgrid.io"
          },
          capabilities: {
            streaming: config.a2aCapabilities?.streaming || false,
            pushNotifications: config.a2aCapabilities?.pushNotifications || false,
            stateTransitionHistory: true
          },
          authentication: {
            schemes: config.authentication?.schemes || ["bearer"]
          },
          defaultInputModes: config.defaultInputModes || ["text"],
          defaultOutputModes: config.defaultOutputModes || ["text"],
          skills: a2aSkills,
          _flowgrid: {
            id: agent.id,
            elementType: agent.element_type || 'Agent',
            pattern: config.pattern || agent.type,
            valueStream: config.valueStream,
            autonomyLevel: config.autonomyLevel || 'supervised',
            decisionAuthority: config.decisionAuthority || 'propose-and-execute',
            riskAppetite: config.riskAppetite || 'medium',
            triggers: config.triggers || [],
            outputs: config.outputs || [],
            escalationPath: config.escalationPath
          }
        };
      })
    );

    res.json({
      agents: agentCards,
      total: agentCards.length,
      tenantId,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Registry list error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list registry agents',
    });
  }
});

// GET /api/registry/agents/:id - Get single agent's A2A card
app.get('/api/registry/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const baseUrl = req.query.baseUrl as string || `https://agents.example.com`;

    if (!tenantId) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authenticated tenant context required' 
      });
    }

    // Verify agent is running and belongs to tenant
    const agentResult = await pool.query(
      `SELECT * 
       FROM agents 
       WHERE id = $1 
         AND tenant_id = $2
         AND config->'deployment'->>'status' = 'running'`,
      [id, tenantId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Running agent ${id} not found`,
      });
    }

    const agent = agentResult.rows[0];
    const config = agent.config || {};

    // Get skills
    const skillsResult = await pool.query(
      'SELECT id, name, display_name, description, input_schema, output_schema, tags, examples FROM agent_skills WHERE agent_id = $1 AND is_active = true ORDER BY created_at',
      [id]
    );

    // Get capabilities
    const capsResult = await pool.query(
      'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1',
      [id]
    );

    // Get relationships
    const relResult = await pool.query(
      `SELECT i.message_type, i.config
       FROM agent_interactions i
       WHERE i.target_agent_id = $1`,
      [id]
    );

    // Build A2A skills
    const a2aSkills = skillsResult.rows.length > 0
      ? skillsResult.rows.map((skill: any) => ({
          id: skill.name,
          name: skill.display_name || skill.name,
          description: skill.description || `${skill.display_name || skill.name} skill`,
          tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
          examples: (skill.examples || []).map((ex: any) => ({
            name: ex.name || skill.display_name || skill.name,
            input: ex.input || {},
            output: ex.output
          })),
          inputModes: ["text"],
          outputModes: ["text"],
          inputSchema: skill.input_schema,
          outputSchema: skill.output_schema
        }))
      : buildSkillsFromAgent(agent, capsResult.rows);

    // Build A2A Protocol v0.2 compliant Agent Card
    const agentCard = {
      name: agent.name,
      url: `${baseUrl}/${agent.id}`,
      version: `${agent.version || 1}.0.0`,
      description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
      protocolVersion: "0.2",
      documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
      provider: {
        organization: config.provider?.organization || "FlowGrid Platform",
        url: config.provider?.url || "https://flowgrid.io"
      },
      capabilities: {
        streaming: config.a2aCapabilities?.streaming || false,
        pushNotifications: config.a2aCapabilities?.pushNotifications || false,
        stateTransitionHistory: true
      },
      authentication: {
        schemes: config.authentication?.schemes || ["bearer"]
      },
      defaultInputModes: config.defaultInputModes || ["text"],
      defaultOutputModes: config.defaultOutputModes || ["text"],
      skills: a2aSkills,
      _flowgrid: {
        id: agent.id,
        elementType: agent.element_type || 'Agent',
        pattern: config.pattern || agent.type,
        valueStream: config.valueStream,
        autonomyLevel: config.autonomyLevel || 'supervised',
        decisionAuthority: config.decisionAuthority || 'propose-and-execute',
        riskAppetite: config.riskAppetite || 'medium',
        triggers: config.triggers || [],
        outputs: config.outputs || [],
        escalationPath: config.escalationPath,
        relationships: relResult.rows.map((r: any) => ({
          messageType: r.message_type,
          config: r.config
        }))
      }
    };

    res.json(agentCard);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Registry get agent error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get agent from registry',
    });
  }
});

// GET /api/registry/agents/search - Search agents by skill, tag, pattern, capability
app.get('/api/registry/agents/search', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const baseUrl = req.query.baseUrl as string || `https://agents.example.com`;
    const { skill, tag, pattern, capability, q } = req.query;

    if (!tenantId) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authenticated tenant context required' 
      });
    }

    let query = `
      SELECT DISTINCT a.* 
      FROM agents a
      LEFT JOIN agent_skills s ON a.id = s.agent_id
      LEFT JOIN agent_capabilities c ON a.id = c.agent_id
      WHERE a.tenant_id = $1
        AND a.config->'deployment'->>'status' = 'running'
    `;
    const params: any[] = [tenantId];
    let paramIndex = 2;

    // Search by skill name
    if (skill) {
      query += ` AND (s.name ILIKE $${paramIndex} OR s.display_name ILIKE $${paramIndex})`;
      params.push(`%${skill}%`);
      paramIndex++;
    }

    // Search by tag (in skill tags or agent config)
    if (tag) {
      query += ` AND (s.tags @> ARRAY[$${paramIndex}]::text[] OR a.config->'pattern' = $${paramIndex}::text::jsonb)`;
      params.push(tag);
      paramIndex++;
    }

    // Search by pattern (agent type/pattern)
    if (pattern) {
      query += ` AND (a.config->>'pattern' ILIKE $${paramIndex} OR a.type ILIKE $${paramIndex})`;
      params.push(`%${pattern}%`);
      paramIndex++;
    }

    // Search by capability name
    if (capability) {
      query += ` AND c.capability_name ILIKE $${paramIndex}`;
      params.push(`%${capability}%`);
      paramIndex++;
    }

    // General text search
    if (q) {
      query += ` AND (a.name ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    query += ` ORDER BY a.name`;

    const result = await pool.query(query, params);

    // Build A2A cards for matched agents
    const agentCards = await Promise.all(
      result.rows.map(async (agent) => {
        const skillsResult = await pool.query(
          `SELECT id, name, display_name, description, input_schema, output_schema, tags, examples 
           FROM agent_skills 
           WHERE agent_id = $1 AND is_active = true 
           ORDER BY created_at`,
          [agent.id]
        );

        const capsResult = await pool.query(
          'SELECT capability_name, capability_type, config FROM agent_capabilities WHERE agent_id = $1',
          [agent.id]
        );

        const config = agent.config || {};
        
        const a2aSkills = skillsResult.rows.length > 0
          ? skillsResult.rows.map((skill: any) => ({
              id: skill.name,
              name: skill.display_name || skill.name,
              description: skill.description || `${skill.display_name || skill.name} skill`,
              tags: skill.tags || [config.pattern || 'agent', 'flowgrid'].filter(Boolean),
              examples: (skill.examples || []).map((ex: any) => ({
                name: ex.name || skill.display_name || skill.name,
                input: ex.input || {},
                output: ex.output
              })),
              inputModes: ["text"],
              outputModes: ["text"],
              inputSchema: skill.input_schema,
              outputSchema: skill.output_schema
            }))
          : buildSkillsFromAgent(agent, capsResult.rows);

        return {
          name: agent.name,
          url: `${baseUrl}/${agent.id}`,
          version: `${agent.version || 1}.0.0`,
          description: config.detailedPurpose || agent.description || config.shortDescription || `${agent.name} agent`,
      shortDescription: config.shortDescription || null,
          protocolVersion: "0.2",
          documentationUrl: config.documentationUrl || `${baseUrl}/docs/${agent.id}`,
          provider: {
            organization: config.provider?.organization || "FlowGrid Platform",
            url: config.provider?.url || "https://flowgrid.io"
          },
          capabilities: {
            streaming: config.a2aCapabilities?.streaming || false,
            pushNotifications: config.a2aCapabilities?.pushNotifications || false,
            stateTransitionHistory: true
          },
          authentication: {
            schemes: config.authentication?.schemes || ["bearer"]
          },
          defaultInputModes: config.defaultInputModes || ["text"],
          defaultOutputModes: config.defaultOutputModes || ["text"],
          skills: a2aSkills,
          _flowgrid: {
            id: agent.id,
            elementType: agent.element_type || 'Agent',
            pattern: config.pattern || agent.type,
            valueStream: config.valueStream,
            autonomyLevel: config.autonomyLevel || 'supervised',
            decisionAuthority: config.decisionAuthority || 'propose-and-execute',
            riskAppetite: config.riskAppetite || 'medium',
            triggers: config.triggers || [],
            outputs: config.outputs || [],
            escalationPath: config.escalationPath
          }
        };
      })
    );

    res.json({
      agents: agentCards,
      total: agentCards.length,
      query: { skill, tag, pattern, capability, q },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Registry search error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search registry',
    });
  }
});

// POST /api/registry/agents/:id/register - Agent self-registration
app.post('/api/registry/agents/:id/register', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { endpoint, metadata } = req.body;

    if (!tenantId) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authenticated tenant context required' 
      });
    }

    // Update deployment status to 'running'
    const result = await pool.query(
      `UPDATE agents 
       SET config = jsonb_set(
         jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{deployment,status}',
           '"running"'
         ),
         '{deployment,registeredAt}',
         to_jsonb(NOW())
       ),
       config = CASE 
         WHEN $3 IS NOT NULL THEN jsonb_set(config, '{deployment,endpoint}', to_jsonb($3::text))
         ELSE config
       END,
       config = CASE 
         WHEN $4 IS NOT NULL THEN jsonb_set(config, '{deployment,metadata}', $4::jsonb)
         ELSE config
       END
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, endpoint, metadata ? JSON.stringify(metadata) : null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    console.log(`[${SERVICE_NAME}] Agent ${id} registered (tenant: ${tenantId})`);

    res.json({
      success: true,
      agentId: id,
      status: 'running',
      registeredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Registry register error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register agent',
    });
  }
});

// DELETE /api/registry/agents/:id/unregister - Agent deregistration
app.delete('/api/registry/agents/:id/unregister', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authenticated tenant context required' 
      });
    }

    // Update deployment status to 'stopped'
    const result = await pool.query(
      `UPDATE agents 
       SET config = jsonb_set(
         jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{deployment,status}',
           '"stopped"'
         ),
         '{deployment,unregisteredAt}',
         to_jsonb(NOW())
       )
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${id} not found`,
      });
    }

    console.log(`[${SERVICE_NAME}] Agent ${id} unregistered (tenant: ${tenantId})`);

    res.status(204).send();
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Registry unregister error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to unregister agent',
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

// ============================================================================
// Approval Requests API (HITL - Human In The Loop)
// ============================================================================

// GET /api/approvals/stats - Counts by status for badge display
app.get('/api/approvals/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT status, COUNT(*)::int as count FROM approval_requests WHERE tenant_id = $1 GROUP BY status`,
      [tenantId]
    );

    const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, expired: 0, cancelled: 0 };
    result.rows.forEach((r: any) => { stats[r.status] = r.count; });

    res.json(stats);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Approval stats error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to get approval stats' });
  }
});

// GET /api/approvals - List approvals for tenant
app.get('/api/approvals', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;
    const agent_id = req.query.agent_id as string;
    const foundation_id = req.query.foundation_id as string;

    let query = `SELECT * FROM approval_requests WHERE tenant_id = $1`;
    const params: any[] = [tenantId];
    let idx = 2;

    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    if (agent_id) { query += ` AND agent_id = $${idx++}`; params.push(agent_id); }
    if (foundation_id) { query += ` AND foundation_id = $${idx++}`; params.push(foundation_id); }

    query += ` ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, requested_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Count
    let countQuery = `SELECT COUNT(*)::int FROM approval_requests WHERE tenant_id = $1`;
    const countParams: any[] = [tenantId];
    let ci = 2;
    if (status) { countQuery += ` AND status = $${ci++}`; countParams.push(status); }
    if (agent_id) { countQuery += ` AND agent_id = $${ci++}`; countParams.push(agent_id); }
    if (foundation_id) { countQuery += ` AND foundation_id = $${ci++}`; countParams.push(foundation_id); }

    const countResult = await pool.query(countQuery, countParams);

    res.json({ data: result.rows, total: countResult.rows[0].count });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List approvals error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list approvals' });
  }
});

// GET /api/approvals/:id - Single approval detail
app.get('/api/approvals/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Approval request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get approval error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to get approval' });
  }
});

// POST /api/approvals - Create approval request
app.post('/api/approvals', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    const { title, description, agent_id, agent_name, flow_instance_id, foundation_id, context, urgency, expires_at } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Bad Request', message: 'title is required' });
    }

    const result = await pool.query(
      `INSERT INTO approval_requests (tenant_id, title, description, agent_id, agent_name, flow_instance_id, foundation_id, context, urgency, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [tenantId, title, description || null, agent_id || null, agent_name || null, flow_instance_id || null, foundation_id || null, context || '{}', urgency || 'normal', expires_at || null]
    );

    console.log(`[${SERVICE_NAME}] Created approval request: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Create approval error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create approval' });
  }
});

// POST /api/approvals/:id/decide - Approve or reject
app.post('/api/approvals/:id/decide', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.userId;
    const userEmail = req.user?.email;
    const { id } = req.params;
    const { decision, comment } = req.body;

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Bad Request', message: "decision must be 'approved' or 'rejected'" });
    }

    const result = await pool.query(
      `UPDATE approval_requests 
       SET status = $1, decided_by = $2, decided_by_name = $3, decided_at = NOW(), decision_comment = $4, updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6 AND status = 'pending'
       RETURNING *`,
      [decision, userId, userEmail, comment || null, id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Approval request not found or already decided' });
    }

    console.log(`[${SERVICE_NAME}] Approval ${id} ${decision} by ${userEmail}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Decide approval error:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to decide approval' });
  }
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
