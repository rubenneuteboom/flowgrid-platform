CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  foundation_id UUID REFERENCES foundations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_name VARCHAR(255),
  flow_instance_id VARCHAR(255),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  context JSONB DEFAULT '{}',
  urgency VARCHAR(20) DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  requested_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  decided_by UUID REFERENCES users(id),
  decided_by_name VARCHAR(255),
  decided_at TIMESTAMP,
  decision_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_tenant ON approval_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approval_requests(agent_id);
