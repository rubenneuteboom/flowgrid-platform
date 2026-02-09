# Getting Started with Flowgrid Platform

This guide walks you through setting up Flowgrid Platform for local development.

## Prerequisites

- **Docker Desktop** (v20.10+) with Docker Compose
- **Node.js** (v18+)
- **Git**
- **VS Code** (recommended)

## Quick Start (5 minutes)

### 1. Clone the Repository

```bash
git clone https://github.com/rubenneuteboom/flowgrid-platform.git
cd flowgrid-platform
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp infrastructure/.env.example infrastructure/.env

# Edit with your API keys
nano infrastructure/.env
# OR
code infrastructure/.env
```

**Required settings:**
```env
JWT_SECRET=your_secret_key_at_least_32_characters_long
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 3. Start Services

```bash
cd infrastructure
docker-compose up -d
```

### 4. Verify Everything Works

```bash
# Check all services are running
docker-compose ps

# Expected output:
# NAME                        STATUS
# flowgrid-postgres          Up (healthy)
# flowgrid-redis             Up (healthy)
# flowgrid-agent-service     Up (healthy)
# flowgrid-auth-service      Up (healthy)
# flowgrid-design-service    Up (healthy)
# flowgrid-integration-service Up (healthy)
# flowgrid-gateway           Up
```

### 5. Test the API

```bash
# Health check
curl http://localhost:8080/health

# Or via specific service
curl http://localhost:3001/health  # Agent Service
curl http://localhost:3002/health  # Auth Service
```

---

## Development Workflow

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f agent-service
```

### Restart a Service

```bash
docker-compose restart agent-service
```

### Rebuild After Code Changes

```bash
# Rebuild specific service
docker-compose build agent-service
docker-compose up -d agent-service

# Rebuild all
docker-compose build
docker-compose up -d
```

### Stop Everything

```bash
docker-compose down

# Also remove volumes (⚠️ deletes database!)
docker-compose down -v
```

---

## Project Structure

```
flowgrid-platform/
├── services/                   # Microservices
│   ├── agent-service/         # Start here for agent management
│   ├── auth-service/          # Authentication logic
│   ├── design-service/        # AI wizard
│   └── integration-service/   # External connectors
├── infrastructure/            # Docker & deployment
│   ├── docker-compose.yml     # Local development
│   ├── .env.example           # Environment template
│   └── nginx/                 # API gateway config
├── shared/                    # Shared code
│   ├── types/                 # TypeScript definitions
│   └── utils/                 # Common utilities
└── docs/                      # Documentation
```

---

## Creating a New Service

Each service follows the same structure:

```
services/my-service/
├── src/
│   ├── index.ts              # Entry point
│   ├── routes/               # Express routes
│   ├── services/             # Business logic
│   ├── middleware/           # Express middleware
│   └── models/               # Data models
├── tests/
│   └── *.test.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

### Minimal Service Template

```typescript
// src/index.ts
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check (required for Docker)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'my-service' });
});

// Your routes here
app.get('/api/something', (req, res) => {
  res.json({ message: 'Hello from my-service' });
});

app.listen(PORT, () => {
  console.log(`my-service running on port ${PORT}`);
});
```

---

## Database Access

PostgreSQL runs on `localhost:5432`:

```bash
# Connect via psql
docker exec -it flowgrid-postgres psql -U flowgrid

# Or use your favorite client:
# Host: localhost
# Port: 5432
# Database: flowgrid
# User: flowgrid
# Password: (from .env)
```

### Initial Schema

The database schema is created automatically. See `infrastructure/init-db/` for migration scripts.

---

## Redis Access

Redis runs on `localhost:6379`:

```bash
# Connect via redis-cli
docker exec -it flowgrid-redis redis-cli

# Test
> PING
PONG
```

---

## Common Issues

### Port Already in Use

```bash
# Find what's using the port
lsof -i :3001

# Kill it or change the port in docker-compose.yml
```

### Database Connection Refused

```bash
# Check postgres is healthy
docker-compose ps postgres

# Check logs
docker-compose logs postgres
```

### Service Won't Start

```bash
# Check logs for the specific service
docker-compose logs agent-service

# Common causes:
# - Missing environment variables
# - Database not ready (wait a few seconds)
# - Code errors (check logs)
```

### Reset Everything

```bash
# Nuclear option - removes all data!
docker-compose down -v
docker-compose up -d
```

---

## Next Steps

1. **Read the Architecture** - [ARCHITECTURE.md](ARCHITECTURE.md)
2. **Understand Multi-Tenancy** - [MULTI-TENANT.md](MULTI-TENANT.md)
3. **Service Deep Dive** - [MICROSERVICES.md](MICROSERVICES.md)
4. **Deployment Options** - [DEPLOYMENT-OPTIONS.md](DEPLOYMENT-OPTIONS.md)

---

## Getting Help

- **GitHub Issues**: [Report bugs or request features](https://github.com/rubenneuteboom/flowgrid-platform/issues)
- **Documentation**: Check the `docs/` folder
- **Linear**: [Project board](https://linear.app/multi-agent-it-department)

---

Happy coding! 🚀
