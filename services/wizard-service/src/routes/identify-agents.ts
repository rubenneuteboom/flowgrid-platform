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

export default router;
