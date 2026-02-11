// =============================================================================
// Auth Service Configuration
// =============================================================================

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3002', 10),
  serviceName: 'auth-service',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid',
  
  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'flowgrid_jwt_secret_dev_CHANGE_IN_PRODUCTION',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m', // Short-lived access token
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', // Long-lived refresh token
  
  // Security
  bcryptRounds: 12,
  passwordMinLength: 8,
  
  // Token expiration
  inviteTokenExpiresHours: 72, // 3 days
  passwordResetExpiresMinutes: 60, // 1 hour
  
  // Rate limiting (relaxed for staging/dev)
  rateLimits: {
    login: { windowMs: 5 * 60 * 1000, max: 20 }, // 20 per 5 min
    password: { windowMs: 15 * 60 * 1000, max: 10 }, // 10 per 15 min
    mfa: { windowMs: 15 * 60 * 1000, max: 20 }, // 20 per 15 min
    general: { windowMs: 15 * 60 * 1000, max: 200 }, // 200 per 15 min
  },
  
  // Email (Resend)
  email: {
    apiKey: process.env.RESEND_API_KEY || 're_hQqNG19o_GDcJya125jySYbkQyLGnxy5N',
    from: process.env.EMAIL_FROM || 'Flowgrid <onboarding@resend.dev>',
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:8080',
  },
  
  // Azure AD B2C (Microsoft OAuth)
  azure: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
    tenantName: process.env.AZURE_B2C_TENANT_NAME || '', // e.g., 'flowgridb2c'
    policyName: process.env.AZURE_B2C_POLICY_NAME || 'B2C_1_signupsignin',
    redirectUri: process.env.AZURE_REDIRECT_URI || 'http://localhost:8080/api/auth/oauth/microsoft/callback',
  },
  
  // MFA
  mfa: {
    issuer: 'Flowgrid',
    backupCodeCount: 10,
  },
  
  // Cookie settings
  cookies: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

export default config;
