/**
 * CSRF Protection Middleware for Wizard Service
 * 
 * Uses the double-submit cookie pattern:
 * 1. Server sets a random CSRF token in a cookie (httpOnly: false so JS can read it)
 * 2. Client must include that token in a header (X-CSRF-Token) with every state-changing request
 * 3. Server verifies the cookie and header match
 * 
 * This protects against CSRF because:
 * - An attacker's site can send cookies with requests (cookie auto-sent by browser)
 * - But an attacker CANNOT read the cookie due to same-origin policy
 * - So they cannot set the required header
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_COOKIE_NAME = 'flowgrid_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32;

// Methods that change state and need CSRF protection
const PROTECTED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Generate a cryptographically secure random token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Middleware to set CSRF cookie on every request (if not already set)
 */
export function setCsrfCookie(req: Request, res: Response, next: NextFunction) {
  // Check if cookie already exists
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateCsrfToken();

    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // JS needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', // Prevent cross-site sending
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    // Also expose token in response header for initial page load
    res.setHeader('X-CSRF-Token', token);
  }

  next();
}

/**
 * Middleware to verify CSRF token on state-changing requests
 */
export function verifyCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Skip non-state-changing methods
  if (!PROTECTED_METHODS.includes(req.method)) {
    return next();
  }

  // Skip if the request has a valid Authorization header (API clients don't need CSRF)
  // This is safe because:
  // 1. Authorization header cannot be set cross-origin without CORS preflight
  // 2. Attackers cannot steal the JWT to include it
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  if (!cookieToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF token missing from cookies',
      code: 'CSRF_COOKIE_MISSING',
    });
  }

  if (!headerToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF token missing from header',
      code: 'CSRF_HEADER_MISSING',
    });
  }

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF token mismatch',
      code: 'CSRF_TOKEN_MISMATCH',
    });
  }

  next();
}

/**
 * Endpoint to get a fresh CSRF token
 * Call this on page load if you need the token before any cookies are set
 */
export function getCsrfTokenEndpoint(req: Request, res: Response) {
  let token = req.cookies?.[CSRF_COOKIE_NAME];

  if (!token) {
    token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  res.json({ csrfToken: token });
}

export default { setCsrfCookie, verifyCsrfToken, getCsrfTokenEndpoint };
