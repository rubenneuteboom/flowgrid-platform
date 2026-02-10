/**
 * Session Routes - Wizard Session Management
 * 
 * Platform Architecture: Session state management for the onboarding wizard.
 * Sessions track the user's journey from capability input to agent creation.
 */

import { Router, Request, Response } from 'express';
import {
  getWizardSession,
  listWizardSessions,
  deleteWizardSession,
} from '../services/database';
import { getStoredPatterns } from '../services/database';

const router = Router();
const SERVICE_NAME = 'wizard-service';

// ============================================================================
// GET /api/wizard/patterns
// Get agentic patterns reference (harmonized knowledge)
// ============================================================================

router.get('/patterns', async (req: Request, res: Response) => {
  try {
    const patterns = await getStoredPatterns();
    res.json({ patterns });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get patterns error:`, error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

// ============================================================================
// GET /api/wizard/sessions
// List all wizard sessions for a tenant
// ============================================================================

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const sessions = await listWizardSessions(tenantId);
    res.json({ sessions });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List sessions error:`, error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// ============================================================================
// GET /api/wizard/sessions/:id
// Get a specific wizard session
// ============================================================================

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const session = await getWizardSession(req.params.id, tenantId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get session error:`, error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// ============================================================================
// DELETE /api/wizard/sessions/:id
// Delete a wizard session
// ============================================================================

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const deleted = await deleteWizardSession(req.params.id, tenantId);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Delete session error:`, error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
