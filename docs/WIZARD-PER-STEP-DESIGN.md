# Wizard Per-Step Execution Design

> **Status:** Draft - Awaiting Approval  
> **Date:** 2026-02-11  
> **Author:** CHEF

## Overview

Refactor the wizard to execute AI prompts **per-step** instead of all-at-once, allowing user selections to inform subsequent steps. All generated data flows into the Design Module.

---

## Current State

```
Step 1 → ALL 7 prompts execute (1a, 1b, 3a, 3b, 3c, 5a, 5b)
Steps 2-6 → Display pre-computed results only
```

**Problems:**
- ~2 minute wait upfront
- User selections in Step 2 don't influence Step 3
- Pattern/skill assignments ignore user's capability choices
- Relationships generated without knowing final agent structure

---

## Proposed Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 1: IDENTIFY CAPABILITIES                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ Input: Text description / XML file / Image                               │
│ Prompts: 1a (Extract Capabilities)                                       │
│ Output: Raw capabilities list                                            │
│ Time: ~10-15 seconds                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 2: REVIEW & CLASSIFY                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ User Action: Select/deselect capabilities, add custom ones               │
│ Prompts: 1b (Classify Elements) - only selected capabilities             │
│ Output: Typed elements (Agent/Capability/DataObject/Process)             │
│ Time: ~8-10 seconds                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 3: DESIGN AGENTS                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ User Action: Review proposed groupings, adjust agent boundaries          │
│ Prompts: 3a (Propose Agents) - from classified elements                  │
│ Output: Agent definitions with assigned capabilities                     │
│ Time: ~15-20 seconds                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 4: CONFIGURE AGENTS                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ User Action: Adjust patterns, autonomy levels, risk appetite             │
│ Prompts: 3b (Assign Patterns) + 3c (Define Skills)                       │
│ Output: Patterns, A2A skills with JSON schemas                           │
│ Time: ~20-25 seconds                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 5: DEFINE PROCESSES                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ User Action: Review process elements, click "Generate BPMN" per process  │
│ Prompts: 4a (Generate BPMN Flow) - AI Business Process Consultant        │
│ Output: Valid BPMN 2.0 XML compatible with bpmn-js                       │
│ Time: ~20-30 seconds (per process)                                       │
│ Note: Also available in Design Module → Process tab                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ WIZARD STEP 6: RELATIONSHIPS & DEPLOY                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ User Action: Review relationships, integrations, then deploy             │
│ Prompts: 5a (Relationships) + 5b (Integrations)                          │
│ Output: Inter-agent relationships, external integrations                 │
│ Action: Save ALL to database                                             │
│ Time: ~25-30 seconds                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Design

### Session State

Each wizard session stores intermediate state:

```typescript
interface WizardSessionState {
  // Step 1 output
  rawCapabilities?: ExtractedCapability[];
  
  // Step 2 input/output
  selectedCapabilities?: string[];  // IDs user selected
  classifiedElements?: ClassifiedElement[];
  
  // Step 3 input/output
  agentGroupings?: AgentGrouping[];  // User can adjust
  proposedAgents?: ProposedAgent[];
  
  // Step 4 output
  agentConfigs?: AgentConfig[];  // Patterns, skills, autonomy
  
  // Step 5 output
  processFlows?: { elementId: string; bpmnXml: string }[];
  
  // Step 6 output
  relationships?: AgentRelationship[];
  integrations?: Integration[];
}
```

### New Endpoints

```
POST /api/wizard/sessions
  → Create new session, return sessionId

GET /api/wizard/sessions/:id
  → Get session state

POST /api/wizard/sessions/:id/step1
  Body: { description?: string, file?: File }
  → Run prompt 1a, return capabilities
  
POST /api/wizard/sessions/:id/step2
  Body: { selectedCapabilityIds: string[] }
  → Run prompt 1b on selected, return classified elements

POST /api/wizard/sessions/:id/step3
  Body: { classifiedElements: Element[], userAdjustments?: Adjustment[] }
  → Run prompt 3a, return proposed agents

POST /api/wizard/sessions/:id/step4
  Body: { agents: Agent[] }
  → Run prompts 3b + 3c, return patterns + skills

POST /api/wizard/sessions/:id/step5
  Body: { processElements: Element[] }
  → Run prompt 4a for each process, return BPMN

POST /api/wizard/sessions/:id/step6
  Body: { agents: Agent[], requestIntegrations: boolean }
  → Run prompts 5a + 5b, return relationships + integrations

POST /api/wizard/sessions/:id/apply
  → Save everything to database, redirect to design module
```

---

## Database Schema Changes

### wizard_sessions (Update)

```sql
ALTER TABLE wizard_sessions ADD COLUMN IF NOT EXISTS 
  current_step INTEGER DEFAULT 1;

ALTER TABLE wizard_sessions ADD COLUMN IF NOT EXISTS 
  step_data JSONB DEFAULT '{}';
  
-- step_data structure:
-- {
--   "step1": { "rawCapabilities": [...] },
--   "step2": { "selectedIds": [...], "classifiedElements": [...] },
--   "step3": { "proposedAgents": [...] },
--   "step4": { "agentConfigs": [...] },
--   "step5": { "processFlows": [...] },
--   "step6": { "relationships": [...], "integrations": [...] }
-- }
```

### agents (Ensure columns exist)

```sql
-- From migration 005, but verify:
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pattern VARCHAR(50);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pattern_rationale TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level VARCHAR(20) DEFAULT 'supervised';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS risk_appetite VARCHAR(20) DEFAULT 'medium';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS triggers TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS outputs TEXT[] DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS process_bpmn TEXT;  -- NEW: Store BPMN XML
ALTER TABLE agents ADD COLUMN IF NOT EXISTS boundaries JSONB DEFAULT '{}';  -- NEW: delegates, escalates
```

### agent_skills (New table from 005)

```sql
-- Already exists from migration 005
CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    input_schema JSONB NOT NULL DEFAULT '{}',
    output_schema JSONB NOT NULL DEFAULT '{}',
    examples JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### agent_interactions (Ensure columns)

```sql
-- From migration 005:
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(50);
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS message_schema JSONB DEFAULT '{}';
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS is_async BOOLEAN DEFAULT false;
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
```

### agent_integrations (Ensure columns)

```sql
-- Add data flow tracking
ALTER TABLE agent_integrations ADD COLUMN IF NOT EXISTS data_flows JSONB DEFAULT '[]';
-- data_flows: [{ "direction": "inbound|outbound", "dataType": "...", "frequency": "..." }]
```

---

## Data Flow to Design Module

When user clicks "Deploy" (Step 6), the `/apply` endpoint:

### 1. Create Agents

```typescript
for (const agent of finalAgents) {
  await db.query(`
    INSERT INTO agents (
      tenant_id, name, description, status, element_type,
      pattern, pattern_rationale, autonomy_level, risk_appetite,
      triggers, outputs, process_bpmn, boundaries, capabilities
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id
  `, [
    tenantId,
    agent.name,
    agent.description,
    'draft',
    agent.elementType,
    agent.pattern,
    agent.patternRationale,
    agent.autonomyLevel,
    agent.riskAppetite,
    agent.triggers,
    agent.outputs,
    agent.processBpmn,
    JSON.stringify(agent.boundaries),
    agent.capabilities
  ]);
}
```

### 2. Create Skills (A2A)

```typescript
for (const skill of agent.skills) {
  await db.query(`
    INSERT INTO agent_skills (
      agent_id, skill_id, name, description,
      input_schema, output_schema, examples
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    agentId,
    skill.skillId,
    skill.name,
    skill.description,
    JSON.stringify(skill.inputSchema),
    JSON.stringify(skill.outputSchema),
    JSON.stringify(skill.examples || [])
  ]);
}
```

### 3. Create Relationships

```typescript
for (const rel of relationships) {
  await db.query(`
    INSERT INTO agent_interactions (
      source_agent_id, target_agent_id, message_type, description,
      relationship_type, message_schema, is_async, priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    sourceAgentId,
    targetAgentId,
    rel.messageType,
    rel.description,
    rel.relationshipType,
    JSON.stringify(rel.messageSchema),
    rel.isAsync,
    rel.priority
  ]);
}
```

### 4. Create Integrations

```typescript
for (const integration of integrations) {
  await db.query(`
    INSERT INTO agent_integrations (
      agent_id, integration_type, config, status, data_flows
    ) VALUES ($1, $2, $3, $4, $5)
  `, [
    agentId,
    integration.type,
    JSON.stringify(integration.config),
    'pending',
    JSON.stringify(integration.dataFlows)
  ]);
}
```

---

## Design Module Display

### Graph View
- **Nodes:** All agents with element_type color coding
- **Edges:** From agent_interactions (relationship lines)
- **Node badges:** Pattern icon, skill count

### Right Panel (Agent selected)

| Tab | Data Source |
|-----|-------------|
| Overview | agents.description, capabilities, pattern |
| Skills | agent_skills (expandable JSON schemas) |
| Relationships | agent_interactions (filtered by agent) |
| Process | agents.process_bpmn (BPMN viewer) |
| Integrations | agent_integrations (filtered by agent) |
| A2A Card | Generated from agent + skills + relationships |
| Code | Export to Azure Functions / Python |

### Relationships Tab (Two-column)
- Shows all agent_interactions
- Color-coded by relationship_type
- Click to see message_schema

### Integrations Panel (New)
- List of external systems
- Grouped by integration_type
- Shows data_flows direction

---

## Frontend Changes (wizard.html)

### Step Navigation

```javascript
async function goToStep(stepNumber) {
  // Save current step data
  await saveCurrentStepData();
  
  // Execute AI prompt for next step
  showLoading(true);
  const result = await executeStepPrompt(stepNumber);
  showLoading(false);
  
  // Update UI with results
  renderStepResults(stepNumber, result);
  
  // Update progress bar
  updateProgressBar(stepNumber);
}
```

### Per-Step Loading States

```javascript
const STEP_CONFIG = {
  1: { prompt: 'extract', loadingText: 'Analyzing your description...', time: '~15s' },
  2: { prompt: 'classify', loadingText: 'Classifying elements...', time: '~10s' },
  3: { prompt: 'propose', loadingText: 'Designing agent structure...', time: '~20s' },
  4: { prompt: 'configure', loadingText: 'Configuring patterns & skills...', time: '~25s' },
  5: { prompt: 'process', loadingText: 'Generating process flows...', time: '~20s' },
  6: { prompt: 'finalize', loadingText: 'Defining relationships...', time: '~30s' },
};
```

### User Edit Callbacks

Each step allows edits that feed into the next:

```javascript
// Step 2: User toggles capability selection
function onCapabilityToggle(capabilityId, selected) {
  sessionState.selectedCapabilities = selected 
    ? [...sessionState.selectedCapabilities, capabilityId]
    : sessionState.selectedCapabilities.filter(id => id !== capabilityId);
}

// Step 3: User adjusts agent grouping
function onAgentAdjustment(agentId, change) {
  sessionState.agentAdjustments.push({ agentId, ...change });
}

// Step 4: User overrides pattern
function onPatternOverride(agentId, newPattern) {
  sessionState.patternOverrides[agentId] = newPattern;
}
```

---

## Implementation Plan

### Phase 1: Backend (2-3 hours)
1. Add `step_data` column to wizard_sessions
2. Create per-step endpoints (`/step1`, `/step2`, etc.)
3. Refactor ai-chain.ts to support individual step execution
4. Update `/apply` to save all data properly

### Phase 2: Frontend (2-3 hours)
1. Refactor wizard.html step navigation
2. Add per-step API calls with loading states
3. Implement user edit callbacks
4. Add "Back" functionality (reload previous step data)

### Phase 3: Design Module (1-2 hours)
1. Update loadAgents() to include new fields
2. Update right panel tabs for skills, integrations
3. Add relationships display in graph edges
4. Ensure BPMN tab loads process_bpmn

### Phase 4: Testing (1 hour)
1. End-to-end wizard flow
2. Verify all data appears in design module
3. Test edit → re-run scenarios

---

---

## Prompt 4a: Generate BPMN Flow

### System Prompt

```
You are a Business Process Consultant, specialized in creating BPMN flows 
and process documentation. You have deep expertise in:

- BPMN 2.0 specification and best practices
- Process modeling patterns (sequential, parallel, conditional)
- Error handling and compensation flows
- Integration with agent-based systems

Your task is to generate valid BPMN 2.0 XML that can be rendered by bpmn-js.
```

### User Prompt Template

```
Create a BPMN 2.0 process flow for the following process:

**Process Name:** {{processName}}
**Description:** {{processDescription}}
**Involved Agents:** {{involvedAgents}}
**Capabilities Used:** {{capabilities}}
**Expected Triggers:** {{triggers}}
**Expected Outputs:** {{outputs}}

Requirements:
1. Generate valid BPMN 2.0 XML
2. Include appropriate start/end events
3. Use service tasks for agent interactions
4. Add gateways for decision points
5. Include error boundary events where appropriate
6. Use descriptive task names
7. Add lane pools for different agents/roles if multiple agents involved

Output ONLY the BPMN XML, no explanation.
```

### Output Schema

```typescript
interface BPMNGenerationOutput {
  processId: string;
  processName: string;
  bpmnXml: string;  // Valid BPMN 2.0 XML
  summary: {
    taskCount: number;
    gatewayCount: number;
    laneCount: number;
    estimatedDuration?: string;
  };
}
```

### BPMN XML Template (for AI reference)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://flowgrid.ai/bpmn">
  <bpmn:process id="Process_{{id}}" name="{{name}}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <!-- Tasks, gateways, events here -->
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_N</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_{{id}}">
      <!-- Visual layout coordinates -->
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
```

### API Endpoints

```
# Wizard context
POST /api/wizard/sessions/:id/generate-bpmn
Body: { processElementId: string }
Returns: { bpmnXml: string, summary: {...} }

# Design Module context (standalone)
POST /api/agents/:id/generate-bpmn
Body: { context?: string }  // Optional additional context
Returns: { bpmnXml: string, summary: {...} }
```

### UI Integration

**Wizard Step 5:**
```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 Identified Processes                                         │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☐ Ticket Routing Process                                    │ │
│ │   Routes incoming tickets to appropriate agents             │ │
│ │   Agents: Triage Agent, Router Agent                        │ │
│ │   [🔄 Generate BPMN] [👁️ Preview]                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☐ Escalation Process                                        │ │
│ │   Handles ticket escalation to human operators              │ │
│ │   Agents: Escalation Agent, Notification Agent              │ │
│ │   [🔄 Generate BPMN] [👁️ Preview]                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Design Module → Process Tab:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Process: Ticket Routing                          [🔄 Regenerate]│
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                    [BPMN Diagram Viewer]                    │ │
│ │                                                             │ │
│ │    (○)──▶[Receive Ticket]──▶◇──▶[Route to Agent]──▶(◉)     │ │
│ │                              │                              │ │
│ │                              ▼                              │ │
│ │                        [Escalate]                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ No BPMN defined. [🔄 Generate with AI]                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Back navigation:** Should "Back" re-run the prompt or just show cached results?
   - **Recommendation:** Show cached, with "Regenerate" button

2. **Partial saves:** Should we auto-save after each step?
   - **Recommendation:** Yes, to wizard_sessions.step_data

3. **Skip steps:** Can user skip Step 5 (Processes) if no Process elements?
   - **Recommendation:** Yes, auto-skip with notification

4. **Timeout handling:** What if a step times out?
   - **Recommendation:** Show retry button, keep previous step data

---

## Approval Checklist

- [ ] Overall architecture approved
- [ ] API endpoint design approved
- [ ] Database schema changes approved
- [ ] Data flow to design module approved
- [ ] Implementation timeline acceptable

**Estimated total time:** 6-9 hours

---

*Awaiting approval to proceed with implementation.*
