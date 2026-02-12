/**
 * Agent Registry API Tests
 * 
 * Tests for multi-tenant agent discovery and registration
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'flowgrid_jwt_secret_dev_CHANGE_IN_PRODUCTION';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid';

const pool = new Pool({ connectionString: DATABASE_URL });

// Test tenant and user
const TEST_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const TEST_USER_ID = '123e4567-e89b-12d3-a456-426614174001';
const TEST_TENANT_2_ID = '223e4567-e89b-12d3-a456-426614174000';

// Generate test JWT
function generateTestToken(tenantId: string, userId: string): string {
  return jwt.sign(
    {
      userId,
      email: 'test@example.com',
      tenantId,
      role: 'admin',
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Agent Registry API', () => {
  let testAgentId: string;
  let testAgentId2: string;
  let authToken: string;
  let authToken2: string;

  beforeAll(async () => {
    // Create test tenants
    await pool.query(
      'INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [TEST_TENANT_ID, 'Test Tenant', 'test-tenant']
    );
    await pool.query(
      'INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [TEST_TENANT_2_ID, 'Test Tenant 2', 'test-tenant-2']
    );

    // Create test users
    await pool.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, email) DO NOTHING',
      [TEST_USER_ID, TEST_TENANT_ID, 'test@example.com', 'hash', 'Test User', 'admin']
    );

    // Create test agents with deployment status
    const agent1 = await pool.query(
      `INSERT INTO agents (tenant_id, name, type, description, config, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        TEST_TENANT_ID,
        'Test Agent Running',
        'Specialist',
        'A test agent that is running',
        JSON.stringify({
          pattern: 'Specialist',
          valueStream: 'Support',
          deployment: {
            status: 'running',
            endpoint: 'https://test-agent.azurewebsites.net'
          }
        }),
        'active'
      ]
    );
    testAgentId = agent1.rows[0].id;

    // Create agent in different tenant
    const agent2 = await pool.query(
      `INSERT INTO agents (tenant_id, name, type, description, config, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        TEST_TENANT_2_ID,
        'Other Tenant Agent',
        'Specialist',
        'Agent in different tenant',
        JSON.stringify({
          deployment: {
            status: 'running'
          }
        }),
        'active'
      ]
    );
    testAgentId2 = agent2.rows[0].id;

    // Add skills to test agent
    await pool.query(
      `INSERT INTO agent_skills (agent_id, tenant_id, name, display_name, description, tags, input_schema, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        testAgentId,
        TEST_TENANT_ID,
        'analyze_incident',
        'Analyze Incident',
        'Analyzes incident tickets',
        ['support', 'analysis'],
        JSON.stringify({
          type: 'object',
          properties: {
            incidentId: { type: 'string' }
          }
        }),
        true
      ]
    );

    // Generate auth tokens
    authToken = generateTestToken(TEST_TENANT_ID, TEST_USER_ID);
    authToken2 = generateTestToken(TEST_TENANT_2_ID, TEST_USER_ID);
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM agent_skills WHERE agent_id = $1', [testAgentId]);
    await pool.query('DELETE FROM agents WHERE id IN ($1, $2)', [testAgentId, testAgentId2]);
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
    await pool.query('DELETE FROM tenants WHERE id IN ($1, $2)', [TEST_TENANT_ID, TEST_TENANT_2_ID]);
    await pool.end();
  });

  describe('GET /api/registry/agents', () => {
    it('should list agents with running status for authenticated tenant', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Should include our running agent
      const agent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId);
      expect(agent).toBeDefined();
      expect(agent.name).toBe('Test Agent Running');
      expect(agent._flowgrid.deploymentStatus).toBe('running');
      expect(agent.skills).toBeDefined();
      expect(agent.skills.length).toBeGreaterThan(0);
    });

    it('should not return agents from other tenants', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should not include agent from tenant 2
      const otherAgent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId2);
      expect(otherAgent).toBeUndefined();
    });

    it('should require authentication', async () => {
      await request(API_URL)
        .get('/api/registry/agents')
        .expect(401);
    });

    it('should support pagination', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.meta).toHaveProperty('page', 1);
      expect(response.body.meta).toHaveProperty('limit', 10);
      expect(response.body.meta).toHaveProperty('total');
      expect(response.body.meta).toHaveProperty('totalPages');
    });
  });

  describe('GET /api/registry/agents/:id', () => {
    it('should return A2A card for specific agent', async () => {
      const response = await request(API_URL)
        .get(`/api/registry/agents/${testAgentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check A2A Protocol v0.2 compliance
      expect(response.body).toHaveProperty('name', 'Test Agent Running');
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('protocolVersion', '0.2');
      expect(response.body).toHaveProperty('provider');
      expect(response.body).toHaveProperty('capabilities');
      expect(response.body).toHaveProperty('authentication');
      expect(response.body).toHaveProperty('skills');
      expect(response.body).toHaveProperty('_flowgrid');

      // Check skills
      expect(Array.isArray(response.body.skills)).toBe(true);
      const skill = response.body.skills.find((s: any) => s.id === 'analyze_incident');
      expect(skill).toBeDefined();
      expect(skill.name).toBe('Analyze Incident');
      expect(skill.description).toBe('Analyzes incident tickets');
      expect(skill.tags).toContain('support');
    });

    it('should not return agent from different tenant', async () => {
      await request(API_URL)
        .get(`/api/registry/agents/${testAgentId2}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 404 for non-existent agent', async () => {
      await request(API_URL)
        .get('/api/registry/agents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/registry/agents/search', () => {
    it('should search by skill name', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents/search?skill=analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      const agent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId);
      expect(agent).toBeDefined();
    });

    it('should search by pattern', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents/search?pattern=Specialist')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      const agent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId);
      expect(agent).toBeDefined();
      expect(agent._flowgrid.pattern).toBe('Specialist');
    });

    it('should search by value stream', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents/search?valueStream=Support')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const agent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId);
      expect(agent).toBeDefined();
      expect(agent._flowgrid.valueStream).toBe('Support');
    });

    it('should search by general text', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents/search?q=running')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const agent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId);
      expect(agent).toBeDefined();
    });

    it('should not return agents from other tenants in search', async () => {
      const response = await request(API_URL)
        .get('/api/registry/agents/search?q=agent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const otherAgent = response.body.data.find((a: any) => a._flowgrid.id === testAgentId2);
      expect(otherAgent).toBeUndefined();
    });
  });

  describe('POST /api/registry/agents/:id/register', () => {
    it('should register agent and set status to running', async () => {
      // Create a draft agent
      const draftAgent = await pool.query(
        `INSERT INTO agents (tenant_id, name, type, config)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          TEST_TENANT_ID,
          'Draft Agent',
          'Specialist',
          JSON.stringify({ deployment: { status: 'draft' } })
        ]
      );
      const draftAgentId = draftAgent.rows[0].id;

      const response = await request(API_URL)
        .post(`/api/registry/agents/${draftAgentId}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          endpoint: 'https://draft-agent.azurewebsites.net',
          healthCheckUrl: 'https://draft-agent.azurewebsites.net/health',
          metadata: { version: '1.0.0' }
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('agentId', draftAgentId);
      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('registeredAt');

      // Verify in database
      const updated = await pool.query(
        'SELECT config FROM agents WHERE id = $1',
        [draftAgentId]
      );
      expect(updated.rows[0].config.deployment.status).toBe('running');
      expect(updated.rows[0].config.deployment.endpoint).toBe('https://draft-agent.azurewebsites.net');

      // Cleanup
      await pool.query('DELETE FROM agents WHERE id = $1', [draftAgentId]);
    });

    it('should not allow registering agent from different tenant', async () => {
      await request(API_URL)
        .post(`/api/registry/agents/${testAgentId2}/register`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          endpoint: 'https://malicious.com'
        })
        .expect(404);
    });
  });

  describe('DELETE /api/registry/agents/:id/unregister', () => {
    it('should unregister agent and set status to stopped', async () => {
      const response = await request(API_URL)
        .delete(`/api/registry/agents/${testAgentId}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('status', 'stopped');
      expect(response.body).toHaveProperty('unregisteredAt');

      // Verify in database
      const updated = await pool.query(
        'SELECT config FROM agents WHERE id = $1',
        [testAgentId]
      );
      expect(updated.rows[0].config.deployment.status).toBe('stopped');

      // Re-register for other tests
      await pool.query(
        `UPDATE agents SET config = jsonb_set(config, '{deployment,status}', '"running"') WHERE id = $1`,
        [testAgentId]
      );
    });

    it('should not allow unregistering agent from different tenant', async () => {
      await request(API_URL)
        .delete(`/api/registry/agents/${testAgentId2}/unregister`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
