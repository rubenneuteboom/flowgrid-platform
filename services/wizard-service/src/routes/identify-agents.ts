/**
 * Identify Agents Route
 * 
 * POST /api/wizard/identify-agents
 * 
 * Given a process and sub-process description, uses AI to propose
 * an optimal agent swarm. Part of the 8-step Design Wizard flow.
 */

import { Router, Request, Response } from 'express';
import { executePrompt } from '../prompts/index';
import { AgentIdentificationInput, AgentIdentificationOutput } from '../prompts/agent-identification';
import { OptimizeAgentsInput } from '../prompts/step3/optimize-agents';
import { OptimizeAgentsOutput } from '../prompts/schemas';
import { logAuditEvent } from '../services/database';

const router = Router();

// ============================================================================
// POST /identify-agents
// ============================================================================

router.post('/identify-agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { process, subProcess, foundationCapabilities, foundationIntegrations } = req.body;

    // Validate required fields
    if (!process?.name || !process?.description) {
      return res.status(400).json({ error: 'process.name and process.description are required' });
    }
    if (!subProcess?.name || !subProcess?.description || !subProcess?.expectedOutcome) {
      return res.status(400).json({ 
        error: 'subProcess.name, subProcess.description, and subProcess.expectedOutcome are required' 
      });
    }

    // Build prompt input
    const promptInput: AgentIdentificationInput = {
      process: {
        name: process.name,
        description: process.description,
      },
      subProcess: {
        name: subProcess.name,
        description: subProcess.description,
        expectedOutcome: subProcess.expectedOutcome,
        constraints: subProcess.constraints || undefined,
      },
      foundationCapabilities: foundationCapabilities || [],
      foundationIntegrations: foundationIntegrations || [],
    };

    // Execute AI prompt
    const result = await executePrompt<AgentIdentificationInput, AgentIdentificationOutput>(
      'agent-identification',
      promptInput
    );

    if (!result.success) {
      console.error('[identify-agents] AI prompt failed:', result.error);
      return res.status(500).json({ 
        error: 'Agent identification failed',
        details: result.error,
      });
    }

    // Audit log
    try {
      await logAuditEvent(tenantId, 'identify-agents', 'wizard', 'identify-agents', {
        processName: process.name,
        subProcessName: subProcess.name,
        orchestratorName: result.data?.orchestrator?.name,
        specialistCount: result.data?.specialists?.length,
        model: result.model,
        executionTimeMs: result.executionTimeMs,
      });
    } catch (auditErr) {
      console.warn('[identify-agents] Audit log failed:', auditErr);
    }

    return res.json({
      success: true,
      data: result.data,
      meta: {
        model: result.model,
        promptVersion: result.promptVersion,
        executionTimeMs: result.executionTimeMs,
        usage: result.usage,
      },
    });
  } catch (error) {
    console.error('[identify-agents] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// POST /optimize-agents
// ============================================================================

router.post('/optimize-agents', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const { proposedAgents, processContext } = req.body;

    // Validate required fields
    if (!proposedAgents?.orchestrator || !Array.isArray(proposedAgents?.specialists)) {
      return res.status(400).json({
        error: 'proposedAgents with orchestrator and specialists[] are required',
      });
    }

    // Map AgentIdentificationOutput format → OptimizeAgentsInput format (ProposeAgentsOutput)
    const orch = proposedAgents.orchestrator;
    const mappedAgents = [
      {
        id: 'orch-1',
        name: orch.name,
        purpose: orch.purpose,
        shortDescription: orch.shortDescription || '',
        suggestedPattern: orch.pattern || 'orchestrator',
        suggestedAutonomy: orch.autonomyLevel || 'supervised',
        decisionAuthority: orch.decisionAuthority || 'propose-and-execute',
        interactionPattern: orch.interactionPattern || 'orchestrated',
        triggers: orch.triggers || [],
        outputs: orch.outputs || [],
        isOrchestrator: true,
        needsInternalBpmn: false,
        ownedElements: [] as string[],
        boundaries: { internal: [] as string[], delegates: [] as string[], escalates: [] as string[] },
      },
      ...proposedAgents.specialists.map((s: any, i: number) => ({
        id: `spec-${i + 1}`,
        name: s.name,
        purpose: s.purpose,
        shortDescription: s.shortDescription || '',
        suggestedPattern: s.pattern || 'tool-use',
        suggestedAutonomy: s.autonomyLevel || 'supervised',
        decisionAuthority: s.decisionAuthority || 'propose-only',
        interactionPattern: s.interactionPattern || 'request-response',
        triggers: s.triggers || [],
        outputs: s.outputs || [],
        isOrchestrator: false,
        needsInternalBpmn: true,
        ownedElements: [] as string[],
        boundaries: { internal: [] as string[], delegates: [] as string[], escalates: [] as string[] },
      })),
    ];

    const optimizeInput: OptimizeAgentsInput = {
      proposedAgents: {
        agents: mappedAgents,
        orphanedElements: [],
      },
      elements: [],
      organizationContext: processContext || '',
    };

    const originalCount = mappedAgents.length;

    // Execute optimization prompt
    const result = await executePrompt<OptimizeAgentsInput, OptimizeAgentsOutput>(
      'step3.optimize-agents',
      optimizeInput
    );

    // If strict validation failed but we got raw JSON, try lenient parsing
    let data: any;
    if (result.success) {
      data = result.data!;
    } else if (result.rawResponse) {
      console.warn('[optimize-agents] Strict validation failed, trying lenient parse:', result.error);
      try {
        let jsonStr = result.rawResponse.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        const jsonStart = jsonStr.search(/[\[{]/);
        if (jsonStart > 0) jsonStr = jsonStr.slice(jsonStart);
        data = JSON.parse(jsonStr);
        // Ensure arrays exist
        data.optimizedAgents = data.optimizedAgents || [];
        data.demotedToTools = (data.demotedToTools || []).map((t: any) => ({
          originalAgentId: t.originalAgentId || t.agentId || '',
          originalAgentName: t.originalAgentName || t.agentName || '',
          toolName: t.toolName || t.name || '',
          toolDescription: t.toolDescription || t.description || '',
          assignedToAgentId: t.assignedToAgentId || t.assignedTo || '',
          reasoning: t.reasoning || '',
        }));
        data.movedToAsync = data.movedToAsync || [];
        data.mergedAgents = (data.mergedAgents || []).map((m: any) => ({
          originalAgentIds: m.originalAgentIds || [m.originalAgentId].filter(Boolean),
          originalAgentNames: m.originalAgentNames || [m.originalAgentName].filter(Boolean),
          mergedIntoAgentId: m.mergedIntoAgentId || '',
          reasoning: m.reasoning || '',
        }));
        data.addedHitlPoints = data.addedHitlPoints || [];
        data.optimizationSummary = data.optimizationSummary || '';
      } catch (parseErr) {
        console.error('[optimize-agents] Lenient parse also failed:', parseErr);
        return res.status(500).json({
          error: 'Agent optimization failed',
          details: result.error,
        });
      }
    } else {
      console.error('[optimize-agents] AI prompt failed:', result.error);
      return res.status(500).json({
        error: 'Agent optimization failed',
        details: result.error,
      });
    }

    // Map optimized agents back to AgentIdentificationOutput format
    const keptAgents = data.optimizedAgents.filter(
      (a: any) => a.status === 'keep' || a.status === 'new'
    );
    const orchestratorAgent = keptAgents.find((a: any) => a.isOrchestrator);
    const specialistAgents = keptAgents.filter((a: any) => !a.isOrchestrator);

    // Build tools list from demoted agents
    const demotedTools = (data.demotedToTools || []).map((d: any) => ({
      name: d.toolName,
      description: d.toolDescription,
      source: 'demoted' as const,
      originalAgent: d.originalAgentName,
    }));

    const optimizedData = {
      orchestrator: orchestratorAgent
        ? {
            name: orchestratorAgent.name,
            purpose: orchestratorAgent.purpose,
            shortDescription: orchestratorAgent.shortDescription || '',
            pattern: orchestratorAgent.suggestedPattern,
            autonomyLevel: orchestratorAgent.suggestedAutonomy,
            decisionAuthority: orchestratorAgent.decisionAuthority,
            interactionPattern: orchestratorAgent.interactionPattern,
            triggers: orchestratorAgent.triggers,
            outputs: orchestratorAgent.outputs,
            keyResponsibilities: orchestratorAgent.keyResponsibilities || [],
            tools: demotedTools.filter((t: any) => {
              const demoted = data.demotedToTools.find((d: any) => d.toolName === t.name);
              return demoted?.assignedToAgentId === orchestratorAgent.id;
            }),
          }
        : proposedAgents.orchestrator, // fallback to original
      specialists: specialistAgents.map((s: any) => ({
        name: s.name,
        purpose: s.purpose,
        shortDescription: s.shortDescription || '',
        pattern: s.suggestedPattern,
        autonomyLevel: s.suggestedAutonomy,
        decisionAuthority: s.decisionAuthority,
        interactionPattern: s.interactionPattern,
        triggers: s.triggers,
        outputs: s.outputs,
        keyResponsibilities: s.keyResponsibilities || [],
        tools: demotedTools.filter((t: any) => {
          const demoted = data.demotedToTools.find((d: any) => d.toolName === t.name);
          return demoted?.assignedToAgentId === s.id;
        }),
      })),
      // Preserve any extra fields from original
      swarmRationale: proposedAgents.swarmRationale,
      humanTouchpoints: proposedAgents.humanTouchpoints,
    };

    // Audit log
    try {
      await logAuditEvent(tenantId, 'optimize-agents', 'wizard', 'optimize-agents', {
        originalCount,
        optimizedCount: keptAgents.length,
        demotedCount: data.demotedToTools.length,
        movedToAsyncCount: data.movedToAsync.length,
        model: result.model,
        executionTimeMs: result.executionTimeMs,
      });
    } catch (auditErr) {
      console.warn('[optimize-agents] Audit log failed:', auditErr);
    }

    return res.json({
      success: true,
      data: optimizedData,
      meta: {
        model: result.model,
        promptVersion: result.promptVersion,
        executionTimeMs: result.executionTimeMs,
        usage: result.usage,
        optimization: {
          originalCount,
          optimizedCount: keptAgents.length,
          demotedToTools: data.demotedToTools,
          movedToAsync: data.movedToAsync,
          mergedAgents: data.mergedAgents,
          addedHitlPoints: data.addedHitlPoints,
          summary: data.optimizationSummary,
        },
      },
    });
  } catch (error) {
    console.error('[optimize-agents] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
