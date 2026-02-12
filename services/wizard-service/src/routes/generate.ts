/**
 * Generation Routes - Agent Network Generation and Application
 * 
 * Platform Architecture: Final stage of the wizard - creating actual agents.
 * This is where the "harmonization engine" produces standardized agent definitions.
 */

import { Router, Request, Response } from 'express';
import {
  getWizardSessionByTenant,
  updateWizardSession,
  markSessionApplied,
  applyWizardSession,
  logAuditEvent,
} from '../services/database';
import {
  generateProcessFlow,
  suggestInteractions,
} from '../services/ai';
import {
  GenerateNetworkRequest,
  GenerateNetworkResponse,
  ApplyWizardRequest,
  ApplyWizardResponse,
  GenerateProcessRequest,
  GenerateProcessResponse,
  ProposedAgent,
  AnalysisResult,
} from '../types/wizard';

const router = Router();
const SERVICE_NAME = 'wizard-service';

// ============================================================================
// POST /api/wizard/generate-network
// Generate a filtered agent network from session analysis
// ============================================================================

router.post('/generate-network', async (req: Request, res: Response) => {
  try {
    const { sessionId, selectedCapabilities } = req.body as GenerateNetworkRequest;
    const tenantId = req.tenantId;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    // Get session
    const session = await getWizardSessionByTenant(sessionId, tenantId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const analysis = session.analysisResult as AnalysisResult;
    if (!analysis) {
      return res.status(400).json({ error: 'Session has no analysis result' });
    }

    // If selectedCapabilities provided, filter agents
    let filteredAgents = analysis.agents || [];
    if (selectedCapabilities && selectedCapabilities.length > 0) {
      filteredAgents = filteredAgents.filter((agent: ProposedAgent) => {
        const agentCaps = agent.capabilities || [];
        return agentCaps.some((cap) => {
          const capName = typeof cap === 'string' ? cap : cap;
          return selectedCapabilities.includes(capName);
        });
      }).map((agent: ProposedAgent) => ({
        ...agent,
        capabilities: (agent.capabilities || []).filter((cap) => {
          const capName = typeof cap === 'string' ? cap : cap;
          return selectedCapabilities.includes(capName);
        })
      }));
    }

    // Update session with filtered results
    const updatedAnalysis: AnalysisResult = {
      ...analysis,
      agents: filteredAgents,
    };

    await updateWizardSession(sessionId, tenantId, updatedAnalysis);

    const response: GenerateNetworkResponse = {
      success: true,
      sessionId,
      agents: filteredAgents,
      relationships: analysis.agentRelationships || [],
      integrations: analysis.integrations || [],
    };

    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate network error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/generate-process
// Generate process flow for an agent
// ============================================================================

router.post('/generate-process', async (req: Request, res: Response) => {
  try {
    const { agent } = req.body as GenerateProcessRequest;

    if (!agent) {
      return res.status(400).json({ error: 'agent is required' });
    }

    const result = await generateProcessFlow(agent);

    const response: GenerateProcessResponse = {
      success: true,
      ...result,
    };

    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate process error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/suggest-interactions
// Suggest interactions between agents (AI-powered)
// ============================================================================

router.post('/suggest-interactions', async (req: Request, res: Response) => {
  try {
    const { agents } = req.body;

    if (!agents || agents.length < 2) {
      return res.json({
        suggestions: [],
        message: 'Need at least 2 agents to suggest interactions',
      });
    }

    const suggestions = await suggestInteractions(agents);

    res.json({ suggestions });
  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Suggest interactions error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/apply
// Apply wizard session - create agents in the database
// This is the final step of the onboarding wizard
// ============================================================================

router.post('/apply', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as ApplyWizardRequest;
    const tenantId = req.tenantId;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    // Get session
    const session = await getWizardSessionByTenant(sessionId, tenantId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'applied') {
      return res.status(400).json({ error: 'Session already applied' });
    }

    const analysis = session.analysisResult as AnalysisResult;
    const stepData = (session as any).step_data || {};
    
    // Get agents from step_data (per-step flow) or analysisResult (legacy flow)
    const step3Agents = stepData?.step3?.proposedAgents?.agents || stepData?.step3?.agents || [];
    const analysisAgents = analysis?.agents || [];
    let agents = step3Agents.length > 0 ? step3Agents : analysisAgents;
    
    // Build capability ID → name map from multiple sources
    const step1Caps = stepData?.step1?.capabilities || [];
    const step2Elements = stepData?.step2?.classifiedElements?.elements || 
                          stepData?.step2?.elements || 
                          analysis?.extractedCapabilities || [];
    const capabilityMap: Record<string, string> = {};
    // First, add step1 capabilities (from XML - have original ArchiMate IDs)
    for (const cap of step1Caps) {
      if (cap.id && cap.name) {
        capabilityMap[cap.id] = cap.name;
      }
    }
    // Then add step2 elements (may have different IDs)
    for (const el of step2Elements) {
      if (el.id && el.name) {
        capabilityMap[el.id] = el.name;
      }
    }
    console.log(`[${SERVICE_NAME}] Capability map has ${Object.keys(capabilityMap).length} entries`);
    
    // Enrich agents: resolve ownedElements IDs to capability names
    agents = agents.map((agent: any) => {
      if (agent.ownedElements && Array.isArray(agent.ownedElements) && !agent.capabilities) {
        const capabilityNames = agent.ownedElements
          .map((id: string) => capabilityMap[id])
          .filter(Boolean);
        console.log(`[${SERVICE_NAME}] Agent ${agent.name}: ${agent.ownedElements.length} ownedElements → ${capabilityNames.length} capabilities`);
        return { ...agent, capabilities: capabilityNames };
      }
      return agent;
    });
    
    // Get relationships from step_data or analysisResult
    const step6Rels = stepData?.step6?.relationships?.relationships || [];
    const analysisRels = analysis?.agentRelationships || [];
    const relationships = step6Rels.length > 0 ? step6Rels : analysisRels;
    
    // Get integrations from step_data or analysisResult
    const step6Ints = stepData?.step6?.integrations?.integrations || [];
    const analysisInts = analysis?.integrations || [];
    const integrations = step6Ints.length > 0 ? step6Ints : analysisInts;
    
    if (agents.length === 0) {
      return res.status(400).json({ error: 'No agents to import. Complete the wizard steps first.' });
    }

    console.log(`[${SERVICE_NAME}] Applying session ${sessionId}: ${agents.length} agents`);

    // Apply the wizard session - create agents in database
    const result = await applyWizardSession(tenantId, agents, relationships, integrations);

    // Mark session as applied
    await markSessionApplied(sessionId, tenantId);

    // Audit log
    await logAuditEvent(
      tenantId,
      'WIZARD_APPLY',
      'wizard_session',
      sessionId,
      { agentsCreated: result.agents.length }
    );

    console.log(`[${SERVICE_NAME}] Created ${result.agents.length} agents from wizard`);

    const response: ApplyWizardResponse = {
      success: true,
      created: {
        agents: result.agents.length,
        interactions: result.interactions,
        integrations: result.integrations,
      },
      agents: result.agents,
      // Frontend success route after import/apply
      redirectUrl: '/design/',
    };

    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Apply wizard error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/generate-bpmn
// Standalone BPMN generation (no step dependencies - for legacy flows)
// ============================================================================

import { executeStep5 } from '../services/step-executor';

router.post('/generate-bpmn', async (req: Request, res: Response) => {
  try {
    const { processId, processName, processDescription, involvedAgents, capabilities, triggers, outputs } = req.body;

    if (!processName || !processDescription) {
      return res.status(400).json({ error: 'processName and processDescription are required' });
    }

    console.log(`[${SERVICE_NAME}] Generating BPMN for: ${processName}`);

    const result = await executeStep5({
      processId: processId || `process-${Date.now()}`,
      processName,
      processDescription,
      involvedAgents: involvedAgents || [],
      capabilities: capabilities || [],
      triggers,
      outputs,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'BPMN generation failed' });
    }

    res.json({
      success: true,
      data: result.data,
      executionTimeMs: result.executionTimeMs,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate BPMN error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/generate-orchestrator-bpmn
// Generate orchestrator BPMN (inter-agent workflow)
// ============================================================================

router.post('/generate-orchestrator-bpmn', async (req: Request, res: Response) => {
  try {
    const { orchestratorAgent, participantAgents, processDescription } = req.body;

    if (!orchestratorAgent || !participantAgents) {
      return res.status(400).json({ error: 'orchestratorAgent and participantAgents are required' });
    }

    console.log(`[${SERVICE_NAME}] Generating orchestrator BPMN for: ${orchestratorAgent.name}`);

    // Use the orchestrator BPMN prompt
    const { executePrompt } = await import('../prompts');
    
    const result = await executePrompt('step4.generate-orchestrator-bpmn', {
      orchestratorAgent,
      participantAgents,
      processDescription: processDescription || orchestratorAgent.purpose || 'Multi-agent orchestration workflow',
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Orchestrator BPMN generation failed' });
    }

    const bpmnXml = (result.data as any)?.bpmnXml || result.data;
    
    res.json({
      success: true,
      data: {
        bpmnXml,
      },
      executionTimeMs: result.executionTimeMs,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate orchestrator BPMN error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/generate-code
// Generate Azure Functions code for an agent
// ============================================================================

router.post('/generate-code', async (req: Request, res: Response) => {
  try {
    const { agentId, agent } = req.body;

    if (!agent) {
      return res.status(400).json({ error: 'agent object is required' });
    }

    console.log(`[${SERVICE_NAME}] Generating code for: ${agent.name}`);

    const config = agent.config || {};
    const capabilities = (agent.capabilities || []).map((c: any) => c.capability_name || c.name || c);
    const integrations = (agent.integrations || []).map((i: any) => i.integration_name || i.integration_type);
    const skills = (agent.skills || []).map((s: any) => ({
      name: s.name,
      displayName: s.display_name || s.name,
      description: s.description,
      inputSchema: s.input_schema
    }));

    const systemPrompt = `You are an expert Azure Functions and IT4IT architect. Generate production-ready TypeScript code for Azure Functions agents.

Include:
- All necessary imports
- TypeScript interfaces and types
- Azure Functions v4 programming model
- Service Bus message handling (tenant-isolated queues)
- Proper error handling and logging
- Application Insights integration
- FlowGrid Agent Registry integration for discovering other agents
- Tenant context validation

Output ONLY the code, no explanations or markdown.`;

    const userPrompt = `Generate a complete Azure Functions (Node.js/TypeScript) implementation for this AI agent.

## Agent Specification
- **Name:** ${agent.name}
- **Short Description:** ${config.shortDescription || 'Not specified'}
- **Purpose:** ${config.detailedPurpose || agent.description || 'Not specified'}
- **Value Stream:** ${config.valueStream || 'Not specified'}
- **Pattern:** ${config.pattern || 'Specialist'}
- **Decision Authority:** ${config.decisionAuthority || 'propose-and-execute'}
- **Autonomy Level:** ${config.autonomyLevel || 'supervised'}

## Business Context
- **Business Value:** ${config.businessValue || 'Not specified'}
- **Success Criteria:** ${config.successCriteria || 'Not specified'}
- **KPIs:** ${(config.kpis || []).join(', ') || 'Not specified'}
- **Risk Appetite:** ${config.riskAppetite || 'medium'}

## Objectives
${(config.objectives || []).length > 0 ? (config.objectives || []).map((o: string) => '- ' + o).join('\n') : '- Not specified'}

## Capabilities
${capabilities.length > 0 ? capabilities.map((c: string) => `- ${c}`).join('\n') : '- None specified'}

## Interactions
- **Pattern:** ${config.interactionPattern || 'request-response'}
- **Triggers:** ${(config.triggers || []).join(', ') || 'Message-triggered'}
- **Outputs:** ${(config.outputs || []).join(', ') || 'Agent messages'}
- **Escalation:** ${config.escalationPath || 'To human operator'}

## Integrations (Tools)
${integrations.length > 0 ? integrations.map((i: string) => `- ${i}`).join('\n') : '- None configured'}

## Multi-Tenant Agent Registry Integration
This agent MUST include:

1. **Environment Variables** (injected at runtime):
   - \`FLOWGRID_REGISTRY_URL\` - URL of the agent registry (e.g., https://api.flowgrid.io)
   - \`FLOWGRID_TENANT_ID\` - Tenant ID for this agent instance
   - \`FLOWGRID_API_TOKEN\` - Bearer token for registry authentication

2. **Helper Functions for Agent Discovery**:
\`\`\`typescript
interface AgentCard {
  name: string;
  url: string;
  version: string;
  description: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    inputSchema?: any;
    outputSchema?: any;
  }>;
}

async function discoverAgents(): Promise<AgentCard[]> {
  const response = await fetch(\`\${process.env.FLOWGRID_REGISTRY_URL}/api/registry/agents\`, {
    headers: {
      'Authorization': \`Bearer \${process.env.FLOWGRID_API_TOKEN}\`
    }
  });
  const data = await response.json();
  return data.agents;
}

async function findAgentBySkill(skillName: string): Promise<AgentCard | null> {
  const response = await fetch(
    \`\${process.env.FLOWGRID_REGISTRY_URL}/api/registry/agents/search?skill=\${encodeURIComponent(skillName)}\`,
    {
      headers: {
        'Authorization': \`Bearer \${process.env.FLOWGRID_API_TOKEN}\`
      }
    }
  );
  const data = await response.json();
  return data.agents[0] || null;
}
\`\`\`

3. **Service Bus Message Envelope** (include tenant_id in all messages):
\`\`\`typescript
interface MessageEnvelope {
  tenantId: string;
  agentId: string;
  messageType: string;
  payload: any;
  timestamp: string;
  correlationId?: string;
}
\`\`\`

4. **Tenant Validation** (validate incoming messages match tenant context):
\`\`\`typescript
function validateTenantContext(message: MessageEnvelope): boolean {
  return message.tenantId === process.env.FLOWGRID_TENANT_ID;
}
\`\`\`

5. **Self-Registration on Startup**:
Include a startup function that registers this agent with the registry:
\`\`\`typescript
async function registerAgent() {
  await fetch(\`\${process.env.FLOWGRID_REGISTRY_URL}/api/registry/agents/\${process.env.AGENT_ID}/register\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.FLOWGRID_API_TOKEN}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      endpoint: process.env.AGENT_ENDPOINT,
      metadata: { version: '1.0.0', status: 'healthy' }
    })
  });
}
\`\`\`

## A2A Skills (Agent-to-Agent Protocol)
${skills.length > 0 ? skills.map((s: any) => '### ' + s.displayName + ' (' + s.name + ')\n' + (s.description || 'No description') + '\nInput: ' + (s.inputSchema ? JSON.stringify(s.inputSchema) : 'any')).join('\n\n') : '- No skills defined (generate based on capabilities)'}

## Requirements
1. Use Azure Functions v4 programming model (Node.js 18+, TypeScript)
2. Use Azure Service Bus for agent-to-agent messaging
3. Include proper error handling and structured logging
4. Implement the ${config.pattern || 'Specialist'} agent pattern
5. Include integration stubs for configured tools
6. Add Azure OpenAI integration for AI reasoning
7. Include TypeScript interfaces for all message types
8. Add health check endpoint
9. Implement all A2A Skills as callable functions with proper input validation
10. Include an A2A-compatible /agent/card endpoint that returns the agent skills

## Environment Variables
The generated code should expect these environment variables:
- FLOWGRID_REGISTRY_URL: URL to the FlowGrid Agent Registry (e.g., https://api.flowgrid.io/api/registry)
- FLOWGRID_TENANT_ID: Tenant ID for multi-tenant isolation
- FLOWGRID_API_KEY: API key for authenticating with FlowGrid services
- AZURE_SERVICEBUS_CONNECTION_STRING: Connection string for Azure Service Bus
- AZURE_OPENAI_ENDPOINT: Azure OpenAI endpoint
- AZURE_OPENAI_API_KEY: Azure OpenAI API key

## Agent Discovery Helper Functions
Include these helper functions for discovering other agents in the tenant:

\`\`\`typescript
// Agent discovery helper
async function discoverAgents(registryUrl: string, tenantId: string, apiKey: string, searchParams?: {
  skill?: string;
  pattern?: string;
  capability?: string;
  valueStream?: string;
}): Promise<any[]> {
  const url = new URL('/agents/search', registryUrl);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'X-Tenant-ID': tenantId
    }
  });
  
  if (!response.ok) {
    throw new Error(\`Failed to discover agents: \${response.statusText}\`);
  }
  
  const result = await response.json();
  return result.data || [];
}

// Get agent A2A card
async function getAgentCard(registryUrl: string, agentId: string, tenantId: string, apiKey: string): Promise<any> {
  const response = await fetch(\`\${registryUrl}/agents/\${agentId}\`, {
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'X-Tenant-ID': tenantId
    }
  });
  
  if (!response.ok) {
    throw new Error(\`Failed to get agent card: \${response.statusText}\`);
  }
  
  return response.json();
}

// Self-register with registry on startup
async function registerWithRegistry(registryUrl: string, agentId: string, tenantId: string, apiKey: string, endpoint: string) {
  try {
    const response = await fetch(\`\${registryUrl}/agents/\${agentId}/register\`, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${apiKey}\`,
        'X-Tenant-ID': tenantId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        endpoint,
        healthCheckUrl: \`\${endpoint}/health\`,
        metadata: {
          startedAt: new Date().toISOString()
        }
      })
    });
    
    if (response.ok) {
      console.log('Successfully registered with FlowGrid Registry');
    } else {
      console.warn('Failed to register with registry:', response.statusText);
    }
  } catch (error) {
    console.warn('Registry registration failed:', error);
  }
}
\`\`\`

Generate a single, complete index.ts file that can be deployed as an Azure Function App.`;

    // Use AI service to generate code
    const aiService = (await import('../services/ai')).aiService;
    const result = await aiService.complete({
      systemPrompt,
      userPrompt,
      maxTokens: 8000,
    });

    if (!result.content) {
      return res.status(500).json({ error: 'Failed to generate code' });
    }

    // Clean up the response (remove markdown code blocks if present)
    let code = result.content;
    if (code.startsWith('```typescript')) {
      code = code.slice(13);
    } else if (code.startsWith('```ts')) {
      code = code.slice(5);
    } else if (code.startsWith('```')) {
      code = code.slice(3);
    }
    if (code.endsWith('```')) {
      code = code.slice(0, -3);
    }
    code = code.trim();

    res.json({
      success: true,
      code,
      agent: agent.name,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate code error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST /api/wizard/generate-skills
// Generate A2A-compliant skills for an agent using AI
// ============================================================================

router.post('/generate-skills', async (req: Request, res: Response) => {
  try {
    const { agentId, agentName, description, capabilities, pattern } = req.body;

    if (!agentName) {
      return res.status(400).json({ error: 'agentName is required' });
    }

    console.log(`[${SERVICE_NAME}] Generating skills for: ${agentName}`);

    const systemPrompt = `You are an expert in designing AI agent skills following the A2A (Agent-to-Agent) Protocol.

Generate 3-5 practical skills that an agent would need to perform its job. Each skill should be:
- Specific and actionable (not vague)
- Named in snake_case (e.g., analyze_incident, create_ticket)
- Have a clear description
- Include relevant tags
- Have a simple input schema

Respond with a JSON array of skills. No markdown, just valid JSON.`;

    const userPrompt = `Generate skills for this agent:

**Agent:** ${agentName}
**Description:** ${description || 'Not specified'}
**Pattern:** ${pattern || 'Specialist'}
**Supported Capabilities:** ${(capabilities || []).join(', ') || 'None specified'}

Generate 3-5 skills as a JSON array with this structure:
[
  {
    "name": "skill_name_snake_case",
    "display_name": "Human Readable Name",
    "description": "What this skill does",
    "tags": ["tag1", "tag2"],
    "input_schema": {
      "type": "object",
      "properties": {
        "param1": { "type": "string", "description": "..." }
      },
      "required": ["param1"]
    },
    "examples": [
      { "name": "Example usage", "input": { "param1": "value" } }
    ]
  }
]`;

    const aiService = (await import('../services/ai')).aiService;
    const result = await aiService.complete({
      systemPrompt,
      userPrompt,
      maxTokens: 3000,
    });

    if (!result.content) {
      return res.status(500).json({ error: 'Failed to generate skills' });
    }

    // Parse the JSON response
    let skills = [];
    try {
      let content = result.content.trim();
      // Remove markdown code blocks if present
      if (content.startsWith('```json')) content = content.slice(7);
      else if (content.startsWith('```')) content = content.slice(3);
      if (content.endsWith('```')) content = content.slice(0, -3);
      content = content.trim();
      
      skills = JSON.parse(content);
      if (!Array.isArray(skills)) {
        skills = [skills];
      }
    } catch (parseError) {
      console.error(`[${SERVICE_NAME}] Failed to parse skills JSON:`, parseError);
      return res.status(500).json({ error: 'Failed to parse generated skills' });
    }

    console.log(`[${SERVICE_NAME}] Generated ${skills.length} skills for ${agentName}`);

    res.json({
      success: true,
      skills,
      agentName,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Generate skills error:`, error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
