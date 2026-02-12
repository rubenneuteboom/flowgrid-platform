# Agent Registry Implementation Guide

## Overview

The Agent Registry is a multi-tenant service that enables agent-to-agent discovery in the FlowGrid Platform. It implements **Option A: Shared Compute, Logical Isolation** for multi-tenant execution.

## What Was Implemented

### 1. Agent Registry Service Endpoints

**Location:** `/services/agent-service/src/index.ts`

#### New Endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/registry/agents` | List all deployed agents for tenant (with A2A cards) |
| GET | `/api/registry/agents/:id` | Get single agent's A2A card |
| GET | `/api/registry/agents/search` | Search by skill, tag, pattern, capability |
| POST | `/api/registry/agents/:id/register` | Agent self-registration (updates deployment status) |
| DELETE | `/api/registry/agents/:id/unregister` | Agent deregistration |

#### Key Features:

- **Tenant Isolation:** All endpoints filter by `tenant_id` from JWT token
- **Deployment Status Filter:** Only returns agents where `config.deployment.status = 'running'`
- **A2A Protocol Compliance:** Returns full A2A v0.2 compliant agent cards
- **Skills Integration:** Uses `agent_skills` table for accurate skill definitions
- **Search Capabilities:** Search by skill name, tag, pattern, capability, value stream, or general text

### 2. Nginx Route Configuration

**Location:** `/infrastructure/nginx/conf.d/routes.conf`

Added route:
```nginx
location /api/registry {
    proxy_pass http://agent_service;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

All `/api/registry/*` requests are proxied to the agent-service.

### 3. Code Generation Updates

**Location:** `/services/wizard-service/src/routes/generate.ts`

#### Added Environment Variables:

Generated agent code now expects:
- `FLOWGRID_REGISTRY_URL` - URL to the Agent Registry
- `FLOWGRID_TENANT_ID` - Tenant ID for multi-tenant isolation
- `FLOWGRID_API_KEY` - API key for authentication

#### Added Helper Functions:

```typescript
// Discover agents by search criteria
discoverAgents(registryUrl, tenantId, apiKey, searchParams)

// Get full A2A card for a specific agent
getAgentCard(registryUrl, agentId, tenantId, apiKey)

// Self-register with registry on startup
registerWithRegistry(registryUrl, agentId, tenantId, apiKey, endpoint)
```

These functions are automatically injected into generated agent code.

### 4. Multi-Tenant Execution Design Documentation

**Location:** `/docs/MULTI-TENANT-EXECUTION.md`

Comprehensive documentation covering:
- Architecture components
- Service Bus tenant isolation strategies
- Queue naming conventions (`{tenant-id}-{agent-id}`)
- Message envelope structure
- Tenant context validation
- Database isolation patterns
- Agent discovery flow examples
- Security best practices
- Cost optimization strategies
- Monitoring & observability
- Migration path to dedicated compute

### 5. Test Suite

**Location:** `/services/agent-service/tests/registry.test.ts`

Comprehensive tests for:
- Listing agents with pagination
- Tenant isolation (no cross-tenant data leaks)
- A2A Protocol v0.2 compliance
- Search functionality (skill, pattern, value stream, text)
- Agent registration/unregistration
- Authentication requirements

## Usage Examples

### 1. List All Running Agents in Tenant

```bash
curl -X GET https://api.flowgrid.io/api/registry/agents \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Response:
```json
{
  "data": [
    {
      "name": "Incident Handler",
      "url": "https://agents.flowgrid.io/123e4567-...",
      "version": "1.0.0",
      "description": "Analyzes and routes incident tickets",
      "protocolVersion": "0.2",
      "skills": [
        {
          "id": "analyze_incident",
          "name": "Analyze Incident",
          "description": "Analyzes incident tickets",
          "tags": ["support", "analysis"],
          "inputSchema": { "type": "object", ... }
        }
      ],
      "_flowgrid": {
        "id": "123e4567-...",
        "tenantId": "acme-corp",
        "pattern": "Specialist",
        "valueStream": "Support",
        "deploymentStatus": "running"
      }
    }
  ],
  "meta": {
    "total": 5,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

### 2. Get A2A Card for Specific Agent

```bash
curl -X GET https://api.flowgrid.io/api/registry/agents/123e4567-... \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 3. Search for Agents by Skill

```bash
curl -X GET "https://api.flowgrid.io/api/registry/agents/search?skill=analyze" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 4. Search by Multiple Criteria

```bash
curl -X GET "https://api.flowgrid.io/api/registry/agents/search?pattern=Specialist&valueStream=Support" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 5. Agent Self-Registration (from agent code)

```typescript
// On agent startup
const agentId = process.env.FLOWGRID_AGENT_ID;
const tenantId = process.env.FLOWGRID_TENANT_ID;
const registryUrl = process.env.FLOWGRID_REGISTRY_URL;
const apiKey = process.env.FLOWGRID_API_KEY;

await fetch(`${registryUrl}/agents/${agentId}/register`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'X-Tenant-ID': tenantId,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    endpoint: process.env.FUNCTION_APP_URL,
    healthCheckUrl: `${process.env.FUNCTION_APP_URL}/health`,
    metadata: {
      startedAt: new Date().toISOString()
    }
  })
});
```

### 6. Agent Discovery in Generated Code

```typescript
// Generated agent code automatically includes this
const registryUrl = process.env.FLOWGRID_REGISTRY_URL;
const tenantId = process.env.FLOWGRID_TENANT_ID;
const apiKey = process.env.FLOWGRID_API_KEY;

// Find agents with a specific skill
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  skill: 'search_knowledge'
});

if (agents.length > 0) {
  const knowledgeCurator = agents[0];
  console.log(`Found agent: ${knowledgeCurator.name}`);
  
  // Get full A2A card
  const agentCard = await getAgentCard(
    registryUrl,
    knowledgeCurator._flowgrid.id,
    tenantId,
    apiKey
  );
  
  // Use the agent...
}
```

## Database Schema Requirements

The Agent Registry relies on these tables:

### `agents` table
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  description TEXT,
  config JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'draft',
  version INTEGER DEFAULT 1,
  ...
);
```

**Key `config` fields:**
- `config.deployment.status` - `'draft' | 'running' | 'stopped' | 'failed'`
- `config.deployment.endpoint` - Agent endpoint URL
- `config.deployment.healthCheckUrl` - Health check endpoint
- `config.pattern` - Agent pattern (Specialist, Orchestrator, etc.)
- `config.valueStream` - IT4IT value stream

### `agent_skills` table
```sql
CREATE TABLE agent_skills (
  id UUID PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  description TEXT,
  input_schema JSONB,
  output_schema JSONB,
  tags TEXT[],
  examples JSONB,
  is_active BOOLEAN DEFAULT true,
  ...
);
```

### `agent_capabilities` table
```sql
CREATE TABLE agent_capabilities (
  id UUID PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  capability_name VARCHAR(255) NOT NULL,
  capability_type VARCHAR(100) DEFAULT 'action',
  config JSONB DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true,
  ...
);
```

## Deployment Checklist

### Agent Service Updates
- [x] Registry endpoints implemented in `index.ts`
- [x] Tenant filtering on all endpoints
- [x] A2A Protocol v0.2 compliance
- [ ] Deploy agent-service with new endpoints
- [ ] Verify endpoints with test suite

### Infrastructure Updates
- [x] Nginx routes configured
- [ ] Update nginx configuration
- [ ] Reload nginx: `nginx -s reload`

### Code Generation Updates
- [x] Registry URL injection in generated code
- [x] Helper functions added
- [ ] Redeploy wizard-service
- [ ] Test code generation with new template

### Documentation
- [x] Multi-tenant execution design doc
- [x] Implementation guide (this file)
- [x] Test suite
- [ ] Update API documentation
- [ ] Update developer onboarding docs

### Testing
- [ ] Run test suite: `npm test -- registry.test.ts`
- [ ] Manual testing with Postman/curl
- [ ] Test cross-tenant isolation
- [ ] Test agent registration flow
- [ ] Load testing (optional)

### Monitoring
- [ ] Add Application Insights tracking for registry endpoints
- [ ] Set up alerts for failed registrations
- [ ] Dashboard for agent deployment status per tenant
- [ ] Queue depth monitoring per tenant

## Security Considerations

### ✅ Implemented Security Features

1. **JWT-based Authentication:** All endpoints require valid JWT with tenant ID claim
2. **Tenant Isolation:** All queries filter by `tenant_id` from JWT
3. **Deployment Status Filtering:** Only `running` agents are discoverable
4. **No Cross-Tenant Access:** Strict enforcement at database level

### ⚠️ Additional Security Recommendations

1. **Rate Limiting:** Add rate limiting to registry endpoints (per tenant)
2. **API Key Rotation:** Implement periodic API key rotation for agents
3. **Audit Logging:** Log all registry access attempts
4. **Row-Level Security:** Enable PostgreSQL RLS policies on all tables
5. **Network Isolation:** Use Azure Private Endpoints for agent-to-service communication

## Performance Considerations

### Current Implementation
- Pagination support (default 50, max 500 agents per page)
- Database indexes on `tenant_id`, `config->deployment->status`
- Efficient queries with JOINs to fetch skills

### Optimization Opportunities
- **Redis Cache:** Cache A2A cards for frequently accessed agents (TTL 5 minutes)
- **Materialized Views:** Pre-compute agent cards for fast retrieval
- **GraphQL:** Consider GraphQL endpoint for more flexible queries
- **Batch APIs:** Add batch endpoints for fetching multiple A2A cards

## Troubleshooting

### Problem: Agent not appearing in registry

**Diagnosis:**
```sql
SELECT id, name, config->'deployment'->>'status' as deployment_status
FROM agents
WHERE tenant_id = '<tenant-id>' AND id = '<agent-id>';
```

**Solution:** Ensure `config.deployment.status = 'running'`

### Problem: Cross-tenant data leak

**Diagnosis:** Check JWT token claims:
```bash
echo $JWT_TOKEN | base64 -d | jq .
```

**Solution:** Verify `tenantId` claim matches expected tenant

### Problem: Skills not showing in A2A card

**Diagnosis:**
```sql
SELECT * FROM agent_skills WHERE agent_id = '<agent-id>' AND is_active = true;
```

**Solution:** Ensure skills are created and `is_active = true`

## Next Steps

1. **Service Bus Integration:** Implement queue naming with tenant prefixes
2. **Agent Templates:** Create standard agent templates with registry integration
3. **UI for Registry:** Build admin UI to view registered agents per tenant
4. **Health Monitoring:** Periodic health checks for registered agents
5. **Auto-Discovery:** Automatic agent discovery via Azure Resource Graph

## References

- [A2A Protocol v0.2 Spec](https://a2a.org/spec/v0.2)
- [Multi-Tenant Execution Design](./MULTI-TENANT-EXECUTION.md)
- [IT4IT Framework](https://www.opengroup.org/it4it)
- [Azure Service Bus Best Practices](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-performance-improvements)

---

**Version:** 1.0  
**Last Updated:** 2026-02-12  
**Implemented By:** FlowGrid Platform Team
