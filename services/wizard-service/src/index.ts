/**
 * Wizard Service - Main Entry Point
 * 
 * ============================================================================
 * PLATFORM ARCHITECTURE (Gregor Hohpe's Principles)
 * ============================================================================
 * 
 * This service follows Hohpe's "Platform Strategy" framework:
 * 
 * 1. HARMONIZATION ENGINE (not service collection)
 *    - Standardizes the onboarding experience across all tenants
 *    - Consistent agent patterns, naming conventions, and capabilities
 *    - Single vocabulary for describing IT service management agents
 * 
 * 2. REAL ABSTRACTION (enables innovation)
 *    - Users describe capabilities in natural language or upload diagrams
 *    - AI complexity is hidden (GPT-4 Vision + Claude under the hood)
 *    - Clean API: analyze → review → apply
 * 
 * 3. FLOATING PLATFORM (shed redundant capabilities)
 *    - AI models can be swapped without API changes
 *    - Version tracking for reproducibility
 *    - Feature flags for experimental AI features (future)
 * 
 * 4. UTILITY-DRIVEN ADOPTION (not mandated)
 *    - Wizard is optional - users can create agents manually
 *    - Metrics tracked: time-to-first-agent, completion rate
 *    - Clear value proposition vs manual design
 * 
 * ============================================================================
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

// Services
import { checkDatabaseHealth, pool } from './services/database';
import { isAnthropicConfigured, isOpenAIConfigured, getCurrentModels } from './services/ai';

// Middleware
import { requireAuth, optionalAuth } from './middleware/auth';
import { setCsrfCookie, verifyCsrfToken, getCsrfTokenEndpoint } from './middleware/csrf';

// Routes
import analyzeRoutes from './routes/analyze';
import sessionRoutes from './routes/session';
import generateRoutes from './routes/generate';
import foundationsRoutes from './routes/foundations';
import identifyAgentsRoutes from './routes/identify-agents';

// ============================================================================
// Service Configuration
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3005;
const SERVICE_NAME = 'wizard-service';
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ============================================================================
// Security Middleware
// ============================================================================

// Helmet with strict Content Security Policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        'https://cdn.jsdelivr.net', // Chart.js, vis-network
        // Add nonce for inline scripts if needed (see below)
      ],
      scriptSrcAttr: ["'none'"], // Disable inline event handlers
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for inline styles (CSS-in-JS, etc.)
        'https://fonts.googleapis.com',
        'https://cdn.jsdelivr.net',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
      ],
      imgSrc: [
        "'self'",
        'data:', // For base64 images
        'blob:', // For blob URLs
      ],
      connectSrc: [
        "'self'",
        // Add API endpoints if different origin
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
    },
  },
  // HSTS - Force HTTPS for 1 year
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Prevent MIME type sniffing
  noSniff: true,
  // XSS filter
  xssFilter: true,
  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || (IS_PRODUCTION ? false : '*'),
  credentials: true, // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
}));

// Cookie parser (required for CSRF)
app.use(cookieParser());

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use(morgan('combined'));

// Set CSRF cookie on all requests
app.use(setCsrfCookie);

// Make database pool available to routes
app.locals.pool = pool;

// ============================================================================
// Health Check (Platform Observability)
// ============================================================================

app.get('/health', async (req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const models = getCurrentModels();

  if (dbHealthy) {
    res.json({
      status: 'ok',
      service: SERVICE_NAME,
      database: 'connected',
      aiProvider: AI_PROVIDER,
      anthropicConfigured: isAnthropicConfigured(),
      openaiConfigured: isOpenAIConfigured(),
      models: models.map(m => `${m.provider}/${m.model}`),
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      platformArchitecture: {
        principle: 'Hohpe Platform Strategy',
        role: 'Onboarding Harmonization Engine',
        adoptionModel: 'utility-driven',
      },
    });
  } else {
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      database: 'disconnected',
    });
  }
});

// ============================================================================
// CSRF Token Endpoint (public - no auth required)
// ============================================================================

app.get('/api/wizard/csrf-token', getCsrfTokenEndpoint);

// ============================================================================
// API Routes (protected by auth + CSRF)
// ============================================================================

// Rate limiting for expensive AI endpoints
const aiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests, please try again later.' },
});

const aiEndpoints = [
  '/api/wizard/analyze-text',
  '/api/wizard/upload-image',
  '/api/wizard/identify-agents',
  '/api/wizard/suggest-subprocess',
  '/api/wizard/generate-orchestrator-bpmn',
  '/api/wizard/generate-bpmn',
];
aiEndpoints.forEach(endpoint => app.use(endpoint, aiRateLimit));

// Apply authentication to all wizard API routes
app.use('/api/wizard', requireAuth);

// Apply CSRF protection to state-changing requests
app.use('/api/wizard', verifyCsrfToken);

// Session management routes (list, get, delete)
app.use('/api/wizard', sessionRoutes);

// Analysis routes (analyze-text, upload-image)
app.use('/api/wizard', analyzeRoutes);

// Generation routes (generate-network, generate-process, apply, suggest-interactions)
app.use('/api/wizard', generateRoutes);

// Foundation routes (CRUD for Discovery Wizard)
app.use('/api/wizard/foundations', foundationsRoutes);

// Agent identification routes (8-step Design Wizard)
app.use('/api/wizard', identifyAgentsRoutes);

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${SERVICE_NAME}] Error:`, err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableEndpoints: [
      'GET /health',
      'GET /api/wizard/patterns',
      'GET /api/wizard/sessions',
      'GET /api/wizard/sessions/:id',
      'DELETE /api/wizard/sessions/:id',
      'POST /api/wizard/analyze-text',
      'POST /api/wizard/upload-image',
      'POST /api/wizard/generate-network',
      'POST /api/wizard/generate-process',
      'POST /api/wizard/suggest-interactions',
      'POST /api/wizard/apply',
      'POST /api/wizard/identify-agents',
      'GET /api/wizard/foundations',
      'GET /api/wizard/foundations/:id',
      'POST /api/wizard/foundations',
      'PUT /api/wizard/foundations/:id',
      'DELETE /api/wizard/foundations/:id',
    ],
  });
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ${SERVICE_NAME} | Flowgrid Platform`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Platform Architecture: Hohpe "Platform Strategy"');
  console.log('  Role: Onboarding Harmonization Engine');
  console.log('');
  console.log(`  Port:               ${PORT}`);
  console.log(`  AI Provider:        ${AI_PROVIDER}`);
  console.log(`  Anthropic:          ${isAnthropicConfigured() ? '✓ configured' : '✗ not configured'}`);
  console.log(`  OpenAI Vision:      ${isOpenAIConfigured() ? '✓ configured' : '✗ not configured'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    POST /api/wizard/analyze-text      → Analyze text description');
  console.log('    POST /api/wizard/upload-image      → Analyze capability diagram');
  console.log('    POST /api/wizard/generate-network  → Filter/generate agents');
  console.log('    POST /api/wizard/apply             → Create agents in database');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${SERVICE_NAME}] Received SIGTERM, shutting down gracefully...`);
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${SERVICE_NAME}] Received SIGINT, shutting down gracefully...`);
  await pool.end();
  process.exit(0);
});

export default app;
