# Agent Registry Quick Start Guide

**For Developers Building Multi-Tenant Agents**

## 🎯 What is the Agent Registry?

The Agent Registry is a **directory service** that lets agents discover each other within the same tenant. Think of it as a phone book for agents.

## 🚀 Quick Start (5 Minutes)

### 1. Environment Variables

Add to your agent's `.env`:

```bash
FLOWGRID_REGISTRY_URL=https://api.flowgrid.io/api/registry
FLOWGRID_TENANT_ID=your-tenant-id
FLOWGRID_API_KEY=your-api-key
FLOWGRID_AGENT_ID=your-agent-id
```

### 2. Self-Register on Startup

```typescript
// Add to your agent's startup code
async function startup() {
  const registryUrl = process.env.FLOWGRID_REGISTRY_URL;
  const agentId = process.env.FLOWGRID_AGENT_ID;
  const tenantId = process.env.FLOWGRID_TENANT_ID;
  const apiKey = process.env.FLOWGRID_API_KEY;
  
  await registerWithRegistry(
    registryUrl,
    agentId,
    tenantId,
    apiKey,
    process.env.FUNCTION_APP_URL
  );
  
  console.log('✅ Registered with Agent Registry');
}
```

### 3. Discover Other Agents

```typescript
// Find agents with a specific skill
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  skill: 'analyze_incident'
});

console.log(`Found ${agents.length} agents with analyze_incident skill`);
```

### 4. Send Message to Agent

```typescript
// Get full A2A card
const agentCard = await getAgentCard(
  registryUrl,
  agents[0]._flowgrid.id,
  tenantId,
  apiKey
);

// Send message via Service Bus
const queueName = `${tenantId}-${agentCard._flowgrid.id}`;
await serviceBusClient.send(queueName, {
  tenantId,
  sourceAgentId: process.env.FLOWGRID_AGENT_ID,
  targetAgentId: agentCard._flowgrid.id,
  skill: 'analyze_incident',
  payload: {
    incidentId: 'INC0001234',
    priority: 'high'
  }
});
```

## 📚 API Reference

### Search Parameters

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `skill` | string | `analyze_incident` | Search by skill name (partial match) |
| `tag` | string | `support` | Search by skill tag (exact match) |
| `pattern` | string | `Specialist` | Search by agent pattern |
| `capability` | string | `ticket_analysis` | Search by capability name |
| `valueStream` | string | `Support` | Search by IT4IT value stream |
| `q` | string | `incident` | General text search (name, description) |

### Discovery Examples

**Find all support agents:**
```typescript
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  valueStream: 'Support'
});
```

**Find agents with specific pattern:**
```typescript
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  pattern: 'Orchestrator'
});
```

**Find agents by tag:**
```typescript
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  tag: 'analytics'
});
```

**General search:**
```typescript
const agents = await discoverAgents(registryUrl, tenantId, apiKey, {
  q: 'knowledge'
});
```

## 🔒 Security Rules

### ✅ DO

- ✅ Always validate `tenantId` in incoming messages
- ✅ Use JWT tokens for authentication
- ✅ Filter by `tenantId` in all database queries
- ✅ Register your agent on startup
- ✅ Unregister on graceful shutdown

### ❌ DON'T

- ❌ Trust `tenantId` from message payload alone
- ❌ Process messages from other tenants
- ❌ Share API keys between tenants
- ❌ Query the database without tenant filtering

## 🏗️ Queue Naming Convention

**Pattern:** `{tenant-id}-{agent-id}`

**Examples:**
```
acme-corp-incident-handler
acme-corp-knowledge-curator
contoso-inc-change-manager
```

## 📝 Message Envelope

All messages MUST include:

```typescript
interface AgentMessage {
  messageId: string;          // UUID
  tenantId: string;           // REQUIRED - must match your tenant
  sourceAgentId: string;      // Sending agent ID
  targetAgentId: string;      // Receiving agent ID
  skill: string;              // Skill to invoke
  timestamp: string;          // ISO 8601 timestamp
  payload: any;               // Skill-specific data
  metadata: {
    correlationId?: string;
    replyTo?: string;
    ttl?: number;             // Time-to-live in seconds
  };
}
```

## 🧪 Testing Your Agent

### 1. Check Registration Status

```bash
curl -X GET "https://api.flowgrid.io/api/registry/agents/$AGENT_ID" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Should return your agent's A2A card.

### 2. Verify Tenant Isolation

```bash
# Try to access agent from different tenant (should fail with 404)
curl -X GET "https://api.flowgrid.io/api/registry/agents/$OTHER_TENANT_AGENT_ID" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Should return 404 Not Found.

### 3. Test Discovery

```bash
curl -X GET "https://api.flowgrid.io/api/registry/agents/search?skill=analyze" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Should return agents with matching skills.

## 🐛 Troubleshooting

### Agent not appearing in registry

**Problem:** `GET /api/registry/agents` doesn't return your agent.

**Solution:** Check deployment status in database:
```sql
SELECT config->'deployment'->>'status' FROM agents WHERE id = 'your-agent-id';
```

Must be `'running'` to appear in registry.

### Cross-tenant access error

**Problem:** Getting 404 when accessing your own agent.

**Solution:** Verify JWT token has correct `tenantId` claim:
```bash
echo $JWT_TOKEN | base64 -d | jq .tenantId
```

### Skills not showing in A2A card

**Problem:** A2A card has empty `skills` array.

**Solution:** Check if skills exist in database:
```sql
SELECT * FROM agent_skills WHERE agent_id = 'your-agent-id' AND is_active = true;
```

## 📖 Full Documentation

- **Implementation Guide:** [AGENT-REGISTRY-IMPLEMENTATION.md](./AGENT-REGISTRY-IMPLEMENTATION.md)
- **Multi-Tenant Design:** [MULTI-TENANT-EXECUTION.md](./MULTI-TENANT-EXECUTION.md)
- **Implementation Summary:** [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)

## 💡 Best Practices

1. **Always self-register** on startup to make your agent discoverable
2. **Cache agent cards** for 5 minutes to reduce registry calls
3. **Set message TTL** to prevent stale messages (default 300 seconds)
4. **Handle 404 gracefully** - agent might be stopped or deleted
5. **Log all discovery calls** for debugging and audit trails
6. **Use correlation IDs** to trace multi-agent workflows

## 🎓 Example: Complete Agent Flow

```typescript
import { app, InvocationContext } from '@azure/functions';
import { ServiceBusClient } from '@azure/service-bus';

// Startup: Register with registry
app.hook.appStart(async () => {
  await registerWithRegistry(
    process.env.FLOWGRID_REGISTRY_URL,
    process.env.FLOWGRID_AGENT_ID,
    process.env.FLOWGRID_TENANT_ID,
    process.env.FLOWGRID_API_KEY,
    process.env.FUNCTION_APP_URL
  );
});

// Incoming message handler
app.serviceBusQueue('myQueue', {
  handler: async (message: AgentMessage, context: InvocationContext) => {
    const tenantId = process.env.FLOWGRID_TENANT_ID;
    
    // 1. Validate tenant context
    if (message.tenantId !== tenantId) {
      context.error('Invalid tenant context');
      return;
    }
    
    // 2. Process the message
    const result = await processMessage(message);
    
    // 3. Find next agent in workflow
    const agents = await discoverAgents(
      process.env.FLOWGRID_REGISTRY_URL,
      tenantId,
      process.env.FLOWGRID_API_KEY,
      { skill: 'review_results' }
    );
    
    if (agents.length === 0) {
      context.warn('No reviewer agent found');
      return;
    }
    
    // 4. Send result to next agent
    const queueName = `${tenantId}-${agents[0]._flowgrid.id}`;
    const sbClient = new ServiceBusClient(process.env.AZURE_SERVICEBUS_CONNECTION_STRING);
    const sender = sbClient.createSender(queueName);
    
    await sender.sendMessages({
      body: {
        tenantId,
        sourceAgentId: process.env.FLOWGRID_AGENT_ID,
        targetAgentId: agents[0]._flowgrid.id,
        skill: 'review_results',
        payload: result,
        metadata: {
          correlationId: message.metadata.correlationId,
          ttl: 300
        }
      }
    });
    
    context.log('✅ Sent result to reviewer');
  }
});

// Shutdown: Unregister from registry
app.hook.appStop(async () => {
  const response = await fetch(
    `${process.env.FLOWGRID_REGISTRY_URL}/agents/${process.env.FLOWGRID_AGENT_ID}/unregister`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.FLOWGRID_API_KEY}`,
        'X-Tenant-ID': process.env.FLOWGRID_TENANT_ID
      }
    }
  );
  
  if (response.ok) {
    console.log('✅ Unregistered from Agent Registry');
  }
});
```

## ⚡ Pro Tips

1. **Batch Lookups:** If you need multiple agent cards, make parallel requests
2. **Fallback Logic:** Always have a fallback if no agents found (human escalation)
3. **Retry Strategy:** Implement exponential backoff for failed registry calls
4. **Monitoring:** Log all agent interactions for observability
5. **Circuit Breaker:** Stop calling registry if it's down (use cached data)

---

**Need Help?** Check [AGENT-REGISTRY-IMPLEMENTATION.md](./AGENT-REGISTRY-IMPLEMENTATION.md) for detailed documentation or contact the FlowGrid Platform team.
