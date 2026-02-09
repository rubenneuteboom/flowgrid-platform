# Flowgrid Authentication System

Complete guide to the enterprise authentication system in Flowgrid Platform.

## Overview

Flowgrid uses a comprehensive, enterprise-grade authentication system with:

- **JWT-based authentication** with short-lived access tokens and long-lived refresh tokens
- **Invite-only registration** - admins control who can join
- **Multi-Factor Authentication (MFA)** using TOTP (Time-based One-Time Passwords)
- **Microsoft OAuth** via Azure AD B2C integration
- **Rate limiting** to prevent brute-force attacks
- **Full audit logging** for security compliance

## Quick Start

### Demo Credentials
```
Email: demo@flowgrid.io
Password: demo123
```

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Login     │────▶│  MFA Check  │────▶│   Access    │
│   Form      │     │  (if on)    │     │   Granted   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   │                   ▼
       │                   │           ┌─────────────┐
       │                   │           │  Refresh    │
       │                   │           │  Token      │
       │                   │           └─────────────┘
       │                   ▼
       │            ┌─────────────┐
       │            │   Enter     │
       │            │  TOTP Code  │
       │            └─────────────┘
       ▼
┌─────────────┐
│  Password   │
│   Reset     │
└─────────────┘
```

## API Endpoints

### Core Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | User login with email/password |
| `/api/auth/logout` | POST | Revoke refresh token |
| `/api/auth/refresh` | POST | Exchange refresh token for new access token |
| `/api/auth/verify` | POST | Validate a JWT token |
| `/api/auth/me` | GET | Get current user profile |

### Login

```bash
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@flowgrid.io", "password": "demo123"}'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "email": "demo@flowgrid.io",
    "name": "Demo User",
    "role": "admin",
    "mfaEnabled": false
  },
  "tenant": {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "Demo Organization",
    "slug": "demo"
  },
  "expiresIn": "15m"
}
```

If MFA is enabled:
```json
{
  "mfaRequired": true,
  "message": "MFA code required"
}
```

Then send login with MFA code:
```bash
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@flowgrid.io", "password": "demo123", "mfaCode": "123456"}'
```

### Token Refresh

```bash
curl -X POST http://localhost:3002/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbGciOiJIUzI1NiIs..."}'
```

### Invite System

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/auth/invite/send` | POST | Send invitation email | Admin |
| `/api/auth/invite/validate/:token` | GET | Validate invite token | Public |
| `/api/auth/invite/accept` | POST | Accept invite, create account | Public |

**Send Invite (Admin only):**
```bash
curl -X POST http://localhost:3002/api/auth/invite/send \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@company.com", "role": "user"}'
```

**Accept Invite:**
```bash
curl -X POST http://localhost:3002/api/auth/invite/accept \
  -H "Content-Type: application/json" \
  -d '{
    "token": "abc123...",
    "name": "John Doe",
    "password": "SecureP@ssw0rd"
  }'
```

### Password Management

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/auth/password/forgot` | POST | Request password reset email | Public |
| `/api/auth/password/reset` | POST | Reset password with token | Public |
| `/api/auth/password/change` | POST | Change password (logged in) | Required |

**Request Reset:**
```bash
curl -X POST http://localhost:3002/api/auth/password/forgot \
  -H "Content-Type: application/json" \
  -d '{"email": "user@company.com"}'
```

**Reset Password:**
```bash
curl -X POST http://localhost:3002/api/auth/password/reset \
  -H "Content-Type: application/json" \
  -d '{
    "token": "reset_token_from_email",
    "password": "NewSecureP@ssw0rd"
  }'
```

### Multi-Factor Authentication (MFA)

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/auth/mfa/setup` | POST | Generate TOTP secret & QR code | Required |
| `/api/auth/mfa/verify` | POST | Verify code & enable MFA | Required |
| `/api/auth/mfa/disable` | POST | Disable MFA | Required |
| `/api/auth/mfa/backup-codes` | POST | Regenerate backup codes | Required |

**Setup MFA:**
```bash
curl -X POST http://localhost:3002/api/auth/mfa/setup \
  -H "Authorization: Bearer <access_token>"
```

Response:
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCode": "data:image/png;base64,iVBORw0KGgo...",
  "message": "Scan the QR code with your authenticator app"
}
```

**Enable MFA:**
```bash
curl -X POST http://localhost:3002/api/auth/mfa/verify \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"code": "123456"}'
```

Response includes backup codes:
```json
{
  "message": "MFA enabled successfully",
  "backupCodes": ["A1B2C3D4", "E5F6G7H8", "..."],
  "warning": "Save these backup codes securely"
}
```

### Microsoft OAuth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/oauth/microsoft/url` | POST | Get Azure AD authorization URL |
| `/api/auth/oauth/microsoft/callback` | GET | OAuth callback handler |

**Get OAuth URL:**
```bash
curl -X POST http://localhost:3002/api/auth/oauth/microsoft/url
```

Response:
```json
{
  "authUrl": "https://yourb2ctenant.b2clogin.com/...",
  "state": "random_state_token"
}
```

### Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/admin/users` | GET | List all users |
| `/api/auth/admin/users/:id/disable` | POST | Disable user account |
| `/api/auth/admin/users/:id/enable` | POST | Enable user account |
| `/api/auth/admin/users/:id/reset-mfa` | POST | Reset user's MFA |
| `/api/auth/admin/audit` | GET | Get authentication audit log |

**List Users:**
```bash
curl http://localhost:3002/api/auth/admin/users?page=1&limit=20 \
  -H "Authorization: Bearer <admin_access_token>"
```

**Get Audit Log:**
```bash
curl http://localhost:3002/api/auth/admin/audit?action=login&status=failure \
  -H "Authorization: Bearer <admin_access_token>"
```

## Token Structure

### Access Token (15 minutes)
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tenantId": "uuid",
  "role": "admin",
  "type": "access",
  "iat": 1707523200,
  "exp": 1707524100
}
```

### Refresh Token (7 days)
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tenantId": "uuid",
  "role": "admin",
  "type": "refresh",
  "iat": 1707523200,
  "exp": 1708128000
}
```

## Password Requirements

Passwords must meet these criteria:
- Minimum 8 characters
- Contains uppercase letters (recommended)
- Contains lowercase letters
- Contains numbers (recommended)
- Contains special characters (recommended)
- Password strength score ≥ 3

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Login | 5 attempts / 15 min |
| Password Reset | 3 attempts / 15 min |
| MFA Endpoints | 10 attempts / 15 min |
| Invite Send | 10 invites / hour |
| General API | 100 requests / 15 min |

## Security Features

### Implemented
- ✅ Password hashing with bcrypt (12 rounds)
- ✅ JWT with short expiration
- ✅ Refresh token rotation
- ✅ Account lockout after failed attempts
- ✅ Rate limiting with Redis backing
- ✅ TOTP-based MFA with backup codes
- ✅ Secure password reset flow
- ✅ Invite-only registration
- ✅ Comprehensive audit logging
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ HTTP-only cookies for refresh tokens

### Best Practices
- Never log passwords or tokens
- Use HTTPS in production
- Rotate JWT secrets periodically
- Monitor audit logs for anomalies
- Regularly clean up expired tokens

## Environment Variables

```bash
# Required
JWT_SECRET=your-very-long-secret-key-change-in-production
DATABASE_URL=postgres://user:pass@localhost:5432/flowgrid

# Optional
PORT=3002
NODE_ENV=production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=https://your-domain.com

# Email (Resend)
RESEND_API_KEY=re_xxx
EMAIL_FROM=Flowgrid <noreply@your-domain.com>
APP_BASE_URL=https://your-domain.com

# Azure AD B2C (optional)
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
AZURE_B2C_TENANT_NAME=yourb2ctenant
AZURE_B2C_POLICY_NAME=B2C_1_signupsignin
AZURE_REDIRECT_URI=https://your-domain.com/api/auth/oauth/microsoft/callback
```

## Database Schema

The auth system uses these tables:

- `users` - User accounts with MFA status
- `refresh_tokens` - Active refresh tokens
- `password_reset_tokens` - Password reset requests
- `invite_tokens` - Pending invitations
- `mfa_secrets` - TOTP secrets and backup codes
- `oauth_accounts` - Linked OAuth providers
- `auth_audit_log` - Security audit trail

See migration `003_auth_enterprise.sql` for full schema.

## Frontend Pages

| Page | URL | Purpose |
|------|-----|---------|
| Login | `/login.html` | User login with MFA support |
| Signup | `/signup.html` | Accept invitation |
| Forgot Password | `/forgot-password.html` | Request reset email |
| Reset Password | `/reset-password.html` | Set new password |
| MFA Setup | `/mfa-setup.html` | Configure 2FA |
| Admin Invite | `/admin-invite.html` | Send invitations |

## Troubleshooting

### "Invalid email or password"
- Check credentials are correct
- Verify account is active
- Check if account is locked (5 failed attempts)

### "Token expired"
- Use refresh token to get new access token
- If refresh token expired, user must login again

### "MFA code required"
- User has 2FA enabled
- Include `mfaCode` in login request

### Rate limit errors
- Wait for the rate limit window to reset (15 min)
- Check Redis connection if using Redis store

### OAuth errors
- Verify Azure AD B2C configuration
- Check redirect URI matches exactly
- Ensure client secret is valid
