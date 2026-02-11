-- =============================================================================
-- Flowgrid Platform - A2A Compliance Schema
-- Migration: 005_a2a_compliance.sql
-- Created: 2026-02-11
-- Purpose: Support for A2A Protocol compliance in agent definitions
-- =============================================================================

-- =============================================================================
-- ENHANCE AGENTS TABLE
-- Add A2A-required fields to existing agents table
-- =============================================================================

-- Element type (Agent/Capability/DataObject/Process)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS element_type VARCHAR(50) DEFAULT 'Agent';

-- Agentic pattern
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pattern VARCHAR(50);

-- Autonomy and risk
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level VARCHAR(50) DEFAULT 'supervised';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS risk_appetite VARCHAR(20) DEFAULT 'medium';

-- Triggers and outputs (A2A message types)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS triggers TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS outputs TEXT[] DEFAULT '{}';

-- Process flow details (for Process elements)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS process_steps TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS decision_points TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS error_handling TEXT;

-- A2A Card version
ALTER TABLE agents ADD COLUMN IF NOT EXISTS a2a_version VARCHAR(20) DEFAULT '1.0.0';

-- =============================================================================
-- A2A AGENT CARDS
-- Full A2A Agent Card metadata per agent
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- A2A Required Fields
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    url VARCHAR(500),
    version VARCHAR(50) DEFAULT '1.0.0',
    protocol_version VARCHAR(10) DEFAULT '1.0',
    
    -- Capabilities
    supports_streaming BOOLEAN DEFAULT false,
    supports_push_notifications BOOLEAN DEFAULT false,
    supports_extended_card BOOLEAN DEFAULT false,
    
    -- Input/Output modes (MIME types)
    default_input_modes TEXT[] DEFAULT ARRAY['text/plain', 'application/json'],
    default_output_modes TEXT[] DEFAULT ARRAY['application/json'],
    
    -- Security schemes (JSON)
    security_schemes JSONB DEFAULT '[]',
    
    -- Full A2A card as JSON (for extensions and raw access)
    card_json JSONB NOT NULL DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(agent_id)
);

-- =============================================================================
-- A2A SKILLS
-- Skills/capabilities exposed by each agent (A2A compliant)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Skill identification
    skill_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Input/Output schemas (JSON Schema format)
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    
    -- Supported modes (MIME types)
    input_modes TEXT[] DEFAULT ARRAY['application/json'],
    output_modes TEXT[] DEFAULT ARRAY['application/json'],
    
    -- Examples (array of {input, output, scenario})
    examples JSONB DEFAULT '[]',
    
    -- Ordering for display
    sort_order INTEGER DEFAULT 0,
    
    -- Active flag
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(agent_id, skill_id)
);

-- =============================================================================
-- A2A MESSAGE TYPES
-- Reusable message type definitions for agent communication
-- =============================================================================
CREATE TABLE IF NOT EXISTS a2a_message_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Message identification
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Schema (JSON Schema format)
    message_schema JSONB NOT NULL DEFAULT '{}',
    
    -- Metadata
    version VARCHAR(20) DEFAULT '1.0.0',
    is_deprecated BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(tenant_id, name)
);

-- =============================================================================
-- ENHANCE AGENT INTERACTIONS
-- Add A2A message contract details to relationships
-- =============================================================================

-- Relationship type (ArchiMate style)
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(50);

-- A2A message contract
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS a2a_message_type_id UUID REFERENCES a2a_message_types(id);
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS response_schema JSONB DEFAULT '{}';
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS is_async BOOLEAN DEFAULT false;
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS retry_policy JSONB DEFAULT '{}';

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_agent_cards_tenant ON agent_cards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_cards_agent ON agent_cards(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_tenant ON agent_skills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_element_type ON agents(tenant_id, element_type);
CREATE INDEX IF NOT EXISTS idx_agents_pattern ON agents(tenant_id, pattern);
CREATE INDEX IF NOT EXISTS idx_a2a_message_types_tenant ON a2a_message_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_type ON agent_interactions(relationship_type);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
CREATE TRIGGER update_agent_cards_updated_at
    BEFORE UPDATE ON agent_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_skills_updated_at
    BEFORE UPDATE ON agent_skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_a2a_message_types_updated_at
    BEFORE UPDATE ON a2a_message_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE agent_cards IS 'A2A-compliant Agent Card metadata for discovery and interoperability';
COMMENT ON TABLE agent_skills IS 'A2A-compliant skill definitions with JSON Schema contracts';
COMMENT ON TABLE a2a_message_types IS 'Reusable message type definitions for A2A communication';

COMMENT ON COLUMN agents.element_type IS 'ArchiMate-style element type: Agent, Capability, DataObject, Process';
COMMENT ON COLUMN agents.pattern IS 'Agentic pattern: routing, planning, tool-use, orchestration, etc.';
COMMENT ON COLUMN agents.autonomy_level IS 'Decision authority: autonomous, supervised, human-in-loop';
COMMENT ON COLUMN agents.triggers IS 'A2A message types this agent responds to';
COMMENT ON COLUMN agents.outputs IS 'A2A message types this agent produces';

-- =============================================================================
-- SEED DATA: A2A Protocol Patterns
-- =============================================================================
INSERT INTO agentic_patterns (id, name, description, use_cases, characteristics, selection_criteria)
VALUES
    ('routing', 'Routing', 'Routes requests to specialized agents based on context',
     ARRAY['Request classification', 'Load balancing', 'Skill-based routing'],
     ARRAY['Context-aware', 'Low latency', 'Stateless'],
     'Routes to other agents'),
    ('planning', 'Planning', 'Breaks complex tasks into steps, creates execution plans',
     ARRAY['Multi-step tasks', 'Dependency management', 'Goal decomposition'],
     ARRAY['Goal-oriented', 'Creates subtasks', 'Manages state'],
     'Complex multi-step tasks'),
    ('tool-use', 'Tool Use', 'Interacts with external APIs, databases, services',
     ARRAY['API integration', 'Data retrieval', 'External actions'],
     ARRAY['API-aware', 'Error handling', 'Retry logic'],
     'External system interaction'),
    ('human-in-loop', 'Human-in-Loop', 'Requires human approval for decisions',
     ARRAY['Approval workflows', 'Sensitive actions', 'Quality review'],
     ARRAY['Escalation', 'Approval gates', 'Audit trail'],
     'Needs human oversight'),
    ('rag', 'RAG', 'Retrieves context from knowledge bases before responding',
     ARRAY['Knowledge retrieval', 'Context augmentation', 'Document QA'],
     ARRAY['Vector search', 'Context injection', 'Source citation'],
     'Needs knowledge base'),
    ('reflection', 'Reflection', 'Self-evaluates and improves outputs',
     ARRAY['Quality improvement', 'Error correction', 'Output refinement'],
     ARRAY['Self-critique', 'Iterative', 'Quality scoring'],
     'Output quality critical'),
    ('guardrails', 'Guardrails', 'Enforces policies, validates inputs/outputs',
     ARRAY['Policy enforcement', 'Content filtering', 'Compliance'],
     ARRAY['Validation', 'Blocking', 'Logging'],
     'Security/compliance critical')
ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    use_cases = EXCLUDED.use_cases,
    characteristics = EXCLUDED.characteristics,
    selection_criteria = EXCLUDED.selection_criteria;

-- Print success
DO $$
BEGIN
    RAISE NOTICE '✅ A2A compliance schema created successfully!';
END $$;
