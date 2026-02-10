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
    if (!analysis) {
      return res.status(400).json({ error: 'Session has no analysis result' });
    }

    const agents = analysis.agents || [];
    const relationships = analysis.agentRelationships || [];
    const integrations = analysis.integrations || [];

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
      redirectUrl: '/design',
    };

    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Apply wizard error:`, error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
