-- Migration: Add runtime tables for flow execution tracking

CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  foundation_id UUID NOT NULL REFERENCES foundations(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  step_key VARCHAR(255) NOT NULL,
  step_name VARCHAR(500),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_name VARCHAR(255),
  step_type VARCHAR(20) DEFAULT 'agent' CHECK (step_type IN ('agent', 'human', 'gateway', 'start', 'end')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'waiting_approval', 'skipped')),
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error TEXT,
  approval_id UUID REFERENCES approval_requests(id),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_tenant ON flow_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_foundation ON flow_runs(foundation_id);
CREATE INDEX IF NOT EXISTS idx_flow_steps_run ON flow_steps(run_id);

-- Add deployed_at to foundations
ALTER TABLE foundations ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP;
