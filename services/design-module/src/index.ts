/**
 * Design Module Service - Main Entry Point
 * 
 * ============================================================================
 * PLATFORM ARCHITECTURE (Gregor Hohpe's Principles)
 * ============================================================================
 * 
 * 1. OPTIONAL MODULE (not core platform)
 *    - Can be enabled/disabled per tenant
 *    - Provides rich agent management UI
 *    - Separate from core wizard onboarding
 * 
 * 2. SINGLE RESPONSIBILITY
 *    - Serves static UI for agent design/management
 *    - All data operations go through agent-service API
 *    - No direct database connections
 * 
 * 3. INDEPENDENTLY DEPLOYABLE
 *    - Self-contained service
 *    - Can be updated without affecting other services
 *    - Versioned separately from platform core
 * 
 * ============================================================================
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';

// ============================================================================
// Service Configuration
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3006;
const SERVICE_NAME = 'design-module';
const VERSION = '0.1.0';

// ============================================================================
// Middleware
// ============================================================================

// Security headers (relaxed for embedded scripts)
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for vis-network
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(morgan('combined'));

// ============================================================================
// Health Check (Platform Observability)
// ============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    version: VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    platformArchitecture: {
      principle: 'Hohpe Platform Strategy',
      role: 'Optional Design Module',
      dataSource: 'agent-service API',
      deploymentModel: 'independent',
    },
  });
});

// ============================================================================
// Static Files
// ============================================================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - serve index.html for all other routes
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
  console.log('  Role: Optional Agent Management UI Module');
  console.log('');
  console.log(`  Port:        ${PORT}`);
  console.log(`  Version:     ${VERSION}`);
  console.log(`  Data Source: agent-service API`);
  console.log('');
  console.log('  Features:');
  console.log('    • Agent network visualization (vis-network)');
  console.log('    • Agent detail panel with tabs');
  console.log('    • Relationship explorer');
  console.log('    • In-place editing');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});

export default app;
