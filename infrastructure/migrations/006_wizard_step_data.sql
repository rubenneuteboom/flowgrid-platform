-- Migration 006: Wizard Per-Step Data
-- Adds support for per-step wizard execution with intermediate state storage

-- =============================================================================
-- WIZARD SESSIONS UPDATES
-- =============================================================================

-- Track current step in wizard flow
ALTER TABLE wizard_sessions 
ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1;

-- Store intermediate step data as JSONB
-- Structure: { "step1": {...}, "step2": {...}, ... }
ALTER TABLE wizard_sessions 
ADD COLUMN IF NOT EXISTS step_data JSONB DEFAULT '{}';

-- =============================================================================
-- AGENTS UPDATES
-- =============================================================================

-- Store BPMN XML for process-type agents
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS process_bpmn TEXT;

-- Store agent boundaries (delegates, escalates)
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS boundaries JSONB DEFAULT '{}';

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_wizard_sessions_step 
ON wizard_sessions(current_step);

CREATE INDEX IF NOT EXISTS idx_wizard_sessions_step_data 
ON wizard_sessions USING GIN (step_data);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN wizard_sessions.current_step IS 'Current wizard step (1-6)';
COMMENT ON COLUMN wizard_sessions.step_data IS 'JSON object storing data from each completed step';
COMMENT ON COLUMN agents.process_bpmn IS 'BPMN 2.0 XML for Process-type agents';
COMMENT ON COLUMN agents.boundaries IS 'Agent boundaries: delegates[], escalates[]';
