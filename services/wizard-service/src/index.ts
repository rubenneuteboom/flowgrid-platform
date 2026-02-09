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

// Services
import { checkDatabaseHealth, pool } from './services/database';
import { isAnthropicConfigured, isOpenAIConfigured, getCurrentModels } from './services/ai';

// Routes
import analyzeRoutes from './routes/analyze';
import sessionRoutes from './routes/session';
import generateRoutes from './routes/generate';

// ============================================================================
// Service Configuration
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3005;
const SERVICE_NAME = 'wizard-service';
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';

// ============================================================================
// Middleware
// ============================================================================

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

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
// API Routes
// ============================================================================

// Session management routes (list, get, delete)
app.use('/api/wizard', sessionRoutes);

// Analysis routes (analyze-text, upload-image)
app.use('/api/wizard', analyzeRoutes);

// Generation routes (generate-network, generate-process, apply, suggest-interactions)
app.use('/api/wizard', generateRoutes);

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
