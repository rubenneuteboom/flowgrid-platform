# Flowgrid Platform

A multi-tenant, AI-powered IT Service Management platform for designing, deploying, and managing agent-based automation systems.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      nginx Gateway (8080)                        │
│                  Rate limiting, routing, load balancing          │
└────────────┬──────────────┬──────────────┬──────────────┬───────┘
             │              │              │              │
    ┌────────▼────────┐ ┌───▼────┐ ┌──────▼─────┐ ┌──────▼──────┐
    │  agent-service  │ │  auth  │ │   design   │ │ integration │
    │     (3001)      │ │ (3002) │ │   (3003)   │ │   (3004)    │
    │   Agent CRUD    │ │  JWT   │ │ Claude AI  │ │ ServiceNow  │
    └────────┬────────┘ └───┬────┘ └──────┬─────┘ └──────┬──────┘
             │              │              │              │
    ┌────────▼──────────────▼──────────────▼──────────────▼──────┐
    │                    PostgreSQL (5432)                        │
    │              flowgrid database - multi-tenant               │
    └─────────────────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────────────────┐
    │                      Redis (6379)                            │
    │                  Caching & session store                     │
    └─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- npm

### 1. Start Infrastructure

```bash
cd infrastructure
docker compose up -d postgres redis
```

### 2. Run Database Migrations

```bash
docker cp migrations/001_initial_schema.sql flowgrid-postgres:/tmp/
docker exec flowgrid-postgres psql -U flowgrid -d flowgrid -f /tmp/001_initial_schema.sql

# Seed demo data
docker cp seed-dev-data.sql flowgrid-postgres:/tmp/
docker exec flowgrid-postgres psql -U flowgrid -d flowgrid -f /tmp/seed-dev-data.sql
```

### 3. Start Services

```bash
# Terminal 1 - Agent Service
cd services/agent-service
DATABASE_URL="postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid" npm run dev

# Terminal 2 - Auth Service
cd services/auth-service
DATABASE_URL="postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid" \
JWT_SECRET="your-secret-key" npm run dev

# Terminal 3 - Design Service
cd services/design-service
DATABASE_URL="postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid" \
ANTHROPIC_API_KEY="your-api-key" npm run dev

# Terminal 4 - Integration Service
cd services/integration-service
DATABASE_URL="postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid" npm run dev
```

### 4. Start Gateway

```bash
cd infrastructure
docker run -d --name flowgrid-gateway --rm -p 8080:80 \
  -v $(pwd)/nginx/nginx-local.conf:/etc/nginx/nginx.conf:ro \
  nginx:alpine
```

## 📡 API Endpoints

### Gateway (http://localhost:8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Gateway health check |

### Auth Service (/api/auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login and get JWT token |
| `/api/auth/verify` | POST | Verify JWT token |
| `/api/auth/me` | GET | Get current user (requires Bearer token) |
| `/api/auth/tenant` | GET | Get tenant info (requires Bearer token) |

**Login Example:**
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@flowgrid.io","password":"demo123"}'
```

### Agent Service (/api/agents)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List all agents |
| `/api/agents/:id` | GET | Get agent by ID |
| `/api/agents` | POST | Create new agent |
| `/api/agents/:id` | PUT | Update agent |
| `/api/agents/:id` | DELETE | Delete agent |
| `/api/agents/:id/capabilities` | POST | Add capability to agent |

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `type` - Filter by agent type
- `status` - Filter by status

### Design Service (/api/design)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/design/analyze-model` | POST | AI analysis of capability model |
| `/api/design/generate-code/:agentId` | POST | Generate agent code |
| `/api/design/suggest-interactions` | POST | AI-suggested agent interactions |
| `/api/design/chat` | POST | Chat with AI assistant |

**AI Chat Example:**
```bash
curl -X POST http://localhost:8080/api/design/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How should I design an incident management agent?"}'
```

### Integration Service (/api/integrations)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/integrations/catalog` | GET | List available integrations |
| `/api/integrations/catalog/:name` | GET | Get integration details |
| `/api/integrations/servicenow/test` | POST | Test ServiceNow connection |
| `/api/integrations/servicenow/incidents` | POST | Create ServiceNow incident |
| `/api/integrations/jira/test` | POST | Test Jira connection |
| `/api/integrations/jira/issues` | POST | Create Jira issue |
| `/api/integrations/github/test` | POST | Test GitHub connection |
| `/api/integrations/agent/:agentId/status` | GET | Get agent's integration status |

## 🗄️ Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `tenants` | Multi-tenant organizations |
| `users` | User accounts within tenants |
| `agents` | AI/automation agents per tenant |
| `agent_capabilities` | Capabilities/skills each agent has |
| `agent_interactions` | Communication patterns between agents |
| `agent_integrations` | External system integrations |
| `audit_log` | Audit trail for compliance |

### Key Relationships

```
tenants (1) ─────► (N) users
tenants (1) ─────► (N) agents
agents (1) ──────► (N) agent_capabilities
agents (1) ──────► (N) agent_integrations
agents (N) ◄─────► (N) agent_interactions
```

## 🔐 Authentication

The platform uses JWT tokens for authentication:

1. Login with email/password → Receive JWT token
2. Include token in requests: `Authorization: Bearer <token>`
3. Tokens expire after 24 hours (configurable)

**Demo Credentials:**
- Email: `demo@flowgrid.io`
- Password: `demo123`

## 🧪 Testing

### Health Checks

```bash
# All services
curl http://localhost:3001/health  # agent-service
curl http://localhost:3002/health  # auth-service
curl http://localhost:3003/health  # design-service
curl http://localhost:3004/health  # integration-service
curl http://localhost:8080/health  # gateway
```

### Full Stack Test

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@flowgrid.io","password":"demo123"}' | jq -r '.token')

# 2. List agents
curl -s http://localhost:8080/api/agents \
  -H "Authorization: Bearer $TOKEN"

# 3. Get integrations
curl -s http://localhost:8080/api/integrations/catalog
```

## 📁 Project Structure

```
flowgrid-platform/
├── infrastructure/
│   ├── docker-compose.yml
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   ├── seed-dev-data.sql
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── nginx-local.conf
│   └── .env
├── services/
│   ├── agent-service/      # Agent CRUD operations
│   ├── auth-service/       # JWT authentication
│   ├── design-service/     # AI-powered design tools
│   └── integration-service/ # External system integrations
└── README.md
```

## 🔧 Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `DATABASE_URL` | All | PostgreSQL connection string |
| `REDIS_URL` | All | Redis connection string |
| `JWT_SECRET` | auth | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | auth | Token expiration (e.g., "1d") |
| `ANTHROPIC_API_KEY` | design | Claude API key |
| `AI_PROVIDER` | design | AI provider (anthropic/openai) |

## 🚧 Roadmap

- [ ] WebSocket support for real-time updates
- [ ] OAuth2/OIDC integration (Azure AD B2C)
- [ ] Agent orchestration engine
- [ ] Visual workflow designer
- [ ] Metrics and monitoring (Prometheus/Grafana)
- [ ] Kubernetes deployment manifests

## 📄 License

Private - All rights reserved
