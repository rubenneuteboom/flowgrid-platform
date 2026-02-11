-- ============================================================================
-- Migration: Azure Entra ID B2C Authentication
-- FlowGrid Platform
-- ============================================================================

-- B2C user mapping (links Azure B2C identity to FlowGrid)
CREATE TABLE IF NOT EXISTS b2c_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    b2c_object_id VARCHAR(36) UNIQUE NOT NULL,  -- Azure B2C objectId (sub claim)
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    given_name VARCHAR(100),
    family_name VARCHAR(100),
    mfa_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_b2c_users_email ON b2c_users(email);
CREATE INDEX idx_b2c_users_object_id ON b2c_users(b2c_object_id);

-- Tenant invite codes (shareable codes for joining a tenant)
CREATE TABLE IF NOT EXISTS tenant_invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(12) UNIQUE NOT NULL,  -- Short shareable code (e.g., "ACME-2024")
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
    created_by UUID REFERENCES b2c_users(id) ON DELETE SET NULL,
    max_uses INTEGER,  -- NULL = unlimited
    use_count INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,  -- NULL = never expires
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invite_codes_code ON tenant_invite_codes(code) WHERE is_active = true;
CREATE INDEX idx_invite_codes_tenant ON tenant_invite_codes(tenant_id);

-- Invite code usage log
CREATE TABLE IF NOT EXISTS invite_code_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_code_id UUID NOT NULL REFERENCES tenant_invite_codes(id) ON DELETE CASCADE,
    b2c_user_id UUID NOT NULL REFERENCES b2c_users(id) ON DELETE CASCADE,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(invite_code_id, b2c_user_id)
);

CREATE INDEX idx_invitations_token ON tenant_invitations(token) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_invitations_email ON tenant_invitations(email);
CREATE INDEX idx_invitations_tenant ON tenant_invitations(tenant_id);

-- User-tenant membership (many-to-many, supports multi-tenant users)
CREATE TABLE IF NOT EXISTS tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    b2c_user_id UUID NOT NULL REFERENCES b2c_users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invited_by UUID REFERENCES b2c_users(id) ON DELETE SET NULL,
    
    UNIQUE(tenant_id, b2c_user_id)
);

CREATE INDEX idx_members_user ON tenant_members(b2c_user_id);
CREATE INDEX idx_members_tenant ON tenant_members(tenant_id);

-- ============================================================================
-- Migration: Existing users to B2C structure
-- Run this BEFORE B2C import to preserve existing data
-- ============================================================================

-- Migrate existing users (if users table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') THEN
        -- Insert existing users into b2c_users with placeholder object_id
        INSERT INTO b2c_users (id, b2c_object_id, email, display_name, created_at)
        SELECT 
            id,
            'pending-' || id::text,  -- Placeholder, updated after B2C import
            email,
            COALESCE(name, email),
            COALESCE(created_at, NOW())
        FROM users
        ON CONFLICT (b2c_object_id) DO NOTHING;
        
        -- Create tenant memberships (existing users become admins of their tenant)
        INSERT INTO tenant_members (tenant_id, b2c_user_id, role, joined_at)
        SELECT 
            u.tenant_id,
            u.id,
            'admin',
            COALESCE(u.created_at, NOW())
        FROM users u
        WHERE u.tenant_id IS NOT NULL
        ON CONFLICT (tenant_id, b2c_user_id) DO NOTHING;
        
        RAISE NOTICE 'Migrated existing users to B2C structure';
    END IF;
END $$;

-- ============================================================================
-- Helper function: Generate short invite code
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_invite_code(tenant_name VARCHAR) 
RETURNS VARCHAR(12) AS $$
DECLARE
    prefix VARCHAR(4);
    suffix VARCHAR(6);
BEGIN
    -- Take first 4 chars of tenant name (uppercase, alphanumeric only)
    prefix := UPPER(REGEXP_REPLACE(LEFT(tenant_name, 4), '[^A-Za-z0-9]', '', 'g'));
    IF LENGTH(prefix) < 2 THEN prefix := 'INV'; END IF;
    
    -- Random 6-char suffix
    suffix := UPPER(SUBSTRING(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));
    
    RETURN prefix || '-' || suffix;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER b2c_users_updated_at
    BEFORE UPDATE ON b2c_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- View: Active invite codes with tenant info
-- ============================================================================

CREATE OR REPLACE VIEW active_invite_codes AS
SELECT 
    c.id,
    c.tenant_id,
    t.name as tenant_name,
    c.code,
    c.role,
    c.max_uses,
    c.use_count,
    c.expires_at,
    c.created_at,
    u.display_name as created_by_name,
    CASE 
        WHEN c.max_uses IS NOT NULL AND c.use_count >= c.max_uses THEN false
        WHEN c.expires_at IS NOT NULL AND c.expires_at < NOW() THEN false
        ELSE true
    END as is_valid
FROM tenant_invite_codes c
JOIN tenants t ON t.id = c.tenant_id
LEFT JOIN b2c_users u ON u.id = c.created_by
WHERE c.is_active = true;

-- ============================================================================
-- View: User with all tenant memberships
-- ============================================================================

CREATE OR REPLACE VIEW user_tenants AS
SELECT 
    u.id as user_id,
    u.b2c_object_id,
    u.email,
    u.display_name,
    m.tenant_id,
    t.name as tenant_name,
    m.role,
    m.joined_at
FROM b2c_users u
JOIN tenant_members m ON m.b2c_user_id = u.id
JOIN tenants t ON t.id = m.tenant_id;
