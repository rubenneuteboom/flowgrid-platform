# FlowGrid Authentication - Azure Entra ID B2C

## Overview

FlowGrid uses Azure Entra ID B2C for identity management, complementing the existing JWT-based auth. Users are invited to tenants by admins (invitation-only model).

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   FlowGrid UI   │────▶│  Azure AD B2C    │────▶│  auth-service   │
│   (Frontend)    │◀────│  (Identity)      │◀────│  (Backend)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                        │
                                ▼                        ▼
                        ┌──────────────┐         ┌──────────────┐
                        │ User Flows   │         │  PostgreSQL  │
                        │ - Sign up    │         │  - tenants   │
                        │ - Sign in    │         │  - invites   │
                        │ - Reset pwd  │         │  - users     │
                        │ - Edit profile│        └──────────────┘
                        │ - MFA        │
                        └──────────────┘
```

## User Flow

### New User - Self-Service (Creates Own Tenant)

1. User visits FlowGrid → clicks "Sign up"
2. Redirect to B2C signup flow
3. B2C creates user identity
4. Callback to FlowGrid with ID token
5. auth-service creates new tenant + user becomes owner
6. User is logged in to their new tenant

### New User - With Invite Code

1. User receives invite code from tenant admin
2. User visits FlowGrid → clicks "Sign up" → enters invite code
3. Redirect to B2C signup flow (invite code in state)
4. B2C creates user identity
5. Callback to FlowGrid with ID token + invite code
6. auth-service validates invite, links user to existing tenant
7. User is logged in to invited tenant

### Existing User (Sign In)

1. User clicks "Sign in"
2. Redirect to B2C sign-in flow
3. B2C authenticates, returns ID token
4. auth-service validates token, looks up tenant membership(s)
5. If multiple tenants → user selects which to enter
6. Returns FlowGrid session token

## Azure B2C Configuration

### Tenant Setup

- **Tenant name:** flowgridauth.onmicrosoft.com (or custom domain)
- **Pricing tier:** Premium P1 (for MFA)
- **Region:** West Europe

### App Registration

```
Application (client) ID: <to-be-created>
Redirect URIs:
  - https://flowgrid.io/auth/callback (production)
  - https://gateway.*.azurecontainerapps.io/auth/callback (staging)
  - http://localhost:8080/auth/callback (development)
  
Supported account types: Accounts in this organizational directory only
Platform: SPA (Single Page Application)
```

### User Flows

| Flow | Name | Description |
|------|------|-------------|
| Sign up and sign in | B2C_1_signupsignin | Combined flow for new and returning users |
| Password reset | B2C_1_passwordreset | Self-service password reset |
| Profile edit | B2C_1_profileedit | Update display name, etc. |

### User Attributes

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| objectId | String | B2C | Unique user identifier |
| email | String | B2C | User's email address |
| displayName | String | B2C | Display name |
| givenName | String | B2C | First name |
| surname | String | B2C | Last name |

### Application Claims (returned in token)

- `sub` (objectId)
- `email`
- `name`
- `given_name`
- `family_name`

### MFA Configuration

- **Method:** Email OTP (primary), Authenticator app (optional)
- **Enforcement:** Required for all users
- **Conditional:** Can be relaxed for trusted IPs

## Database Schema Changes

### New Tables

```sql
-- B2C user mapping
CREATE TABLE b2c_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    b2c_object_id VARCHAR(36) UNIQUE NOT NULL,  -- B2C objectId
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP
);

-- Tenant invitations
CREATE TABLE tenant_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'member',  -- admin, member, viewer
    invited_by UUID REFERENCES b2c_users(id),
    token VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- User-tenant membership (many-to-many)
CREATE TABLE tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    b2c_user_id UUID REFERENCES b2c_users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, b2c_user_id)
);
```

### Migration: Existing Users

```sql
-- Migrate existing users to b2c_users (before B2C migration)
INSERT INTO b2c_users (id, b2c_object_id, email, display_name, created_at)
SELECT 
    id,
    id::text,  -- Temporary, will be updated after B2C import
    email,
    name,
    created_at
FROM users;

-- Create tenant memberships from existing data
INSERT INTO tenant_members (tenant_id, b2c_user_id, role)
SELECT tenant_id, id, 'admin' FROM users;
```

## API Endpoints

### Auth Service Updates

```
POST /api/auth/b2c/callback
  - Handles B2C redirect with ID token
  - Creates/updates b2c_users record
  - If invite code present: validates and joins tenant
  - If no invite code: creates new tenant (user = owner)
  - Returns FlowGrid session

POST /api/auth/invite-codes
  - Creates tenant invite code
  - Returns: { code: "ACME-A1B2C3", ... }
  - Requires: tenant admin role

GET /api/auth/invite-codes
  - Lists tenant's invite codes
  - Requires: tenant admin role

GET /api/auth/invite-codes/:code/validate
  - Validates invite code (public endpoint)
  - Returns: { valid: true, tenantName: "Acme Corp", role: "member" }

DELETE /api/auth/invite-codes/:id
  - Deactivates invite code
  - Requires: tenant admin role

GET /api/auth/me
  - Returns current user profile + tenant memberships

GET /api/auth/tenants
  - Returns user's tenant memberships (for tenant switcher)

POST /api/auth/tenants/:id/switch
  - Switches active tenant context
```

## Frontend Integration

### MSAL.js Configuration

```typescript
// src/auth/msalConfig.ts
import { Configuration, LogLevel } from '@azure/msal-browser';

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.B2C_CLIENT_ID,
    authority: `https://flowgridauth.b2clogin.com/flowgridauth.onmicrosoft.com/B2C_1_signupsignin`,
    knownAuthorities: ['flowgridauth.b2clogin.com'],
    redirectUri: window.location.origin + '/auth/callback',
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};
```

### Login Flow

```typescript
// Initiate login (with optional invite token)
async function login(inviteToken?: string) {
  const state = inviteToken ? { invite: inviteToken } : undefined;
  await msalInstance.loginRedirect({
    ...loginRequest,
    state: state ? JSON.stringify(state) : undefined,
  });
}

// Handle callback
async function handleCallback() {
  const response = await msalInstance.handleRedirectPromise();
  if (response) {
    // Send to backend
    const session = await fetch('/api/auth/b2c/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: response.idToken,
        state: response.state,
      }),
    }).then(r => r.json());
    
    // Store session, redirect to app
  }
}
```

## Environment Variables

```bash
# B2C Configuration
B2C_TENANT_NAME=flowgridauth
B2C_TENANT_ID=<tenant-id>
B2C_CLIENT_ID=<client-id>
B2C_CLIENT_SECRET=<client-secret>  # For backend token validation
B2C_POLICY_SIGNIN=B2C_1_signupsignin
B2C_POLICY_RESET=B2C_1_passwordreset
B2C_POLICY_PROFILE=B2C_1_profileedit

# Token validation
B2C_ISSUER=https://flowgridauth.b2clogin.com/<tenant-id>/v2.0/
B2C_JWKS_URI=https://flowgridauth.b2clogin.com/flowgridauth.onmicrosoft.com/B2C_1_signupsignin/discovery/v2.0/keys
```

## Migration Plan

### Phase 1: Setup (Day 1)
1. Create B2C tenant in Azure
2. Configure app registration
3. Create user flows (signin, signup, reset, profile)
4. Enable MFA

### Phase 2: Backend (Day 1-2)
1. Add database tables (b2c_users, invitations, memberships)
2. Implement B2C callback endpoint
3. Implement invitation endpoints
4. Add JWKS token validation

### Phase 3: Frontend (Day 2)
1. Add MSAL.js library
2. Create auth context/provider
3. Update login/signup pages
4. Handle B2C redirects

### Phase 4: Migration (Day 2-3)
1. Export existing users
2. Bulk import to B2C (via Graph API)
3. Update b2c_object_id mappings
4. Send password reset emails to migrated users

### Phase 5: Testing & Rollout (Day 3)
1. Test all flows (signup, signin, invite, reset)
2. Test MFA
3. Deploy to staging
4. Gradual rollout to production

## Security Considerations

- All tokens validated server-side via JWKS
- Invitation tokens are single-use, time-limited (72h)
- MFA required for all users
- Session tokens are HttpOnly, Secure, SameSite=Strict
- B2C handles password policies and brute-force protection

## Rollback Plan

If issues arise:
1. Keep existing JWT auth working in parallel
2. Feature flag to switch between auth methods
3. B2C user mappings preserved for re-migration
