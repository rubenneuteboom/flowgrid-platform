-- =============================================================================
-- Flowgrid Platform - Authentication Test Data
-- Run after 003_auth_enterprise.sql migration
-- =============================================================================

-- Update demo user with new auth fields
UPDATE users SET
    mfa_enabled = false,
    email_verified = true,
    email_verified_at = NOW(),
    password_changed_at = NOW()
WHERE email = 'demo@flowgrid.io';

-- Create additional test users
-- Test User 1: Regular user (password: user123)
INSERT INTO users (id, tenant_id, email, password_hash, name, role, email_verified, email_verified_at)
VALUES (
    '22222222-2222-2222-2222-222222222223',
    '11111111-1111-1111-1111-111111111111',
    'user@flowgrid.io',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4kKhGDDXGb4O2O5S', -- user123
    'Test User',
    'user',
    true,
    NOW()
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Test User 2: User with MFA enabled (password: mfa123)
-- Note: MFA secret would need to be set up via the app
INSERT INTO users (id, tenant_id, email, password_hash, name, role, mfa_enabled, mfa_verified_at, email_verified, email_verified_at)
VALUES (
    '22222222-2222-2222-2222-222222222224',
    '11111111-1111-1111-1111-111111111111',
    'mfa@flowgrid.io',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4kKhGDDXGb4O2O5S', -- mfa123 (same hash for demo)
    'MFA Test User',
    'user',
    false, -- MFA needs to be set up via API
    NULL,
    true,
    NOW()
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Test User 3: Inactive user (password: inactive123)
INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, email_verified)
VALUES (
    '22222222-2222-2222-2222-222222222225',
    '11111111-1111-1111-1111-111111111111',
    'inactive@flowgrid.io',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4kKhGDDXGb4O2O5S',
    'Inactive User',
    'user',
    false,
    true
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Test User 4: Locked user (password: locked123)
INSERT INTO users (id, tenant_id, email, password_hash, name, role, failed_login_attempts, locked_until, email_verified)
VALUES (
    '22222222-2222-2222-2222-222222222226',
    '11111111-1111-1111-1111-111111111111',
    'locked@flowgrid.io',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4kKhGDDXGb4O2O5S',
    'Locked User',
    'user',
    5,
    NOW() + INTERVAL '30 minutes',
    true
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Create a second tenant for testing isolation
INSERT INTO tenants (id, name, slug, settings, tier)
VALUES (
    '11111111-1111-1111-1111-111111111112',
    'Test Corp',
    'testcorp',
    '{"theme": "dark", "features": {"ai": true}}',
    'standard'
) ON CONFLICT (slug) DO NOTHING;

-- Admin for second tenant
INSERT INTO users (id, tenant_id, email, password_hash, name, role, email_verified, email_verified_at)
VALUES (
    '22222222-2222-2222-2222-222222222227',
    '11111111-1111-1111-1111-111111111112',
    'admin@testcorp.io',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4kKhGDDXGb4O2O5S', -- admin123
    'TestCorp Admin',
    'admin',
    true,
    NOW()
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Add some audit log entries for testing
INSERT INTO auth_audit_log (user_id, tenant_id, action, status, ip_address, details, created_at)
SELECT 
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'login',
    'success',
    '192.168.1.1',
    '{"user_agent": "Mozilla/5.0 Test Browser"}',
    NOW() - (generate_series(1, 10) || ' hours')::INTERVAL;

INSERT INTO auth_audit_log (user_id, tenant_id, action, status, ip_address, details)
VALUES
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 
     'password_change', 'success', '192.168.1.1', '{}'),
    (NULL, NULL, 'login_attempt', 'failure', '10.0.0.1', 
     '{"email": "hacker@evil.com", "reason": "user_not_found"}'),
    ('22222222-2222-2222-2222-222222222226', '11111111-1111-1111-1111-111111111111',
     'login_attempt', 'blocked', '192.168.1.50', '{"reason": "account_locked"}');

-- Print test credentials
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ Authentication test data seeded successfully!';
    RAISE NOTICE '';
    RAISE NOTICE '🔐 Test Credentials:';
    RAISE NOTICE '────────────────────────────────────────';
    RAISE NOTICE 'Demo Organization (demo):';
    RAISE NOTICE '  Admin:    demo@flowgrid.io / demo123';
    RAISE NOTICE '  User:     user@flowgrid.io / user123';
    RAISE NOTICE '  MFA User: mfa@flowgrid.io / mfa123 (needs MFA setup)';
    RAISE NOTICE '  Inactive: inactive@flowgrid.io (disabled)';
    RAISE NOTICE '  Locked:   locked@flowgrid.io (temporarily locked)';
    RAISE NOTICE '';
    RAISE NOTICE 'Test Corp (testcorp):';
    RAISE NOTICE '  Admin:    admin@testcorp.io / admin123';
    RAISE NOTICE '────────────────────────────────────────';
END $$;
