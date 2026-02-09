import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = 'design-service';
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
});

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// OpenAI API key for vision
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// ============================================================================
// Agentic Design Patterns
// ============================================================================
const AGENTIC_PATTERNS = `
## AGENTIC DESIGN PATTERNS

Choose the appropriate pattern based on the agent's role:

| Pattern | Use When | Characteristics |
|---------|----------|-----------------|
| **Orchestrator** | Coordinates multiple agents/workflows | High-level control, delegates tasks, manages state |
| **Specialist** | Deep domain expertise needed | Focused scope, expert knowledge, handles specific tasks |
| **Coordinator** | Manages handoffs between teams/systems | Routing, load balancing, ensures continuity |
| **Gateway** | External system integration | API facade, protocol translation, security boundary |
| **Monitor** | Observes and alerts on conditions | Passive, threshold-based triggers, escalation |
| **Executor** | Performs automated actions | Task execution, scripted workflows, idempotent |
| **Analyzer** | Processes data for insights | Pattern detection, ML/analytics, reporting |
| **Aggregator** | Combines data from multiple sources | Data fusion, normalization, single view |
| **Router** | Directs work to appropriate handler | Rule-based routing, load distribution |

PATTERN SELECTION CRITERIA:
- Manages other agents → Orchestrator
- Talks to external systems → Gateway  
- Watches and alerts → Monitor
- Deep domain knowledge → Specialist
- Executes automated actions → Executor
- Analyzes data/patterns → Analyzer
- Combines multiple data sources → Aggregator
- Routes requests to handlers → Router
- Manages handoffs → Coordinator`;

// ============================================================================
// Health Check
// ============================================================================
app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: SERVICE_NAME,
      database: 'connected',
      aiProvider: AI_PROVIDER,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
      openaiConfigured: !!OPENAI_API_KEY,
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
// Wizard Routes
// ============================================================================

// Get agentic patterns reference
app.get('/api/wizard/patterns', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM agentic_patterns ORDER BY id');
    res.json({ patterns: result.rows });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get patterns error:`, error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

// List wizard sessions
app.get('/api/wizard/sessions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }

    const result = await pool.query(
      `SELECT id, session_name, source_type, status, created_at, updated_at, applied_at
       FROM wizard_sessions 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [tenantId]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List sessions error:`, error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get wizard session by ID
app.get('/api/wizard/sessions/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM wizard_sessions WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get session error:`, error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Delete wizard session
app.delete('/api/wizard/sessions/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM wizard_sessions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Delete session error:`, error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Upload and analyze image
app.post('/api/wizard/upload-image', upload.single('file'), async (req: Request, res: Response) => {
  console.log(`[${SERVICE_NAME}] Image upload started`);
  
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ 
      error: 'OpenAI API key not configured for vision analysis' 
    });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const tenantId = req.headers['x-tenant-id'] || req.body.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }

    const customPrompt = req.body.customPrompt?.trim() || '';
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`[${SERVICE_NAME}] Analyzing image: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    // Phase 1: OpenAI Vision - Extract capabilities
    const visionPrompt = customPrompt 
      ? `USER CONTEXT: ${customPrompt}\n\nYou are analyzing a capability model diagram.\n\nTASK: Extract ALL text and structure from this image.`
      : `You are analyzing a capability model diagram.\n\nTASK: Extract ALL text and structure from this image.`;

    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'user', 
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
              { type: 'text', text: `${visionPrompt}

Return a JSON object with:
{
  "title": "Name of the model if visible",
  "structure": {
    "level0": ["List all top-level sections/value streams"],
    "level1": ["List all mid-level capability groups"],
    "level2": ["List all detailed capabilities/functions"]
  },
  "hierarchy": [
    {
      "name": "Top level item name",
      "children": [{ "name": "Child item name", "children": [] }]
    }
  ],
  "totalItems": <count>,
  "additionalText": ["Any other text visible"]
}

Be thorough - extract EVERY piece of text you can see.` }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!visionResponse.ok) {
      const error = await visionResponse.text();
      throw new Error(`OpenAI Vision error: ${visionResponse.status} - ${error}`);
    }

    const visionData = await visionResponse.json() as any;
    let extractedText = visionData.choices[0].message.content;

    // Clean markdown
    if (extractedText.startsWith('```')) {
      extractedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    let extractedData;
    try {
      extractedData = JSON.parse(extractedText);
    } catch (e) {
      extractedData = { rawText: extractedText, structure: {} };
    }

    console.log(`[${SERVICE_NAME}] Vision extracted ${extractedData.totalItems || 'unknown'} items`);

    // Phase 2: Claude - Design agents
    const analysisPrompt = `Je bent een enterprise architect. Analyseer deze geëxtraheerde capability structuur en ontwerp een compleet agent model.

${AGENTIC_PATTERNS}

## GEËXTRAHEERDE DATA UIT AFBEELDING:
${JSON.stringify(extractedData, null, 2)}

## ONTWERP NU EEN COMPLEET AGENT MODEL:

Return valid JSON:
{
  "summary": {
    "totalCapabilities": <number>,
    "valueStreams": [<level 0 items>],
    "capabilityGroups": <number>,
    "recommendedAgents": <number>,
    "complexity": "low|medium|high",
    "overview": "<beschrijving>"
  },
  "extractedCapabilities": [
    {"name": "<naam>", "level": <0-2>, "parentName": "<parent of null>", "description": "<beschrijving>"}
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "<Agent Naam>",
      "layer": "value-stream|functional-component|capability",
      "valueStream": "<level 0 naam>",
      "purpose": "<doel>",
      "description": "<uitgebreide beschrijving>",
      "capabilities": [<capability namen>],
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router",
      "patternRationale": "<why this pattern was chosen>",
      "autonomyLevel": "autonomous|supervised|human-in-loop",
      "riskAppetite": "low|medium|high",
      "triggers": [<triggers>],
      "outputs": [<outputs>]
    }
  ],
  "agentRelationships": [
    {"sourceAgentId": "agent-1", "targetAgentId": "agent-2", "messageType": "<type>", "description": "<wat>"}
  ],
  "integrations": [
    {"agentId": "agent-1", "name": "<naam>", "system": "<systeem>", "type": "API|Webhook", "direction": "inbound|outbound"}
  ]
}

REGELS:
- Max 20 agents to ensure complete JSON output
- Keep descriptions SHORT (max 80 chars)
- Define relationships between related agents
- Include realistic integrations (ServiceNow, Jira, etc.)
- Return ONLY valid JSON, no markdown`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: 'You are an expert enterprise architect. Respond with ONLY valid JSON.',
      messages: [{ role: 'user', content: analysisPrompt }],
    });

    let analysis = message.content[0].type === 'text' ? message.content[0].text : '';
    
    // Clean markdown
    if (analysis.includes('```')) {
      analysis = analysis.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    }
    const jsonMatch = analysis.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = jsonMatch[0];
    }

    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis);
    } catch (parseError) {
      console.error(`[${SERVICE_NAME}] JSON parse error:`, parseError);
      return res.status(500).json({ 
        error: 'Failed to parse AI response',
        raw: analysis.substring(0, 500)
      });
    }

    // Create wizard session
    const sessionId = uuidv4();
    const sessionName = extractedData.title || `Image Analysis ${new Date().toLocaleDateString()}`;

    await pool.query(
      `INSERT INTO wizard_sessions 
       (id, tenant_id, session_name, source_type, source_data, analysis_result, custom_prompt, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sessionId, tenantId, sessionName, 'image', extractedData, parsedAnalysis, customPrompt, 'analyzed']
    );

    console.log(`[${SERVICE_NAME}] Created session ${sessionId} with ${parsedAnalysis.agents?.length || 0} agents`);

    res.json({
      success: true,
      sessionId,
      analysis: parsedAnalysis,
      source: 'image',
      model: 'hybrid (gpt-4o + claude-sonnet)',
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Image analysis error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze text description
app.post('/api/wizard/analyze-text', async (req: Request, res: Response) => {
  try {
    const { description, requirements, tenantId } = req.body;
    const tid = tenantId || req.headers['x-tenant-id'];

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!tid) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    console.log(`[${SERVICE_NAME}] Analyzing text description (${description.length} chars)`);

    const prompt = `Je bent een enterprise architect. Analyseer deze beschrijving en ontwerp een compleet agent model.

${AGENTIC_PATTERNS}

## BESCHRIJVING:
${description}

${requirements ? `## EISEN:\n${requirements.join('\n')}` : ''}

## ONTWERP NU EEN COMPLEET AGENT MODEL:

Return valid JSON:
{
  "summary": {
    "totalCapabilities": <number>,
    "recommendedAgents": <number>,
    "complexity": "low|medium|high",
    "overview": "<beschrijving>"
  },
  "extractedCapabilities": [
    {"name": "<naam>", "level": <0-2>, "description": "<beschrijving>"}
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "<Agent Naam>",
      "purpose": "<doel>",
      "description": "<uitgebreide beschrijving>",
      "capabilities": [<capability namen>],
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router",
      "patternRationale": "<waarom dit pattern>",
      "autonomyLevel": "autonomous|supervised|human-in-loop",
      "riskAppetite": "low|medium|high",
      "triggers": [<triggers>],
      "outputs": [<outputs>]
    }
  ],
  "agentRelationships": [
    {"sourceAgentId": "agent-1", "targetAgentId": "agent-2", "messageType": "<type>", "description": "<wat>"}
  ],
  "integrations": [
    {"agentId": "agent-1", "name": "<naam>", "system": "<systeem>", "type": "API|Webhook", "direction": "inbound|outbound"}
  ]
}

Return ONLY valid JSON.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      system: 'You are an expert enterprise architect. Respond with ONLY valid JSON.',
      messages: [{ role: 'user', content: prompt }],
    });

    let analysis = message.content[0].type === 'text' ? message.content[0].text : '';
    
    if (analysis.includes('```')) {
      analysis = analysis.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    }
    const jsonMatch = analysis.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = jsonMatch[0];
    }

    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis);
    } catch (parseError) {
      return res.status(500).json({ 
        error: 'Failed to parse AI response',
        raw: analysis.substring(0, 500)
      });
    }

    // Create wizard session
    const sessionId = uuidv4();
    const sessionName = `Text Analysis ${new Date().toLocaleDateString()}`;

    await pool.query(
      `INSERT INTO wizard_sessions 
       (id, tenant_id, session_name, source_type, source_data, analysis_result, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, tid, sessionName, 'text', { description, requirements }, parsedAnalysis, 'analyzed']
    );

    res.json({
      success: true,
      sessionId,
      analysis: parsedAnalysis,
      source: 'text',
      model: 'claude-sonnet-4-20250514',
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Text analysis error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Apply wizard session - create agents in database
app.post('/api/wizard/apply', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const tenantId = req.body.tenantId || req.headers['x-tenant-id'];

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    // Get session
    const sessionResult = await pool.query(
      'SELECT * FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
      [sessionId, tenantId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    if (session.status === 'applied') {
      return res.status(400).json({ error: 'Session already applied' });
    }

    const analysis = session.analysis_result;
    const agents = analysis.agents || [];

    console.log(`[${SERVICE_NAME}] Applying session ${sessionId}: ${agents.length} agents`);

    const createdAgents = [];
    const agentIdMap: Record<string, string> = {};

    // Create agents
    for (const agent of agents) {
      const newAgentId = uuidv4();
      agentIdMap[agent.id] = newAgentId;

      await pool.query(
        `INSERT INTO agents (id, tenant_id, name, type, description, config, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newAgentId,
          tenantId,
          agent.name,
          agent.pattern || 'Specialist',
          agent.description || agent.purpose || '',
          JSON.stringify({
            pattern: agent.pattern,
            patternRationale: agent.patternRationale,
            autonomyLevel: agent.autonomyLevel,
            riskAppetite: agent.riskAppetite,
            triggers: agent.triggers,
            outputs: agent.outputs,
            valueStream: agent.valueStream,
            layer: agent.layer,
          }),
          'draft'
        ]
      );

      // Create capabilities
      for (const cap of (agent.capabilities || [])) {
        const capName = typeof cap === 'string' ? cap : cap.name;
        await pool.query(
          `INSERT INTO agent_capabilities (agent_id, capability_name, capability_type, is_enabled)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id, capability_name) DO NOTHING`,
          [newAgentId, capName, 'action', true]
        );
      }

      createdAgents.push({
        id: newAgentId,
        name: agent.name,
        type: agent.pattern,
      });
    }

    // Create interactions
    for (const rel of (analysis.agentRelationships || [])) {
      const sourceId = agentIdMap[rel.sourceAgentId];
      const targetId = agentIdMap[rel.targetAgentId];
      if (sourceId && targetId) {
        await pool.query(
          `INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description, is_active)
           VALUES ($1, $2, $3, $4, $5)`,
          [sourceId, targetId, rel.messageType || 'message', rel.description || '', true]
        );
      }
    }

    // Create integrations
    for (const int of (analysis.integrations || [])) {
      const agentId = agentIdMap[int.agentId];
      if (agentId) {
        await pool.query(
          `INSERT INTO agent_integrations (agent_id, integration_type, config, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id, integration_type) DO NOTHING`,
          [
            agentId,
            int.system || int.name,
            JSON.stringify({ name: int.name, type: int.type, direction: int.direction }),
            'pending'
          ]
        );
      }
    }

    // Update session status
    await pool.query(
      `UPDATE wizard_sessions SET status = 'applied', applied_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'WIZARD_APPLY', 'wizard_session', sessionId, JSON.stringify({ agents: createdAgents.length })]
    );

    console.log(`[${SERVICE_NAME}] Created ${createdAgents.length} agents from wizard`);

    res.json({
      success: true,
      created: {
        agents: createdAgents.length,
        interactions: (analysis.agentRelationships || []).length,
        integrations: (analysis.integrations || []).length,
      },
      agents: createdAgents,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Apply wizard error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Existing Design Routes
// ============================================================================

// Analyze capability model using AI
app.post('/api/design/analyze-model', async (req: Request, res: Response) => {
  try {
    const { description, existingAgents, requirements } = req.body;

    if (!description) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Description is required',
      });
    }

    const prompt = `Analyze the following IT service management scenario and suggest an agent-based solution.

${AGENTIC_PATTERNS}

Scenario Description:
${description}

${existingAgents ? `Existing Agents: ${JSON.stringify(existingAgents)}` : ''}
${requirements ? `Requirements: ${JSON.stringify(requirements)}` : ''}

Please provide:
1. A list of recommended agents with their capabilities and patterns
2. Suggested interactions between agents
3. Integration points with external systems (ServiceNow, Jira, etc.)
4. Any potential risks or considerations

Respond in JSON format with the following structure:
{
  "recommendedAgents": [{"name": "...", "type": "...", "pattern": "...", "capabilities": [...], "description": "..."}],
  "interactions": [{"from": "...", "to": "...", "type": "...", "description": "..."}],
  "integrations": [{"system": "...", "purpose": "...", "requiredData": [...]}],
  "considerations": ["..."]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    let analysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = { rawResponse: responseText };
      }
    } catch {
      analysis = { rawResponse: responseText };
    }

    res.json({
      analysis,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Analyze model error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to analyze model',
    });
  }
});

// Generate agent code
app.post('/api/design/generate-code/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { language = 'typescript', framework = 'express' } = req.body;

    const agentResult = await pool.query(
      `SELECT a.*, 
              COALESCE(json_agg(DISTINCT jsonb_build_object('name', ac.capability_name, 'type', ac.capability_type)) FILTER (WHERE ac.id IS NOT NULL), '[]') as capabilities,
              COALESCE(json_agg(DISTINCT jsonb_build_object('type', ai.integration_type, 'config', ai.config)) FILTER (WHERE ai.id IS NOT NULL), '[]') as integrations
       FROM agents a
       LEFT JOIN agent_capabilities ac ON a.id = ac.agent_id
       LEFT JOIN agent_integrations ai ON a.id = ai.agent_id
       WHERE a.id = $1
       GROUP BY a.id`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Agent ${agentId} not found`,
      });
    }

    const agent = agentResult.rows[0];
    const config = agent.config || {};

    const prompt = `Generate ${language} code for an IT service management agent with the following specifications:

Agent Name: ${agent.name}
Type/Pattern: ${agent.type}
Description: ${agent.description || 'No description provided'}
Capabilities: ${JSON.stringify(agent.capabilities)}
Integrations: ${JSON.stringify(agent.integrations)}
Config: ${JSON.stringify(config)}

Agentic Pattern: ${config.pattern || agent.type}
Autonomy Level: ${config.autonomyLevel || 'supervised'}
Risk Appetite: ${config.riskAppetite || 'low'}
Triggers: ${JSON.stringify(config.triggers || [])}
Outputs: ${JSON.stringify(config.outputs || [])}

Generate production-ready ${framework} code that:
1. Implements all specified capabilities as API endpoints
2. Includes error handling and logging
3. Has TypeScript types/interfaces
4. Includes connection stubs for integrations
5. Follows the ${config.pattern || 'Specialist'} agentic pattern
6. Respects the autonomy level (${config.autonomyLevel || 'supervised'})

Provide the complete code in a single file.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const code = message.content[0].type === 'text' ? message.content[0].text : '';

    res.json({
      agentId,
      agentName: agent.name,
      language,
      framework,
      code,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Generate code error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate code',
    });
  }
});

// Suggest interactions between agents
app.post('/api/design/suggest-interactions', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'tenantId is required',
      });
    }

    const agentsResult = await pool.query(
      `SELECT a.id, a.name, a.type, a.description, a.config,
              COALESCE(json_agg(DISTINCT ac.capability_name) FILTER (WHERE ac.capability_name IS NOT NULL), '[]') as capabilities
       FROM agents a
       LEFT JOIN agent_capabilities ac ON a.id = ac.agent_id
       WHERE a.tenant_id = $1
       GROUP BY a.id`,
      [tenantId]
    );

    if (agentsResult.rows.length < 2) {
      return res.json({
        suggestions: [],
        message: 'Need at least 2 agents to suggest interactions',
      });
    }

    const prompt = `Given these IT service management agents, suggest meaningful interactions between them:

Agents:
${agentsResult.rows.map((a: any) => {
  const config = a.config || {};
  return `- ${a.name} (${a.type}, Pattern: ${config.pattern || 'Unknown'}): ${a.description || 'No description'}\n  Capabilities: ${JSON.stringify(a.capabilities)}`;
}).join('\n')}

Suggest interactions in this JSON format:
{
  "suggestions": [
    {
      "sourceAgent": "agent name",
      "targetAgent": "agent name", 
      "messageType": "type of message/event",
      "description": "why this interaction is valuable",
      "priority": "high/medium/low"
    }
  ]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    let suggestions;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      } else {
        suggestions = { suggestions: [], rawResponse: responseText };
      }
    } catch {
      suggestions = { suggestions: [], rawResponse: responseText };
    }

    res.json(suggestions);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Suggest interactions error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to suggest interactions',
    });
  }
});

// Simple AI chat endpoint
app.post('/api/design/chat', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Message is required',
      });
    }

    const systemPrompt = `You are an AI assistant specializing in IT service management and agent-based architectures. 
You help users design, configure, and troubleshoot multi-agent systems that integrate with ServiceNow, Jira, and other ITSM tools.
You understand agentic design patterns: Orchestrator, Specialist, Coordinator, Gateway, Monitor, Executor, Analyzer, Aggregator, Router.
${context ? `Context: ${JSON.stringify(context)}` : ''}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : '';

    res.json({
      reply,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Chat error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process chat',
    });
  }
});

// ============================================================================
// Error Handling
// ============================================================================
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
  console.log(`[${SERVICE_NAME}] AI Provider: ${AI_PROVIDER}`);
  console.log(`[${SERVICE_NAME}] Anthropic configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`[${SERVICE_NAME}] OpenAI Vision configured: ${!!OPENAI_API_KEY}`);
});

export default app;
