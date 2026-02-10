# Wizard Migration: Legacy Design Module → Flowgrid Platform

**Migrated:** 2026-02-09
**Source:** ~/Documents/Projects/flowgrid-design-v2/web-ui/server.js (4,116 lines)
**Target:** design-service (port 3003)

## Overview

The legacy Flowgrid Design wizard provides an AI-powered workflow for:
1. **Image Upload** → GPT-4 Vision extracts capabilities from screenshots/diagrams
2. **Text Analysis** → Claude/OpenAI designs agent architecture
3. **Agent Generation** → Creates agents with agentic patterns
4. **Database Save** → Persists to database with relationships

## Source Endpoints (legacy module)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/analyze-image` | POST | GPT-4 Vision: Extract capabilities from image |
| `/api/ai-analysis` | POST | Claude: Generate agent model from capabilities |
| `/api/apply-analysis` | POST | Save agents/capabilities/integrations to DB |
| `/api/wizard/generate-process` | POST | Generate process flow for an agent |

## Target Endpoints (Flowgrid Platform)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/wizard/upload-image` | POST | Vision AI: Analyze capability model image |
| `/api/wizard/analyze-text` | POST | Text description → agent design |
| `/api/wizard/generate-agents` | POST | Create agent specifications |
| `/api/wizard/apply` | POST | Save wizard session to database |
| `/api/wizard/sessions` | GET | List user's wizard sessions |
| `/api/wizard/sessions/:id` | GET/DELETE | Get/delete wizard session |

## Agentic Design Patterns

The wizard assigns these patterns to agents based on their role:

| Pattern | Use Case | Characteristics |
|---------|----------|-----------------|
| **Orchestrator** | Coordinates multiple agents | High-level control, delegates tasks |
| **Specialist** | Deep domain expertise | Focused scope, expert knowledge |
| **Coordinator** | Manages handoffs | Routing, load balancing |
| **Gateway** | External integration | API facade, security boundary |
| **Monitor** | Observes conditions | Passive, threshold alerts |
| **Executor** | Automated actions | Task execution, idempotent |
| **Analyzer** | Data insights | Pattern detection, ML/analytics |
| **Aggregator** | Combines data | Data fusion, normalization |
| **Router** | Directs work | Rule-based routing |

## Database Schema Changes

### New Tables (PostgreSQL)

```sql
-- Wizard sessions (tracks user progress)
CREATE TABLE wizard_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID REFERENCES users(id),
    session_name VARCHAR(255),
    source_type VARCHAR(50), -- 'image', 'text', 'xml'
    source_data JSONB, -- extracted capabilities
    analysis_result JSONB, -- AI analysis output
    status VARCHAR(50) DEFAULT 'draft', -- draft, analyzed, applied
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Capability maps (generated from wizard)
CREATE TABLE capability_maps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    wizard_session_id UUID REFERENCES wizard_sessions(id),
    name VARCHAR(255) NOT NULL,
    capabilities JSONB NOT NULL,
    hierarchy JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## AI Integration

### Phase 1: Vision Extraction (OpenAI)
- Model: `gpt-4o` with vision capability
- Extracts all text/structure from uploaded image
- Returns hierarchy of capabilities

### Phase 2: Agent Design (Claude)
- Model: `claude-sonnet-4-20250514`
- Analyzes capabilities and designs agent architecture
- Assigns agentic patterns, autonomy levels, triggers

## Multi-Tenant Considerations

- All wizard data MUST include `tenant_id`
- Sessions are isolated per tenant
- Agents created from wizard inherit tenant context
- Audit log tracks wizard actions

## Frontend Flow

1. **Step 1: Input**
   - Upload image OR paste text description
   - Optional: provide additional context

2. **Step 2: Review Capabilities**
   - See extracted capability hierarchy
   - Edit/add/remove capabilities

3. **Step 3: Review Agents**
   - See generated agent specifications
   - Adjust patterns, autonomy, triggers

4. **Step 4: Apply**
   - Save agents to database
   - Redirect to agent management

## API Examples

### Upload Image
```bash
curl -X POST http://localhost:8080/api/wizard/upload-image \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@capability-model.png" \
  -F "customPrompt=This is an IT4IT value stream diagram"
```

### Analyze Text
```bash
curl -X POST http://localhost:8080/api/wizard/analyze-text \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "We need agents to manage incident response...",
    "requirements": ["24/7 monitoring", "Auto-escalation"]
  }'
```

### Apply Session
```bash
curl -X POST http://localhost:8080/api/wizard/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "uuid-here"}'
```

## Migration Steps

1. ✅ Document legacy wizard flow
2. ✅ Add wizard schema to PostgreSQL (002_wizard_schema.sql)
3. ✅ Port endpoints to design-service (wizard routes added)
4. ✅ Create wizard.html frontend (multi-step form)
5. ✅ Test end-to-end flow (text analysis → agent creation)
6. ✅ Update documentation

## Completed: 2026-02-09

### Test Results
- **Text Analysis**: Created 4 agents from simple description
  - Incident Detection Monitor (Monitor pattern)
  - Incident Management Orchestrator (Orchestrator pattern)
  - ServiceNow Integration Gateway (Gateway pattern)
  - Incident Analytics Specialist (Analyzer pattern)
- **Capabilities**: 8 capabilities linked to agents
- **Interactions**: 5 agent-to-agent interactions
- **Integrations**: 4 external system integrations

### URLs
- Wizard UI: http://localhost:8080/wizard.html
- Patterns API: http://localhost:8080/api/wizard/patterns
- Sessions API: http://localhost:8080/api/wizard/sessions
