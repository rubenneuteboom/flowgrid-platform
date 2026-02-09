// =============================================================================
// Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/auth.utils';
import { Pool } from 'pg';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & { mfaEnabled?: boolean };
      tenantId?: string;
    }
  }
}

export function createAuthMiddleware(pool: Pool) {
  /**
   * Require valid JWT token
   */
  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'No token provided',
        });
      }

      const token = authHeader.substring(7);
      
      try {
        const decoded = verifyToken(token);
        
        // Only accept access tokens
        if (decoded.type !== 'access') {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid token type',
          });
        }

        // Verify user still exists and is active
        const userResult = await pool.query(
          'SELECT id, is_active, mfa_enabled FROM users WHERE id = $1',
          [decoded.userId]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'User not found or inactive',
          });
        }

        req.user = {
          ...decoded,
          mfaEnabled: userResult.rows[0].mfa_enabled,
        };
        req.tenantId = decoded.tenantId;
        
        next();
      } catch (error) {
        if ((error as Error).name === 'TokenExpiredError') {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Token expired',
            code: 'TOKEN_EXPIRED',
          });
        }
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token',
        });
      }
    } catch (error) {
      console.error('[auth-middleware] Error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
      });
    }
  };

  /**
   * Require admin role
   */
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    next();
  };

  /**
   * Require specific roles
   */
  const requireRoles = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Required role: ${roles.join(' or ')}`,
        });
      }

      next();
    };
  };

  /**
   * Optional auth - attach user if token present, but don't require it
   */
  const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        return next();
      }

      const token = authHeader.substring(7);
      
      try {
        const decoded = verifyToken(token);
        
        if (decoded.type === 'access') {
          const userResult = await pool.query(
            'SELECT id, is_active, mfa_enabled FROM users WHERE id = $1',
            [decoded.userId]
          );

          if (userResult.rows.length > 0 && userResult.rows[0].is_active) {
            req.user = {
              ...decoded,
              mfaEnabled: userResult.rows[0].mfa_enabled,
            };
            req.tenantId = decoded.tenantId;
          }
        }
      } catch {
        // Token invalid, continue without user
      }
      
      next();
    } catch (error) {
      next();
    }
  };

  return {
    requireAuth,
    requireAdmin,
    requireRoles,
    optionalAuth,
  };
}

export default createAuthMiddleware;
