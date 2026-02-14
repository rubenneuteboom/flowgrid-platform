-- =============================================================================
-- Flowgrid Platform - Consolidated Bootable Schema
-- Generated: 2026-02-14
-- Source of truth: running local database (23 tables)
-- =============================================================================

-- =============================================================================
-- FUNCTIONS (must exist before triggers)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_foundations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
    DELETE FROM password_reset_tokens WHERE expires_at < NOW();
    DELETE FROM invite_tokens WHERE expires_at < NOW();
    DELETE FROM auth_audit_log WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_rate_limit_events()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limit_events WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. TENANTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}',
    tier VARCHAR(50) DEFAULT 'standard',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active) WHERE is_active = true;

CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. USERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_verified_at TIMESTAMP WITH TIME ZONE,
    email_verified BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(tenant_id, is_active) WHERE is_active = true;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. AGENTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    description TEXT,
    config JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'draft',
    version INTEGER DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    element_type VARCHAR(50) DEFAULT 'Agent'
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(tenant_id, status);

CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. AGENT CAPABILITIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    capability_name VARCHAR(255) NOT NULL,
    capability_type VARCHAR(100) DEFAULT 'action',
    config JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_id, capability_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent ON agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_type ON agent_capabilities(capability_type);

-- =============================================================================
-- 5. AGENT INTERACTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    target_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    message_type VARCHAR(100) NOT NULL,
    description TEXT,
    config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT different_agents CHECK (source_agent_id != target_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_interactions_source ON agent_interactions(source_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_target ON agent_interactions(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_type ON agent_interactions(message_type);

CREATE TRIGGER update_agent_interactions_updated_at
    BEFORE UPDATE ON agent_interactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. AGENT INTEGRATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    integration_type VARCHAR(100) NOT NULL,
    config JSONB DEFAULT '{}',
    credentials_encrypted TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    config_endpoint TEXT,
    config_auth_type VARCHAR(50) DEFAULT 'API Key',
    config_api_key TEXT,
    is_configured BOOLEAN DEFAULT false,
    integration_name VARCHAR(100),
    UNIQUE(agent_id, integration_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_integrations_agent ON agent_integrations(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_integrations_type ON agent_integrations(integration_type);
CREATE INDEX IF NOT EXISTS idx_agent_integrations_status ON agent_integrations(status);

CREATE TRIGGER update_agent_integrations_updated_at
    BEFORE UPDATE ON agent_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. AGENT SKILLS
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255),
    description TEXT,
    input_schema JSONB,
    output_schema JSONB,
    tags TEXT[] DEFAULT '{}',
    examples JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_tenant ON agent_skills(tenant_id);

-- =============================================================================
-- 8. AUDIT LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- =============================================================================
-- 9. AUTH AUDIT LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB DEFAULT '{}',
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_tenant ON auth_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at);

-- =============================================================================
-- 10. WIZARD SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS wizard_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_name VARCHAR(255),
    source_type VARCHAR(50) NOT NULL DEFAULT 'text',
    source_data JSONB DEFAULT '{}',
    analysis_result JSONB DEFAULT '{}',
    custom_prompt TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    error_message TEXT,
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    step_data JSONB,
    current_step INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wizard_sessions_tenant ON wizard_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wizard_sessions_user ON wizard_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_wizard_sessions_status ON wizard_sessions(status);
CREATE INDEX IF NOT EXISTS idx_wizard_sessions_created ON wizard_sessions(created_at DESC);

CREATE TRIGGER update_wizard_sessions_updated_at
    BEFORE UPDATE ON wizard_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 11. CAPABILITY MAPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS capability_maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    wizard_session_id UUID REFERENCES wizard_sessions(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    capabilities JSONB NOT NULL DEFAULT '[]',
    hierarchy JSONB DEFAULT '{}',
    value_streams JSONB DEFAULT '[]',
    source_type VARCHAR(50),
    source_metadata JSONB DEFAULT '{}',
    is_template BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_maps_tenant ON capability_maps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_maps_session ON capability_maps(wizard_session_id);
CREATE INDEX IF NOT EXISTS idx_capability_maps_template ON capability_maps(tenant_id, is_template) WHERE is_template = true;

CREATE TRIGGER update_capability_maps_updated_at
    BEFORE UPDATE ON capability_maps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 12. AGENTIC PATTERNS
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

-- =============================================================================
-- 13. REFRESH TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(512) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason VARCHAR(255),
    device_info JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token) WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE NOT revoked;

-- =============================================================================
-- 14. PASSWORD RESET TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(512) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    used_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token) WHERE NOT used;
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- =============================================================================
-- 15. INVITE TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS invite_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(512) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user',
    invited_by UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_token ON invite_tokens(token) WHERE NOT used;
CREATE INDEX IF NOT EXISTS idx_invite_email ON invite_tokens(email);
CREATE INDEX IF NOT EXISTS idx_invite_tenant ON invite_tokens(tenant_id);

-- =============================================================================
-- 16. MFA SECRETS
-- =============================================================================
CREATE TABLE IF NOT EXISTS mfa_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    secret VARCHAR(255) NOT NULL,
    backup_codes TEXT[],
    backup_codes_generated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_secrets_user ON mfa_secrets(user_id);

CREATE TRIGGER update_mfa_secrets_updated_at
    BEFORE UPDATE ON mfa_secrets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 17. OAUTH ACCOUNTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    profile JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_account_id);

CREATE TRIGGER update_oauth_accounts_updated_at
    BEFORE UPDATE ON oauth_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 18. RATE LIMIT EVENTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS rate_limit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier VARCHAR(255) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    attempt_count INTEGER DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blocked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier ON rate_limit_events(identifier, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_events(window_start);

-- =============================================================================
-- 19. INTEGRATION CATALOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS integration_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    icon VARCHAR(10),
    description TEXT,
    api_docs_url TEXT,
    auth_types TEXT DEFAULT 'OAuth2,API Key',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 20. FOUNDATIONS
-- =============================================================================
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
    updated_at TIMESTAMP DEFAULT NOW(),
    deployed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_foundations_tenant_id ON foundations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foundations_name ON foundations(name);

DROP TRIGGER IF EXISTS foundations_updated_at ON foundations;
CREATE TRIGGER foundations_updated_at
    BEFORE UPDATE ON foundations
    FOR EACH ROW EXECUTE FUNCTION update_foundations_updated_at();

-- =============================================================================
-- 21. APPROVAL REQUESTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- =============================================================================
-- 22. FLOW RUNS
-- =============================================================================
CREATE TABLE IF NOT EXISTS flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    foundation_id UUID NOT NULL REFERENCES foundations(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
    input_data JSONB DEFAULT '{}',
    output_data JSONB DEFAULT '{}',
    error TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    orchestrator_id UUID
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_tenant ON flow_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_foundation ON flow_runs(foundation_id);

-- =============================================================================
-- 23. FLOW STEPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS flow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS idx_flow_steps_run ON flow_steps(run_id);

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE tenants IS 'Multi-tenant organization accounts';
COMMENT ON TABLE users IS 'User accounts within tenants';
COMMENT ON TABLE agents IS 'AI/automation agents configured per tenant';
COMMENT ON TABLE agent_capabilities IS 'Capabilities/skills each agent possesses';
COMMENT ON TABLE agent_interactions IS 'Communication patterns between agents';
COMMENT ON TABLE agent_integrations IS 'External system integrations per agent';
COMMENT ON TABLE agent_skills IS 'Agent skill definitions with JSON Schema contracts';
COMMENT ON TABLE audit_log IS 'Audit trail for security and compliance';
COMMENT ON TABLE auth_audit_log IS 'Security audit trail for authentication events';
COMMENT ON TABLE wizard_sessions IS 'Tracks user progress through the AI-powered wizard workflow';
COMMENT ON TABLE capability_maps IS 'Stores extracted capability hierarchies from images/text/xml';
COMMENT ON TABLE agentic_patterns IS 'Reference data for AI agent design patterns';
COMMENT ON TABLE refresh_tokens IS 'Long-lived refresh tokens for JWT renewal';
COMMENT ON TABLE password_reset_tokens IS 'One-time password reset tokens sent via email';
COMMENT ON TABLE invite_tokens IS 'Invitation tokens for new user registration';
COMMENT ON TABLE mfa_secrets IS 'TOTP secrets for multi-factor authentication';
COMMENT ON TABLE oauth_accounts IS 'Linked OAuth provider accounts (Microsoft, etc.)';
COMMENT ON TABLE rate_limit_events IS 'Rate limiting backup for Redis';
COMMENT ON TABLE integration_catalog IS 'Available integration types catalog';
COMMENT ON TABLE foundations IS 'Discovery wizard foundation definitions';
COMMENT ON TABLE approval_requests IS 'Human-in-the-loop approval requests';
COMMENT ON TABLE flow_runs IS 'Flow execution run instances';
COMMENT ON TABLE flow_steps IS 'Individual steps within a flow run';

DO $$
BEGIN
    RAISE NOTICE '✅ Flowgrid Platform schema created successfully! (23 tables)';
END $$;
