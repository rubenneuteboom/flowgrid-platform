# Flowgrid Platform Architecture

## Overview

Flowgrid Platform is a multi-tenant AI Agent Management System built with a microservices architecture. This document provides a high-level overview of the system design.

## Design Principles

1. **Multi-Tenant First** - Every component designed for tenant isolation
2. **Service Independence** - Deploy, scale, and update services independently
3. **Fault Isolation** - One service failure doesn't cascade
4. **Observable** - Comprehensive logging, metrics, and tracing
5. **Secure by Default** - Defense in depth at every layer

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Internet / CDN                                  │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                            API Gateway (nginx)                               │
│  • SSL Termination  • Rate Limiting  • Request Routing  • Authentication    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 │                   │                   │
         ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
         │ Agent Service │   │ Design Service│   │ Auth Service  │
         │    (3001)     │   │    (3003)     │   │    (3002)     │
         └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
                 │                   │                   │
                 │           ┌───────▼───────┐           │
                 │           │  Integration  │           │
                 │           │   Service     │           │
                 │           │    (3004)     │           │
                 │           └───────┬───────┘           │
                 │                   │                   │
                 └───────────────────┼───────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
   ┌─────▼─────┐              ┌──────▼──────┐            ┌───────▼───────┐
   │ PostgreSQL│              │    Redis    │            │ Message Queue │
   │   (5432)  │              │   (6379)    │            │ (Service Bus) │
   └───────────┘              └─────────────┘            └───────────────┘
```

## Service Responsibilities

### Agent Service (Port 3001)
- Agent CRUD operations
- Agent versioning and history
- Agent metadata and configuration
- **Load:** High read, medium write

### Auth Service (Port 3002)
- JWT token validation
- Tenant context extraction
- Role-based access control (RBAC)
- User management
- **Load:** Very high (every request)

### Design Service (Port 3003)
- AI-powered agent design wizard
- Process analysis (NLP)
- Code generation
- ArchiMate model integration
- **Load:** Low frequency, high latency (AI calls)

### Integration Service (Port 3004)
- ServiceNow connector
- Jira connector
- GitHub connector
- Webhook management
- **Load:** Medium, bursty

## Data Flow

### Request Authentication Flow
```
Client → Gateway → Auth Service (validate JWT) → Target Service → Response
```

### Agent Creation Flow
```
1. Client → Gateway → Agent Service (POST /agents)
2. Agent Service validates request
3. Agent Service stores in PostgreSQL
4. Agent Service publishes event to queue
5. Response to client
6. (Async) Other services react to event
```

### AI Design Flow
```
1. Client → Gateway → Design Service (POST /design/analyze)
2. Design Service queries Agent Service for context
3. Design Service calls AI provider (Claude/GPT-4)
4. Design Service processes response
5. Design Service returns generated agent spec
```

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 18 | Team expertise, ecosystem |
| Language | TypeScript | Type safety, tooling |
| Database | PostgreSQL | ACID, JSON support, RLS |
| Cache | Redis | Fast, reliable, pub/sub |
| Gateway | nginx | Battle-tested, flexible |
| Queue | Azure Service Bus | Managed, reliable |
| AI | Claude API | Best for code generation |

## Deployment Options

See [DEPLOYMENT-OPTIONS.md](DEPLOYMENT-OPTIONS.md) for detailed comparison:

1. **Local** - Docker Compose (development)
2. **VPS** - Docker Compose on Hetzner/DigitalOcean
3. **Azure Container Apps** - Managed containers with auto-scaling
4. **Azure Kubernetes** - Full flexibility (enterprise)

## Security Layers

1. **Network** - Azure Virtual Network, NSGs
2. **Gateway** - Rate limiting, WAF rules
3. **Authentication** - JWT with Azure AD B2C
4. **Authorization** - RBAC per tenant
5. **Data** - Encryption at rest, row-level security
6. **Audit** - Comprehensive logging

## Scalability

Each service scales independently:

| Service | Min Replicas | Max Replicas | Scaling Trigger |
|---------|--------------|--------------|-----------------|
| Agent | 2 | 10 | CPU > 70% |
| Auth | 3 | 15 | Requests/sec |
| Design | 1 | 5 | Queue depth |
| Integration | 2 | 8 | Queue depth |

## Related Documents

- [MULTI-TENANT.md](MULTI-TENANT.md) - Multi-tenancy design
- [MICROSERVICES.md](MICROSERVICES.md) - Service details
- [DEPLOYMENT-OPTIONS.md](DEPLOYMENT-OPTIONS.md) - Deployment guide
- [GETTING-STARTED.md](GETTING-STARTED.md) - Development setup
