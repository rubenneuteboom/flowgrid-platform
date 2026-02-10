/**
 * Database Service
 * 
 * Platform Architecture: Encapsulates all database operations.
 * Following Hohpe's "Real Abstraction" - hide PostgreSQL complexity behind clean methods.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  WizardSession,
  AnalysisResult,
  ProposedAgent,
  AgentRelationship,
  ProposedIntegration,
  AgenticPattern,
} from '../types/wizard';

// ============================================================================
// Database Pool (Singleton)
// ============================================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
});

export { pool };

// ============================================================================
// Health Check
// ============================================================================

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Wizard Session Operations
// ============================================================================

export async function createWizardSession(
  tenantId: string,
  sessionName: string,
  sourceType: 'image' | 'text' | 'template',
  sourceData: Record<string, unknown>,
  analysisResult: AnalysisResult,
  customPrompt?: string
): Promise<string> {
  const sessionId = uuidv4();
  
  await pool.query(
    `INSERT INTO wizard_sessions 
     (id, tenant_id, session_name, source_type, source_data, analysis_result, custom_prompt, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [sessionId, tenantId, sessionName, sourceType, sourceData, analysisResult, customPrompt, 'analyzed']
  );

  return sessionId;
}

export async function getWizardSession(sessionId: string, tenantId: string): Promise<WizardSession | null> {
  const result = await pool.query(
    'SELECT * FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionName: row.session_name,
    sourceType: row.source_type,
    sourceData: row.source_data,
    analysisResult: row.analysis_result,
    customPrompt: row.custom_prompt,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  };
}

export async function getWizardSessionByTenant(
  sessionId: string,
  tenantId: string
): Promise<WizardSession | null> {
  const result = await pool.query(
    'SELECT * FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionName: row.session_name,
    sourceType: row.source_type,
    sourceData: row.source_data,
    analysisResult: row.analysis_result,
    customPrompt: row.custom_prompt,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  };
}

export async function listWizardSessions(tenantId: string, limit = 50): Promise<WizardSession[]> {
  const result = await pool.query(
    `SELECT id, session_name, source_type, status, created_at, updated_at, applied_at
     FROM wizard_sessions 
     WHERE tenant_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [tenantId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId,
    sessionName: row.session_name,
    sourceType: row.source_type,
    sourceData: {},
    analysisResult: null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  }));
}

export async function updateWizardSession(
  sessionId: string,
  tenantId: string,
  analysisResult: AnalysisResult
): Promise<boolean> {
  const result = await pool.query(
    'UPDATE wizard_sessions SET analysis_result = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
    [analysisResult, sessionId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markSessionApplied(sessionId: string, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE wizard_sessions SET status = 'applied', applied_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [sessionId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteWizardSession(sessionId: string, tenantId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM wizard_sessions WHERE id = $1 AND tenant_id = $2', [sessionId, tenantId]);
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Agent Creation (Apply Wizard Results)
// ============================================================================

export interface CreatedAgent {
  id: string;
  name: string;
  type: AgenticPattern;
}

export interface ApplyResult {
  agents: CreatedAgent[];
  interactions: number;
  integrations: number;
}

export async function applyWizardSession(
  tenantId: string,
  agents: ProposedAgent[],
  relationships: AgentRelationship[],
  integrations: ProposedIntegration[]
): Promise<ApplyResult> {
  const createdAgents: CreatedAgent[] = [];
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
      const capName = typeof cap === 'string' ? cap : cap;
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
  for (const rel of relationships) {
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
  for (const int of integrations) {
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

  return {
    agents: createdAgents,
    interactions: interactionsCreated,
    integrations: integrationsCreated,
  };
}

// ============================================================================
// Audit Logging (Platform Observability)
// ============================================================================

export async function logAuditEvent(
  tenantId: string,
  action: string,
  entityType: string,
  entityId: string,
  newValues: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, new_values)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, action, entityType, entityId, JSON.stringify(newValues)]
  );
}

// ============================================================================
// Pattern Reference Data
// ============================================================================

export async function getStoredPatterns(): Promise<unknown[]> {
  const result = await pool.query('SELECT * FROM agentic_patterns ORDER BY id');
  return result.rows;
}
