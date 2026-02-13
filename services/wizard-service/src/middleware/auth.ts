/**
 * Authentication Middleware for Wizard Service
 * 
 * Validates JWT tokens against the auth-service.
 * Extracts tenantId from the verified token (never trust client-provided).
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Token payload structure (must match auth-service)
export interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      tenantId?: string;
    }
  }
}

// JWT secret from environment (must match auth-service)
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required but not set');
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verify a JWT token
 */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

/**
 * Require valid JWT token - returns 401 if missing/invalid
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided. Please log in.',
        code: 'NO_TOKEN',
      });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = verifyToken(token);

      // Only accept access tokens (not refresh tokens)
      if (decoded.type !== 'access') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token type',
          code: 'INVALID_TOKEN_TYPE',
        });
      }

      // Attach user info to request
      req.user = decoded;
      // IMPORTANT: Use tenantId from JWT, never trust client-provided tenantId
      req.tenantId = decoded.tenantId;

      next();
    } catch (error) {
      if ((error as Error).name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token expired. Please log in again.',
          code: 'TOKEN_EXPIRED',
        });
      }
      if ((error as Error).name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token',
          code: 'INVALID_TOKEN',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[wizard-auth] Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication error',
    });
  }
}

/**
 * Optional auth - attach user if token present, but don't require it
 * Useful for endpoints that work with/without auth (with limited functionality)
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);

    try {
      const decoded = verifyToken(token);

      if (decoded.type === 'access') {
        req.user = decoded;
        req.tenantId = decoded.tenantId;
      }
    } catch {
      // Token invalid, continue without user
    }

    next();
  } catch {
    next();
  }
}

/**
 * Require specific roles (e.g., admin)
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Required role: ${roles.join(' or ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    next();
  };
}

export default { requireAuth, optionalAuth, requireRoles, verifyToken };
