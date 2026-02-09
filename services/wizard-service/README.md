# Wizard Service

**Agent Network Wizard - Onboarding Harmonization Engine**

Part of the [Flowgrid Platform](../../README.md) for multi-agent IT service management.

## Overview

The wizard-service provides AI-powered onboarding that transforms capability models into agent networks. Following Gregor Hohpe's Platform Strategy, it acts as a **harmonization engine** that standardizes how organizations design their agent architectures.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your API keys

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

## API Endpoints

### Analysis

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wizard/analyze-text` | POST | Analyze text description → agent recommendations |
| `/api/wizard/upload-image` | POST | Analyze capability diagram → agent recommendations |

### Session Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wizard/sessions` | GET | List wizard sessions |
| `/api/wizard/sessions/:id` | GET | Get session details |
| `/api/wizard/sessions/:id` | DELETE | Delete session |

### Generation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wizard/generate-network` | POST | Generate filtered agent network |
| `/api/wizard/generate-process` | POST | Generate process flow for agent |
| `/api/wizard/suggest-interactions` | POST | AI-suggested agent interactions |
| `/api/wizard/apply` | POST | Apply session → create agents |

### Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wizard/patterns` | GET | Get agentic patterns reference |
| `/health` | GET | Service health check |

## Typical Flow

```
1. Upload Diagram
   POST /api/wizard/upload-image
   → Returns: sessionId, analysis with recommended agents

2. Review & Customize
   GET /api/wizard/sessions/:id
   → Review recommended agents, patterns, capabilities

3. Filter (Optional)
   POST /api/wizard/generate-network
   → Filter agents by selected capabilities

4. Apply
   POST /api/wizard/apply
   → Creates agents in PostgreSQL database
```

## Architecture

```
src/
├── index.ts              # Main server + health check
├── routes/
│   ├── analyze.ts        # Text and image analysis
│   ├── session.ts        # Session management
│   └── generate.ts       # Network generation and apply
├── services/
│   ├── ai.ts             # AI provider abstraction
│   ├── database.ts       # PostgreSQL operations
│   └── patterns.ts       # Agentic patterns reference
└── types/
    └── wizard.ts         # TypeScript interfaces
```

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Service port (default: 3005) | No |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `OPENAI_API_KEY` | GPT-4 Vision API key | Yes* |
| `AI_PROVIDER` | Primary AI provider | No |

*Required for image analysis

## AI Models Used

| Model | Provider | Purpose |
|-------|----------|---------|
| `gpt-4o` | OpenAI | Image analysis (Vision) |
| `claude-sonnet-4-20250514` | Anthropic | Agent design |

## Database Tables

| Table | Purpose |
|-------|---------|
| `wizard_sessions` | Stores analysis sessions |
| `agents` | Created agents (output) |
| `agent_capabilities` | Agent capabilities |
| `agent_interactions` | Agent relationships |
| `agent_integrations` | External system integrations |

## Platform Architecture

See [PLATFORM-ARCHITECTURE.md](./PLATFORM-ARCHITECTURE.md) for detailed documentation on how this service implements Gregor Hohpe's Platform Strategy principles.

## Docker

```bash
# Build
docker build -t flowgrid/wizard-service .

# Run
docker run -p 3005:3005 \
  -e DATABASE_URL=postgres://... \
  -e ANTHROPIC_API_KEY=... \
  -e OPENAI_API_KEY=... \
  flowgrid/wizard-service
```

## Testing

```bash
# Run tests
npm test

# Health check
curl http://localhost:3005/health

# Example: Analyze text
curl -X POST http://localhost:3005/api/wizard/analyze-text \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: demo-tenant" \
  -d '{"description": "IT service desk with incident and change management"}'
```

## License

Copyright © 2024 Flowgrid Platform. All rights reserved.
