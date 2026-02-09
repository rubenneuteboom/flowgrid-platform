-- =============================================================================
-- Flowgrid Platform - Development Seed Data
-- =============================================================================

-- Demo Tenant
INSERT INTO tenants (id, name, slug, settings, tier)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Demo Organization',
    'demo',
    '{"theme": "light", "features": {"ai": true, "integrations": true}}',
    'enterprise'
) ON CONFLICT (slug) DO NOTHING;

-- Demo User (password: demo123)
-- Password hash is bcrypt of 'demo123' with salt rounds 12
INSERT INTO users (id, tenant_id, email, password_hash, name, role)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'demo@flowgrid.io',
    '$2b$12$d0g/46Xtt2FTSW.cgTcq/ur.P9q6qzcfm9l.r21cu3KIP3DoMhtpS', -- demo123
    'Demo User',
    'admin'
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Demo Agents
-- Agent 1: Incident Manager
INSERT INTO agents (id, tenant_id, name, type, description, config, status)
VALUES (
    '33333333-3333-3333-3333-333333333331',
    '11111111-1111-1111-1111-111111111111',
    'Incident Manager',
    'servicenow',
    'Handles ServiceNow incident lifecycle management',
    '{"servicenow": {"table": "incident"}, "capabilities": ["create", "update", "resolve"]}',
    'active'
) ON CONFLICT DO NOTHING;

-- Agent 2: Change Coordinator
INSERT INTO agents (id, tenant_id, name, type, description, config, status)
VALUES (
    '33333333-3333-3333-3333-333333333332',
    '11111111-1111-1111-1111-111111111111',
    'Change Coordinator',
    'servicenow',
    'Coordinates change requests and approvals',
    '{"servicenow": {"table": "change_request"}, "capabilities": ["create", "approve", "schedule"]}',
    'active'
) ON CONFLICT DO NOTHING;

-- Agent 3: AI Assistant
INSERT INTO agents (id, tenant_id, name, type, description, config, status)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'AI Support Assistant',
    'ai',
    'AI-powered support assistant using Claude',
    '{"model": "claude-sonnet-4-20250514", "capabilities": ["analyze", "recommend", "summarize"]}',
    'active'
) ON CONFLICT DO NOTHING;

-- Agent Capabilities
INSERT INTO agent_capabilities (agent_id, capability_name, capability_type, config)
VALUES 
    ('33333333-3333-3333-3333-333333333331', 'create_incident', 'action', '{"priority_levels": ["critical", "high", "medium", "low"]}'),
    ('33333333-3333-3333-3333-333333333331', 'update_incident', 'action', '{}'),
    ('33333333-3333-3333-3333-333333333331', 'resolve_incident', 'action', '{}'),
    ('33333333-3333-3333-3333-333333333332', 'create_change', 'action', '{}'),
    ('33333333-3333-3333-3333-333333333332', 'approve_change', 'action', '{}'),
    ('33333333-3333-3333-3333-333333333333', 'analyze_text', 'ai', '{"model": "claude-sonnet-4-20250514"}'),
    ('33333333-3333-3333-3333-333333333333', 'generate_summary', 'ai', '{}')
ON CONFLICT (agent_id, capability_name) DO NOTHING;

-- Agent Interactions
INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description)
VALUES 
    ('33333333-3333-3333-3333-333333333331', '33333333-3333-3333-3333-333333333332', 'change_request', 'Incident Manager requests change from Change Coordinator'),
    ('33333333-3333-3333-3333-333333333331', '33333333-3333-3333-3333-333333333333', 'analysis_request', 'Incident Manager requests AI analysis'),
    ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333331', 'recommendation', 'AI Assistant provides recommendations to Incident Manager')
ON CONFLICT DO NOTHING;

-- Agent Integrations
INSERT INTO agent_integrations (agent_id, integration_type, config, status)
VALUES 
    ('33333333-3333-3333-3333-333333333331', 'servicenow', '{"instance": "demo.service-now.com"}', 'pending'),
    ('33333333-3333-3333-3333-333333333332', 'servicenow', '{"instance": "demo.service-now.com"}', 'pending'),
    ('33333333-3333-3333-3333-333333333333', 'anthropic', '{"model": "claude-sonnet-4-20250514"}', 'active')
ON CONFLICT (agent_id, integration_type) DO NOTHING;

-- Print success
DO $$
BEGIN
    RAISE NOTICE '✅ Demo data seeded successfully!';
END $$;
