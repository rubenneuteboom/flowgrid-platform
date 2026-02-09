// =============================================================================
// Authentication Utilities
// =============================================================================

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';
import config from '../config';

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generate a URL-safe token
 */
export function generateUrlSafeToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage (don't store plaintext tokens)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// =============================================================================
// Password Utilities
// =============================================================================

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check password strength using zxcvbn-style rules
 */
export function checkPasswordStrength(password: string): {
  valid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length < 8) {
    feedback.push('Password must be at least 8 characters long');
  } else if (password.length >= 12) {
    score += 2;
  } else {
    score += 1;
  }

  // Uppercase check
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add uppercase letters for a stronger password');
  }

  // Lowercase check
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add lowercase letters for a stronger password');
  }

  // Number check
  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add numbers for a stronger password');
  }

  // Special character check
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add special characters for a stronger password');
  }

  // Common patterns check
  const commonPatterns = [
    /^123456/, /password/i, /qwerty/i, /abc123/i,
    /letmein/i, /welcome/i, /admin/i, /login/i
  ];
  if (commonPatterns.some(pattern => pattern.test(password))) {
    score = Math.max(0, score - 2);
    feedback.push('Avoid common password patterns');
  }

  return {
    valid: password.length >= 8 && score >= 3,
    score: Math.min(score, 5),
    feedback,
  };
}

// =============================================================================
// JWT Utilities
// =============================================================================

export interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  type: 'access' | 'refresh';
}

/**
 * Generate an access token (short-lived)
 */
export function generateAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    config.jwtSecret,
    { expiresIn: config.jwtAccessExpiresIn } as jwt.SignOptions
  );
}

/**
 * Generate a refresh token (long-lived)
 */
export function generateRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: config.jwtRefreshExpiresIn } as jwt.SignOptions
  );
}

/**
 * Verify a JWT token
 */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
}

/**
 * Decode a JWT without verification (for inspection)
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}

// =============================================================================
// MFA (TOTP) Utilities
// =============================================================================

/**
 * Generate a new TOTP secret (Base32 encoded)
 */
export function generateMfaSecret(): string {
  // Generate 20 random bytes and encode as Base32
  const buffer = crypto.randomBytes(20);
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;
  
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      result += base32chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  
  if (bits > 0) {
    result += base32chars[(value << (5 - bits)) & 31];
  }
  
  return result;
}

/**
 * Generate a QR code data URL for authenticator apps
 */
export async function generateMfaQrCode(email: string, secret: string): Promise<string> {
  const otpauth = `otpauth://totp/${encodeURIComponent(config.mfa.issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(config.mfa.issuer)}&algorithm=SHA1&digits=6&period=30`;
  return QRCode.toDataURL(otpauth);
}

/**
 * Decode Base32 to bytes
 */
function base32Decode(input: string): Buffer {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  
  for (const char of cleanInput) {
    const index = base32chars.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  
  return Buffer.from(output);
}

/**
 * Generate TOTP code for a given time
 */
function generateTOTP(secret: string, time: number): string {
  const counter = Math.floor(time / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();
  
  const offset = hash[hash.length - 1] & 0x0f;
  const code = ((hash[offset] & 0x7f) << 24 |
                (hash[offset + 1] & 0xff) << 16 |
                (hash[offset + 2] & 0xff) << 8 |
                (hash[offset + 3] & 0xff)) % 1000000;
  
  return code.toString().padStart(6, '0');
}

/**
 * Verify a TOTP code (allows 1 step drift in each direction)
 */
export function verifyMfaCode(secret: string, code: string): boolean {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // Check current time and ±1 time step (30 seconds each)
    for (let i = -1; i <= 1; i++) {
      const expectedCode = generateTOTP(secret, now + i * 30);
      if (expectedCode === code.padStart(6, '0')) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Generate backup codes for MFA
 */
export async function generateBackupCodes(count: number = 10): Promise<{
  codes: string[];
  hashedCodes: string[];
}> {
  const codes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
    hashedCodes.push(await bcrypt.hash(code, 10));
  }

  return { codes, hashedCodes };
}

/**
 * Verify a backup code
 */
export async function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): Promise<{ valid: boolean; usedIndex: number }> {
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(code.toUpperCase(), hashedCodes[i])) {
      return { valid: true, usedIndex: i };
    }
  }
  return { valid: false, usedIndex: -1 };
}

// =============================================================================
// Email Validation
// =============================================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Get client IP from request
 */
export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ips.trim();
  }
  return req.ip || 'unknown';
}

/**
 * Get user agent from request
 */
export function getUserAgent(req: { headers: Record<string, string | string[] | undefined> }): string {
  const ua = req.headers['user-agent'];
  return (Array.isArray(ua) ? ua[0] : ua) || 'unknown';
}

// =============================================================================
// Date/Time Helpers
// =============================================================================

/**
 * Get expiration date
 */
export function getExpirationDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Get expiration date in hours
 */
export function getExpirationDateHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Check if a date has expired
 */
export function isExpired(date: Date): boolean {
  return new Date(date) < new Date();
}

export default {
  generateSecureToken,
  generateUrlSafeToken,
  hashToken,
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
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
};
