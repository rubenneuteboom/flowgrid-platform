// =============================================================================
// Flowgrid Auth Service - Enterprise Authentication
// =============================================================================

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';

import config from './config';
import createAuthMiddleware from './middleware/auth.middleware';
import {
  initRateLimitRedis,
  loginLimiter,
  passwordLimiter,
  mfaLimiter,
  inviteLimiter,
  generalLimiter,
} from './middleware/rate-limit.middleware';
import {
  generateSecureToken,
  hashToken,
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  generateMfaSecret,
  generateMfaQrCode,
  verifyMfaCode,
  generateBackupCodes,
  verifyBackupCode,
  isValidEmail,
  getClientIp,
  getUserAgent,
  getExpirationDate,
  getExpirationDateHours,
  isExpired,
} from './utils/auth.utils';
import {
  sendEmail,
  getInviteEmailTemplate,
  getPasswordResetEmailTemplate,
  getMfaSetupEmailTemplate,
  getWelcomeEmailTemplate,
  getSecurityAlertEmailTemplate,
} from './services/email.service';

const app = express();
const SERVICE_NAME = config.serviceName;

// Database connection
const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Initialize rate limiting with Redis
initRateLimitRedis();

// Initialize auth middleware
const { requireAuth, requireAdmin, requireRoles, optionalAuth } = createAuthMiddleware(pool);

// =============================================================================
// Middleware
// =============================================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('combined'));

// Apply general rate limiting to all routes
app.use('/api', generalLimiter);

// =============================================================================
// Audit Logging Helper
// =============================================================================

async function logAuthEvent(params: {
  userId?: string;
  tenantId?: string;
  action: string;
  status: 'success' | 'failure' | 'blocked';
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
}) {
  try {
    await pool.query(
      `INSERT INTO auth_audit_log (user_id, tenant_id, action, status, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId || null,
        params.tenantId || null,
        params.action,
        params.status,
        params.ipAddress || null,
        params.userAgent || null,
        JSON.stringify(params.details || {}),
      ]
    );
  } catch (error) {
    console.error('[audit] Failed to log event:', error);
  }
}

// =============================================================================
// Health Check
// =============================================================================

app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: SERVICE_NAME,
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =============================================================================
// LOGIN (with MFA support)
// =============================================================================

interface LoginRequest {
  email: string;
  password: string;
  mfaCode?: string;
}

app.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { email, password, mfaCode }: LoginRequest = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    // Look up user
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.tenant_id, 
              u.mfa_enabled, u.is_active, u.locked_until, u.failed_login_attempts,
              t.name as tenant_name, t.slug as tenant_slug
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      await logAuthEvent({
        action: 'login_attempt',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { email, reason: 'user_not_found' },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const user = userResult.rows[0];

    // Check if user is active
    if (!user.is_active) {
      await logAuthEvent({
        userId: user.id,
        tenantId: user.tenant_id,
        action: 'login_attempt',
        status: 'blocked',
        ipAddress,
        userAgent,
        details: { reason: 'account_disabled' },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Account is disabled',
      });
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logAuthEvent({
        userId: user.id,
        tenantId: user.tenant_id,
        action: 'login_attempt',
        status: 'blocked',
        ipAddress,
        userAgent,
        details: { reason: 'account_locked', locked_until: user.locked_until },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Account is temporarily locked. Please try again later.',
      });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      // Increment failed login attempts
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      let lockUntil = null;

      // Lock account after 5 failed attempts
      if (newAttempts >= 5) {
        lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [newAttempts, lockUntil, user.id]
      );

      await logAuthEvent({
        userId: user.id,
        tenantId: user.tenant_id,
        action: 'login_attempt',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { reason: 'invalid_password', attempts: newAttempts },
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check MFA if enabled
    if (user.mfa_enabled) {
      if (!mfaCode) {
        return res.status(200).json({
          mfaRequired: true,
          message: 'MFA code required',
        });
      }

      // Get MFA secret
      const mfaResult = await pool.query(
        'SELECT secret, backup_codes FROM mfa_secrets WHERE user_id = $1',
        [user.id]
      );

      if (mfaResult.rows.length === 0) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'MFA configuration error',
        });
      }

      const mfaSecret = mfaResult.rows[0];
      let mfaValid = verifyMfaCode(mfaSecret.secret, mfaCode);

      // If TOTP failed, try backup codes
      if (!mfaValid && mfaSecret.backup_codes) {
        const backupResult = await verifyBackupCode(mfaCode, mfaSecret.backup_codes);
        if (backupResult.valid) {
          mfaValid = true;
          // Remove used backup code
          const updatedCodes = [...mfaSecret.backup_codes];
          updatedCodes.splice(backupResult.usedIndex, 1);
          await pool.query(
            'UPDATE mfa_secrets SET backup_codes = $1 WHERE user_id = $2',
            [updatedCodes, user.id]
          );
        }
      }

      if (!mfaValid) {
        await logAuthEvent({
          userId: user.id,
          tenantId: user.tenant_id,
          action: 'mfa_verify',
          status: 'failure',
          ipAddress,
          userAgent,
        });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid MFA code',
        });
      }
    }

    // Reset failed attempts and update last login
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const refreshTokenHash = hashToken(refreshToken);

    // Store refresh token
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      `INSERT INTO refresh_tokens (token, user_id, expires_at, ip_address, device_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [refreshTokenHash, user.id, refreshExpires, ipAddress, JSON.stringify({ userAgent })]
    );

    await logAuthEvent({
      userId: user.id,
      tenantId: user.tenant_id,
      action: 'login',
      status: 'success',
      ipAddress,
      userAgent,
    });

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      ...config.cookies,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
      },
      expiresIn: config.jwtAccessExpiresIn,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Login error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process login',
    });
  }
});

// =============================================================================
// REFRESH TOKEN
// =============================================================================

app.post('/api/auth/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token required',
      });
    }

    // Verify the refresh token JWT
    let decoded;
    try {
      decoded = verifyToken(refreshToken);
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
    } catch (error) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid refresh token',
      });
    }

    // Check if token exists and is not revoked
    const tokenHash = hashToken(refreshToken);
    const tokenResult = await pool.query(
      `SELECT rt.*, u.is_active, u.role, u.email, u.tenant_id
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND NOT rt.revoked AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token expired or revoked',
      });
    }

    const storedToken = tokenResult.rows[0];

    if (!storedToken.is_active) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User account is disabled',
      });
    }

    // Generate new access token
    const tokenPayload = {
      userId: storedToken.user_id,
      email: storedToken.email,
      tenantId: storedToken.tenant_id,
      role: storedToken.role,
    };

    const newAccessToken = generateAccessToken(tokenPayload);

    res.json({
      accessToken: newAccessToken,
      expiresIn: config.jwtAccessExpiresIn,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Refresh error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to refresh token',
    });
  }
});

// =============================================================================
// LOGOUT
// =============================================================================

app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await pool.query(
        `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = 'logout'
         WHERE token = $1`,
        [tokenHash]
      );
    }

    // Optionally revoke all sessions
    if (req.body.revokeAll) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = 'logout_all'
         WHERE user_id = $1 AND NOT revoked`,
        [req.user!.userId]
      );
    }

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'logout',
      status: 'success',
      ipAddress,
      userAgent,
      details: { revokeAll: req.body.revokeAll },
    });

    // Clear cookie
    res.clearCookie('refreshToken');

    res.json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Logout error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to logout',
    });
  }
});

// =============================================================================
// VERIFY TOKEN
// =============================================================================

app.post('/api/auth/verify', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : req.body.token;

    if (!token) {
      return res.status(400).json({
        valid: false,
        error: 'Token is required',
      });
    }

    const decoded = verifyToken(token);

    // Verify user still exists and is active
    const userResult = await pool.query(
      'SELECT id, email, role, tenant_id, mfa_enabled FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        valid: false,
        error: 'User not found or inactive',
      });
    }

    res.json({
      valid: true,
      user: {
        id: decoded.userId,
        email: decoded.email,
        tenantId: decoded.tenantId,
        role: decoded.role,
        mfaEnabled: userResult.rows[0].mfa_enabled,
      },
    });
  } catch (error) {
    if ((error as Error).name === 'TokenExpiredError') {
      return res.status(401).json({
        valid: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }
    res.status(401).json({
      valid: false,
      error: 'Invalid token',
    });
  }
});

// =============================================================================
// GET CURRENT USER
// =============================================================================

app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.mfa_enabled, u.email_verified,
              t.id as tenant_id, t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [req.user!.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const user = userResult.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.created_at,
      mfaEnabled: user.mfa_enabled,
      emailVerified: user.email_verified,
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get user error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// =============================================================================
// INVITE SYSTEM
// =============================================================================

// Send invite
app.post('/api/auth/invite/send', requireAuth, requireAdmin, inviteLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { email, role = 'user' } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid email address required',
      });
    }

    // Check if user already exists in this tenant
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
      [email.toLowerCase(), req.user!.tenantId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
    }

    // Check for existing pending invite
    const existingInvite = await pool.query(
      `SELECT id FROM invite_tokens 
       WHERE email = $1 AND tenant_id = $2 AND NOT used AND expires_at > NOW()`,
      [email.toLowerCase(), req.user!.tenantId]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Pending invitation already exists for this email',
      });
    }

    // Generate invite token
    const token = generateSecureToken();
    const tokenHash = hashToken(token);
    const expiresAt = getExpirationDateHours(config.inviteTokenExpiresHours);

    await pool.query(
      `INSERT INTO invite_tokens (token, email, tenant_id, role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, email.toLowerCase(), req.user!.tenantId, role, req.user!.userId, expiresAt]
    );

    // Get inviter and tenant info for email
    const inviterResult = await pool.query(
      `SELECT u.name as inviter_name, t.name as org_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1`,
      [req.user!.userId]
    );

    const { inviter_name, org_name } = inviterResult.rows[0];

    // Send invite email
    const inviteUrl = `${config.email.baseUrl}/signup.html?token=${token}`;
    const emailTemplate = getInviteEmailTemplate({
      inviterName: inviter_name || 'An admin',
      organizationName: org_name,
      inviteUrl,
      expiresIn: `${config.inviteTokenExpiresHours} hours`,
    });

    await sendEmail({
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'invite_sent',
      status: 'success',
      ipAddress,
      userAgent,
      details: { invitedEmail: email, role },
    });

    res.json({
      message: 'Invitation sent successfully',
      email,
      expiresAt,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Send invite error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send invitation',
    });
  }
});

// Validate invite token
app.get('/api/auth/invite/validate/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tokenHash = hashToken(token);

    const inviteResult = await pool.query(
      `SELECT it.email, it.role, it.expires_at, t.name as tenant_name
       FROM invite_tokens it
       JOIN tenants t ON it.tenant_id = t.id
       WHERE it.token = $1 AND NOT it.used AND it.expires_at > NOW()`,
      [tokenHash]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({
        valid: false,
        error: 'Invalid or expired invitation',
      });
    }

    const invite = inviteResult.rows[0];
    res.json({
      valid: true,
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenant_name,
      expiresAt: invite.expires_at,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Validate invite error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Accept invite and create account
app.post('/api/auth/invite/accept', async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { token, name, password } = req.body;

    if (!token || !name || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token, name, and password are required',
      });
    }

    // Validate password strength
    const passwordCheck = checkPasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password does not meet requirements',
        feedback: passwordCheck.feedback,
      });
    }

    const tokenHash = hashToken(token);

    // Get and validate invite
    const inviteResult = await pool.query(
      `SELECT id, email, tenant_id, role, invited_by
       FROM invite_tokens
       WHERE token = $1 AND NOT used AND expires_at > NOW()`,
      [tokenHash]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Invalid or expired invitation',
      });
    }

    const invite = inviteResult.rows[0];

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
      [invite.email, invite.tenant_id]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Account already exists for this email',
      });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, tenant_id, email_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING id, email, name, role`,
      [invite.email, passwordHash, name, invite.role, invite.tenant_id]
    );

    const user = userResult.rows[0];

    // Mark invite as used
    await pool.query(
      'UPDATE invite_tokens SET used = true, used_at = NOW() WHERE id = $1',
      [invite.id]
    );

    // Get tenant info
    const tenantResult = await pool.query(
      'SELECT id, name, slug FROM tenants WHERE id = $1',
      [invite.tenant_id]
    );
    const tenant = tenantResult.rows[0];

    // Generate tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      tenantId: invite.tenant_id,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const refreshTokenHash = hashToken(refreshToken);

    // Store refresh token
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (token, user_id, expires_at, ip_address, device_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [refreshTokenHash, user.id, refreshExpires, ipAddress, JSON.stringify({ userAgent })]
    );

    await logAuthEvent({
      userId: user.id,
      tenantId: invite.tenant_id,
      action: 'account_created',
      status: 'success',
      ipAddress,
      userAgent,
      details: { invitedBy: invite.invited_by },
    });

    // Send welcome email
    const welcomeEmail = getWelcomeEmailTemplate({
      userName: name,
      organizationName: tenant.name,
      loginUrl: `${config.email.baseUrl}/login.html`,
    });

    await sendEmail({
      to: invite.email,
      subject: welcomeEmail.subject,
      html: welcomeEmail.html,
    });

    // Set refresh token cookie
    res.cookie('refreshToken', refreshToken, {
      ...config.cookies,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: 'Account created successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaEnabled: false,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Accept invite error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create account',
    });
  }
});

// =============================================================================
// PASSWORD RESET
// =============================================================================

// Request password reset
app.post('/api/auth/password/forgot', passwordLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid email address required',
      });
    }

    // Always return success to prevent email enumeration
    const successResponse = {
      message: 'If an account exists with this email, you will receive a password reset link',
    };

    // Look up user
    const userResult = await pool.query(
      `SELECT u.id, u.name, u.tenant_id
       FROM users u
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      // Log attempt but don't reveal user doesn't exist
      await logAuthEvent({
        action: 'password_reset_request',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { email, reason: 'user_not_found' },
      });
      return res.json(successResponse);
    }

    const user = userResult.rows[0];

    // Invalidate existing reset tokens
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND NOT used',
      [user.id]
    );

    // Generate reset token
    const token = generateSecureToken();
    const tokenHash = hashToken(token);
    const expiresAt = getExpirationDate(config.passwordResetExpiresMinutes);

    await pool.query(
      `INSERT INTO password_reset_tokens (token, user_id, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, user.id, expiresAt, ipAddress]
    );

    // Send reset email
    const resetUrl = `${config.email.baseUrl}/reset-password.html?token=${token}`;
    const emailTemplate = getPasswordResetEmailTemplate({
      userName: user.name || 'User',
      resetUrl,
      expiresIn: `${config.passwordResetExpiresMinutes} minutes`,
    });

    await sendEmail({
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    await logAuthEvent({
      userId: user.id,
      tenantId: user.tenant_id,
      action: 'password_reset_request',
      status: 'success',
      ipAddress,
      userAgent,
    });

    res.json(successResponse);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Password forgot error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process password reset request',
    });
  }
});

// Reset password with token
app.post('/api/auth/password/reset', passwordLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token and new password are required',
      });
    }

    // Validate password strength
    const passwordCheck = checkPasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password does not meet requirements',
        feedback: passwordCheck.feedback,
      });
    }

    const tokenHash = hashToken(token);

    // Get and validate reset token
    const tokenResult = await pool.query(
      `SELECT prt.id, prt.user_id, u.email, u.tenant_id
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1 AND NOT prt.used AND prt.expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Invalid or expired reset token',
      });
    }

    const resetToken = tokenResult.rows[0];

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = true, used_at = NOW() WHERE id = $1',
      [resetToken.id]
    );

    // Revoke all refresh tokens (force re-login)
    await pool.query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = 'password_reset'
       WHERE user_id = $1 AND NOT revoked`,
      [resetToken.user_id]
    );

    await logAuthEvent({
      userId: resetToken.user_id,
      tenantId: resetToken.tenant_id,
      action: 'password_reset',
      status: 'success',
      ipAddress,
      userAgent,
    });

    // Send security alert email
    const alertEmail = getSecurityAlertEmailTemplate({
      userName: 'User',
      alertType: 'Password Changed',
      details: 'Your password was successfully reset.',
      ipAddress,
      timestamp: new Date().toISOString(),
    });

    await sendEmail({
      to: resetToken.email,
      subject: alertEmail.subject,
      html: alertEmail.html,
    });

    res.json({
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Password reset error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset password',
    });
  }
});

// Change password (authenticated)
app.post('/api/auth/password/change', requireAuth, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current and new password are required',
      });
    }

    // Validate new password strength
    const passwordCheck = checkPasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password does not meet requirements',
        feedback: passwordCheck.feedback,
      });
    }

    // Get current password hash
    const userResult = await pool.query(
      'SELECT password_hash, email FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      await logAuthEvent({
        userId: req.user!.userId,
        tenantId: req.user!.tenantId,
        action: 'password_change',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { reason: 'invalid_current_password' },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Current password is incorrect',
      });
    }

    // Hash and update password
    const passwordHash = await hashPassword(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2',
      [passwordHash, req.user!.userId]
    );

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'password_change',
      status: 'success',
      ipAddress,
      userAgent,
    });

    // Send security alert
    const alertEmail = getSecurityAlertEmailTemplate({
      userName: 'User',
      alertType: 'Password Changed',
      details: 'Your password was changed.',
      ipAddress,
      timestamp: new Date().toISOString(),
    });

    await sendEmail({
      to: user.email,
      subject: alertEmail.subject,
      html: alertEmail.html,
    });

    res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Password change error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to change password',
    });
  }
});

// =============================================================================
// MFA (Multi-Factor Authentication)
// =============================================================================

// Setup MFA - Generate secret and QR code
app.post('/api/auth/mfa/setup', requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  try {
    // Check if MFA already enabled
    const userResult = await pool.query(
      'SELECT mfa_enabled, email FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (userResult.rows[0]?.mfa_enabled) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'MFA is already enabled',
      });
    }

    // Generate new secret
    const secret = generateMfaSecret();
    const qrCodeDataUrl = await generateMfaQrCode(req.user!.email, secret);

    // Store secret (not enabled yet)
    await pool.query(
      `INSERT INTO mfa_secrets (user_id, secret)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET secret = $2, updated_at = NOW()`,
      [req.user!.userId, secret]
    );

    res.json({
      secret,
      qrCode: qrCodeDataUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] MFA setup error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to setup MFA',
    });
  }
});

// Verify and enable MFA
app.post('/api/auth/mfa/verify', requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Verification code required',
      });
    }

    // Get MFA secret
    const mfaResult = await pool.query(
      'SELECT secret FROM mfa_secrets WHERE user_id = $1',
      [req.user!.userId]
    );

    if (mfaResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'MFA setup not initiated. Call /api/auth/mfa/setup first.',
      });
    }

    const secret = mfaResult.rows[0].secret;

    // Verify code
    if (!verifyMfaCode(secret, code)) {
      await logAuthEvent({
        userId: req.user!.userId,
        tenantId: req.user!.tenantId,
        action: 'mfa_enable',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { reason: 'invalid_code' },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid verification code',
      });
    }

    // Generate backup codes
    const { codes, hashedCodes } = await generateBackupCodes(config.mfa.backupCodeCount);

    // Enable MFA and store backup codes
    await pool.query(
      'UPDATE users SET mfa_enabled = true, mfa_verified_at = NOW() WHERE id = $1',
      [req.user!.userId]
    );

    await pool.query(
      'UPDATE mfa_secrets SET backup_codes = $1, backup_codes_generated_at = NOW() WHERE user_id = $2',
      [hashedCodes, req.user!.userId]
    );

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'mfa_enable',
      status: 'success',
      ipAddress,
      userAgent,
    });

    // Send confirmation email
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user!.userId]);
    const mfaEmail = getMfaSetupEmailTemplate({ userName: 'User' });
    await sendEmail({
      to: userResult.rows[0].email,
      subject: mfaEmail.subject,
      html: mfaEmail.html,
    });

    res.json({
      message: 'MFA enabled successfully',
      backupCodes: codes,
      warning: 'Save these backup codes securely. They will not be shown again.',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] MFA verify error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to enable MFA',
    });
  }
});

// Disable MFA
app.post('/api/auth/mfa/disable', requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { code, password } = req.body;

    if (!code || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'MFA code and password are required',
      });
    }

    // Verify password
    const userResult = await pool.query(
      'SELECT password_hash, email FROM users WHERE id = $1',
      [req.user!.userId]
    );

    const isPasswordValid = await verifyPassword(password, userResult.rows[0].password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid password',
      });
    }

    // Verify MFA code
    const mfaResult = await pool.query(
      'SELECT secret FROM mfa_secrets WHERE user_id = $1',
      [req.user!.userId]
    );

    if (mfaResult.rows.length === 0 || !verifyMfaCode(mfaResult.rows[0].secret, code)) {
      await logAuthEvent({
        userId: req.user!.userId,
        tenantId: req.user!.tenantId,
        action: 'mfa_disable',
        status: 'failure',
        ipAddress,
        userAgent,
        details: { reason: 'invalid_code' },
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid MFA code',
      });
    }

    // Disable MFA
    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_verified_at = NULL WHERE id = $1',
      [req.user!.userId]
    );

    // Delete MFA secret
    await pool.query('DELETE FROM mfa_secrets WHERE user_id = $1', [req.user!.userId]);

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'mfa_disable',
      status: 'success',
      ipAddress,
      userAgent,
    });

    // Send security alert
    const alertEmail = getSecurityAlertEmailTemplate({
      userName: 'User',
      alertType: 'Two-Factor Authentication Disabled',
      details: 'MFA was disabled on your account.',
      ipAddress,
      timestamp: new Date().toISOString(),
    });

    await sendEmail({
      to: userResult.rows[0].email,
      subject: alertEmail.subject,
      html: alertEmail.html,
    });

    res.json({
      message: 'MFA disabled successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] MFA disable error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to disable MFA',
    });
  }
});

// Generate new backup codes
app.post('/api/auth/mfa/backup-codes', requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'MFA code required',
      });
    }

    // Verify MFA code
    const mfaResult = await pool.query(
      'SELECT secret FROM mfa_secrets WHERE user_id = $1',
      [req.user!.userId]
    );

    if (mfaResult.rows.length === 0 || !verifyMfaCode(mfaResult.rows[0].secret, code)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid MFA code',
      });
    }

    // Generate new backup codes
    const { codes, hashedCodes } = await generateBackupCodes(config.mfa.backupCodeCount);

    await pool.query(
      'UPDATE mfa_secrets SET backup_codes = $1, backup_codes_generated_at = NOW() WHERE user_id = $2',
      [hashedCodes, req.user!.userId]
    );

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'mfa_backup_codes_regenerated',
      status: 'success',
      ipAddress,
      userAgent,
    });

    res.json({
      message: 'New backup codes generated',
      backupCodes: codes,
      warning: 'Save these backup codes securely. Your old codes are now invalid.',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Backup codes error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate backup codes',
    });
  }
});

// =============================================================================
// MICROSOFT OAUTH (Azure AD B2C)
// =============================================================================

// Get Microsoft OAuth URL
app.post('/api/auth/oauth/microsoft/url', async (req: Request, res: Response) => {
  try {
    if (!config.azure.clientId || !config.azure.tenantName) {
      // OAuth is optional in local/dev setups; return 200 so UI can feature-detect
      return res.json({
        configured: false,
        message: 'Microsoft OAuth not configured',
      });
    }

    const state = generateSecureToken(16);
    const nonce = generateSecureToken(16);

    // Store state for verification (in production, use Redis with TTL)
    // For now, we'll include it in the response for the client to verify

    const authUrl = new URL(
      `https://${config.azure.tenantName}.b2clogin.com/${config.azure.tenantName}.onmicrosoft.com/${config.azure.policyName}/oauth2/v2.0/authorize`
    );

    authUrl.searchParams.set('client_id', config.azure.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', config.azure.redirectUri);
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('response_mode', 'query');

    res.json({
      authUrl: authUrl.toString(),
      state,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] OAuth URL error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate OAuth URL',
    });
  }
});

// Microsoft OAuth callback
app.get('/api/auth/oauth/microsoft/callback', async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error(`[${SERVICE_NAME}] OAuth error:`, oauthError, error_description);
      return res.redirect(`${config.email.baseUrl}/login.html?error=oauth_failed`);
    }

    if (!code || !state) {
      return res.redirect(`${config.email.baseUrl}/login.html?error=invalid_callback`);
    }

    // Exchange code for tokens
    const tokenUrl = `https://${config.azure.tenantName}.b2clogin.com/${config.azure.tenantName}.onmicrosoft.com/${config.azure.policyName}/oauth2/v2.0/token`;

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.azure.clientId,
        client_secret: config.azure.clientSecret,
        code: code as string,
        redirect_uri: config.azure.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.error(`[${SERVICE_NAME}] Token exchange failed:`, await tokenResponse.text());
      return res.redirect(`${config.email.baseUrl}/login.html?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      id_token: string;
      expires_in: number;
      token_type: string;
    };

    // Decode ID token to get user info
    const idTokenPayload = JSON.parse(
      Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()
    );

    const {
      sub: providerAccountId,
      email: providerEmail,
      name,
      emails,
    } = idTokenPayload;

    const email = providerEmail || (emails && emails[0]) || null;

    if (!email) {
      return res.redirect(`${config.email.baseUrl}/login.html?error=no_email`);
    }

    // Check if user exists with this OAuth account
    const oauthResult = await pool.query(
      `SELECT oa.user_id, u.email, u.tenant_id, u.role, u.is_active, u.name
       FROM oauth_accounts oa
       JOIN users u ON oa.user_id = u.id
       WHERE oa.provider = 'microsoft' AND oa.provider_account_id = $1`,
      [providerAccountId]
    );

    let user;
    let tenant;

    if (oauthResult.rows.length > 0) {
      // Existing OAuth user - log in
      user = oauthResult.rows[0];

      if (!user.is_active) {
        return res.redirect(`${config.email.baseUrl}/login.html?error=account_disabled`);
      }

      // Get tenant info
      const tenantResult = await pool.query(
        'SELECT id, name, slug FROM tenants WHERE id = $1',
        [user.tenant_id]
      );
      tenant = tenantResult.rows[0];

      // Update OAuth tokens
      await pool.query(
        `UPDATE oauth_accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
         WHERE provider = 'microsoft' AND provider_account_id = $4`,
        [tokens.access_token, tokens.refresh_token, new Date(Date.now() + tokens.expires_in * 1000), providerAccountId]
      );

      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.user_id]);
    } else {
      // Check if user exists by email
      const userByEmail = await pool.query(
        `SELECT u.id, u.email, u.tenant_id, u.role, u.is_active, u.name, t.name as tenant_name, t.slug
         FROM users u
         JOIN tenants t ON u.tenant_id = t.id
         WHERE u.email = $1`,
        [email.toLowerCase()]
      );

      if (userByEmail.rows.length > 0) {
        // Link OAuth to existing account
        user = userByEmail.rows[0];

        if (!user.is_active) {
          return res.redirect(`${config.email.baseUrl}/login.html?error=account_disabled`);
        }

        await pool.query(
          `INSERT INTO oauth_accounts (user_id, provider, provider_account_id, provider_email, access_token, refresh_token, token_expires_at)
           VALUES ($1, 'microsoft', $2, $3, $4, $5, $6)`,
          [user.id, providerAccountId, email, tokens.access_token, tokens.refresh_token, new Date(Date.now() + tokens.expires_in * 1000)]
        );

        tenant = { id: user.tenant_id, name: user.tenant_name, slug: user.slug };

        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        await logAuthEvent({
          userId: user.id,
          tenantId: user.tenant_id,
          action: 'oauth_account_linked',
          status: 'success',
          ipAddress,
          userAgent,
          details: { provider: 'microsoft' },
        });
      } else {
        // No account - redirect to invite flow
        // Microsoft OAuth can only be used for existing users or invite-based registration
        return res.redirect(`${config.email.baseUrl}/login.html?error=no_account&email=${encodeURIComponent(email)}`);
      }
    }

    // Generate tokens
    const tokenPayload = {
      userId: user.user_id || user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const refreshTokenHash = hashToken(refreshToken);

    // Store refresh token
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (token, user_id, expires_at, ip_address, device_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [refreshTokenHash, user.user_id || user.id, refreshExpires, ipAddress, JSON.stringify({ userAgent, provider: 'microsoft' })]
    );

    await logAuthEvent({
      userId: user.user_id || user.id,
      tenantId: user.tenant_id,
      action: 'oauth_login',
      status: 'success',
      ipAddress,
      userAgent,
      details: { provider: 'microsoft' },
    });

    // Redirect with tokens (in production, use a more secure method like setting cookies and redirecting)
    res.redirect(`${config.email.baseUrl}/index.html?accessToken=${accessToken}&refreshToken=${refreshToken}`);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] OAuth callback error:`, error);
    res.redirect(`${config.email.baseUrl}/login.html?error=server_error`);
  }
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

// List users
app.get('/api/auth/admin/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search, role, active } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    // Build WHERE clause
    let whereClause = 'WHERE u.tenant_id = $1';
    const params: any[] = [req.user!.tenantId];
    let paramCount = 1;

    if (search) {
      paramCount++;
      whereClause += ` AND (u.email ILIKE $${paramCount} OR u.name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (role) {
      paramCount++;
      whereClause += ` AND u.role = $${paramCount}`;
      params.push(role);
    }

    if (active !== undefined) {
      paramCount++;
      whereClause += ` AND u.is_active = $${paramCount}`;
      params.push(active === 'true');
    }

    // Count total (using same params without pagination)
    const countQuery = `SELECT COUNT(*) FROM users u ${whereClause}`;
    const countResult = await pool.query(countQuery, [...params]);

    // Build full query with pagination
    const selectQuery = `
      SELECT u.id, u.email, u.name, u.role, u.is_active, u.mfa_enabled, 
             u.email_verified, u.last_login_at, u.created_at
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    
    const usersResult = await pool.query(selectQuery, [...params, Number(limit), offset]);

    res.json({
      users: usersResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(countResult.rows[0].count / Number(limit)),
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] List users error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Disable user
app.post('/api/auth/admin/users/:id/disable', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Prevent self-disable
    if (id === req.user!.userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot disable your own account',
      });
    }

    // Verify user belongs to same tenant
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2',
      [id, req.user!.tenantId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Disable user
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [id]);

    // Revoke all refresh tokens
    await pool.query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = 'account_disabled'
       WHERE user_id = $1 AND NOT revoked`,
      [id]
    );

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'user_disabled',
      status: 'success',
      ipAddress,
      userAgent,
      details: { targetUserId: id, reason },
    });

    res.json({
      message: 'User disabled successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Disable user error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Enable user
app.post('/api/auth/admin/users/:id/enable', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { id } = req.params;

    // Verify user belongs to same tenant
    const userResult = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
      [id, req.user!.tenantId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [id]);

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'user_enabled',
      status: 'success',
      ipAddress,
      userAgent,
      details: { targetUserId: id },
    });

    res.json({
      message: 'User enabled successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Enable user error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Reset user's MFA
app.post('/api/auth/admin/users/:id/reset-mfa', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { id } = req.params;

    // Verify user belongs to same tenant
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2',
      [id, req.user!.tenantId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Disable MFA
    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_verified_at = NULL WHERE id = $1',
      [id]
    );

    // Delete MFA secret
    await pool.query('DELETE FROM mfa_secrets WHERE user_id = $1', [id]);

    await logAuthEvent({
      userId: req.user!.userId,
      tenantId: req.user!.tenantId,
      action: 'admin_mfa_reset',
      status: 'success',
      ipAddress,
      userAgent,
      details: { targetUserId: id },
    });

    // Notify user
    const alertEmail = getSecurityAlertEmailTemplate({
      userName: 'User',
      alertType: 'MFA Reset by Administrator',
      details: 'An administrator has reset your two-factor authentication. You will need to set it up again.',
      ipAddress,
      timestamp: new Date().toISOString(),
    });

    await sendEmail({
      to: userResult.rows[0].email,
      subject: alertEmail.subject,
      html: alertEmail.html,
    });

    res.json({
      message: 'User MFA reset successfully',
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Reset MFA error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// Get auth audit log
app.get('/api/auth/admin/audit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 50, userId, action, status, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT aal.id, aal.user_id, u.email as user_email, aal.action, aal.status,
             aal.ip_address, aal.user_agent, aal.details, aal.created_at
      FROM auth_audit_log aal
      LEFT JOIN users u ON aal.user_id = u.id
      WHERE aal.tenant_id = $1
    `;
    const params: any[] = [req.user!.tenantId];
    let paramCount = 1;

    if (userId) {
      paramCount++;
      query += ` AND aal.user_id = $${paramCount}`;
      params.push(userId);
    }

    if (action) {
      paramCount++;
      query += ` AND aal.action = $${paramCount}`;
      params.push(action);
    }

    if (status) {
      paramCount++;
      query += ` AND aal.status = $${paramCount}`;
      params.push(status);
    }

    if (startDate) {
      paramCount++;
      query += ` AND aal.created_at >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND aal.created_at <= $${paramCount}`;
      params.push(endDate);
    }

    // Count total
    const countResult = await pool.query(
      query.replace(/SELECT aal\.id.*FROM/, 'SELECT COUNT(*) FROM'),
      params
    );

    // Get paginated results
    query += ` ORDER BY aal.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(Number(limit), offset);

    const auditResult = await pool.query(query, params);

    res.json({
      events: auditResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(countResult.rows[0].count / Number(limit)),
      },
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Audit log error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// =============================================================================
// TENANT INFO
// =============================================================================

app.get('/api/auth/tenant', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantResult = await pool.query(
      'SELECT id, name, slug, tier, settings, created_at FROM tenants WHERE id = $1',
      [req.user!.tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Tenant not found',
      });
    }

    const tenant = tenantResult.rows[0];
    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tier: tenant.tier,
      settings: tenant.settings,
      createdAt: tenant.created_at,
    });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Get tenant error:`, error);
    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(config.port, () => {
  console.log(`[${SERVICE_NAME}] Running on port ${config.port}`);
  console.log(`[${SERVICE_NAME}] Health check: http://localhost:${config.port}/health`);
  console.log(`[${SERVICE_NAME}] Environment: ${config.nodeEnv}`);
});

export default app;
