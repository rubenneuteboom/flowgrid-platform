# Flowgrid Multi-Tenant Architecture Roadmap

**Date:** 2026-02-09  
**Purpose:** Transform Flowgrid from single-tenant prototype to enterprise multi-tenant AI Agent Management Platform  
**Audience:** Technical decision makers  

---

## Executive Summary

**Current State:** Single-user SQLite prototype  
**Target State:** Multi-tenant SaaS platform supporting 100+ customers  
**Timeline:** 3-6 months incremental migration  
**Investment:** Low to Medium (leverages existing Azure infrastructure)

**Key Principle:** Build for multi-tenancy NOW, before it becomes a rewrite.

---

## 1. 🏗️ Database Architecture (CRITICAL)

### Current Problem
```javascript
// Single SQLite database for ALL data
const db = new Database('it4it-archimate.db');
```

**Issues:**
- ❌ No customer isolation
- ❌ Can't scale beyond single machine
- ❌ No data sovereignty compliance (GDPR)
- ❌ Impossible to backup per customer
- ❌ Performance degrades as data grows

### Solution A: Database-per-Tenant (Recommended for <100 customers)

```javascript
// Customer-specific database routing
class TenantDatabaseManager {
  constructor() {
    this.connections = new Map();
    this.config = {
      provider: 'azure-sql', // or postgres
      server: process.env.SQL_SERVER,
      poolSize: 5
    };
  }
  
  async getConnection(tenantId) {
    if (!this.connections.has(tenantId)) {
      const connString = `Server=${this.config.server};Database=flowgrid-${tenantId};...`;
      this.connections.set(tenantId, await createConnection(connString));
    }
    return this.connections.get(tenantId);
  }
}

// Usage in routes
app.get('/api/elements', authenticate, async (req, res) => {
  const tenantId = req.user.tenantId;
  const db = await dbManager.getConnection(tenantId);
  const elements = await db.query('SELECT * FROM elements');
  res.json(elements);
});
```

**Benefits:**
- ✅ Complete data isolation
- ✅ Easy to backup/restore per customer
- ✅ Easy to migrate customers between regions
- ✅ Simple compliance (delete database = delete all customer data)
- ✅ Performance isolation (one customer can't slow down another)

**Drawbacks:**
- ⚠️ More databases to manage
- ⚠️ Schema migrations need to run on ALL databases
- ⚠️ Cost scales linearly with customers

**When to use:** <100 customers, strict data sovereignty requirements

---

### Solution B: Shared Database with tenant_id Column (Recommended for >100 customers)

```sql
-- Add tenant_id to ALL tables
ALTER TABLE elements ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE relationships ADD COLUMN tenant_id UUID NOT NULL;
ALTER TABLE agents ADD COLUMN tenant_id UUID NOT NULL;

-- Create indexes for tenant filtering
CREATE INDEX idx_elements_tenant ON elements(tenant_id);
CREATE INDEX idx_relationships_tenant ON relationships(tenant_id);
CREATE INDEX idx_agents_tenant ON agents(tenant_id);

-- Row-Level Security (PostgreSQL)
CREATE POLICY tenant_isolation_policy ON elements
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE elements ENABLE ROW LEVEL SECURITY;
```

```javascript
// Middleware to set tenant context
async function setTenantContext(req, res, next) {
  const tenantId = req.user.tenantId;
  
  // Set session variable for RLS
  await db.query('SET app.current_tenant = $1', [tenantId]);
  
  // Alternative: Add to all queries
  req.tenantId = tenantId;
  next();
}

// Base query builder
class TenantAwareQuery {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }
  
  select(table) {
    return db.query(`SELECT * FROM ${table} WHERE tenant_id = $1`, [this.tenantId]);
  }
}
```

**Benefits:**
- ✅ Scales to 1000s of customers
- ✅ Single schema to maintain
- ✅ Cost-effective (shared resources)
- ✅ Easier cross-tenant analytics/admin

**Drawbacks:**
- ⚠️ Risk of tenant data leakage (requires careful code review)
- ⚠️ One bad query can impact all customers
- ⚠️ Harder to meet strict compliance requirements

**When to use:** >100 customers, SaaS-first approach

---

### Hybrid Approach (Best of Both Worlds)

```javascript
// VIP customers get their own database
// Standard customers share a database

class HybridDatabaseManager {
  async getConnection(tenantId) {
    const tenant = await this.getTenantConfig(tenantId);
    
    if (tenant.tier === 'enterprise' || tenant.dedicated) {
      return this.getDedicatedConnection(tenantId);
    } else {
      return this.getSharedConnection(tenant.shardId);
    }
  }
}
```

**When to use:** Mixed customer base (SMB + Enterprise)

---

## 2. 🔐 Authentication & Authorization (CRITICAL)

### Current Problem
No multi-user support, no tenant isolation

### Solution: Industry-Standard Auth Stack

```javascript
// 1. Use Azure AD B2C or Auth0
const authConfig = {
  issuer: 'https://flowgrid.b2clogin.com/flowgrid.onmicrosoft.com/v2.0/',
  clientId: process.env.AZURE_AD_CLIENT_ID,
  validateIssuer: true,
  audience: process.env.AZURE_AD_AUDIENCE
};

// 2. JWT middleware
const jwt = require('express-jwt');
const jwks = require('jwks-rsa');

app.use(jwt({
  secret: jwks.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksUri: `${authConfig.issuer}/discovery/v2.0/keys`
  }),
  audience: authConfig.audience,
  issuer: authConfig.issuer,
  algorithms: ['RS256']
}));

// 3. Extract tenant from JWT claims
app.use((req, res, next) => {
  req.user = {
    userId: req.user.sub,
    email: req.user.email,
    tenantId: req.user['extension_TenantId'], // Custom claim
    roles: req.user.roles || []
  };
  next();
});

// 4. Role-based access control
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user.roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.delete('/api/agents/:id', requireRole('admin'), async (req, res) => {
  // Only admins can delete
});
```

**Required Roles:**
- `tenant:admin` - Full access within tenant
- `tenant:user` - Read/write agents
- `tenant:viewer` - Read-only
- `platform:admin` - Cross-tenant admin (Flowgrid staff)

---

## 3. 📊 Data Model Changes (HIGH PRIORITY)

### Add Multi-Tenancy Columns

```sql
-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  tier VARCHAR(50) DEFAULT 'standard', -- standard, professional, enterprise
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, trial
  max_agents INTEGER DEFAULT 50,
  max_users INTEGER DEFAULT 5,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (if not using external auth)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  status VARCHAR(50) DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Update existing tables
ALTER TABLE elements ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE relationships ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agents ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Audit trail per tenant
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100),
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
```

---

## 4. 🚀 API Architecture (HIGH PRIORITY)

### Current: Monolithic Express App
```
server.js (4,116 lines) 😱
```

### Target: Modular Microservices-Ready Architecture

```
api/
├── gateway/                    # API Gateway (Kong, Azure API Management)
│   ├── rate-limiting.yml
│   ├── authentication.yml
│   └── routing.yml
├── services/
│   ├── agent-service/         # CRUD for agents
│   │   ├── src/
│   │   ├── tests/
│   │   └── Dockerfile
│   ├── design-service/        # AI-powered design wizard
│   │   ├── src/
│   │   └── Dockerfile
│   ├── execution-service/     # Agent runtime
│   │   ├── src/
│   │   └── Dockerfile
│   ├── integration-service/   # External integrations
│   │   └── ...
│   └── auth-service/          # Authentication & RBAC
│       └── ...
└── shared/
    ├── database/              # Shared DB utilities
    ├── messaging/             # Event bus (Azure Service Bus)
    └── telemetry/            # Logging & monitoring
```

### API Gateway Layer

```javascript
// Azure API Management or Kong Gateway
{
  "routes": [
    {
      "path": "/api/v1/agents/*",
      "service": "agent-service",
      "plugins": [
        "jwt-auth",
        "rate-limiting:10req/min",
        "tenant-router"
      ]
    },
    {
      "path": "/api/v1/design/*",
      "service": "design-service",
      "plugins": [
        "jwt-auth",
        "rate-limiting:5req/min", // AI calls are expensive
        "usage-tracking"
      ]
    }
  ]
}
```

**Benefits:**
- ✅ Service-specific rate limits
- ✅ Independent scaling
- ✅ Version management (v1, v2)
- ✅ Analytics per tenant

---

## 5. 💰 Usage Tracking & Billing (MEDIUM PRIORITY)

### Track Consumption Metrics

```sql
CREATE TABLE usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  metric_type VARCHAR(100), -- agents_created, ai_tokens, api_calls
  metric_value BIGINT,
  metadata JSONB,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_tenant_period ON usage_metrics(tenant_id, period_start, period_end);
```

```javascript
// Middleware to track API usage
async function trackApiUsage(req, res, next) {
  const start = Date.now();
  
  res.on('finish', async () => {
    const duration = Date.now() - start;
    
    await db.query(`
      INSERT INTO usage_metrics (tenant_id, metric_type, metric_value, metadata)
      VALUES ($1, 'api_call', 1, $2)
    `, [
      req.user.tenantId,
      JSON.stringify({
        endpoint: req.path,
        method: req.method,
        duration,
        statusCode: res.statusCode
      })
    ]);
  });
  
  next();
}

// Track AI token usage
async function trackAiUsage(tenantId, provider, tokens, cost) {
  await db.query(`
    INSERT INTO usage_metrics (tenant_id, metric_type, metric_value, metadata)
    VALUES ($1, 'ai_tokens', $2, $3)
  `, [
    tenantId,
    tokens,
    JSON.stringify({ provider, cost })
  ]);
}
```

### Quota Enforcement

```javascript
async function checkQuota(req, res, next) {
  const tenant = await getTenant(req.user.tenantId);
  const usage = await getCurrentMonthUsage(tenant.id);
  
  if (usage.agents >= tenant.max_agents) {
    return res.status(429).json({
      error: 'Agent quota exceeded',
      limit: tenant.max_agents,
      current: usage.agents,
      upgradeUrl: '/billing/upgrade'
    });
  }
  
  next();
}

app.post('/api/agents', authenticate, checkQuota, async (req, res) => {
  // Create agent
});
```

---

## 6. 🔒 Security Hardening (HIGH PRIORITY)

### 1. Input Validation (Everywhere)

```javascript
const { body, param, validationResult } = require('express-validator');

app.post('/api/agents',
  authenticate,
  body('name').isString().trim().isLength({ min: 1, max: 255 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('pattern').isIn(['Orchestrator', 'Specialist', 'Monitor', ...]),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // ... handler
  }
);
```

### 2. SQL Injection Prevention

```javascript
// ❌ NEVER DO THIS
const sql = `SELECT * FROM agents WHERE name = '${req.query.name}'`;

// ✅ ALWAYS USE PARAMETERIZED QUERIES
const sql = 'SELECT * FROM agents WHERE tenant_id = $1 AND name = $2';
const result = await db.query(sql, [tenantId, name]);
```

### 3. Content Security Policy

```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Minimize unsafe-inline
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.openai.com', 'https://api.anthropic.com']
    }
  }
}));
```

### 4. Rate Limiting (Per Tenant + Global)

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

// Global rate limit (prevent DDoS)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP'
});

// Per-tenant rate limit
const tenantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: async (req) => {
    const tenant = await getTenant(req.user.tenantId);
    return tenant.tier === 'enterprise' ? 100 : 10; // Higher limits for paid tiers
  },
  keyGenerator: (req) => req.user.tenantId,
  store: new RedisStore({
    client: redisClient
  })
});

app.use('/api/', globalLimiter);
app.use('/api/', authenticate, tenantLimiter);
```

---

## 7. 📈 Observability & Monitoring (MEDIUM PRIORITY)

### Application Insights per Tenant

```javascript
const appInsights = require('applicationinsights');
appInsights.setup(process.env.APPINSIGHTS_KEY)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectExceptions(true)
  .start();

const client = appInsights.defaultClient;

// Tag all telemetry with tenant
client.commonProperties = {
  environment: process.env.NODE_ENV,
  version: process.env.APP_VERSION
};

// Custom events per tenant
app.use((req, res, next) => {
  if (req.user) {
    client.trackEvent({
      name: 'API Call',
      properties: {
        tenantId: req.user.tenantId,
        endpoint: req.path,
        method: req.method
      }
    });
  }
  next();
});

// Track AI usage
async function callAI(tenantId, prompt) {
  const start = Date.now();
  try {
    const result = await openai.complete(prompt);
    
    client.trackMetric({
      name: 'AI Request',
      value: result.usage.total_tokens,
      properties: {
        tenantId,
        provider: 'openai',
        model: 'gpt-4',
        duration: Date.now() - start
      }
    });
    
    return result;
  } catch (err) {
    client.trackException({
      exception: err,
      properties: { tenantId, prompt: prompt.slice(0, 100) }
    });
    throw err;
  }
}
```

### Health Checks per Service

```javascript
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    openai: await checkOpenAI(),
    serviceBus: await checkServiceBus()
  };
  
  const healthy = Object.values(checks).every(c => c.status === 'ok');
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  });
});

async function checkDatabase() {
  try {
    await db.query('SELECT 1');
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
```

---

## 8. 🌍 Infrastructure as Code (HIGH PRIORITY)

### Current: Manual Azure deployments

### Target: Terraform or Bicep for Everything

```hcl
# terraform/main.tf

# Tenant-specific resource group
resource "azurerm_resource_group" "tenant" {
  for_each = var.tenants
  
  name     = "rg-flowgrid-${each.key}"
  location = each.value.region
  
  tags = {
    tenant = each.key
    tier   = each.value.tier
  }
}

# Dedicated SQL database per enterprise tenant
resource "azurerm_mssql_database" "tenant" {
  for_each = {
    for k, v in var.tenants : k => v
    if v.tier == "enterprise"
  }
  
  name      = "flowgrid-${each.key}"
  server_id = azurerm_mssql_server.main.id
  sku_name  = each.value.db_sku
  
  tags = {
    tenant = each.key
  }
}

# Shared database for standard/professional tiers
resource "azurerm_mssql_database" "shared" {
  name      = "flowgrid-shared"
  server_id = azurerm_mssql_server.main.id
  sku_name  = "S3" # Scales with usage
}
```

**Benefits:**
- ✅ Reproducible infrastructure
- ✅ Version controlled
- ✅ Easy to provision new tenants
- ✅ Disaster recovery (rebuild from code)

---

## 9. 💾 Backup & Disaster Recovery (CRITICAL)

### Per-Tenant Backups

```javascript
// Automated daily backups per tenant
async function backupTenant(tenantId) {
  const tenant = await getTenant(tenantId);
  const timestamp = new Date().toISOString().split('T')[0];
  
  if (tenant.dedicated) {
    // Backup dedicated database
    await azureSql.createBackup({
      database: `flowgrid-${tenantId}`,
      name: `backup-${timestamp}`,
      retentionDays: tenant.tier === 'enterprise' ? 90 : 30
    });
  } else {
    // Export tenant data from shared DB
    await exportTenantData(tenantId, `backups/${tenantId}/${timestamp}.sql`);
  }
}

// Cron job (Azure Function Timer Trigger)
module.exports = async function (context, timer) {
  const tenants = await getAllActiveTenants();
  
  for (const tenant of tenants) {
    await backupTenant(tenant.id);
  }
};
```

### Point-in-Time Recovery

```sql
-- PostgreSQL: Enable point-in-time recovery
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = 'az storage blob upload ...';

-- Azure SQL: Automatic (built-in)
-- Can restore to any point in last 35 days
```

---

## 10. 🔄 Migration Strategy (PHASED APPROACH)

### Phase 1: Add Multi-Tenancy Foundation (Week 1-2)

```sql
-- Step 1: Add tenant table
CREATE TABLE tenants (...);

-- Step 2: Create default tenant for current data
INSERT INTO tenants (id, name, slug) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default');

-- Step 3: Add tenant_id columns (nullable first)
ALTER TABLE elements ADD COLUMN tenant_id UUID;
ALTER TABLE relationships ADD COLUMN tenant_id UUID;
ALTER TABLE agents ADD COLUMN tenant_id UUID;

-- Step 4: Backfill existing data
UPDATE elements SET tenant_id = '00000000-0000-0000-0000-000000000001';
UPDATE relationships SET tenant_id = '00000000-0000-0000-0000-000000000001';
UPDATE agents SET tenant_id = '00000000-0000-0000-0000-000000000001';

-- Step 5: Make NOT NULL
ALTER TABLE elements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE relationships ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agents ALTER COLUMN tenant_id SET NOT NULL;

-- Step 6: Add foreign keys
ALTER TABLE elements ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
```

---

### Phase 2: Add Authentication (Week 3-4)

```javascript
// 1. Set up Azure AD B2C
// 2. Add JWT middleware
// 3. Migrate existing users
// 4. Add tenant extraction from JWT
```

---

### Phase 3: Split Monolith (Week 5-8)

```bash
# Extract services one by one
1. Extract agent-service (80% of traffic)
2. Extract design-service (AI endpoints)
3. Extract auth-service
4. Extract integration-service
```

---

### Phase 4: Add Observability (Week 9-10)

```javascript
// Add Application Insights, logging, monitoring
```

---

### Phase 5: Harden Security (Week 11-12)

```javascript
// Rate limiting, input validation, CSP, etc.
```

---

## 📊 Cost Implications

| Change | Monthly Cost (100 tenants) | Notes |
|--------|----------------------------|-------|
| **Azure SQL (shared)** | $50-200 | S3-S6 tier depending on load |
| **Azure SQL (dedicated per enterprise tenant)** | $50 per tenant | Only for enterprise tier |
| **Azure AD B2C** | Free - $50 | 50k MAU free, then $0.00325/MAU |
| **Azure API Management** | $140 (Developer tier) | $550 for Standard |
| **Application Insights** | $20-100 | Depends on telemetry volume |
| **Redis Cache** | $15 (Basic) | For rate limiting |
| **Azure Service Bus** | $10 (Basic) | For event-driven architecture |
| **Total** | **$285-560/month** | For 100 tenants, excluding compute |

**Revenue Required:** $5-10/tenant/month to break even

---

## 🎯 Recommended Priority Order

### Do NOW (Before adding more features)

1. ✅ **Add tenant_id to all tables** (2 days)
2. ✅ **Implement JWT authentication** (3 days)
3. ✅ **Add input validation** (2 days)
4. ✅ **Set up Application Insights** (1 day)

**Total: 2 weeks**

---

### Do SOON (Next sprint)

5. ✅ **Split server.js into modules** (1 week)
6. ✅ **Add rate limiting** (2 days)
7. ✅ **Implement usage tracking** (3 days)
8. ✅ **Set up automated backups** (2 days)

**Total: 2-3 weeks**

---

### Do LATER (Before production)

9. ✅ **Migrate to PostgreSQL or Azure SQL** (1 week)
10. ✅ **Add API Gateway** (1 week)
11. ✅ **Implement Row-Level Security** (3 days)
12. ✅ **Add health checks** (2 days)

**Total: 2-3 weeks**

---

## 📈 Success Metrics

| Metric | Current | Target (6 months) |
|--------|---------|-------------------|
| **Concurrent Tenants** | 1 | 100+ |
| **Uptime** | Unknown | 99.9% |
| **API Response Time (p95)** | Unknown | <200ms |
| **Time to Onboard Tenant** | Manual | <5 min (automated) |
| **Cost per Tenant** | N/A | <$5/month |
| **Data Isolation** | None | 100% verified |

---

## 🔧 Quick Wins You Can Implement Today

### 1. Add Tenant ID to Database (1 hour)

```sql
-- Run this migration NOW
ALTER TABLE elements ADD COLUMN tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE relationships ADD COLUMN tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE agents ADD COLUMN tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX idx_elements_tenant ON elements(tenant_id);
```

### 2. Add Request Context (30 min)

```javascript
// Add to server.js
app.use((req, res, next) => {
  req.context = {
    tenantId: req.headers['x-tenant-id'] || 'default',
    userId: req.headers['x-user-id'] || 'system',
    requestId: req.headers['x-request-id'] || uuidv4()
  };
  next();
});
```

### 3. Start Logging Structured Data (30 min)

```javascript
function log(level, message, metadata = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    tenantId: metadata.tenantId,
    userId: metadata.userId,
    requestId: metadata.requestId,
    ...metadata
  }));
}

// Usage
log('info', 'Agent created', {
  tenantId: req.context.tenantId,
  agentId: newAgent.id
});
```

---

## 💡 Key Takeaways

1. **Multi-tenancy is a foundation, not a feature** - Add it before it becomes a rewrite
2. **Database isolation is the hardest part** - Choose your strategy early
3. **Authentication affects everything** - Use a proven solution (Azure AD B2C)
4. **Observability is not optional** - You can't fix what you can't see
5. **Start simple, evolve gradually** - Don't build for 10M users on day 1

---

**Next Steps:**
1. Review this document with your team
2. Prioritize the "Do NOW" section
3. Create Linear issues for each task
4. Start with tenant_id migration this week

**Questions?** Let's discuss on Telegram 📱

---

**Author:** CHEF 👨‍🍳  
**Date:** 2026-02-09  
**Status:** Ready for review and implementation
