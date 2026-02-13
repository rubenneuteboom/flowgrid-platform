import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { FlowRunner } from '../engine/flow-runner';

export function createRuntimeRouter(pool: Pool, runner: FlowRunner): Router {
  const router = Router();
  const stateManager = runner.getStateManager();

  // Deploy a foundation
  router.post('/foundations/:id/deploy', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;

      // Check foundation exists
      const foundation = await pool.query(
        `SELECT * FROM foundations WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (foundation.rows.length === 0) {
        return res.status(404).json({ error: 'Foundation not found' });
      }

      // Check for orchestrator with BPMN
      const orchestrator = await pool.query(
        `SELECT id, name FROM agents WHERE tenant_id = $1 AND config->>'foundationId' = $2 AND config->>'pattern' = 'orchestrator' AND config->>'bpmnXml' IS NOT NULL`,
        [tenantId, id]
      );
      if (orchestrator.rows.length === 0) {
        return res.status(400).json({ error: 'Foundation has no orchestrator with BPMN. Cannot deploy.' });
      }

      // Mark as deployed
      await pool.query(
        `UPDATE foundations SET deployed_at = NOW() WHERE id = $1`,
        [id]
      );

      res.json({ success: true, deployedAt: new Date().toISOString(), orchestratorAgent: orchestrator.rows[0].name });
    } catch (error: any) {
      console.error('[runtime] Deploy error:', error.message);
      res.status(500).json({ error: 'Failed to deploy foundation' });
    }
  });

  // Start a new run
  router.post('/foundations/:id/run', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;
      const { input, orchestratorId } = req.body;

      const run = await runner.startRun(tenantId, id, input || {}, orchestratorId);
      res.status(201).json({ runId: run.id, status: run.status, startedAt: run.started_at });
    } catch (error: any) {
      console.error('[runtime] Start run error:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // List runs
  router.get('/runs', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const status = req.query.status as string | undefined;
      const runs = await stateManager.listRuns(tenantId, status);

      // Enrich with foundation name
      const foundationIds = [...new Set(runs.map(r => r.foundation_id))];
      let foundationMap: Record<string, string> = {};
      if (foundationIds.length > 0) {
        const fResult = await pool.query(
          `SELECT id, name FROM foundations WHERE id = ANY($1)`,
          [foundationIds]
        );
        fResult.rows.forEach(f => { foundationMap[f.id] = f.name; });
      }

      res.json({
        data: runs.map(r => ({
          ...r,
          foundation_name: foundationMap[r.foundation_id] || 'Unknown'
        }))
      });
    } catch (error: any) {
      console.error('[runtime] List runs error:', error.message);
      res.status(500).json({ error: 'Failed to list runs' });
    }
  });

  // Get run detail
  router.get('/runs/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;

      const run = await stateManager.getRun(id, tenantId);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      const steps = await stateManager.getSteps(id);

      // Get foundation name
      const fResult = await pool.query(`SELECT name FROM foundations WHERE id = $1`, [run.foundation_id]);

      res.json({
        ...run,
        foundation_name: fResult.rows[0]?.name || 'Unknown',
        steps
      });
    } catch (error: any) {
      console.error('[runtime] Get run error:', error.message);
      res.status(500).json({ error: 'Failed to get run' });
    }
  });

  // SSE live updates
  router.get('/runs/:id/live', async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const { id } = req.params;

    const run = await stateManager.getRun(id, tenantId);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial state
    const steps = await stateManager.getSteps(id);
    sendEvent({ type: 'init', run, steps });

    // Listen for updates
    const onStepUpdate = (event: any) => {
      if (event.runId === id) {
        sendEvent({ type: 'step.update', ...event });
      }
    };
    const onRunComplete = (event: any) => {
      if (event.runId === id) {
        sendEvent({ type: 'run.complete', ...event });
      }
    };
    const onRunError = (event: any) => {
      if (event.runId === id) {
        sendEvent({ type: 'run.error', ...event });
      }
    };

    runner.on('step.update', onStepUpdate);
    runner.on('run.complete', onRunComplete);
    runner.on('run.error', onRunError);

    req.on('close', () => {
      runner.off('step.update', onStepUpdate);
      runner.off('run.complete', onRunComplete);
      runner.off('run.error', onRunError);
    });
  });

  // Resume a paused run
  router.post('/runs/:id/resume', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;

      await runner.resumeRun(id, tenantId);
      res.json({ success: true, message: 'Run resumed' });
    } catch (error: any) {
      console.error('[runtime] Resume error:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // List deployed foundations
  // Delete a run and its steps
  router.delete('/runs/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;
      await pool.query(`DELETE FROM flow_steps WHERE run_id = $1`, [id]);
      const result = await pool.query(`DELETE FROM flow_runs WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, tenantId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete run' });
    }
  });

  // Delete all runs for a foundation (optionally filtered by orchestrator)
  router.delete('/foundations/:id/runs', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;
      const orchestratorId = req.query.orchestrator_id as string;
      let query = `SELECT id FROM flow_runs WHERE foundation_id = $1 AND tenant_id = $2`;
      const params: any[] = [id, tenantId];
      if (orchestratorId) {
        query += ` AND orchestrator_id = $3`;
        params.push(orchestratorId);
      }
      const runs = await pool.query(query, params);
      const runIds = runs.rows.map((r: any) => r.id);
      if (runIds.length > 0) {
        await pool.query(`DELETE FROM flow_steps WHERE run_id = ANY($1)`, [runIds]);
        await pool.query(`DELETE FROM flow_runs WHERE id = ANY($1)`, [runIds]);
      }
      res.json({ success: true, deleted: runIds.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete runs' });
    }
  });

  router.get('/foundations/deployed', async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const result = await pool.query(
        `SELECT id, name, deployed_at FROM foundations WHERE tenant_id = $1 AND deployed_at IS NOT NULL ORDER BY deployed_at DESC`,
        [tenantId]
      );
      res.json({ data: result.rows });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to list deployed foundations' });
    }
  });

  return router;
}
