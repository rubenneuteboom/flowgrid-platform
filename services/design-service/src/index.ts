import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

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

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// ============================================================================
// Agentic Design Patterns (shared reference)
// ============================================================================
const AGENTIC_PATTERNS = `
## AGENTIC DESIGN PATTERNS

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

ADDITIONAL PATTERNS (Anthropic's Guide):
- Routing, Planning, Tool Use, Orchestration, Human-in-Loop, RAG, Reflection, Guardrails`;

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
// Design Tools - Agent Refinement
// ============================================================================

// Get agentic patterns reference
app.get('/api/design/patterns', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM agentic_patterns ORDER BY id');
    res.json({ patterns: result.rows });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get patterns error:`, error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

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

// Refine a single agent
app.post('/api/design/agent', async (req: Request, res: Response) => {
  try {
    const { agent, refinementRequest } = req.body;

    if (!agent) {
      return res.status(400).json({ error: 'agent is required' });
    }

    const prompt = `You are an expert in designing AI agents for IT service management.

Current agent configuration:
${JSON.stringify(agent, null, 2)}

${AGENTIC_PATTERNS}

Refinement request: ${refinementRequest || 'Improve this agent design with better capabilities, clearer purpose, and optimal pattern selection.'}

Return an improved agent configuration as JSON:
{
  "name": "...",
  "purpose": "...",
  "description": "...",
  "pattern": "...",
  "patternRationale": "...",
  "capabilities": [...],
  "triggers": [...],
  "outputs": [...],
  "autonomyLevel": "autonomous|supervised|human-in-loop",
  "riskAppetite": "low|medium|high",
  "improvements": ["list of improvements made"]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    let refinedAgent;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        refinedAgent = JSON.parse(jsonMatch[0]);
      } else {
        refinedAgent = { rawResponse: responseText };
      }
    } catch {
      refinedAgent = { rawResponse: responseText };
    }

    res.json({
      success: true,
      agent: refinedAgent,
      model: 'claude-sonnet-4-20250514',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Refine agent error:`, error);
    res.status(500).json({ error: 'Failed to refine agent' });
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
});

export default app;
