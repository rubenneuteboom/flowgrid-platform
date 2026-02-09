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
const PORT = process.env.PORT || 3005;
const SERVICE_NAME = 'wizard-service';
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
// Agentic Design Patterns Reference
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

## ADDITIONAL AGENTIC PATTERNS (9 Patterns from Anthropic's Guide)

| Pattern | Emoji | Use When |
|---------|-------|----------|
| **Routing** | 🔀 | Routes work to the appropriate specialist |
| **Planning** | 📋 | Breaks down complex tasks into steps |
| **Tool Use** | 🔧 | Integrates with external systems/APIs |
| **Orchestration** | 🎭 | Coordinates multiple agents |
| **Human-in-Loop** | 👤 | Requires human approval for decisions |
| **RAG** | 📚 | Retrieves information from knowledge bases |
| **Reflection** | 🔍 | Evaluates and improves own output |
| **Guardrails** | 🛡️ | Validates input/output and enforces security |

PATTERN SELECTION CRITERIA:
- Manages other agents → Orchestrator
- Talks to external systems → Gateway  
- Watches and alerts → Monitor
- Deep domain knowledge → Specialist
- Executes automated actions → Executor
- Analyzes data/patterns → Analyzer
- Combines multiple data sources → Aggregator
- Routes requests to handlers → Router/Routing
- Breaks tasks into steps → Planning
- Needs human oversight → Human-in-Loop`;

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

// Upload and analyze image (GPT-4o Vision + Claude)
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
    {"name": "<naam>", "level": <0-2>, "parentName": "<parent of null>", "description": "<beschrijving>", "automationPotential": "low|medium|high"}
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
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router|routing|planning|tool-use|orchestration|human-in-loop|rag|reflection|guardrails",
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
    {"name": "<naam>", "level": <0-2>, "description": "<beschrijving>", "automationPotential": "low|medium|high"}
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "<Agent Naam>",
      "purpose": "<doel>",
      "description": "<uitgebreide beschrijving>",
      "capabilities": [<capability namen>],
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router|routing|planning|tool-use|orchestration|human-in-loop|rag|reflection|guardrails",
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

// Generate complete agent network from session
app.post('/api/wizard/generate-network', async (req: Request, res: Response) => {
  try {
    const { sessionId, selectedCapabilities } = req.body;
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
    const analysis = session.analysis_result;

    // If selectedCapabilities provided, filter agents
    let filteredAgents = analysis.agents || [];
    if (selectedCapabilities && selectedCapabilities.length > 0) {
      filteredAgents = filteredAgents.filter((agent: any) => {
        const agentCaps = agent.capabilities || [];
        return agentCaps.some((cap: any) => {
          const capName = typeof cap === 'string' ? cap : cap.name;
          return selectedCapabilities.includes(capName);
        });
      }).map((agent: any) => ({
        ...agent,
        capabilities: (agent.capabilities || []).filter((cap: any) => {
          const capName = typeof cap === 'string' ? cap : cap.name;
          return selectedCapabilities.includes(capName);
        })
      }));
    }

    // Update session with filtered results
    const updatedAnalysis = {
      ...analysis,
      filteredAgents,
      selectedCapabilities
    };

    await pool.query(
      `UPDATE wizard_sessions SET analysis_result = $1, updated_at = NOW() WHERE id = $2`,
      [updatedAnalysis, sessionId]
    );

    res.json({
      success: true,
      sessionId,
      agents: filteredAgents,
      relationships: analysis.agentRelationships || [],
      integrations: analysis.integrations || []
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate network error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Generate process flow for an agent
app.post('/api/wizard/generate-process', async (req: Request, res: Response) => {
  try {
    const { agent } = req.body;

    if (!agent) {
      return res.status(400).json({ error: 'agent is required' });
    }

    const prompt = `Generate a simple process flow for an agent with these specifications:

Name: ${agent.name}
Purpose: ${agent.purpose || agent.description || 'No purpose specified'}
Pattern: ${agent.pattern || 'Specialist'}
Capabilities: ${(agent.capabilities || []).join(', ')}

Return in this format:

PROCESS STEPS:
1. [First step]
2. [Second step]
3. [Continue...]

DECISION POINTS:
- IF [condition] THEN [action]
- IF [condition] THEN [action]

ERROR HANDLING:
- ON [error type] THEN [handling action]
- ON [error type] THEN [handling action]

Be specific to the agent's purpose and capabilities.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const reply = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse the response
    const stepsMatch = reply.match(/PROCESS STEPS:([\s\S]*?)(?=DECISION POINTS:|$)/i);
    const decisionsMatch = reply.match(/DECISION POINTS:([\s\S]*?)(?=ERROR HANDLING:|$)/i);
    const errorsMatch = reply.match(/ERROR HANDLING:([\s\S]*?)$/i);

    res.json({
      success: true,
      processSteps: stepsMatch ? stepsMatch[1].trim() : reply,
      decisionPoints: decisionsMatch ? decisionsMatch[1].trim() : '',
      errorHandling: errorsMatch ? errorsMatch[1].trim() : ''
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate process error:`, error);
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
    const agents = analysis.filteredAgents || analysis.agents || [];

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
            objectives: agent.objectives,
            processSteps: agent.processSteps,
            decisionPoints: agent.decisionPoints,
            errorHandling: agent.errorHandling,
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
    let interactionsCreated = 0;
    for (const rel of (analysis.agentRelationships || [])) {
      const sourceId = agentIdMap[rel.sourceAgentId];
      const targetId = agentIdMap[rel.targetAgentId];
      if (sourceId && targetId) {
        await pool.query(
          `INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description, is_active)
           VALUES ($1, $2, $3, $4, $5)`,
          [sourceId, targetId, rel.messageType || 'message', rel.description || '', true]
        );
        interactionsCreated++;
      }
    }

    // Create integrations
    let integrationsCreated = 0;
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
        integrationsCreated++;
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
        interactions: interactionsCreated,
        integrations: integrationsCreated,
      },
      agents: createdAgents,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Apply wizard error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Suggest interactions between agents (AI-powered)
app.post('/api/wizard/suggest-interactions', async (req: Request, res: Response) => {
  try {
    const { agents } = req.body;
    const tenantId = req.body.tenantId || req.headers['x-tenant-id'];

    if (!agents || agents.length < 2) {
      return res.json({
        suggestions: [],
        message: 'Need at least 2 agents to suggest interactions',
      });
    }

    const prompt = `Given these IT service management agents, suggest meaningful interactions between them:

Agents:
${agents.map((a: any) => `- ${a.name} (${a.pattern || 'Specialist'}): ${a.purpose || a.description || 'No description'}\n  Capabilities: ${(a.capabilities || []).join(', ')}`).join('\n')}

Suggest interactions in this JSON format:
{
  "suggestions": [
    {
      "sourceAgent": "agent name",
      "targetAgent": "agent name", 
      "messageType": "type of message/event",
      "description": "why this interaction is valuable",
      "priority": "high|medium|low"
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
  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Suggest interactions error:`, error);
    res.status(500).json({ error: error.message });
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
