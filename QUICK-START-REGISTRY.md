# Quick Start: Multi-Tenant Agent Registry

## 🚀 Get Started in 5 Minutes

### 1. Start the Agent Service

```bash
cd /Users/rubenneuteboom/Documents/Projects/flowgrid-platform/services/agent-service
npm install
npm run dev
```

Service runs on: `http://localhost:3001`

### 2. Create a Test Agent with Deployment Config

```sql
-- Connect to your PostgreSQL database
psql postgres://flowgrid:FlowgridDev2026!@localhost:5432/flowgrid

-- Insert a test agent
INSERT INTO agents (tenant_id, name, type, description, config, status)
VALUES (
  'demo-tenant-123',
  'Test Registry Agent',
  'Specialist',
  'Agent for testing registry endpoints',
  '{
    "pattern": "Specialist",
    "deployment": {
      "status": "running",
      "registeredAt": "2026-02-12T10:00:00Z"
    }
  }'::jsonb,
  'active'
)
RETURNING id;
```

Save the returned UUID as `AGENT_ID`.

### 3. Generate a JWT Token

```javascript
// scripts/generate-test-token.js
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    userId: 'test-user-123',
    email: 'test@example.com',
    tenantId: 'demo-tenant-123',
    role: 'admin',
    type: 'access'
  },
  'flowgrid_jwt_secret_dev_CHANGE_IN_PRODUCTION',
  { expiresIn: '24h' }
);

console.log(token);
```

Run: `node scripts/generate-test-token.js` and save the token.

### 4. Test the Registry

```bash
# Set your token
export JWT_TOKEN="<your-jwt-token-here>"

# List all running agents
curl http://localhost:3001/api/registry/agents \
  -H "Authorization: Bearer $JWT_TOKEN" | jq

# Search by pattern
curl "http://localhost:3001/api/registry/agents/search?pattern=specialist" \
  -H "Authorization: Bearer $JWT_TOKEN" | jq

# Get specific agent
export AGENT_ID="<uuid-from-step-2>"
curl http://localhost:3001/api/registry/agents/$AGENT_ID \
  -H "Authorization: Bearer $JWT_TOKEN" | jq

# Register agent (simulate startup)
curl -X POST http://localhost:3001/api/registry/agents/$AGENT_ID/register \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://test.example.com",
    "metadata": {"version": "1.0.0"}
  }' | jq

# Unregister agent (simulate shutdown)
curl -X DELETE http://localhost:3001/api/registry/agents/$AGENT_ID/unregister \
  -H "Authorization: Bearer $JWT_TOKEN"
```

## 📋 Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/registry/agents` | GET | List all running agents (tenant-scoped) |
| `/api/registry/agents/:id` | GET | Get single agent's A2A card |
| `/api/registry/agents/search` | GET | Search (skill, tag, pattern, capability, q) |
| `/api/registry/agents/:id/register` | POST | Agent self-registration |
| `/api/registry/agents/:id/unregister` | DELETE | Agent deregistration |

## 🔑 Authentication

All endpoints require JWT with:
- Header: `Authorization: Bearer <token>`
- Token must have `tenantId` claim
- Token must be signed with `JWT_SECRET` from env

## 🧪 Test Tenant Isolation

```sql
-- Create agent in different tenant
INSERT INTO agents (tenant_id, name, type, config)
VALUES (
  'other-tenant-456',
  'Other Tenant Agent',
  'Specialist',
  '{"deployment": {"status": "running"}}'::jsonb
);

-- Query with demo-tenant-123 JWT
-- Should NOT see the other-tenant-456 agent
```

## 📚 Documentation

- **Full Design**: `/docs/MULTI-TENANT-EXECUTION.md`
- **Implementation**: `/docs/REGISTRY-IMPLEMENTATION-SUMMARY.md`
- **Task Summary**: `/SUBAGENT-TASK-COMPLETE.md`

## 🛠️ Troubleshooting

### "Unauthorized" error
- Check JWT is valid: `jwt.verify(token, 'flowgrid_jwt_secret_dev_CHANGE_IN_PRODUCTION')`
- Check token has `tenantId` claim
- Check token `type` is `'access'`

### "Agent not found"
- Check agent has `config.deployment.status = 'running'`
- Check agent `tenant_id` matches JWT `tenantId`
- Check agent UUID is correct

### Empty response from `/api/registry/agents`
- No running agents in your tenant
- Check: `SELECT * FROM agents WHERE tenant_id = 'demo-tenant-123' AND config->'deployment'->>'status' = 'running';`

---

**Need Help?** See `/docs/MULTI-TENANT-EXECUTION.md` for complete documentation.
