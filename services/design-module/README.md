# 🎨 Design Studio

Agent Management UI for the Flowgrid Platform.

## Overview

The Design Studio is a **separate, optional service** that provides a rich UI for managing agents after they've been created through the Wizard. It follows Hohpe's platform architecture principles:

- **Independently deployable** - Can be updated without affecting other services
- **Optional module** - Can be enabled/disabled per tenant
- **No direct database access** - All data flows through agent-service API
- **Single responsibility** - Serves UI only, no business logic

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Flowgrid Platform                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Wizard     │    │   Design     │    │   Agent      │      │
│  │   Service    │    │   Module     │    │   Service    │      │
│  │   (3005)     │    │   (3006)     │    │   (3001)     │      │
│  │              │    │              │    │              │      │
│  │  Onboarding  │    │  Management  │──▶│   Data API   │      │
│  │     UI       │    │     UI       │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   ▲               │
│         │                   └───────────────────┘               │
│         │                        API calls                      │
│         │                                                       │
│         └─── "Create agents" ───▶ "Manage agents" ─────────────┤
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Agent Network Visualization** - Interactive graph using vis-network
- **Element Browser** - Sidebar with search and filtering
- **Detail Panel with Tabs**:
  - 📋 Overview - Basic agent configuration
  - 🎯 Objectives - Goals and KPIs
  - 🔌 Integrations - Connected services
  - 🔗 Relations - Incoming/outgoing relationships
  - 🤖 Code - Generated system prompt

## Technology Stack

- **Express.js** - Lightweight HTTP server
- **vis-network** - Graph visualization (CDN)
- **Static HTML/CSS/JS** - No framework dependencies
- **TypeScript** - Type-safe server code

## Development

```bash
# Navigate to service directory
cd services/design-module

# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3006 | HTTP server port |
| `NODE_ENV` | development | Environment mode |
| `AGENT_SERVICE_URL` | http://localhost:3001 | Agent service API URL |

## API Integration

The Design Studio makes these calls to agent-service:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List all agents |
| `/api/agents/:id` | GET | Get agent details |
| `/api/agents/:id` | PUT | Update agent |
| `/api/agents/:id` | DELETE | Delete agent |
| `/api/agents/relationships` | GET | List relationships |

## Docker

```bash
# Build image
docker build -t flowgrid/design-module .

# Run container
docker run -p 3006:3006 flowgrid/design-module
```

## Nginx Gateway Route

The Design Studio is accessible at `/design` through the nginx gateway:

```nginx
location /design {
    proxy_pass http://design-module;
    # ... proxy headers
}
```

Access at: `http://localhost:8080/design`

## Platform Architecture Notes

Following Gregor Hohpe's platform principles:

1. **Real Abstraction** - The UI abstracts agent management complexity
2. **Utility-Driven Adoption** - Users choose to use it, not mandated
3. **Floating Platform** - Can evolve independently of core services
4. **Harmonization Engine** - Provides consistent agent management experience

## Related Services

| Service | Port | Purpose |
|---------|------|---------|
| Wizard Service | 3005 | Agent onboarding (creates agents) |
| Design Studio | 3006 | Agent management (manages agents) |
| Agent Service | 3001 | Data API (stores/retrieves agents) |
