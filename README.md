# Flowgrid Platform

> Multi-tenant AI Agent Management Platform with IT4IT Framework
> Production-ready microservices architecture

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

---

## 🎯 Overview

Flowgrid Platform is an enterprise-grade AI Agent Management System built on the IT4IT reference architecture. It enables organizations to design, deploy, and operate AI agents that integrate seamlessly with existing IT service management tools.

### Key Features

- **🏢 Multi-Tenant Architecture** - Complete data isolation per organization
- **🔧 Microservices Design** - Independent scaling and deployment
- **🤖 AI-Powered Design Wizard** - Generate agents from process descriptions
- **🔗 IT4IT Alignment** - Built on industry-standard value streams
- **📊 ArchiMate Integration** - Visual modeling with enterprise architecture
- **🔌 Integration Ready** - Connect to ServiceNow, Jira, GitHub, and more

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway (nginx/traefik)                   │
│          - Authentication  - Rate Limiting  - Routing           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌──────────────┐    ┌──────────────────┐    ┌────────────────────┐
│ Agent Service│    │  Design Service  │    │   Auth Service     │
│   (CRUD)     │    │   (AI Wizard)    │    │   (JWT/RBAC)       │
│   :3001      │    │     :3003        │    │     :3002          │
└──────┬───────┘    └────────┬─────────┘    └─────────┬──────────┘
       │                     │                        │
       │            ┌────────┴─────────┐              │
       │            │                  │              │
       ▼            ▼                  ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
│ Integration  │  │  Execution   │  │  Analytics Service │
│   Service    │  │   Service    │  │     (Metrics)      │
│   :3004      │  │    :3005     │  │      :3006         │
└──────────────┘  └──────────────┘  └────────────────────┘
        │                 │                   │
        └─────────────────┴───────────────────┘
                          │
              ┌───────────┴───────────┐
              │  Shared Infrastructure │
              │  - PostgreSQL          │
              │  - Redis               │
              │  - Message Queue       │
              └───────────────────────┘
```

---

## 📁 Project Structure

```
flowgrid-platform/
├── services/                    # Microservices
│   ├── agent-service/          # Agent CRUD operations
│   ├── design-service/         # AI-powered design wizard
│   ├── auth-service/           # Authentication & authorization
│   └── integration-service/    # External integrations (ServiceNow, etc.)
├── infrastructure/             # Deployment configurations
│   ├── docker-compose.yml      # Local development
│   ├── .env.example            # Environment template
│   └── bicep/                  # Azure infrastructure as code
├── shared/                     # Shared libraries
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Common utilities
└── docs/                       # Documentation
    ├── ARCHITECTURE.md         # System architecture
    ├── MULTI-TENANT.md         # Multi-tenancy design
    ├── MICROSERVICES.md        # Service breakdown
    └── GETTING-STARTED.md      # Quick start guide
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Git

### Local Development

```bash
# Clone the repository
git clone https://github.com/rubenneuteboom/flowgrid-platform.git
cd flowgrid-platform

# Copy environment template
cp infrastructure/.env.example infrastructure/.env
# Edit .env with your API keys

# Start all services
cd infrastructure
docker-compose up -d

# Verify services are running
docker-compose ps

# View logs
docker-compose logs -f
```

### Access Points

| Service | URL | Description |
|---------|-----|-------------|
| API Gateway | http://localhost:8080 | Main entry point |
| Agent Service | http://localhost:3001 | Agent management |
| Auth Service | http://localhost:3002 | Authentication |
| Design Service | http://localhost:3003 | AI wizard |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Cache |

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design overview |
| [Multi-Tenant](docs/MULTI-TENANT.md) | Multi-tenancy implementation |
| [Microservices](docs/MICROSERVICES.md) | Service breakdown and patterns |
| [Deployment](docs/DEPLOYMENT-OPTIONS.md) | Deployment options (VPS, Azure, K8s) |
| [Getting Started](docs/GETTING-STARTED.md) | Development setup guide |

---

## 🔧 Services

### Agent Service
Core CRUD operations for AI agents. Handles agent lifecycle, versioning, and metadata.

### Design Service
AI-powered wizard for generating agents from natural language process descriptions. Integrates with Claude/GPT-4 for intelligent suggestions.

### Auth Service
JWT-based authentication with multi-tenant support. Role-based access control (RBAC) for team management.

### Integration Service
Connectors for external systems: ServiceNow, Jira, GitHub, Azure DevOps, and more.

---

## 🔐 Multi-Tenancy

Flowgrid supports complete data isolation per organization:

- **Database per tenant** (Enterprise tier)
- **Schema per tenant** (Professional tier)  
- **Row-level security** (Standard tier)

See [Multi-Tenant Architecture](docs/MULTI-TENANT.md) for details.

---

## 🛠️ Technology Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 18+ (TypeScript) |
| **API** | Express.js / NestJS |
| **Database** | PostgreSQL 15 |
| **Cache** | Redis 7 |
| **Queue** | Azure Service Bus / BullMQ |
| **AI** | Claude API, OpenAI API |
| **Gateway** | nginx / Traefik |
| **Container** | Docker / Docker Compose |
| **Cloud** | Azure (Container Apps / AKS) |

---

## 📊 IT4IT Value Streams

Flowgrid aligns with IT4IT reference architecture:

| Value Stream | Status | Description |
|--------------|--------|-------------|
| **S2P** (Strategy to Portfolio) | 🔄 Planned | Strategic planning agents |
| **R2D** (Requirement to Deploy) | ✅ Active | Development & deployment agents |
| **R2F** (Request to Fulfill) | 🔄 Planned | Service request agents |
| **D2C** (Detect to Correct) | 🔄 Planned | Incident & problem agents |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/rubenneuteboom/flowgrid-platform/issues)
- **Linear**: [Project Board](https://linear.app/multi-agent-it-department)

---

**Built with ❤️ for enterprise AI agent management**
