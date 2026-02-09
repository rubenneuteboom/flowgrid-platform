// =============================================================================
// Flowgrid Platform - Shared Utilities
// =============================================================================

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        break;
      }

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Structured logger factory
 */
export function createLogger(serviceName: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: serviceName,
        message,
        ...meta,
      }));
    },
    
    warn: (message: string, meta?: Record<string, unknown>) => {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: serviceName,
        message,
        ...meta,
      }));
    },
    
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: serviceName,
        message,
        error: error?.message,
        stack: error?.stack,
        ...meta,
      }));
    },
    
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'debug',
          service: serviceName,
          message,
          ...meta,
        }));
      }
    },
  };
}

/**
 * Safely parse JSON with a default value
 */
export function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Truncate string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Create a timeout promise that rejects after the specified time
 */
export function timeout<T>(promise: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}
