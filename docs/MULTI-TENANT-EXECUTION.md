# Multi-Tenant Execution Design

## Overview

FlowGrid Platform uses **Option A: Shared Compute, Logical Isolation** for multi-tenant agent execution. This document defines how agents running in a shared infrastructure maintain tenant isolation.

## Architecture Principles

1. **Shared Infrastructure**: All agents run on shared compute resources (Azure Functions, containers)
2. **Logical Isolation**: Tenant separation enforced through software boundaries (not physical)
3. **Cost Efficiency**: Resource sharing enables lower per-tenant costs
4. **Security**: Cryptographic tenant verification at every layer

## Components

### 1. Agent Registry Service

**Purpose**: Runtime discovery of deployed agents within a tenant

**Endpoints**:
- `GET /api/registry/agents` - List all running agents for the authenticated tenant
- `GET /api/registry/agents/:id` - Get A2A card for a specific agent
- `GET /api/registry/agents/search` - Search agents by skill, tag, pattern, or capability
- `POST /api/registry/agents/:id/register` - Agent self-registration on startup
- `DELETE /api/registry/agents/:id/unregister` - Agent deregistration on shutdown

**Security**:
- All endpoints require JWT authentication with `tenantId` claim
- Only returns agents where `config.deployment.status = 'running'`
- Filters all queries by `tenant_id` from JWT

**Response Format**:
Returns full A2A Protocol v0.2 agent cards with skills, capabilities, and metadata.

### 2. Service Bus Tenant Isolation

#### Queue Naming Convention

**Option A: Tenant-Prefixed Queues** (Recommended)
```
{tenant-id}-agents          # Shared queue for all agents in tenant
{tenant-id}-{agent-id}      # Dedicated queue per agent (for high volume)
{tenant-id}-orchestrator    # Orchestration/coordination queue
{tenant-id}-dlq             # Dead letter queue for tenant
```

**Benefits**:
- Physical separation at queue level
- Easy monitoring per tenant
- No message filtering required
- Clear ownership and billing

**Example**:
```
demo-tenant-123-agents
demo-tenant-123-incident-agent
demo-tenant-123-orchestrator
demo-tenant-123-dlq
```

#### Message Envelope

All messages MUST include tenant context in the envelope:

```typescript
interface MessageEnvelope {
  // Required fields
  tenantId: string;           // Tenant ID (cryptographic validation)
  agentId: string;            // Source agent ID
  messageType: string;        // Message type (e.g., 'incident.created')
  
  // Payload
  payload: any;               // Actual message content
  
  // Metadata
  timestamp: string;          // ISO 8601 timestamp
  correlationId?: string;     // For request/response tracking
  causationId?: string;       // For event chains
  
  // Security
  signature?: string;         // HMAC signature for verification
}
```

**Required Validation**:
```typescript
// Every message handler MUST validate tenant context
function validateMessage(message: MessageEnvelope): boolean {
  // 1. Check tenant ID matches agent's tenant
  if (message.tenantId !== process.env.FLOWGRID_TENANT_ID) {
    console.error('Tenant mismatch', {
      expected: process.env.FLOWGRID_TENANT_ID,
      received: message.tenantId
    });
    return false;
  }
  
  // 2. Verify signature (if present)
  if (message.signature) {
    const valid = verifyHMAC(message, process.env.FLOWGRID_TENANT_SECRET);
    if (!valid) {
      console.error('Invalid message signature');
      return false;
    }
  }
  
  return true;
}
```

### 3. Agent Runtime Context

Each agent instance receives tenant-specific environment variables:

```bash
# Tenant Identity
FLOWGRID_TENANT_ID=demo-tenant-123
FLOWGRID_TENANT_SECRET=<secret-for-signing>

# Agent Identity
AGENT_ID=agent-uuid-here
AGENT_NAME=Incident Response Agent

# Registry Integration
FLOWGRID_REGISTRY_URL=https://api.flowgrid.io
FLOWGRID_API_TOKEN=<jwt-token-with-tenant-scope>

# Service Bus Configuration
SERVICEBUS_CONNECTION_STRING=<connection-string>
SERVICEBUS_QUEUE_NAME=demo-tenant-123-agents

# Optional: Agent-specific queue
SERVICEBUS_DEDICATED_QUEUE=demo-tenant-123-incident-agent
```

### 4. Agent Lifecycle

#### Startup Sequence
1. **Load Configuration**: Read environment variables and config files
2. **Validate Tenant Context**: Ensure `FLOWGRID_TENANT_ID` is set
3. **Connect to Service Bus**: Subscribe to tenant-specific queue
4. **Register with Registry**: POST to `/api/registry/agents/:id/register`
5. **Discover Peers**: Query registry for other agents in tenant
6. **Mark Ready**: Begin processing messages

#### Shutdown Sequence
1. **Stop Accepting Messages**: Drain in-flight work
2. **Unregister**: DELETE `/api/registry/agents/:id/unregister`
3. **Close Connections**: Clean up Service Bus, database connections
4. **Exit Gracefully**: Return 0 exit code

### 5. Inter-Agent Communication

Agents discover and communicate with peers in the same tenant:

```typescript
// Example: Incident agent discovers knowledge agent
async function escalateToKnowledge(incident: any) {
  // 1. Discover knowledge agent
  const knowledgeAgent = await findAgentBySkill('search_knowledge_base');
  
  if (!knowledgeAgent) {
    console.warn('No knowledge agent available');
    return null;
  }
  
  // 2. Send message with tenant context
  const envelope: MessageEnvelope = {
    tenantId: process.env.FLOWGRID_TENANT_ID!,
    agentId: process.env.AGENT_ID!,
    messageType: 'knowledge.search',
    payload: {
      query: incident.description,
      context: { incidentId: incident.id }
    },
    timestamp: new Date().toISOString(),
    correlationId: incident.correlationId
  };
  
  // 3. Send to knowledge agent's queue
  await serviceBusClient.sendMessage(
    `${process.env.FLOWGRID_TENANT_ID}-knowledge-agent`,
    envelope
  );
}
```

## Security Model

### Defense in Depth

1. **Authentication**: JWT tokens with tenant scope
2. **Authorization**: Database queries filtered by `tenant_id`
3. **Network Isolation**: Queue-level separation
4. **Message Validation**: Every handler validates tenant context
5. **Cryptographic Verification**: HMAC signatures on sensitive operations
6. **Audit Logging**: All cross-tenant access attempts logged

### Preventing Cross-Tenant Attacks

**Attack Vector**: Malicious agent sends message with different `tenantId`

**Mitigations**:
1. Agent can only connect to queues matching its `FLOWGRID_TENANT_ID`
2. All message handlers validate `message.tenantId === process.env.FLOWGRID_TENANT_ID`
3. Registry queries filtered by JWT tenant claim
4. Database queries use `WHERE tenant_id = $1` with parameterized tenantId

**Attack Vector**: Agent attempts to discover other tenants' agents

**Mitigations**:
1. Registry endpoints require JWT with tenant claim
2. All SQL queries filter by `tenant_id` from JWT
3. A2A cards only returned for agents where `config.deployment.status = 'running'` AND `tenant_id` matches

## Monitoring & Observability

### Per-Tenant Metrics

Track separately for each tenant:
- Message throughput (messages/sec)
- Agent CPU/memory usage
- Error rates and latencies
- Queue depths
- Inter-agent communication patterns

### Alerts

- Cross-tenant access attempts (ERROR)
- Queue depth exceeds threshold (WARNING)
- Agent registration failures (WARNING)
- Tenant isolation validation failures (CRITICAL)

### Logging

All log entries MUST include `tenantId` for filtering:

```typescript
console.log('Processing message', {
  tenantId: message.tenantId,
  agentId: message.agentId,
  messageType: message.messageType,
  timestamp: message.timestamp
});
```

## Cost Allocation

### Per-Tenant Billing

Track usage per tenant for chargeback:

1. **Compute**: Function execution time, memory
2. **Storage**: Database rows, blob storage
3. **Network**: Service Bus messages, API calls
4. **AI**: OpenAI/Claude API token usage

### Resource Quotas

Prevent runaway costs with per-tenant limits:

```typescript
interface TenantQuota {
  maxAgents: number;              // e.g., 50
  maxMessagesPerDay: number;      // e.g., 100,000
  maxAITokensPerDay: number;      // e.g., 1,000,000
  maxStorageMB: number;           // e.g., 10,000
}
```

## Testing Strategy

### Unit Tests
- Validate tenant context extraction from JWT
- Test message envelope validation
- Verify queue name generation

### Integration Tests
- Create two test tenants
- Verify Agent A (tenant 1) cannot discover Agent B (tenant 2)
- Verify messages sent to wrong queue are rejected
- Test registry returns only tenant-scoped agents

### Load Tests
- 100 agents across 10 tenants
- Verify no cross-tenant leakage under load
- Ensure fair resource sharing

## Migration Path

### Phase 1: Registry (Current)
- ✅ Agent Registry endpoints
- ✅ Tenant-scoped queries
- ✅ A2A card generation

### Phase 2: Service Bus (Next)
- Implement queue naming convention
- Add message envelope validation
- Deploy tenant-prefixed queues

### Phase 3: Code Generation
- Update templates with registry helpers
- Inject tenant context variables
- Add self-registration on startup

### Phase 4: Monitoring
- Add per-tenant dashboards
- Implement usage tracking
- Set up alerting

## Future Enhancements

### Physical Isolation Option (Enterprise)
For high-security tenants, offer dedicated infrastructure:
- Dedicated Azure subscription
- Dedicated Service Bus namespace
- Dedicated database instance
- Higher pricing tier

### Multi-Region Support
- Geo-distributed agent registry
- Regional queue routing
- Data residency compliance (GDPR, etc.)

### Advanced Security
- Tenant-specific encryption keys
- HSM integration for secrets
- Zero-trust network policies

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-12  
**Owner**: FlowGrid Platform Team
