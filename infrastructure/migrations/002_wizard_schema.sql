-- =============================================================================
-- Flowgrid Platform - Wizard Schema
-- Migration: 002_wizard_schema.sql
-- Created: 2026-02-09
-- Purpose: Support for AI-powered wizard workflow
-- =============================================================================

-- =============================================================================
-- WIZARD SESSIONS
-- Tracks user progress through the wizard workflow
-- =============================================================================
CREATE TABLE IF NOT EXISTS wizard_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_name VARCHAR(255),
    source_type VARCHAR(50) NOT NULL DEFAULT 'text', -- 'image', 'text', 'xml'
    source_data JSONB DEFAULT '{}', -- extracted capabilities from source
    analysis_result JSONB DEFAULT '{}', -- AI analysis output (agents, relationships, etc.)
    custom_prompt TEXT, -- user-provided context for analysis
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'analyzed', 'applied', 'failed'
    error_message TEXT, -- if status = 'failed'
    applied_at TIMESTAMP WITH TIME ZONE, -- when agents were created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_wizard_sessions_tenant ON wizard_sessions(tenant_id);
CREATE INDEX idx_wizard_sessions_user ON wizard_sessions(user_id);
CREATE INDEX idx_wizard_sessions_status ON wizard_sessions(status);
CREATE INDEX idx_wizard_sessions_created ON wizard_sessions(created_at DESC);

-- =============================================================================
-- CAPABILITY MAPS
-- Stores extracted capability hierarchies for reuse
-- =============================================================================
CREATE TABLE IF NOT EXISTS capability_maps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    wizard_session_id UUID REFERENCES wizard_sessions(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    capabilities JSONB NOT NULL DEFAULT '[]', -- array of capability objects
    hierarchy JSONB DEFAULT '{}', -- parent-child relationships
    value_streams JSONB DEFAULT '[]', -- top-level value streams identified
    source_type VARCHAR(50), -- 'image', 'text', 'xml'
    source_metadata JSONB DEFAULT '{}', -- original filename, dimensions, etc.
    is_template BOOLEAN DEFAULT false, -- reusable template
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_capability_maps_tenant ON capability_maps(tenant_id);
CREATE INDEX idx_capability_maps_session ON capability_maps(wizard_session_id);
CREATE INDEX idx_capability_maps_template ON capability_maps(tenant_id, is_template) WHERE is_template = true;

-- =============================================================================
-- AGENTIC PATTERNS (lookup table)
-- Reference data for AI agent design patterns
-- =============================================================================
CREATE TABLE IF NOT EXISTS agentic_patterns (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    use_cases TEXT[] NOT NULL DEFAULT '{}',
    characteristics TEXT[] NOT NULL DEFAULT '{}',
    selection_criteria TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert standard agentic patterns
INSERT INTO agentic_patterns (id, name, description, use_cases, characteristics, selection_criteria) VALUES
('orchestrator', 'Orchestrator', 'Coordinates multiple agents and workflows', 
 ARRAY['Multi-agent coordination', 'Workflow management', 'State orchestration'],
 ARRAY['High-level control', 'Delegates tasks', 'Manages state'],
 'Manages other agents'),
('specialist', 'Specialist', 'Deep domain expertise for specific tasks',
 ARRAY['Expert analysis', 'Domain-specific processing', 'Focused operations'],
 ARRAY['Focused scope', 'Expert knowledge', 'Handles specific tasks'],
 'Deep domain knowledge'),
('coordinator', 'Coordinator', 'Manages handoffs between teams and systems',
 ARRAY['Team coordination', 'Process handoffs', 'Cross-system sync'],
 ARRAY['Routing', 'Load balancing', 'Ensures continuity'],
 'Manages handoffs'),
('gateway', 'Gateway', 'External system integration and API facade',
 ARRAY['API integration', 'External systems', 'Protocol translation'],
 ARRAY['API facade', 'Protocol translation', 'Security boundary'],
 'Talks to external systems'),
('monitor', 'Monitor', 'Observes conditions and alerts on thresholds',
 ARRAY['System monitoring', 'Alerting', 'Threshold detection'],
 ARRAY['Passive observation', 'Threshold-based triggers', 'Escalation'],
 'Watches and alerts'),
('executor', 'Executor', 'Performs automated actions and task execution',
 ARRAY['Task execution', 'Automation', 'Script running'],
 ARRAY['Task execution', 'Scripted workflows', 'Idempotent'],
 'Executes automated actions'),
('analyzer', 'Analyzer', 'Processes data for insights and patterns',
 ARRAY['Data analysis', 'Pattern detection', 'ML insights'],
 ARRAY['Pattern detection', 'ML/analytics', 'Reporting'],
 'Analyzes data/patterns'),
('aggregator', 'Aggregator', 'Combines data from multiple sources',
 ARRAY['Data fusion', 'Multi-source aggregation', 'Unified views'],
 ARRAY['Data fusion', 'Normalization', 'Single view'],
 'Combines multiple data sources'),
('router', 'Router', 'Directs work to appropriate handlers',
 ARRAY['Request routing', 'Load distribution', 'Rule-based dispatch'],
 ARRAY['Rule-based routing', 'Load distribution'],
 'Routes requests to handlers')
ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    use_cases = EXCLUDED.use_cases,
    characteristics = EXCLUDED.characteristics,
    selection_criteria = EXCLUDED.selection_criteria;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
CREATE TRIGGER update_wizard_sessions_updated_at
    BEFORE UPDATE ON wizard_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_capability_maps_updated_at
    BEFORE UPDATE ON capability_maps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE wizard_sessions IS 'Tracks user progress through the AI-powered wizard workflow';
COMMENT ON TABLE capability_maps IS 'Stores extracted capability hierarchies from images/text/xml';
COMMENT ON TABLE agentic_patterns IS 'Reference data for AI agent design patterns';

-- Print success
DO $$
BEGIN
    RAISE NOTICE '✅ Wizard schema created successfully!';
END $$;
