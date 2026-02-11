# FlowGrid A2A Prompt Engineering Implementation Plan

> **Version:** 1.0  
> **Created:** 2026-02-11  
> **Status:** Approved  

## Executive Summary

Re-engineer FlowGrid Wizard prompts to:
1. Split monolithic prompts into step-specific, composable prompts
2. Produce A2A-compliant agent definitions
3. Enable better UX in the Design Module through richer data structures

---

## Phase 1: Foundation (Week 1)

### 1.1 Database Schema Updates

**New Tables:**

```sql
-- A2A Agent Cards
CREATE TABLE agent_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- A2A Required Fields
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    url VARCHAR(500),
    version VARCHAR(50) DEFAULT '1.0.0',
    protocol_version VARCHAR(10) DEFAULT '1.0',
    
    -- Capabilities
    supports_streaming BOOLEAN DEFAULT false,
    supports_push_notifications BOOLEAN DEFAULT false,
    supports_extended_card BOOLEAN DEFAULT false,
    
    -- Input/Output modes
    default_input_modes TEXT[] DEFAULT ARRAY['text/plain', 'application/json'],
    default_output_modes TEXT[] DEFAULT ARRAY['application/json'],
    
    -- Full A2A card as JSON (for extensions)
    card_json JSONB NOT NULL DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(agent_id)
);

-- A2A Skills (per agent)
CREATE TABLE agent_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Skill identification
    skill_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Input/Output schemas (JSON Schema)
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    
    -- Modes
    input_modes TEXT[] DEFAULT ARRAY['application/json'],
    output_modes TEXT[] DEFAULT ARRAY['application/json'],
    
    -- Examples
    examples JSONB DEFAULT '[]',
    
    -- Ordering
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(agent_id, skill_id)
);

-- Enhanced agents table (add columns)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS element_type VARCHAR(50) DEFAULT 'Agent';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pattern VARCHAR(50);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level VARCHAR(50) DEFAULT 'supervised';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS risk_appetite VARCHAR(20) DEFAULT 'medium';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS triggers TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS outputs TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS process_steps TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS decision_points TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS error_handling TEXT;

-- Element relationships (enhanced)
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(50);
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS a2a_message_schema JSONB DEFAULT '{}';

-- Create indexes
CREATE INDEX idx_agent_cards_tenant ON agent_cards(tenant_id);
CREATE INDEX idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX idx_agents_element_type ON agents(tenant_id, element_type);
CREATE INDEX idx_agents_pattern ON agents(tenant_id, pattern);
```

**UX Impact:** 
- Design Module can show A2A Card preview for each agent
- Skills displayed as expandable cards with I/O schemas
- Pattern-based filtering and visualization

---

### 1.2 Prompt Architecture

**New Directory Structure:**
```
services/wizard-service/src/
├── prompts/
│   ├── index.ts              # Prompt registry & executor
│   ├── schemas.ts            # Zod validation schemas
│   ├── step1/
│   │   ├── extract.ts        # 1a: Extract capabilities
│   │   └── classify.ts       # 1b: Classify elements
│   ├── step3/
│   │   ├── propose-agents.ts # 3a: Group into agents
│   │   ├── assign-patterns.ts# 3b: Assign patterns
│   │   └── define-skills.ts  # 3c: A2A skills/contracts
│   ├── step4/
│   │   └── generate-bpmn.ts  # 4a: BPMN generation
│   └── step5/
│       ├── relationships.ts  # 5a: A2A relationships
│       └── integrations.ts   # 5b: External integrations
├── services/
│   └── ai.ts                 # Refactored to use prompt registry
```

---

## Phase 2: Prompt Implementation (Week 1-2)

### 2.1 Step 1: Identify Capabilities

#### Prompt 1a: Extract Capabilities
**Input:** Text description or image extraction  
**Output:** Raw capability list with hierarchy

```typescript
interface ExtractCapabilitiesOutput {
  capabilities: Array<{
    id: string;           // Generated UUID
    name: string;         // Display name  
    level: 0 | 1 | 2;     // Hierarchy depth
    parentId?: string;    // Parent capability
    description: string;  // Max 150 chars
    domain: string;       // Business domain
    keywords: string[];   // For search/filter
  }>;
  metadata: {
    sourceType: 'text' | 'image' | 'xml';
    totalExtracted: number;
    confidence: number;   // 0.0-1.0
    domains: string[];    // Unique domains found
  };
}
```

**UX Impact:**
- Capability tree shows domain groupings
- Confidence indicator on extraction results
- Keyword tags for filtering

#### Prompt 1b: Classify Elements
**Input:** Extracted capabilities  
**Output:** Typed elements (Agent/Capability/DataObject/Process)

```typescript
interface ClassifyElementsOutput {
  elements: Array<{
    id: string;           // From input
    name: string;
    elementType: 'Agent' | 'Capability' | 'DataObject' | 'Process';
    rationale: string;    // Why this type (max 80 chars)
    archiMateType?: string; // Optional ArchiMate mapping
  }>;
  summary: {
    agents: number;
    capabilities: number;
    dataObjects: number;
    processes: number;
  };
}
```

**UX Impact:**
- Color-coded element badges in Review step
- ArchiMate compliance indicator
- Type distribution chart

---

### 2.2 Step 3: Agent Design

#### Prompt 3a: Propose Agents
**Input:** Classified elements  
**Output:** Agent groupings with owned elements

```typescript
interface ProposeAgentsOutput {
  agents: Array<{
    id: string;
    name: string;
    purpose: string;          // Max 200 chars
    responsibilities: string[]; // 3-5 items
    ownedElements: string[];  // IDs of capabilities/data/processes
    suggestedPattern: AgenticPattern;
    suggestedAutonomy: 'autonomous' | 'supervised' | 'human-in-loop';
    boundaries: {
      internal: string[];     // What it handles itself
      delegates: string[];    // What it delegates
      escalates: string[];    // What needs human review
    };
  }>;
  orphanedElements: string[]; // Elements not assigned to any agent
}
```

**UX Impact:**
- Agent cards show responsibility list
- Boundary visualization (internal vs delegate vs escalate)
- Warning for orphaned elements

#### Prompt 3b: Assign Patterns
**Input:** Proposed agents  
**Output:** Pattern assignments with A2A metadata

```typescript
interface AssignPatternsOutput {
  agentPatterns: Array<{
    agentId: string;
    pattern: AgenticPattern;
    patternRationale: string;
    
    // A2A-specific
    autonomyLevel: 'autonomous' | 'supervised' | 'human-in-loop';
    riskAppetite: 'low' | 'medium' | 'high';
    
    a2aCapabilities: {
      streaming: boolean;
      pushNotifications: boolean;
    };
    
    triggers: string[];       // Events that activate
    outputs: string[];        // What it produces
    
    interactionStyle: 'sync' | 'async' | 'streaming';
    expectedLatency: 'realtime' | 'neartime' | 'batch';
  }>;
}
```

**UX Impact:**
- Pattern badge with icon on agent cards
- A2A capability indicators
- Latency/interaction style shown in detail view

#### Prompt 3c: Define Skills (NEW - A2A)
**Input:** Agents with patterns  
**Output:** A2A-compliant skill definitions

```typescript
interface DefineSkillsOutput {
  agentSkills: Array<{
    agentId: string;
    skills: Array<{
      skillId: string;        // e.g., "ticket-classification"
      name: string;
      description: string;
      
      // JSON Schemas
      inputSchema: JSONSchema;
      outputSchema: JSONSchema;
      
      // Example I/O
      examples: Array<{
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        scenario: string;
      }>;
      
      // Modes
      inputModes: string[];   // MIME types
      outputModes: string[];
    }>;
  }>;
}
```

**UX Impact:**
- Skills tab in agent detail panel
- Expandable schema viewer (JSON tree)
- "Try It" interface with example data

---

### 2.3 Step 4: Process Design

#### Prompt 4a: Generate Process Flow
**Input:** Process elements + agent assignments  
**Output:** BPMN-compatible process definitions

```typescript
interface GenerateProcessOutput {
  processes: Array<{
    elementId: string;        // Process element ID
    name: string;
    
    // BPMN structure
    startEvent: { id: string; name: string };
    endEvents: Array<{ id: string; name: string; type: 'normal' | 'error' | 'cancel' }>;
    
    tasks: Array<{
      id: string;
      name: string;
      type: 'serviceTask' | 'userTask' | 'scriptTask';
      assignedAgent?: string;  // Agent ID
      inputData: string[];
      outputData: string[];
    }>;
    
    gateways: Array<{
      id: string;
      type: 'exclusive' | 'parallel' | 'inclusive';
      condition?: string;
    }>;
    
    flows: Array<{
      id: string;
      sourceRef: string;
      targetRef: string;
      condition?: string;
    }>;
    
    // Raw BPMN XML (optional)
    bpmnXml?: string;
  }>;
}
```

**UX Impact:**
- Visual BPMN editor with agent task assignments
- Process step cards linked to agents
- Export to Camunda-compatible BPMN

---

### 2.4 Step 5: Interactions

#### Prompt 5a: Define Relationships
**Input:** Agents with skills  
**Output:** A2A-compliant message contracts

```typescript
interface DefineRelationshipsOutput {
  relationships: Array<{
    id: string;
    sourceAgentId: string;
    targetAgentId: string;
    
    // A2A Message definition
    messageType: string;      // e.g., "TicketClassificationRequest"
    description: string;
    
    // Contract
    messageSchema: JSONSchema;
    responseSchema?: JSONSchema;
    
    // Behavior
    isAsync: boolean;
    retryPolicy?: {
      maxRetries: number;
      backoffMs: number;
    };
    
    // ArchiMate relationship type
    archiMateType?: 'Flow' | 'Triggering' | 'Access' | 'Serving' | 'Realization';
  }>;
  
  messageTypes: Array<{
    name: string;
    schema: JSONSchema;
    usedBy: string[];       // Agent IDs
  }>;
}
```

**UX Impact:**
- Relationship diagram with message type labels
- Click relationship to see contract details
- Message catalog view

---

## Phase 3: Design Module UX Enhancements (Week 2-3)

### 3.1 Agent Detail Panel Redesign

**New Tabs:**
1. **Overview** - Summary, pattern, autonomy, A2A capabilities
2. **Skills** - A2A skill definitions with schemas
3. **Relationships** - Incoming/outgoing with message types
4. **Process** - BPMN viewer for Process elements
5. **A2A Card** - Raw JSON preview with copy button
6. **Code** - Generated code snippets (TypeScript, Python)

### 3.2 New Views

**A2A Catalog View:**
- Grid of all agents as "Agent Cards"
- Filterable by pattern, autonomy, capabilities
- Quick copy A2A card JSON

**Message Registry:**
- All message types across agents
- Schema viewer
- Usage graph (which agents send/receive)

**Skills Matrix:**
- Agents × Skills matrix view
- Identify gaps and overlaps
- Suggest skill consolidation

### 3.3 Graph Enhancements

**Node Improvements:**
- Pattern icon inside node
- A2A capability indicators (streaming, push)
- Skill count badge

**Edge Improvements:**
- Message type label on hover
- Async vs sync visual distinction
- Click to see contract

---

## Phase 4: Validation & Quality (Week 3)

### 4.1 Zod Schema Validation

```typescript
// schemas.ts
import { z } from 'zod';

export const ExtractCapabilitiesSchema = z.object({
  capabilities: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(2).max(100),
    level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    parentId: z.string().uuid().optional(),
    description: z.string().max(150),
    domain: z.string(),
    keywords: z.array(z.string()),
  })),
  metadata: z.object({
    sourceType: z.enum(['text', 'image', 'xml']),
    totalExtracted: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    domains: z.array(z.string()),
  }),
});
```

### 4.2 A2A Compliance Tests

```typescript
// tests/a2a-compliance.test.ts
describe('A2A Compliance', () => {
  it('Agent Card has required fields', () => {
    // name, description, url, version, protocolVersion
  });
  
  it('Skills have valid JSON Schemas', () => {
    // inputSchema, outputSchema are valid JSON Schema
  });
  
  it('Message contracts are bidirectionally valid', () => {
    // Source output matches target input
  });
});
```

---

## Implementation Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Foundation | DB migration, prompt directory structure |
| 1-2 | Prompts | All 8 prompts implemented with validation |
| 2-3 | UX | Design Module enhancements |
| 3 | Quality | Tests, documentation |

---

## Linear Issues to Create

### Epic: A2A Prompt Engineering
1. **[ARCH]** Database schema for A2A compliance
2. **[ARCH]** Prompt registry and executor framework
3. **[PROMPT]** Step 1a: Extract Capabilities prompt
4. **[PROMPT]** Step 1b: Classify Elements prompt
5. **[PROMPT]** Step 3a: Propose Agents prompt
6. **[PROMPT]** Step 3b: Assign Patterns prompt
7. **[PROMPT]** Step 3c: Define Skills prompt (A2A)
8. **[PROMPT]** Step 4a: Generate Process Flow prompt
9. **[PROMPT]** Step 5a: Define Relationships prompt
10. **[UX]** Agent detail panel redesign
11. **[UX]** A2A Catalog view
12. **[UX]** Message Registry view
13. **[UX]** Graph enhancements for A2A
14. **[TEST]** Zod validation for all prompts
15. **[TEST]** A2A compliance test suite
16. **[DOCS]** A2A integration documentation

---

## Success Metrics

1. **Prompt Quality:** >95% valid JSON responses
2. **A2A Compliance:** All agents have valid Agent Cards
3. **UX Satisfaction:** Skills/contracts visible in Design Module
4. **Developer Experience:** TypeScript types for all structures
