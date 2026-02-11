# A2A Code Generation Architecture

> FlowGrid designs agents → Exports to multiple runtime targets

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     FlowGrid Platform                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Wizard    │───▶│   Design    │───▶│   Export    │         │
│  │  (Design)   │    │   Module    │    │   Engine    │         │
│  └─────────────┘    └─────────────┘    └──────┬──────┘         │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
         ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
         │  Azure Functions │      │ Azure AI Agent   │      │ Python/LangGraph │
         │  (A2A HTTP)      │      │ Service          │      │ (Local/Cloud)    │
         └──────────────────┘      └──────────────────┘      └──────────────────┘
```

## Export Targets

### 1. A2A JSON (Base Export)
Pure A2A-compliant JSON that can be consumed by any A2A runtime.

```json
{
  "agentCard": {
    "name": "Incident Router",
    "description": "Routes incidents to appropriate teams",
    "url": "https://agents.example.com/incident-router",
    "version": "1.0.0",
    "capabilities": {
      "streaming": false,
      "pushNotifications": true
    },
    "skills": [
      {
        "id": "route-incident",
        "name": "Route Incident",
        "description": "Routes an incident based on category and priority",
        "inputSchema": { ... },
        "outputSchema": { ... }
      }
    ]
  },
  "relationships": [ ... ],
  "integrations": [ ... ]
}
```

### 2. Azure Functions (TypeScript)

Generated project structure:
```
incident-router-agent/
├── package.json
├── tsconfig.json
├── host.json
├── local.settings.json
├── src/
│   ├── functions/
│   │   ├── agentCard.ts          # GET /.well-known/agent.json
│   │   ├── submitTask.ts         # POST /tasks
│   │   ├── getTask.ts            # GET /tasks/{id}
│   │   ├── sendMessage.ts        # POST /tasks/{id}/messages
│   │   └── skills/
│   │       └── routeIncident.ts  # Skill implementation
│   ├── a2a/
│   │   ├── types.ts              # A2A type definitions
│   │   ├── taskStore.ts          # Task state management
│   │   └── messageHandler.ts     # Message routing
│   └── llm/
│       └── client.ts             # Azure OpenAI / Anthropic client
├── infra/
│   ├── main.bicep                # Azure infrastructure
│   └── parameters.json
└── README.md
```

### 3. Azure AI Agent Service

Generated configuration:
```json
{
  "agent": {
    "name": "Incident Router",
    "instructions": "You are an incident routing agent. Your job is to...",
    "model": "gpt-4o",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "route_incident",
          "description": "Routes an incident to the appropriate team",
          "parameters": { ... }
        }
      }
    ]
  },
  "deployment": {
    "resourceGroup": "rg-agents",
    "location": "westeurope"
  }
}
```

### 4. Python/LangGraph

Generated project:
```
incident_router/
├── pyproject.toml
├── README.md
├── src/
│   └── incident_router/
│       ├── __init__.py
│       ├── agent.py              # LangGraph agent definition
│       ├── skills.py             # Skill implementations
│       ├── a2a_server.py         # FastAPI A2A endpoints
│       └── config.py
├── tests/
└── Dockerfile
```

## Database Schema Extensions

```sql
-- Agent export configurations
CREATE TABLE agent_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    target_type VARCHAR(50) NOT NULL,  -- 'azure-functions', 'azure-ai-agent', 'python-langgraph', 'a2a-json'
    config JSONB DEFAULT '{}',
    last_exported_at TIMESTAMP,
    export_version INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Export history for audit
CREATE TABLE export_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    export_type VARCHAR(50) NOT NULL,
    agents_exported INT NOT NULL,
    download_url TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### Export Endpoints (agent-service)

```
POST /api/agents/export
  Body: { 
    target: "azure-functions" | "azure-ai-agent" | "python-langgraph" | "a2a-json",
    agentIds: string[] | "all",
    options: { ... }
  }
  Response: { downloadUrl: string, expiresAt: string }

GET /api/agents/export/targets
  Response: [
    { id: "azure-functions", name: "Azure Functions", description: "..." },
    { id: "azure-ai-agent", name: "Azure AI Agent Service", description: "..." },
    ...
  ]

GET /api/agents/:id/a2a-card
  Response: A2A Agent Card JSON
```

## UI Integration

### Design Module - Export Panel

Add "Export" tab to agent detail panel:
- Target selector (dropdown)
- Agent selector (checkboxes or "Export All")
- Target-specific options
- Export button → Downloads ZIP
- Export history list

### Export Preview

Before downloading, show:
- Files that will be generated
- Estimated setup steps
- Required Azure resources (for Azure targets)

## Implementation Phases

### Phase 1: A2A JSON Export (MVP)
- [ ] Add `/api/agents/:id/a2a-card` endpoint
- [ ] Add `/api/agents/export` with `target: "a2a-json"`
- [ ] Generate compliant Agent Card JSON
- [ ] Include skills, relationships, integrations

### Phase 2: Azure Functions Generator
- [ ] TypeScript project template
- [ ] A2A HTTP handler generation
- [ ] Skill stub generation
- [ ] Bicep infrastructure template
- [ ] README with deployment instructions

### Phase 3: Python/LangGraph Generator
- [ ] Python project template
- [ ] LangGraph agent definition
- [ ] FastAPI A2A server
- [ ] Dockerfile for containerization

### Phase 4: Azure AI Agent Service
- [ ] Agent configuration generator
- [ ] Tool definition mapping
- [ ] Deployment script generation

### Phase 5: UI Integration
- [ ] Export tab in Design Module
- [ ] Target selector and options
- [ ] Download handling
- [ ] Export history

## Code Generation Principles

1. **Readable over clever** - Generated code should be easy to understand and modify
2. **Complete but minimal** - Include everything needed, nothing extra
3. **Well-documented** - README, inline comments, type definitions
4. **Production-ready** - Error handling, logging, configuration
5. **Idempotent** - Re-exporting produces the same output for same input

## Template Engine

Use Handlebars or EJS for code generation:

```typescript
// templates/azure-functions/skill.ts.hbs
import { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { A2AMessage, A2AResponse } from "../a2a/types";

/**
 * Skill: {{skill.name}}
 * {{skill.description}}
 */
export async function {{skill.functionName}}(
  message: A2AMessage,
  context: InvocationContext
): Promise<A2AResponse> {
  const input = message.parts.find(p => p.type === "data")?.data;
  
  // TODO: Implement skill logic
  // Input schema: {{json skill.inputSchema}}
  // Output schema: {{json skill.outputSchema}}
  
  return {
    role: "agent",
    parts: [
      {
        type: "data",
        data: {
          // Your response here
        }
      }
    ]
  };
}
```

## Security Considerations

1. **No secrets in exports** - API keys, credentials are placeholders
2. **Tenant isolation** - Can only export own agents
3. **Audit logging** - Track who exported what, when
4. **Expiring downloads** - Export URLs expire after 1 hour
