# Flowgrid Microservices Architecture

**Purpose:** Transform monolithic server into modular, independently scalable microservices  
**Benefits:** Load balancing, fault isolation, independent deployment, easier troubleshooting  
**Timeline:** 4-6 weeks implementation  

---

## 🎯 Core Principles

1. **Single Responsibility** - Each service does ONE thing well
2. **Independent Deployment** - Deploy services without affecting others
3. **Fault Isolation** - One service crash doesn't bring down the platform
4. **Horizontal Scaling** - Scale services independently based on load
5. **Observable** - Each service exposes health, metrics, logs

---

## 🏗️ Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway / Load Balancer              │
│              (Azure API Management / Kong / Traefik)         │
│   - Authentication                                           │
│   - Rate Limiting                                            │
│   - Request Routing                                          │
│   - SSL Termination                                          │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────┴────────────────────────────────────┐
    │                                              │
┌───▼────────────┐  ┌──────────────┐  ┌──────────▼─────┐
│  Agent Service │  │ Auth Service │  │  Design Service│
│  (CRUD)        │  │  (JWT)       │  │  (AI Wizard)   │
│  Port: 3001    │  │  Port: 3002  │  │  Port: 3003    │
└───┬────────────┘  └──────────────┘  └────────┬───────┘
    │                                           │
┌───▼────────────┐  ┌──────────────┐  ┌────────▼───────┐
│Integration Svc │  │ Execution Svc│  │  Analytics Svc │
│(Ext. APIs)     │  │(Agent Runtime)│  │  (Metrics)     │
│Port: 3004      │  │Port: 3005    │  │  Port: 3006    │
└────────────────┘  └──────────────┘  └────────────────┘
         │                   │                  │
         └───────────────────┴──────────────────┘
                             │
                ┌────────────▼────────────┐
                │   Shared Infrastructure │
                │  - PostgreSQL / SQL     │
                │  - Redis Cache          │
                │  - Azure Service Bus    │
                │  - Blob Storage         │
                └─────────────────────────┘
```

---

## 📦 Service Breakdown

### 1. Agent Service (Core CRUD)

**Responsibility:** Agent lifecycle management

**Endpoints:**
- `GET /api/agents` - List agents
- `GET /api/agents/:id` - Get agent details
- `POST /api/agents` - Create agent
- `PUT /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/agents/:id/status` - Runtime status

**Tech Stack:**
- Node.js + Express (or NestJS for better structure)
- PostgreSQL connection pool
- Redis for caching

**Load Pattern:** High read, medium write (most requests)

**Scaling:** 3-10 instances depending on traffic

---

### 2. Design Service (AI-Powered Wizard)

**Responsibility:** Agent design wizard, AI analysis, code generation

**Endpoints:**
- `POST /api/design/analyze-image` - Image analysis (Vision AI)
- `POST /api/design/analyze-model` - Capability model analysis
- `POST /api/design/generate-interactions` - Generate agent interactions
- `POST /api/design/compile/:agentId` - Generate code
- `GET /api/design/prompt-preview/:agentId` - Preview AI prompt

**Tech Stack:**
- Node.js + Express
- OpenAI SDK
- Anthropic SDK
- Heavy compute (AI calls)

**Load Pattern:** Low frequency, high latency (AI calls 5-30s)

**Scaling:** 2-5 instances (AI calls are slow, not CPU-bound)

**Cost:** Highest (AI API calls)

---

### 3. Auth Service (Authentication & Authorization)

**Responsibility:** JWT validation, tenant extraction, RBAC

**Endpoints:**
- `POST /api/auth/login` - User login (if not using Azure AD B2C)
- `POST /api/auth/validate` - Validate JWT token
- `GET /api/auth/user` - Get current user info
- `GET /api/auth/tenant` - Get tenant info
- `POST /api/auth/refresh` - Refresh token

**Tech Stack:**
- Node.js + Express
- jsonwebtoken library
- Redis for token blacklist

**Load Pattern:** Very high (every request validates)

**Scaling:** 5-15 instances (critical path)

**Optimization:** Cache JWT validation results in Redis

---

### 4. Integration Service (External APIs)

**Responsibility:** Connect to ServiceNow, Jira, GitHub, etc.

**Endpoints:**
- `GET /api/integrations/catalog` - List available integrations
- `POST /api/integrations/:name/test` - Test connection
- `GET /api/integrations/:name/status` - Check integration health
- `POST /api/integrations/servicenow/incident` - Create incident
- `GET /api/integrations/github/repos` - List repos

**Tech Stack:**
- Node.js + Express
- Axios for HTTP calls
- Retry logic (exponential backoff)

**Load Pattern:** Medium, bursty (when agents execute)

**Scaling:** 3-8 instances

---

### 5. Execution Service (Agent Runtime)

**Responsibility:** Execute agent workflows, handle Service Bus messages

**Endpoints:**
- `POST /api/execute/agent/:id` - Trigger agent execution
- `GET /api/execute/jobs/:jobId` - Get execution status
- `POST /api/execute/cancel/:jobId` - Cancel running job

**Background Workers:**
- Service Bus message handlers
- Scheduled agent triggers (cron-like)

**Tech Stack:**
- Node.js + Bull (job queue with Redis)
- Azure Service Bus SDK
- Worker pool pattern

**Load Pattern:** Spiky (depends on agent triggers)

**Scaling:** 3-10 instances + auto-scale workers

---

### 6. Analytics Service (Metrics & Monitoring)

**Responsibility:** Usage tracking, dashboards, tenant metrics

**Endpoints:**
- `GET /api/analytics/usage/:tenantId` - Tenant usage stats
- `GET /api/analytics/agents/:agentId/metrics` - Agent performance
- `POST /api/analytics/track` - Track custom event
- `GET /api/analytics/dashboard` - Dashboard data

**Tech Stack:**
- Node.js + Express
- Time-series database (InfluxDB or TimescaleDB)
- Aggregation logic

**Load Pattern:** Medium read, high write

**Scaling:** 2-5 instances, separate read/write

---

## 🐳 Docker Setup (Each Service)

### Example: Agent Service

**Directory Structure:**
```
services/
├── agent-service/
│   ├── src/
│   │   ├── routes/
│   │   │   └── agents.js
│   │   ├── services/
│   │   │   ├── database.js
│   │   │   └── cache.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── validation.js
│   │   ├── models/
│   │   │   └── agent.js
│   │   └── index.js
│   ├── tests/
│   │   └── agents.test.js
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
```

**Dockerfile:**
```dockerfile
FROM node:18-alpine AS base
WORKDIR /app

# Dependencies
COPY package*.json ./
RUN npm ci --only=production

# Source code
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# Run as non-root
USER node

EXPOSE 3001

CMD ["node", "src/index.js"]
```

**docker-compose.yml (Development):**
```yaml
version: '3.8'

services:
  agent-service:
    build: ./services/agent-service
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - DB_HOST=postgres
      - REDIS_HOST=redis
      - SERVICE_BUS_CONNECTION=${SERVICE_BUS_CONNECTION}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  design-service:
    build: ./services/design-service
    ports:
      - "3003:3003"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    restart: unless-stopped

  auth-service:
    build: ./services/auth-service
    ports:
      - "3002:3002"
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - AZURE_AD_CLIENT_ID=${AZURE_AD_CLIENT_ID}
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=flowgrid
      - POSTGRES_USER=flowgrid
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - agent-service
      - design-service
      - auth-service

volumes:
  postgres-data:
  redis-data:
```

---

## 🔄 Inter-Service Communication

### Option 1: HTTP/REST (Synchronous)

**When to use:** Real-time responses needed

```javascript
// In design-service: Call agent-service
const axios = require('axios');

async function getAgent(agentId, token) {
  const response = await axios.get(
    `http://agent-service:3001/api/agents/${agentId}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 5000
    }
  );
  return response.data;
}
```

**With Service Discovery (Kubernetes):**
```javascript
const AGENT_SERVICE = process.env.AGENT_SERVICE_URL || 'http://agent-service:3001';
```

---

### Option 2: Message Queue (Asynchronous)

**When to use:** Long-running tasks, fire-and-forget

```javascript
// Azure Service Bus example
const { ServiceBusClient } = require('@azure/service-bus');

// Design Service: Publish "agent compiled" event
async function publishAgentCompiled(agentId, code) {
  const sender = serviceBus.createSender('agent-compiled');
  await sender.sendMessages({
    body: { agentId, code, timestamp: Date.now() }
  });
}

// Execution Service: Subscribe to "agent compiled" events
async function handleAgentCompiled(message) {
  const { agentId, code } = message.body;
  // Deploy agent to runtime
  await deployAgent(agentId, code);
}
```

**Benefits:**
- ✅ Fault tolerance (retries)
- ✅ Decoupled services
- ✅ Load leveling (queue absorbs spikes)

---

## 🌐 API Gateway Configuration

### Nginx (Simple, Free)

**nginx.conf:**
```nginx
upstream agent-service {
    least_conn;  # Load balancing algorithm
    server agent-service-1:3001 max_fails=3 fail_timeout=30s;
    server agent-service-2:3001 max_fails=3 fail_timeout=30s;
    server agent-service-3:3001 max_fails=3 fail_timeout=30s;
}

upstream design-service {
    server design-service-1:3003;
    server design-service-2:3003;
}

server {
    listen 80;
    server_name api.flowgrid.ai;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # Agent Service routes
    location /api/agents {
        proxy_pass http://agent-service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Design Service routes (higher timeout for AI)
    location /api/design {
        proxy_pass http://design-service;
        proxy_read_timeout 120s;  # AI calls take longer
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
    }
}
```

---

### Azure API Management (Enterprise)

**Policies:**
```xml
<policies>
    <inbound>
        <!-- Validate JWT -->
        <validate-jwt header-name="Authorization" failed-validation-httpcode="401">
            <openid-config url="https://login.microsoftonline.com/.../v2.0/.well-known/openid-configuration" />
            <audiences>
                <audience>api://flowgrid</audience>
            </audiences>
        </validate-jwt>
        
        <!-- Rate limit per tenant -->
        <rate-limit-by-key calls="100" renewal-period="60" 
            counter-key="@(context.Request.Headers.GetValueOrDefault("X-Tenant-Id"))" />
        
        <!-- Set backend -->
        <set-backend-service base-url="https://agent-service.azurewebsites.net" />
    </inbound>
    
    <backend>
        <forward-request timeout="60" />
    </backend>
    
    <outbound>
        <!-- Add correlation ID -->
        <set-header name="X-Correlation-Id" exists-action="override">
            <value>@(context.RequestId)</value>
        </set-header>
    </outbound>
    
    <on-error>
        <set-status code="500" reason="Internal Server Error" />
        <set-body>@{
            return new JObject(
                new JProperty("error", context.LastError.Message),
                new JProperty("requestId", context.RequestId)
            ).ToString();
        }</set-body>
    </on-error>
</policies>
```

---

## 📊 Monitoring & Observability

### Health Checks (Each Service)

```javascript
// src/health.js
const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
  const checks = {
    service: 'agent-service',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  // Database check
  try {
    await db.query('SELECT 1');
    checks.checks.database = { status: 'ok' };
  } catch (err) {
    checks.checks.database = { status: 'error', message: err.message };
    checks.status = 'degraded';
  }

  // Redis check
  try {
    await redis.ping();
    checks.checks.redis = { status: 'ok' };
  } catch (err) {
    checks.checks.redis = { status: 'error', message: err.message };
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(checks);
});

router.get('/ready', async (req, res) => {
  // Kubernetes readiness probe
  // Returns 200 when service is ready to accept traffic
  const ready = await checkDatabaseConnection() && await checkDependencies();
  res.status(ready ? 200 : 503).send(ready ? 'ready' : 'not ready');
});

router.get('/live', (req, res) => {
  // Kubernetes liveness probe
  // Returns 200 if process is alive (doesn't check dependencies)
  res.status(200).send('alive');
});

module.exports = router;
```

---

### Distributed Tracing

```javascript
// OpenTelemetry setup
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const provider = new NodeTracerProvider({
  resource: {
    attributes: {
      'service.name': 'agent-service',
      'service.version': '1.0.0'
    }
  }
});

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation()
  ]
});

provider.register();

// Now all HTTP requests are automatically traced!
```

**View traces in:**
- Azure Application Insights
- Jaeger
- Zipkin
- Datadog

---

### Structured Logging (All Services)

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'agent-service',
    version: process.env.APP_VERSION
  },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Usage
logger.info('Agent created', {
  tenantId: req.user.tenantId,
  agentId: agent.id,
  userId: req.user.id,
  correlationId: req.headers['x-correlation-id']
});
```

**Log Aggregation:**
- Azure Log Analytics
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Loki + Grafana

---

## 🚀 Deployment Strategies

### Option 1: Azure Container Apps (Easiest)

```bash
# Deploy each service
az containerapp create \
  --name agent-service \
  --resource-group rg-flowgrid \
  --image flowgrid.azurecr.io/agent-service:latest \
  --target-port 3001 \
  --ingress external \
  --min-replicas 2 \
  --max-replicas 10 \
  --cpu 0.5 --memory 1Gi \
  --env-vars \
    DB_HOST=secretref:db-host \
    DB_PASSWORD=secretref:db-password
```

**Auto-scaling:**
```bash
az containerapp update \
  --name agent-service \
  --scale-rule-name http-rule \
  --scale-rule-type http \
  --scale-rule-http-concurrency 50
```

---

### Option 2: Azure Kubernetes Service (Most Flexible)

**Deployment YAML:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: agent-service
  template:
    metadata:
      labels:
        app: agent-service
    spec:
      containers:
      - name: agent-service
        image: flowgrid.azurecr.io/agent-service:1.0.0
        ports:
        - containerPort: 3001
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: flowgrid-secrets
              key: db-host
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /live
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: agent-service
spec:
  selector:
    app: agent-service
  ports:
  - port: 80
    targetPort: 3001
  type: LoadBalancer
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: agent-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 🔧 Migration Strategy (From Monolith)

### Phase 1: Extract Auth Service (Week 1)

1. Create `services/auth-service/`
2. Move JWT validation logic
3. Deploy as sidecar (same server)
4. Route `/api/auth/*` to port 3002
5. Test thoroughly
6. Switch DNS/load balancer

---

### Phase 2: Extract Agent Service (Week 2)

1. Create `services/agent-service/`
2. Move agent CRUD endpoints
3. Shared database (same connection)
4. Deploy alongside monolith
5. A/B test (10% traffic)
6. Full cutover

---

### Phase 3: Extract Design Service (Week 3)

1. Create `services/design-service/`
2. Move AI endpoints
3. Most expensive to run (AI calls)
4. Deploy with lower replica count
5. Monitor costs closely

---

### Phase 4: Decommission Monolith (Week 4)

1. All traffic routed to microservices
2. Monolith serves only static files
3. Eventually → Static Web App for frontend
4. Delete server.js 🎉

---

## 📈 Load Balancing Strategies

### 1. Round Robin (Default)
```
Request 1 → Instance A
Request 2 → Instance B
Request 3 → Instance C
Request 4 → Instance A (repeat)
```

**Good for:** Uniform workloads

---

### 2. Least Connections
```nginx
upstream agent-service {
    least_conn;  # Send to instance with fewest active connections
    server instance-a:3001;
    server instance-b:3001;
    server instance-c:3001;
}
```

**Good for:** Varying request durations

---

### 3. IP Hash (Session Affinity)
```nginx
upstream agent-service {
    ip_hash;  # Same IP always goes to same instance
    server instance-a:3001;
    server instance-b:3001;
}
```

**Good for:** Stateful sessions (though avoid if possible)

---

### 4. Weighted Round Robin
```nginx
upstream agent-service {
    server instance-a:3001 weight=3;  # Gets 3x traffic
    server instance-b:3001 weight=1;
}
```

**Good for:** Different instance sizes

---

## 🐛 Troubleshooting Benefits

### Before (Monolith)
```
❌ Server crashed → Entire platform down
❌ Bug in AI service → Can't access agents
❌ Memory leak → Affects all endpoints
❌ Can't scale design wizard independently
```

### After (Microservices)
```
✅ Design service crashes → Agents still accessible
✅ Bug in AI → Isolated, other services work
✅ Memory leak in one service → Others unaffected
✅ Scale design wizard to 10 instances, agent service stays at 3
```

### Debugging Example

**Distributed Tracing:**
```
Request ID: abc-123
├─ API Gateway (5ms)
├─ Auth Service (12ms)
│  └─ Redis cache hit (2ms)
├─ Agent Service (45ms)
│  ├─ Database query (38ms) ← SLOW!
│  └─ Redis cache miss (7ms)
└─ Total: 62ms

ISSUE FOUND: Missing index on tenant_id!
```

---

## 💰 Cost Implications

| Deployment | Monthly Cost (100 tenants) | Complexity |
|------------|---------------------------|------------|
| **Monolith (current)** | €100-200 | Low |
| **Docker Compose (VPS)** | €50-100 | Medium |
| **Azure Container Apps** | €200-400 | Low |
| **Azure Kubernetes** | €300-600 | High |

**Recommendation:** Start with Azure Container Apps (easiest), migrate to AKS when >1000 tenants

---

## 🎯 Recommended Next Steps

### Week 1: Setup Infrastructure
- [ ] Create `services/` directory structure
- [ ] Write Dockerfiles for each service
- [ ] Create docker-compose.yml for local dev
- [ ] Test all services locally

### Week 2: Extract Auth Service
- [ ] Move JWT logic to auth-service
- [ ] Deploy to Azure Container Apps
- [ ] Test authentication flow
- [ ] Monitor for 1 week

### Week 3: Extract Agent Service
- [ ] Move CRUD endpoints
- [ ] Deploy alongside monolith
- [ ] A/B test with 10% traffic
- [ ] Full cutover if stable

### Week 4: Extract Design Service
- [ ] Move AI endpoints
- [ ] Configure auto-scaling (2-5 replicas)
- [ ] Monitor AI costs
- [ ] Optimize prompts

---

## 📊 Success Metrics

| Metric | Target |
|--------|--------|
| **Service Availability** | >99.9% per service |
| **Mean Time to Recovery** | <5 minutes |
| **Deployment Frequency** | Daily per service |
| **Failed Deployment Rate** | <5% |
| **Independent Scaling** | Yes (prove it!) |

---

**Ready to modularize?** Let me know and I'll create the full service scaffolding! 🚀
