-- Migration: Add foundations table for Discovery Wizard
-- Date: 2026-02-12

CREATE TABLE IF NOT EXISTS foundations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  capabilities JSONB DEFAULT '[]',
  data_objects JSONB DEFAULT '[]',
  processes JSONB DEFAULT '[]',
  integrations JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for tenant isolation
CREATE INDEX IF NOT EXISTS idx_foundations_tenant_id ON foundations(tenant_id);

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_foundations_name ON foundations(name);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_foundations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS foundations_updated_at ON foundations;
CREATE TRIGGER foundations_updated_at
  BEFORE UPDATE ON foundations
  FOR EACH ROW
  EXECUTE FUNCTION update_foundations_updated_at();
