import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export interface FlowRun {
  id: string;
  tenant_id: string;
  foundation_id: string;
  status: string;
  input_data: any;
  output_data: any;
  error?: string;
  started_at: Date;
  completed_at?: Date;
}

export interface FlowStep {
  id: string;
  run_id: string;
  step_key: string;
  step_name?: string;
  agent_id?: string;
  agent_name?: string;
  step_type: string;
  status: string;
  input_data: any;
  output_data: any;
  error?: string;
  approval_id?: string;
  started_at?: Date;
  completed_at?: Date;
}

export class StateManager {
  constructor(private pool: Pool) {}

  async createRun(tenantId: string, foundationId: string, inputData: any, orchestratorId?: string): Promise<FlowRun> {
    const result = await this.pool.query(
      `INSERT INTO flow_runs (tenant_id, foundation_id, status, input_data, orchestrator_id)
       VALUES ($1, $2, 'running', $3, $4)
       RETURNING *`,
      [tenantId, foundationId, JSON.stringify(inputData || {}), orchestratorId || null]
    );
    return result.rows[0];
  }

  async updateRunStatus(runId: string, status: string, outputData?: any, error?: string): Promise<void> {
    const completedAt = ['completed', 'failed', 'cancelled'].includes(status) ? 'NOW()' : 'NULL';
    await this.pool.query(
      `UPDATE flow_runs SET status = $1, output_data = COALESCE($2, output_data), error = $3, completed_at = ${completedAt} WHERE id = $4`,
      [status, outputData ? JSON.stringify(outputData) : null, error || null, runId]
    );
  }

  async getRun(runId: string, tenantId: string): Promise<FlowRun | null> {
    const result = await this.pool.query(
      `SELECT * FROM flow_runs WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId]
    );
    return result.rows[0] || null;
  }

  async listRuns(tenantId: string, status?: string): Promise<FlowRun[]> {
    let query = `SELECT * FROM flow_runs WHERE tenant_id = $1`;
    const params: any[] = [tenantId];
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC LIMIT 100`;
    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async createStep(runId: string, stepKey: string, stepName: string, stepType: string, agentId?: string, agentName?: string): Promise<FlowStep> {
    const result = await this.pool.query(
      `INSERT INTO flow_steps (run_id, step_key, step_name, step_type, agent_id, agent_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [runId, stepKey, stepName, stepType, agentId || null, agentName || null]
    );
    return result.rows[0];
  }

  async updateStepStatus(stepId: string, status: string, outputData?: any, error?: string): Promise<void> {
    const startedClause = status === 'running' ? ', started_at = NOW()' : '';
    const completedClause = ['completed', 'failed', 'skipped'].includes(status) ? ', completed_at = NOW()' : '';
    if (outputData) {
      // Save output + status
      await this.pool.query(
        `UPDATE flow_steps SET status = $1, output_data = $2, error = $3 ${startedClause} ${completedClause} WHERE id = $4`,
        [status, JSON.stringify(outputData), error || null, stepId]
      );
    } else {
      // Status-only update — never touch output_data (prevents race condition overwrite)
      await this.pool.query(
        `UPDATE flow_steps SET status = $1, error = COALESCE($2, error) ${startedClause} ${completedClause} WHERE id = $3`,
        [status, error || null, stepId]
      );
    }
  }

  async setStepApproval(stepId: string, approvalId: string): Promise<void> {
    await this.pool.query(
      `UPDATE flow_steps SET approval_id = $1, status = 'waiting_approval' WHERE id = $2`,
      [approvalId, stepId]
    );
  }

  async updateStepInput(stepId: string, inputData: any): Promise<void> {
    await this.pool.query(
      `UPDATE flow_steps SET input_data = $1 WHERE id = $2`,
      [JSON.stringify(inputData), stepId]
    );
  }

  async getSteps(runId: string): Promise<FlowStep[]> {
    const result = await this.pool.query(
      `SELECT * FROM flow_steps WHERE run_id = $1 ORDER BY created_at ASC`,
      [runId]
    );
    return result.rows;
  }

  async getStepByApproval(approvalId: string): Promise<FlowStep | null> {
    const result = await this.pool.query(
      `SELECT * FROM flow_steps WHERE approval_id = $1`,
      [approvalId]
    );
    return result.rows[0] || null;
  }
}
