/**
 * Foundation CRUD Routes
 * 
 * Manages project foundations created by the Discovery Wizard.
 * Foundations store extracted capabilities, data objects, and processes
 * that can be imported into the Design Wizard.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();

// Database pool (injected via app.locals or imported)
const getPool = (req: Request): Pool => {
  return req.app.locals.pool;
};

// Extract tenant_id from JWT (middleware should have set this)
const getTenantId = (req: Request): string => {
  const user = (req as any).user;
  if (!user?.tenantId) {
    throw new Error('Tenant ID not found in token');
  }
  return user.tenantId;
};

/**
 * GET /api/wizard/foundations
 * List all foundations for the current tenant
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const tenantId = getTenantId(req);
    
    const result = await pool.query(
      `SELECT id, name, description, 
              jsonb_array_length(capabilities) as capability_count,
              jsonb_array_length(data_objects) as data_object_count,
              jsonb_array_length(processes) as process_count,
              created_at, updated_at
       FROM foundations 
       WHERE tenant_id = $1 AND (is_archived = false OR is_archived IS NULL)
       ORDER BY updated_at DESC`,
      [tenantId]
    );
    
    res.json({
      success: true,
      foundations: result.rows
    });
  } catch (error) {
    console.error('[Foundations] List error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list foundations'
    });
  }
});

/**
 * GET /api/wizard/foundations/:id
 * Get a single foundation by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const tenantId = getTenantId(req);
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM foundations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Foundation not found'
      });
    }
    
    res.json({
      success: true,
      foundation: result.rows[0]
    });
  } catch (error) {
    console.error('[Foundations] Get error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get foundation'
    });
  }
});

/**
 * POST /api/wizard/foundations
 * Create a new foundation
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const tenantId = getTenantId(req);
    const { 
      name, 
      description, 
      capabilities = [], 
      data_objects = [], 
      processes = [],
      integrations = [],
      metadata = {}
    } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }
    
    const result = await pool.query(
      `INSERT INTO foundations 
       (tenant_id, name, description, capabilities, data_objects, processes, integrations, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId, 
        name, 
        description || '', 
        JSON.stringify(capabilities),
        JSON.stringify(data_objects),
        JSON.stringify(processes),
        JSON.stringify(integrations),
        JSON.stringify(metadata)
      ]
    );
    
    res.status(201).json({
      success: true,
      foundation: result.rows[0]
    });
  } catch (error) {
    console.error('[Foundations] Create error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create foundation'
    });
  }
});

/**
 * PUT /api/wizard/foundations/:id
 * Update an existing foundation
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { 
      name, 
      description, 
      capabilities, 
      data_objects, 
      processes,
      integrations,
      metadata
    } = req.body;
    
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (capabilities !== undefined) {
      updates.push(`capabilities = $${paramIndex++}`);
      values.push(JSON.stringify(capabilities));
    }
    if (data_objects !== undefined) {
      updates.push(`data_objects = $${paramIndex++}`);
      values.push(JSON.stringify(data_objects));
    }
    if (processes !== undefined) {
      updates.push(`processes = $${paramIndex++}`);
      values.push(JSON.stringify(processes));
    }
    if (integrations !== undefined) {
      updates.push(`integrations = $${paramIndex++}`);
      values.push(JSON.stringify(integrations));
    }
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(metadata));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }
    
    values.push(id, tenantId);
    
    const result = await pool.query(
      `UPDATE foundations 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Foundation not found'
      });
    }
    
    res.json({
      success: true,
      foundation: result.rows[0]
    });
  } catch (error) {
    console.error('[Foundations] Update error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update foundation'
    });
  }
});

/**
 * DELETE /api/wizard/foundations/:id
 * Delete a foundation
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const tenantId = getTenantId(req);
    const { id } = req.params;
    
    const result = await pool.query(
      `DELETE FROM foundations WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Foundation not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Foundation deleted'
    });
  } catch (error) {
    console.error('[Foundations] Delete error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete foundation'
    });
  }
});

export default router;
