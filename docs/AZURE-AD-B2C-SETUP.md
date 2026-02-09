# Azure AD B2C Setup Guide

Step-by-step guide to configure Microsoft Azure AD B2C for Flowgrid authentication.

## Overview

Azure AD B2C allows users to sign in with their Microsoft accounts (work, school, or personal) or social identities. This guide covers setting up B2C for Flowgrid.

## Prerequisites

- Azure subscription
- Global Administrator access to Azure AD
- Flowgrid running (for redirect URI)

## Step 1: Create Azure AD B2C Tenant

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "Azure AD B2C"
3. Click **Create a new Azure AD B2C Tenant**
4. Fill in the details:
   - **Organization name**: `Flowgrid Auth`
   - **Initial domain name**: `flowgridb2c` (must be unique)
   - **Country/Region**: Select your region
5. Click **Create**

⏱️ Creation takes 2-3 minutes.

## Step 2: Link B2C Tenant to Subscription

1. In Azure Portal, click your account (top right)
2. Click **Switch directory**
3. Select your new B2C tenant
4. Go to **Azure AD B2C** service
5. Click **Subscriptions** → **Link a subscription**

## Step 3: Register Flowgrid Application

1. In Azure AD B2C, go to **App registrations**
2. Click **New registration**
3. Fill in:
   - **Name**: `Flowgrid Platform`
   - **Supported account types**: Select appropriate option
     - For B2C: "Accounts in any identity provider or organizational directory"
   - **Redirect URI**: 
     - Type: `Web`
     - URL: `http://localhost:8080/api/auth/oauth/microsoft/callback` (dev)
     - Add production URL later
4. Click **Register**

### Note Your Values
After registration, note these values (you'll need them):
- **Application (client) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Directory (tenant) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

## Step 4: Configure App Authentication

1. In your app registration, go to **Authentication**
2. Under **Implicit grant and hybrid flows**:
   - ✅ Check "ID tokens"
   - ✅ Check "Access tokens"
3. Under **Supported account types**, verify selection
4. Add additional redirect URIs if needed:
   - `https://your-production-domain.com/api/auth/oauth/microsoft/callback`
5. Click **Save**

## Step 5: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Enter description: `Flowgrid Production`
4. Select expiration (recommended: 24 months)
5. Click **Add**
6. **⚠️ IMPORTANT**: Copy the secret value immediately! It won't be shown again.

Save the secret value:
```
AZURE_CLIENT_SECRET=your-secret-value-here
```

## Step 6: Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Delegated permissions**
5. Add these permissions:
   - `openid`
   - `profile`
   - `email`
   - `User.Read`
6. Click **Add permissions**
7. Click **Grant admin consent for [tenant]**

## Step 7: Create User Flow (Sign-up/Sign-in)

1. Go to **Azure AD B2C** (not the app registration)
2. Click **User flows**
3. Click **New user flow**
4. Select **Sign up and sign in**
5. Select **Recommended** version
6. Name it: `B2C_1_signupsignin`
7. Under **Identity providers**:
   - ✅ Email signup
   - ✅ Microsoft Account (if you want Microsoft login)
8. Under **User attributes and token claims**:
   - Collect: Display Name, Email Address
   - Return: Display Name, Email Addresses, Identity Provider
9. Click **Create**

### Configure User Flow Properties

1. Open your new user flow
2. Go to **Properties**
3. Token configuration:
   - Access token lifetime: 60 minutes
   - Refresh token lifetime: 14 days
4. Click **Save**

## Step 8: Add Identity Providers (Optional)

### Add Microsoft Account

1. Go to **Identity providers**
2. Click **Microsoft Account**
3. Enter:
   - **Client ID**: (from your app registration)
   - **Client Secret**: (the secret you created)
4. Click **Save**
5. Go back to your user flow, add Microsoft Account as provider

### Add Google (Optional)

1. Create project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable Google+ API
3. Create OAuth credentials
4. In Azure AD B2C, go to **Identity providers** → **Google**
5. Enter Google Client ID and Secret

## Step 9: Configure Flowgrid

Add these environment variables to your `.env` file:

```bash
# Azure AD B2C Configuration
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_B2C_TENANT_NAME=flowgridb2c
AZURE_B2C_POLICY_NAME=B2C_1_signupsignin
AZURE_REDIRECT_URI=http://localhost:8080/api/auth/oauth/microsoft/callback
```

For production, update the redirect URI:
```bash
AZURE_REDIRECT_URI=https://your-domain.com/api/auth/oauth/microsoft/callback
```

## Step 10: Test the Integration

1. Start Flowgrid
2. Navigate to `/login.html`
3. Click "Sign in with Microsoft"
4. You should be redirected to Azure AD B2C
5. Sign in with your Microsoft account
6. After consent, you'll be redirected back to Flowgrid

## User Flow Diagrams

### New User via Microsoft

```
┌─────────────────┐
│  Login Page     │
│  Click Microsoft│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Azure AD B2C   │
│  Login/Consent  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Callback       │
│  Email found?   │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│  Yes   │ │   No   │
│ Link   │ │ Error: │
│ OAuth  │ │ Need   │
│        │ │ Invite │
└────────┘ └────────┘
```

### Existing User Linking

```
User with email demo@company.com exists
         │
         ▼
User signs in with Microsoft (same email)
         │
         ▼
OAuth account linked to existing user
         │
         ▼
User can now use either password or Microsoft
```

## Troubleshooting

### Error: "AADSTS50011: Reply URL does not match"
- Verify redirect URI in Azure matches exactly
- Check for trailing slashes
- Ensure protocol matches (http vs https)

### Error: "Invalid client secret"
- Secrets expire - generate a new one
- Check for copy/paste issues (hidden characters)

### Error: "No email claim"
- Ensure `email` permission is granted
- Check user flow returns email addresses

### Users can't see Microsoft button
- Check if `AZURE_CLIENT_ID` is set
- The button only shows if OAuth is configured

### Token exchange fails
- Verify client secret is correct
- Check B2C tenant name is exact
- Ensure user flow name matches

## Production Checklist

- [ ] Create production redirect URI
- [ ] Use separate client secret for production
- [ ] Enable MFA policy for sensitive apps
- [ ] Configure token lifetimes appropriately
- [ ] Set up monitoring in Azure
- [ ] Document user recovery process
- [ ] Test with various identity providers
- [ ] Configure conditional access policies

## Cost Considerations

Azure AD B2C pricing (as of 2024):
- First 50,000 MAU: Free
- After 50,000 MAU: ~$0.00325 per authentication

MAU = Monthly Active Users (users who authenticate at least once per month)

## Additional Resources

- [Azure AD B2C Documentation](https://docs.microsoft.com/azure/active-directory-b2c/)
- [User Flows vs Custom Policies](https://docs.microsoft.com/azure/active-directory-b2c/user-flow-overview)
- [Token Reference](https://docs.microsoft.com/azure/active-directory-b2c/tokens-overview)
- [Security Best Practices](https://docs.microsoft.com/azure/active-directory-b2c/security-overview)
