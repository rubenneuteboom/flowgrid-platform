// =============================================================================
// Rate Limiting Middleware
// =============================================================================

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { Request, Response } from 'express';
import config from '../config';

let redis: Redis | null = null;

/**
 * Initialize Redis connection for rate limiting
 */
export function initRateLimitRedis(): Redis | null {
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[rate-limit] Redis error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[rate-limit] Connected to Redis');
    });

    // Try to connect
    redis.connect().catch(() => {
      console.warn('[rate-limit] Redis connection failed, using memory store');
      redis = null;
    });

    return redis;
  } catch (error) {
    console.warn('[rate-limit] Redis not available, using memory store');
    return null;
  }
}

/**
 * Create a rate limiter with optional Redis backing
 */
function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyPrefix: string;
}) {
  const limiterOptions: Parameters<typeof rateLimit>[0] = {
    windowMs: options.windowMs,
    max: options.max,
    message: {
      error: 'Too Many Requests',
      message: options.message,
      retryAfter: Math.ceil(options.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      // Use IP address + endpoint for rate limiting
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      return `${options.keyPrefix}:${ip}`;
    },
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too Many Requests',
        message: options.message,
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
  };

  // Use Redis store if available
  if (redis) {
    try {
      limiterOptions.store = new RedisStore({
        // @ts-expect-error - Redis client type mismatch between ioredis and rate-limit-redis
        sendCommand: async (...args: string[]) => redis!.call(...args),
        prefix: `flowgrid:ratelimit:${options.keyPrefix}:`,
      });
    } catch (error) {
      console.warn('[rate-limit] Failed to create Redis store, using memory');
    }
  }

  return rateLimit(limiterOptions);
}

// =============================================================================
// Pre-configured Rate Limiters
// =============================================================================

/**
 * Login rate limiter - 5 attempts per 15 minutes
 */
export const loginLimiter = createRateLimiter({
  windowMs: config.rateLimits.login.windowMs,
  max: config.rateLimits.login.max,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  keyPrefix: 'login',
});

/**
 * Password reset rate limiter - 3 attempts per 15 minutes
 */
export const passwordLimiter = createRateLimiter({
  windowMs: config.rateLimits.password.windowMs,
  max: config.rateLimits.password.max,
  message: 'Too many password reset attempts. Please try again later.',
  keyPrefix: 'password',
});

/**
 * MFA rate limiter - 10 attempts per 15 minutes
 */
export const mfaLimiter = createRateLimiter({
  windowMs: config.rateLimits.mfa.windowMs,
  max: config.rateLimits.mfa.max,
  message: 'Too many MFA attempts. Please try again later.',
  keyPrefix: 'mfa',
});

/**
 * General API rate limiter - 100 requests per 15 minutes
 */
export const generalLimiter = createRateLimiter({
  windowMs: config.rateLimits.general.windowMs,
  max: config.rateLimits.general.max,
  message: 'Too many requests. Please slow down.',
  keyPrefix: 'general',
});

/**
 * Invite rate limiter - 10 invites per hour
 */
export const inviteLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many invite attempts. Please try again later.',
  keyPrefix: 'invite',
});

export default {
  initRateLimitRedis,
  loginLimiter,
  passwordLimiter,
  mfaLimiter,
  generalLimiter,
  inviteLimiter,
};
