# Azure Entra ID B2C Implementation Checklist

## Phase 1: Azure Setup ⬜

### Create B2C Tenant
- [ ] Go to Azure Portal → Create resource → Azure Active Directory B2C
- [ ] Tenant name: `flowgridauth` (or preferred name)
- [ ] Initial domain: `flowgridauth.onmicrosoft.com`
- [ ] Region: West Europe
- [ ] Link to Azure subscription for billing

### App Registration
- [ ] B2C tenant → App registrations → New registration
- [ ] Name: `FlowGrid Platform`
- [ ] Supported account types: Accounts in this organizational directory only
- [ ] Redirect URIs (SPA):
  - `http://localhost:8080/auth/callback`
  - `https://gateway.salmonfield-b588dc13.westeurope.azurecontainerapps.io/auth/callback`
- [ ] Note down: Application (client) ID
- [ ] Create client secret → Note down value

### User Flows
- [ ] Create "Sign up and sign in" flow (B2C_1_signupsignin)
  - User attributes: Email, Display Name, Given Name, Surname
  - Application claims: Same + objectId
  - MFA: Email
- [ ] Create "Password reset" flow (B2C_1_passwordreset)
- [ ] Create "Profile editing" flow (B2C_1_profileedit)

### Test User Flow
- [ ] Run sign-up flow manually
- [ ] Verify token contains expected claims

---

## Phase 2: Database ⬜

### Run Migration
```bash
# In flowgrid-platform/services/auth-service
psql $DATABASE_URL < migrations/004_b2c_auth.sql
```

- [ ] Create `b2c_users` table
- [ ] Create `tenant_invitations` table  
- [ ] Create `tenant_members` table
- [ ] Migrate existing users

---

## Phase 3: Backend ⬜

### Environment Variables
- [ ] Add to `.env` / Azure Key Vault:
  - `B2C_TENANT_NAME`
  - `B2C_TENANT_ID`
  - `B2C_CLIENT_ID`
  - `B2C_CLIENT_SECRET`
  - `B2C_POLICY_SIGNIN`

### Auth Service Updates
- [ ] Add JWKS validation (`jose` or `jsonwebtoken` + `jwks-rsa`)
- [ ] Implement `POST /api/auth/b2c/callback`
- [ ] Implement `POST /api/auth/invite`
- [ ] Implement `GET /api/auth/invite/:token`
- [ ] Implement `DELETE /api/auth/invite/:token`
- [ ] Update `GET /api/auth/me` for B2C users

### Email Service
- [ ] Create invitation email template
- [ ] Send via Resend API

---

## Phase 4: Frontend ⬜

### Install Dependencies
```bash
npm install @azure/msal-browser @azure/msal-react
```

### Implementation
- [ ] Create `src/auth/msalConfig.ts`
- [ ] Create `src/auth/AuthProvider.tsx`
- [ ] Update login page for B2C redirect
- [ ] Handle `/auth/callback` route
- [ ] Update navbar for B2C logout
- [ ] Create invitation acceptance page

---

## Phase 5: Migration ⬜

### Export Existing Users
- [ ] Export user list (email, name, tenant)
- [ ] Generate temporary passwords or use passwordless

### Import to B2C
- [ ] Use Microsoft Graph API bulk import
- [ ] Update `b2c_object_id` in database
- [ ] Send "Welcome to new login" email with reset link

---

## Phase 6: Testing ⬜

- [ ] New user signup via invitation
- [ ] Existing user signin
- [ ] Password reset flow
- [ ] Profile edit flow
- [ ] MFA enrollment and verification
- [ ] Token refresh
- [ ] Logout (B2C + FlowGrid)
- [ ] Multi-tenant user (belongs to multiple tenants)

---

## Phase 7: Deployment ⬜

- [ ] Add secrets to Azure Key Vault
- [ ] Update CI/CD for new env vars
- [ ] Deploy to staging
- [ ] Smoke test
- [ ] Deploy to production
- [ ] Monitor for errors

---

## Quick Commands

```bash
# Test B2C token validation locally
curl -X POST http://localhost:3002/api/auth/b2c/callback \
  -H "Content-Type: application/json" \
  -d '{"idToken": "...", "state": "{}"}'

# Create invitation
curl -X POST http://localhost:3002/api/auth/invite \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "role": "member"}'
```
