# Level 1 → Level 2 Architecture: Design + Smart Export

> **FlowGrid Platform Evolution**
> Author: CHEF (Architecture Assistant)
> Date: 2026-02-13
> Status: Draft
> Version: 2.0 — Updated for Dual BPMN Execution Approach

## Executive Summary

Level 2 transforms FlowGrid from a pure design tool into a **design-and-export platform**. Users design agent systems visually, then export executable code packages targeting real orchestration frameworks. The first target is **LangGraph** (LangChain's agent orchestration library).

The key addition is a **Code Generation Engine** — a pluggable, template-driven system that maps FlowGrid's internal model (agents, capabilities, relationships, BPMN) to target-specific constructs.

### The Dual BPMN Approach

FlowGrid uses BPMN at **two levels** with different execution strategies:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FlowGrid BPMN Strategy                        │
│                                                                  │
│  ┌─────────────────────────────┐  ┌────────────────────────────┐│
│  │  ORCHESTRATOR BPMN          │  │  AGENT INTERNAL BPMN       ││
│  │  (coordination between      │  │  (logic within a single    ││
│  │   agents)                   │  │   agent)                   ││
│  │                             │  │                            ││
│  │  Level 3: Runs LIVE in     │  │  Level 2: Code-generated   ││
│  │  bpmn-engine (Node.js)     │  │  into native functions     ││
│  │                             │  │  (Azure Function / TS / Py)││
│  │  • serviceTask → agent     │  │                            ││
│  │  • userTask → HITL         │  │  • Steps → function calls  ││
│  │  • gateways → routing      │  │  • LLM calls → native code││
│  │  • Hot-reloadable          │  │  • Tools → SDK integrations││
│  │                             │  │  • Re-export on change    ││
│  └─────────────────────────────┘  └────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Why this split?**
- **Orchestration** = coordination logic ("first A, then B, if X ask human") → perfect for a live BPMN engine
- **Agent internals** = cognitive work ("call LLM, parse response, reason about confidence") → doesn't map well to BPMN execution, better as native code
- **Performance**: no engine overhead for agent internals
- **Flexibility**: change orchestration flows without redeploying agents

**What Level 2 exports:**
1. **Agent internal code** — generated FROM agent internal BPMNs (always)
2. **Standalone orchestrator code** — generated FROM orchestrator BPMN (optional, for users targeting CrewAI/LangGraph instead of FlowGrid's own runtime)

Users who plan to use FlowGrid Level 3 do NOT need the standalone orchestrator export — the orchestrator BPMN will run live in `bpmn-engine` at runtime. But for users who want a fully self-contained export (e.g., deploying to their own infrastructure with LangGraph), the standalone mode code-generates the orchestrator too.

---

## 1. Code Generation Engine Architecture

### 1.1 Design Principles

- **Pluggable targets**: Each export format is a self-contained plugin
- **Template-driven**: Jinja2-style templates for code generation (using Handlebars for Node.js)
- **Two-phase**: First transform FlowGrid model → intermediate representation (IR), then IR → target code
- **Deterministic**: Same design always produces identical output (no AI in the export path)
- **Validated**: Generated code is statically validated before packaging
- **Dual-scope**: Generates agent internal code (always) + orchestrator code (standalone mode only)

### 1.2 Engine Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Code Generation Engine                          │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌───────────────────────────┐  │
│  │  Model    │    │   IR     │    │     Target Plugins        │  │
│  │  Loader   │───▶│ Builder  │───▶│                           │  │
│  │          │    │          │    │  ┌─────────────────────┐  │  │
│  └──────────┘    └──────────┘    │  │  LangGraph          │  │  │
│       │                │          │  │  (standalone orch +  │  │  │
│       │                │          │  │   agent internals)   │  │  │
│       ▼                ▼          │  ├─────────────────────┤  │  │
│  ┌──────────┐    ┌──────────┐    │  │  CrewAI             │  │  │
│  │  Design   │    │ Intermed │    │  ├─────────────────────┤  │  │
│  │  Store    │    │  Repr.   │    │  │  Azure Functions    │  │  │
│  │ (PG/API) │    │ (JSON)   │    │  │  (agent-only mode)  │  │  │
│  └──────────┘    └──────────┘    │  ├─────────────────────┤  │  │
│                                   │  │  Custom             │  │  │
│                                   │  └─────────────────────┘  │  │
│                                   └───────────────┬───────────┘  │
│                                                   │              │
│                                            ┌──────▼──────┐      │
│                                            │ Validator   │      │
│                                            │ & Packager  │      │
│                                            └─────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Export Modes

The code generation engine supports two export modes:

| Mode | What's Generated | Use Case |
|---|---|---|
| **Agent-only** (default) | Agent internal code from agent BPMNs | Users planning to use FlowGrid Level 3 runtime |
| **Standalone** | Agent code + orchestrator code from orchestrator BPMN | Users deploying to LangGraph/CrewAI/their own infra |

```typescript
interface ExportOptions {
  mode: 'agent-only' | 'standalone';  // NEW
  includeTests: boolean;
  includeDockerfile: boolean;
  includeReadme: boolean;
  llmProvider: 'openai' | 'anthropic' | 'azure_openai';
  deployTarget: 'azure-functions' | 'docker' | 'local';  // NEW
  pythonVersion: '3.11' | '3.12';
  toolStubStyle: 'pass' | 'raise' | 'mock';
}
```

**Agent-only mode** generates:
- One Azure Function (or Python module) per agent, scaffolded from the agent's internal BPMN
- Tool stubs, schemas, config
- Deployment manifest (e.g., Azure Function host.json)
- No orchestrator code — the orchestrator BPMN is consumed by `bpmn-engine` at Level 3

**Standalone mode** additionally generates:
- Orchestrator code (LangGraph StateGraph, CrewAI Crew, etc.) from the orchestrator BPMN
- HITL hooks mapped to the target framework
- Server/runner entry point
- Full self-contained deployment package

### 1.4 Intermediate Representation (IR)

The IR is a normalized, target-agnostic JSON structure extracted from FlowGrid's design:

```typescript
interface ExportIR {
  metadata: {
    designId: string;
    designVersion: number;
    exportedAt: string;
    flowgridVersion: string;
    exportMode: 'agent-only' | 'standalone';  // NEW
  };
  agents: AgentIR[];
  orchestratorFlows: FlowIR[];       // orchestrator BPMN (only used in standalone mode)
  agentInternalFlows: AgentFlowIR[]; // agent internal BPMNs (always used)
  relationships: RelationshipIR[];
  dataObjects: DataObjectIR[];
  humanTasks: HumanTaskIR[];
  tools: ToolIR[];
}

interface AgentIR {
  id: string;
  name: string;
  slug: string;                    // kebab-case, safe for filenames
  role: string;
  capabilities: CapabilityIR[];
  pattern: 'reactive' | 'proactive' | 'deliberative' | 'hybrid';
  tools: string[];                 // references to ToolIR.id
  systemPrompt?: string;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  internalBpmnRef?: string;        // reference to AgentFlowIR.id
}

// NEW: Agent internal BPMN → code generation
interface AgentFlowIR {
  id: string;
  agentRef: string;                // which agent this flow belongs to
  name: string;
  bpmnXml: string;                 // raw BPMN 2.0 XML for the agent's internal logic
  steps: AgentStepIR[];            // linearized steps extracted from BPMN
  errorHandlers: ErrorHandlerIR[];
}

interface AgentStepIR {
  id: string;
  name: string;
  type: 'llm_call' | 'tool_call' | 'condition' | 'transform' | 'output';
  config: Record<string, unknown>;
  next: string[];                  // next step IDs
  errorHandler?: string;           // error handler ID
}

interface FlowIR {
  id: string;
  name: string;
  bpmnXml: string;                 // raw BPMN 2.0 XML
  startEvents: string[];
  endEvents: string[];
  tasks: TaskIR[];
  gateways: GatewayIR[];
  sequenceFlows: SequenceFlowIR[];
  dataAssociations: DataAssociationIR[];
}

interface TaskIR {
  id: string;
  name: string;
  type: 'serviceTask' | 'userTask' | 'scriptTask' | 'sendTask' | 'receiveTask';
  agentRef?: string;               // which agent handles this
  isHITL: boolean;                 // human-in-the-loop checkpoint
  hitlConfig?: {
    approvalType: 'approve_reject' | 'review_edit' | 'inform';
    timeout?: number;              // seconds
    escalateTo?: string;
  };
  inputMappings: DataMapping[];
  outputMappings: DataMapping[];
}

interface GatewayIR {
  id: string;
  type: 'exclusive' | 'parallel' | 'inclusive' | 'eventBased';
  conditions: Array<{
    flowRef: string;
    expression: string;
  }>;
}

interface DataObjectIR {
  id: string;
  name: string;
  schema: JSONSchema;
  scope: 'flow' | 'agent' | 'global';
}

interface ToolIR {
  id: string;
  name: string;
  slug: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  implementation: 'stub' | 'api_call' | 'function';
  apiConfig?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
  };
}

interface HumanTaskIR {
  id: string;
  taskRef: string;
  interruptPoint: 'before' | 'after';
  description: string;
  approvalType: string;
}
```

### 1.5 Target Plugin Interface

```typescript
interface ExportPlugin {
  readonly name: string;           // e.g., 'langgraph'
  readonly version: string;
  readonly displayName: string;    // e.g., 'LangGraph (Python)'
  readonly fileExtension: string;  // e.g., 'py'
  readonly supportsStandalone: boolean;  // NEW: can generate orchestrator code?
  readonly supportsAgentOnly: boolean;   // NEW: can generate agent-only code?

  /**
   * Validate that the IR can be exported to this target.
   * Returns warnings/errors for unsupported constructs.
   */
  validate(ir: ExportIR): ValidationResult;

  /**
   * Generate the export package from the IR.
   * Returns a map of relative file paths → file contents.
   */
  generate(ir: ExportIR, options: ExportOptions): Promise<ExportPackage>;
}

interface ExportPackage {
  files: Map<string, string | Buffer>;  // path → content
  manifest: ExportManifest;
  warnings: string[];
}

interface ExportManifest {
  target: string;
  exportMode: 'agent-only' | 'standalone';  // NEW
  generatedAt: string;
  files: Array<{
    path: string;
    type: 'agent' | 'tool' | 'flow' | 'config' | 'test' | 'readme' | 'orchestrator';
    description: string;
  }>;
}
```

---

## 2. Agent Internal BPMN → Code Generation

### 2.1 How It Works

Each agent in FlowGrid has an **internal BPMN** that describes its cognitive workflow — the steps it takes to process input and produce output. At export time, this BPMN is transformed into native code:

```
┌───────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Agent Internal BPMN  │     │  Code Generation │     │  Native Function │
│                       │────▶│  Engine           │────▶│                  │
│  ┌─────┐  ┌───────┐  │     │                  │     │  Azure Function  │
│  │Parse│─▶│Classify│  │     │  • Extract steps │     │  or Python module│
│  │Input│  │Intent │  │     │  • Map to code   │     │  or TypeScript   │
│  └─────┘  └───┬───┘  │     │  • Wire up LLM   │     │                  │
│           ┌───▼───┐   │     │  • Add tools     │     │  Developer fills │
│           │Route  │   │     │  • Generate stubs│     │  in AI logic     │
│           │by Type│   │     └──────────────────┘     └──────────────────┘
│           └───────┘   │
└───────────────────────┘
```

**Key principle**: The BPMN defines the STRUCTURE, the developer fills in the EXECUTION logic (LLM calls, tool usage, ReAct loops). The generated code is a scaffolding, not a complete implementation.

### 2.2 Agent Code Generation (Azure Functions Target)

```typescript
// Generated: agents/classifier-agent/index.ts
// Source: Agent Internal BPMN for "Classifier Agent"
// Generated by FlowGrid Export v{version}
//
// STRUCTURE from BPMN — fill in AI logic where marked TODO

import { AzureFunction, Context, HttpRequest } from '@azure/functions';

interface ClassifierInput {
  ticketDescription: string;
  category_hint?: string;
}

interface ClassifierOutput {
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

/**
 * Classifier Agent — Azure Function entry point
 * Pattern: reactive
 * 
 * Internal BPMN steps:
 *   1. parseInput — extract ticket data
 *   2. classifyIntent — LLM call to classify
 *   3. assessPriority — determine priority from classification
 *   4. validateOutput — check confidence threshold
 */
const classifierAgent: AzureFunction = async (
  context: Context,
  req: HttpRequest,
): Promise<ClassifierOutput> => {
  const input: ClassifierInput = req.body;

  // Step 1: parseInput (from BPMN scriptTask)
  const parsed = parseInput(input);

  // Step 2: classifyIntent (from BPMN serviceTask — LLM call)
  const classification = await classifyIntent(parsed);

  // Step 3: assessPriority (from BPMN serviceTask)
  const priority = await assessPriority(classification);

  // Step 4: validateOutput (from BPMN gateway + scriptTask)
  if (classification.confidence < 0.7) {
    // Low confidence path (from BPMN exclusive gateway)
    return {
      category: 'unclassified',
      priority: 'medium',
      confidence: classification.confidence,
    };
  }

  return {
    category: classification.category,
    priority: priority,
    confidence: classification.confidence,
  };
};

// --- Step implementations (fill in AI logic) ---

function parseInput(input: ClassifierInput) {
  // TODO: Implement input parsing/normalization
  return { description: input.ticketDescription, hint: input.category_hint };
}

async function classifyIntent(parsed: any) {
  // TODO: Implement LLM classification call
  // Example:
  // const response = await llm.chat({
  //   messages: [{ role: 'system', content: CLASSIFY_PROMPT }, ...],
  //   response_format: { type: 'json_object' },
  // });
  throw new Error('Not implemented: classifyIntent — add LLM call here');
}

async function assessPriority(classification: any) {
  // TODO: Implement priority assessment logic
  throw new Error('Not implemented: assessPriority');
}

export default classifierAgent;
```

### 2.3 Agent Code Generation (LangGraph/Python Target)

```python
# Generated: agents/classifier_agent.py
# Source: Agent Internal BPMN for "Classifier Agent"
# Generated by FlowGrid Export v{version}

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_anthropic import ChatAnthropic

async def classifier_agent(state: FlowState) -> dict:
    """
    Agent: Classifier Agent
    Pattern: reactive
    Capabilities: ticket_classification, priority_assessment
    
    Internal BPMN steps:
      1. parseInput
      2. classifyIntent (LLM call)
      3. assessPriority
      4. validateOutput (confidence gate)
    """
    llm = ChatAnthropic(model="claude-sonnet-4-20250514")

    system_prompt = """You are a Classifier Agent.
    Role: {role_from_flowgrid}

    Capabilities:
    - ticket_classification: {capability_description}
    - priority_assessment: {capability_description}

    Instructions:
    {instructions_from_flowgrid}
    """

    # Bind tools if agent has them
    tools = [classify_ticket, assess_priority]
    llm_with_tools = llm.bind_tools(tools)

    response = await llm_with_tools.ainvoke([
        SystemMessage(content=system_prompt),
        *state["messages"]
    ])

    return {
        "messages": [response],
        "classification_result": {
            # Output mapping from FlowGrid
        }
    }
```

---

## 3. Standalone Orchestrator Export (Optional)

### 3.1 When to Use Standalone Mode

Standalone mode generates orchestrator code FROM the orchestrator BPMN. Use this when:

- You want a **fully self-contained** export (no FlowGrid runtime dependency)
- You're deploying to **LangGraph**, **CrewAI**, or another framework
- You want to run everything on **your own infrastructure**
- You don't plan to use FlowGrid Level 3

**If you plan to use FlowGrid Level 3**, skip standalone mode. The orchestrator BPMN will run live in `bpmn-engine` — no code generation needed. Only export the agent internal code.

### 3.2 First Target: LangGraph (Standalone Mode)

#### Mapping Overview

| FlowGrid Concept | LangGraph Construct |
|---|---|
| Orchestrator BPMN Process | `StateGraph` |
| Service Task (agent) | Graph node (calls agent function) |
| User Task (HITL) | `interrupt_before` / `interrupt_after` |
| Exclusive Gateway | Conditional edges (`add_conditional_edges`) |
| Parallel Gateway | Fan-out with parallel node execution |
| Data Object | State channel (TypedDict field) |
| Agent relationship | Edge between nodes |
| Start Event | `START` node |
| End Event | `END` node |
| Tool | LangGraph `ToolNode` / `@tool` decorated function |
| Agent capabilities | System prompt sections |
| Sequence Flow condition | Edge condition function |

#### State Mapping

FlowGrid DataObjects become fields in a LangGraph `TypedDict` state:

```python
# Generated from FlowGrid DataObjects
from typing import TypedDict, Annotated, Sequence
from langgraph.graph.message import add_messages

class FlowState(TypedDict):
    """Auto-generated from FlowGrid design: {design_name}"""

    # Core message history
    messages: Annotated[Sequence[BaseMessage], add_messages]

    # From DataObject: "ticket_data" (scope: flow)
    ticket_data: dict

    # From DataObject: "classification_result" (scope: flow)
    classification_result: dict

    # From DataObject: "approval_status" (scope: flow)
    approval_status: str

    # From DataObject: "agent_outputs" (scope: flow)
    agent_outputs: dict
```

**Mapping rules:**
- `scope: flow` → top-level state field
- `scope: agent` → nested dict under agent slug key
- `scope: global` → top-level state field with reducer (last-write-wins or merge)
- JSON Schema `string` → `str`, `object` → `dict`, `array` → `list`, `number` → `float`, `integer` → `int`, `boolean` → `bool`

#### Flow Graph Generation (Standalone Orchestrator)

The orchestrator BPMN becomes a `StateGraph`:

```python
# Generated: flows/incident_flow.py
# NOTE: This is STANDALONE mode — orchestrator logic is code-generated.
# In FlowGrid Level 3, this BPMN would run live in bpmn-engine instead.

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver

from .state import FlowState
from agents.classifier_agent import classifier_agent
from agents.resolver_agent import resolver_agent
from agents.approval_agent import approval_agent

def build_incident_flow() -> StateGraph:
    """
    Flow: Incident Resolution
    Generated from Orchestrator BPMN: {bpmn_process_id}
    Mode: standalone (orchestrator code-generated)
    """
    builder = StateGraph(FlowState)

    # Add nodes — each calls the code-generated agent function
    builder.add_node("classify", classifier_agent)
    builder.add_node("resolve", resolver_agent)
    builder.add_node("approve", approval_agent)

    # Start → Classify (from BPMN Start Event)
    builder.add_edge(START, "classify")

    # Classify → routing (from BPMN Exclusive Gateway)
    builder.add_conditional_edges(
        "classify",
        route_by_priority,
        {
            "high": "approve",
            "low": "resolve",
        }
    )

    # Approve → Resolve
    builder.add_edge("approve", "resolve")

    # Resolve → End
    builder.add_edge("resolve", END)

    # HITL: interrupt before approval (from BPMN User Task)
    checkpointer = PostgresSaver.from_conn_string(
        os.environ["DATABASE_URL"]
    )

    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["approve"],
    )

    return graph
```

### 3.3 Gateway Mapping (Standalone Mode)

| BPMN Gateway | LangGraph Construct |
|---|---|
| Exclusive (XOR) | `add_conditional_edges` with routing function |
| Parallel (AND) | Multiple edges from same node (LangGraph runs them in parallel via `Send`) |
| Inclusive (OR) | `add_conditional_edges` returning list of targets |
| Event-Based | `add_conditional_edges` with event type check |

**Exclusive Gateway condition generation:**

```python
def route_by_priority(state: FlowState) -> str:
    """
    Gateway: Priority Router
    Source: BPMN ExclusiveGateway_{id}
    """
    priority = state.get("classification_result", {}).get("priority", "low")
    if priority == "high":
        return "high"
    return "low"
```

**Parallel Gateway (fan-out):**

```python
from langgraph.constants import Send

def fan_out_parallel(state: FlowState) -> list[Send]:
    """
    Gateway: Parallel Split
    Source: BPMN ParallelGateway_{id}
    """
    return [
        Send("enrich_data", state),
        Send("notify_team", state),
        Send("log_incident", state),
    ]

builder.add_conditional_edges("classify", fan_out_parallel)
```

---

## 4. Export Pipeline

### 4.1 Pipeline Stages

```
┌──────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Load    │   │  Build    │   │ Validate │   │ Generate │   │ Package  │
│  Design  │──▶│  IR       │──▶│  IR      │──▶│  Code    │──▶│  & Zip   │
│          │   │           │   │          │   │          │   │          │
└──────────┘   └───────────┘   └──────────┘   └──────────┘   └──────────┘
     │               │              │               │               │
     ▼               ▼              ▼               ▼               ▼
  Fetch from     Normalize      Check for      Run target      Create ZIP
  design-svc     agents,        missing refs,  plugin:         with manifest,
  + agent-svc    agent BPMNs,   unsupported    • Agent code    README,
                 orch BPMN,     constructs     • Orch code     requirements
                 data objects                    (standalone)
```

### 4.2 Generated Package Structure

**Agent-only mode** (for FlowGrid Level 3 users):

```
export-{design-slug}-agents-{timestamp}/
├── README.md                    # Setup instructions
├── host.json                    # Azure Functions config
├── .env.example
│
├── agents/
│   ├── classifier-agent/
│   │   ├── index.ts             # Generated from agent internal BPMN
│   │   ├── function.json        # Azure Function binding
│   │   └── types.ts             # Input/output schemas
│   ├── resolver-agent/
│   │   ├── index.ts
│   │   ├── function.json
│   │   └── types.ts
│   └── shared/
│       ├── llm-client.ts        # LLM provider abstraction
│       └── tool-helpers.ts
│
├── tools/
│   ├── classify-ticket.ts
│   └── search-kb.ts
│
├── tests/
│   └── ...
│
└── flowgrid/
    ├── manifest.json
    └── agent-bpmns/             # Original BPMNs for reference
        ├── classifier-agent.bpmn
        └── resolver-agent.bpmn
```

**Standalone mode** (full self-contained export):

```
export-{design-slug}-standalone-{timestamp}/
├── README.md
├── config.yaml
├── requirements.txt / package.json
├── Dockerfile
│
├── agents/                      # From agent internal BPMNs
│   ├── classifier_agent.py
│   ├── resolver_agent.py
│   └── approval_agent.py
│
├── tools/
│   └── ...
│
├── flows/                       # From orchestrator BPMN (standalone)
│   ├── state.py
│   ├── incident_flow.py         # StateGraph / orchestrator code
│   └── conditions.py
│
├── server.py                    # Entry point
│
├── tests/
│   └── ...
│
└── flowgrid/
    ├── manifest.json
    ├── orchestrator.bpmn        # Original orchestrator BPMN
    └── agent-bpmns/
        └── ...
```

### 4.3 config.yaml

```yaml
# Generated by FlowGrid Export
# Design: Incident Resolution v3
# Mode: standalone | agent-only
# Exported: 2026-02-13T07:41:00Z

export:
  mode: standalone               # or agent-only
  design: incident-resolution
  version: 3

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  temperature: 0.1
  max_tokens: 4096

checkpoint:
  backend: postgres
  connection_env: DATABASE_URL

agents:
  classifier:
    model_override: null
    temperature_override: 0.0
  resolver:
    model_override: null
    max_tokens_override: 8192

hitl:
  default_timeout: 3600
  escalation_enabled: true

tools:
  classify_ticket:
    implementation: stub
  search_kb:
    implementation: api_call
    api_url_env: KB_API_URL
```

### 4.4 Validation Rules

Before generating code, the engine validates:

| Rule | Severity | Description |
|---|---|---|
| All service tasks have agent refs | Error | Every orchestrator BPMN service task must map to an agent |
| Agent internal BPMNs exist | Warning | Agents without internal BPMNs get minimal stubs |
| No orphan agents | Warning | Agents not referenced in any flow |
| No circular-only flows | Error | At least one path from start to end |
| Data object schemas defined | Warning | Untyped data objects generate `dict` |
| Gateway conditions complete | Error | Every outgoing flow from XOR gateway needs a condition |
| Tool schemas defined | Warning | Tools without schemas generate generic signatures |
| HITL tasks have config | Warning | User tasks without approval config get defaults |
| Standalone mode: orch BPMN exists | Error | Standalone export needs an orchestrator BPMN |

---

## 5. HITL in Generated Code

### 5.1 Standalone Mode: BPMN User Task → LangGraph Interrupt

FlowGrid models HITL as BPMN User Tasks. In standalone mode, these map to LangGraph's interrupt mechanism:

| FlowGrid HITL Type | LangGraph Mapping |
|---|---|
| Pre-approval (review before action) | `interrupt_before=["node_name"]` |
| Post-review (review after action) | `interrupt_after=["node_name"]` |
| Edit-and-approve | `interrupt_before` + state update on resume |

### 5.2 Generated HITL Pattern (Standalone)

```python
graph = builder.compile(
    checkpointer=checkpointer,
    interrupt_before=["approve_change"],
    interrupt_after=["generate_report"],
)

# Runtime usage (generated in server.py):
from langgraph.types import Command

@app.post("/flows/{flow_id}/resume")
async def resume_flow(flow_id: str, approval: ApprovalRequest):
    """Resume a flow after HITL interrupt."""
    config = {"configurable": {"thread_id": flow_id}}

    if approval.action == "approve":
        result = await graph.ainvoke(None, config)
    elif approval.action == "reject":
        result = await graph.ainvoke(
            Command(update={"approval_status": "rejected"}), config,
        )
    elif approval.action == "edit":
        result = await graph.ainvoke(
            Command(update=approval.state_updates), config,
        )

    return {"status": "resumed", "result": result}
```

### 5.3 Agent-Only Mode: HITL Not Included

In agent-only mode, HITL is handled by FlowGrid's runtime (Level 3). The exported agent code doesn't include HITL logic — the `bpmn-engine` orchestrator handles `userTask` elements directly via the Interaction Service.

### 5.4 Approval Metadata

```python
from dataclasses import dataclass
from enum import Enum

class ApprovalType(Enum):
    APPROVE_REJECT = "approve_reject"
    REVIEW_EDIT = "review_edit"
    INFORM = "inform"

@dataclass
class HITLCheckpoint:
    """Metadata for a human-in-the-loop checkpoint.
    Generated from FlowGrid BPMN User Task.
    """
    task_id: str
    task_name: str
    approval_type: ApprovalType
    description: str
    timeout_seconds: int
    escalate_to: str | None
    required_role: str | None
    context_fields: list[str]
    editable_fields: list[str]
```

---

## 6. Shared State in Generated Code

### 6.1 DataObject → State Channel Mapping

```
FlowGrid DataObject          LangGraph State (standalone)
─────────────────────         ──────────────────
name: "ticket_data"    ──▶    ticket_data: dict
scope: flow                   (top-level field)

name: "agent_memory"   ──▶    agent_memory: Annotated[dict, merge_dicts]
scope: global                  (with reducer for concurrent writes)

name: "messages"       ──▶    messages: Annotated[list, add_messages]
scope: flow                    (using LangGraph's message reducer)
```

### 6.2 Reducer Strategy

| DataObject Scope | Reducer | Behavior |
|---|---|---|
| flow | None (last-write) | Standard overwrite |
| agent | `merge_dicts` | Deep merge agent-specific state |
| global | `merge_dicts` | Merge across parallel branches |
| messages (special) | `add_messages` | Append, deduplicate by ID |

### 6.3 Generated State with Reducers

```python
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

def merge_dicts(left: dict, right: dict) -> dict:
    """Deep merge for concurrent state updates."""
    result = {**left}
    for key, value in right.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = merge_dicts(result[key], value)
        else:
            result[key] = value
    return result

class FlowState(TypedDict):
    ticket_data: dict
    classification_result: dict
    approval_status: str
    shared_context: Annotated[dict, merge_dicts]
    messages: Annotated[list, add_messages]
```

---

## 7. API Design

### 7.1 Export Endpoint

```
POST /api/export/{format}
```

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| format | string | Target format: `langgraph`, `crewai`, `azure-functions`, `autogen` |

**Request Body:**

```json
{
  "designId": "uuid",
  "version": 3,
  "options": {
    "mode": "agent-only",
    "includeTests": true,
    "includeDockerfile": true,
    "includeReadme": true,
    "llmProvider": "anthropic",
    "deployTarget": "azure-functions",
    "pythonVersion": "3.12",
    "toolStubStyle": "raise"
  }
}
```

**Response (200 OK):**

```json
{
  "exportId": "uuid",
  "format": "azure-functions",
  "mode": "agent-only",
  "status": "completed",
  "package": {
    "downloadUrl": "/api/export/download/{exportId}",
    "expiresAt": "2026-02-13T08:41:00Z",
    "fileCount": 12,
    "totalSize": 18432
  },
  "manifest": {
    "files": [
      { "path": "agents/classifier-agent/index.ts", "type": "agent" },
      { "path": "agents/resolver-agent/index.ts", "type": "agent" }
    ]
  },
  "warnings": [
    "Tool 'search_kb' has no implementation — generated as stub"
  ],
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": ["Agent 'monitor' is defined but not used in any flow"]
  }
}
```

**Error Responses:**

| Status | Condition |
|---|---|
| 400 | Invalid design or unsupported constructs |
| 404 | Design not found |
| 422 | Validation failed (errors array populated) |
| 501 | Unsupported export format |

### 7.2 Supporting Endpoints

```
GET  /api/export/formats                    # List available export formats + modes
GET  /api/export/{exportId}                 # Get export status/metadata
GET  /api/export/download/{exportId}        # Download ZIP package
POST /api/export/{format}/preview           # Preview generated code (no ZIP)
POST /api/export/{format}/validate          # Validate only, no generation
```

---

## 8. New Services & Components

### 8.1 Service Map (Level 2)

```
┌─────────────────────────────────────────────────────────────────┐
│                        nginx (reverse proxy)                     │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│          │          │          │          │                       │
│  auth    │  agent   │  design  │  integ   │   EXPORT SERVICE    │
│  :3002   │  :3001   │  :3003   │  :3004   │      :3005          │
│          │          │          │          │                       │
│          │          │          │          │  ┌─────────────────┐ │
│          │          │          │          │  │ Code Gen Engine │ │
│          │          │          │          │  ├─────────────────┤ │
│          │          │          │          │  │ Agent Code Gen  │ │
│          │          │          │          │  │ (from internal  │ │
│          │          │          │          │  │  BPMN → native) │ │
│          │          │          │          │  ├─────────────────┤ │
│          │          │          │          │  │ LangGraph Plugin│ │
│          │          │          │          │  │ (standalone     │ │
│          │          │          │          │  │  orch + agents) │ │
│          │          │          │          │  ├─────────────────┤ │
│          │          │          │          │  │ Azure Func.     │ │
│          │          │          │          │  │ Plugin (agents) │ │
│          │          │          │          │  ├─────────────────┤ │
│          │          │          │          │  │ Validator       │ │
│          │          │          │          │  ├─────────────────┤ │
│          │          │          │          │  │ Packager (ZIP)  │ │
│          │          │          │          │  └─────────────────┘ │
├──────────┴──────────┴──────────┴──────────┴─────────────────────┤
│                    PostgreSQL  |  Redis  |  S3/MinIO             │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 New: export-service (port 3005)

**Responsibilities:**
- Expose export API endpoints
- Orchestrate the export pipeline
- Manage export artifacts (store ZIPs temporarily)
- Track export history per design

**Tech stack:**
- Node.js / TypeScript (consistent with existing services)
- Handlebars for code templates
- archiver for ZIP creation
- S3/MinIO or local filesystem for artifact storage

### 8.3 New: Code Generation Engine (library)

Internal library used by export-service:

```
packages/
└── codegen/
    ├── src/
    │   ├── engine.ts              # Core orchestrator
    │   ├── ir-builder.ts          # FlowGrid model → IR
    │   ├── agent-flow-parser.ts   # NEW: Parse agent internal BPMNs
    │   ├── validator.ts           # IR validation
    │   ├── packager.ts            # ZIP creation
    │   └── plugins/
    │       ├── plugin.interface.ts
    │       ├── azure-functions/   # NEW: Agent-only target
    │       │   ├── index.ts
    │       │   ├── agent-generator.ts
    │       │   └── templates/
    │       │       ├── agent.ts.hbs
    │       │       ├── function.json.hbs
    │       │       └── host.json.hbs
    │       ├── langgraph/         # Standalone + agent target
    │       │   ├── index.ts
    │       │   ├── mapper.ts
    │       │   ├── templates/
    │       │   │   ├── agent.py.hbs
    │       │   │   ├── flow.py.hbs       # Standalone orchestrator
    │       │   │   ├── state.py.hbs
    │       │   │   ├── tool.py.hbs
    │       │   │   ├── server.py.hbs
    │       │   │   ├── config.yaml.hbs
    │       │   │   ├── requirements.txt.hbs
    │       │   │   └── README.md.hbs
    │       │   └── validator.ts
    │       └── crewai/            # Future plugin
    └── tests/
```

### 8.4 Frontend: Export Panel

Add to the existing design-module (three-panel editor):

- **Export button** in toolbar
- **Export dialog**: select format, choose mode (agent-only vs standalone), configure options
- **Code preview panel**: syntax-highlighted view of generated code
- **Export history**: list of previous exports per design
- **Mode explainer**: tooltip explaining when to use agent-only vs standalone

### 8.5 Database Additions

```sql
-- Export tracking
CREATE TABLE exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID REFERENCES designs(id),
    design_version INTEGER NOT NULL,
    format VARCHAR(50) NOT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'agent-only',  -- agent-only | standalone
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    options JSONB NOT NULL DEFAULT '{}',
    manifest JSONB,
    warnings JSONB DEFAULT '[]',
    artifact_path VARCHAR(500),
    artifact_size INTEGER,
    error_message TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_exports_design ON exports(design_id, design_version);
CREATE INDEX idx_exports_tenant ON exports(tenant_id);
```

---

## 9. How Level 2 Fits the Dual BPMN Approach

### 9.1 The Full Picture

```
┌────────────────────────────────────────────────────────────────────┐
│                     FlowGrid Design Module                         │
│                                                                    │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐  │
│  │  Orchestrator BPMN  │    │  Agent Internal BPMNs            │  │
│  │  (how agents        │    │  (how each agent works inside)   │  │
│  │   coordinate)       │    │                                  │  │
│  └──────────┬──────────┘    └───────────────┬──────────────────┘  │
│             │                               │                      │
└─────────────┼───────────────────────────────┼──────────────────────┘
              │                               │
    ┌─────────▼─────────┐           ┌─────────▼──────────┐
    │  Level 3 Path     │           │  Level 2 Export     │
    │                   │           │  (ALWAYS)           │
    │  Stored in DB     │           │                     │
    │  Loaded by        │           │  Agent internal     │
    │  bpmn-engine      │           │  BPMNs → native     │
    │  at runtime       │           │  code (Azure Func,  │
    │                   │           │  Python, TS)        │
    │  (NOT code-       │           │                     │
    │   generated)      │           │  Deploy as          │
    └───────────────────┘           │  microservices      │
                                    └──────────┬──────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │  Standalone Export   │
                                    │  (OPTIONAL)          │
                                    │                      │
                                    │  Orchestrator BPMN   │
                                    │  → LangGraph/CrewAI  │
                                    │  code (for users NOT │
                                    │  using FG runtime)   │
                                    └─────────────────────┘
```

### 9.2 The Two User Journeys

**Journey A: FlowGrid Runtime (Level 3)**
1. Design agent network in FlowGrid Design
2. Export agent internal code (agent-only mode) → deploy as Azure Functions
3. Deploy orchestrator BPMN to FlowGrid runtime → `bpmn-engine` executes it live
4. Change orchestration? Edit BPMN in Design → hot-reload → immediate effect
5. Change agent logic? Re-export agent code → redeploy Azure Function

**Journey B: Self-Hosted (Standalone)**
1. Design agent network in FlowGrid Design
2. Export everything (standalone mode) → full LangGraph/CrewAI package
3. Deploy to your own infrastructure
4. Change anything? Re-export from FlowGrid → redeploy

---

## 10. Implementation Roadmap

### Phase 1: Foundation (3-4 weeks)

| Task | Effort | Description |
|---|---|---|
| IR schema definition (v2) | 3d | Add agent internal flow IR, export modes |
| IR builder | 5d | Extract IR from FlowGrid design/agent/BPMN data |
| Agent internal BPMN parser | 3d | Parse agent BPMNs into step sequences |
| Plugin interface (v2) | 2d | Add mode support, agent-only vs standalone |
| Export service scaffold | 3d | New service, routes, auth integration |
| Export database schema | 1d | Migrations, models |
| **Total** | **~17d** | |

### Phase 2: Agent Code Generation (3-4 weeks)

| Task | Effort | Description |
|---|---|---|
| Azure Functions plugin | 5d | Agent internal BPMN → TypeScript Azure Functions |
| Agent step mapper | 4d | BPMN steps → function calls, LLM stubs |
| Tool stub generation | 2d | Tool definitions → typed stubs |
| Schema generation | 2d | Input/output types from BPMN data objects |
| Templates (Handlebars) | 3d | .ts.hbs, function.json.hbs, etc. |
| **Total** | **~16d** | |

### Phase 3: LangGraph Standalone Plugin (2-3 weeks)

| Task | Effort | Description |
|---|---|---|
| State mapping | 2d | DataObjects → TypedDict with reducers |
| Agent node generation | 3d | Agent internal BPMN → Python agent functions |
| Orchestrator graph generation | 4d | Orchestrator BPMN → StateGraph (standalone) |
| HITL generation | 2d | User tasks → interrupt_before/after |
| **Total** | **~11d** | |

### Phase 4: Packaging & Validation (2 weeks)

| Task | Effort | Description |
|---|---|---|
| ZIP packager | 2d | archiver integration, manifest generation |
| Validation engine | 3d | All validation rules, error/warning reporting |
| README generation | 2d | Dynamic README with setup instructions |
| Artifact storage | 2d | S3/MinIO integration, TTL cleanup |
| **Total** | **~9d** | |

### Phase 5: Frontend & Polish (2 weeks)

| Task | Effort | Description |
|---|---|---|
| Export button + dialog | 3d | UI with mode selector |
| Code preview panel | 3d | Syntax highlighting, file browser |
| Export history view | 2d | List, re-download, compare |
| E2E testing | 2d | Full pipeline tests |
| **Total** | **~10d** | |

### Total Estimate: ~12-14 weeks (1 developer)

### Phase 6 (Future): Additional Targets

- CrewAI standalone plugin (~2 weeks)
- AutoGen standalone plugin (~2 weeks)
- Custom Python/TypeScript agent-only plugin (~2 weeks)

---

## 11. Architecture Diagram

```
                        ┌──────────────────────────────────┐
                        │          FlowGrid UI              │
                        │     (design-module + export)      │
                        └──────────────┬───────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────┐
                        │            nginx                  │
                        │        (reverse proxy)            │
                        └──┬───┬───┬───┬───┬───────────────┘
                           │   │   │   │   │
              ┌────────────┘   │   │   │   └────────────┐
              ▼                ▼   ▼   ▼                ▼
        ┌──────────┐   ┌────┐ ┌────┐ ┌────┐    ┌──────────────┐
        │  auth    │   │ ag │ │ ds │ │ in │    │   EXPORT     │
        │  :3002   │   │ :01│ │ :03│ │ :04│    │   SERVICE    │
        └──────────┘   └────┘ └────┘ └────┘    │   :3005      │
                          │      │              │              │
                          │      │              │ ┌──────────┐ │
                          │      │              │ │ Agent    │ │
                          │      │              │ │ Code Gen │ │
                          │      │              │ │(internal │ │
                          │      │              │ │ BPMN→TS) │ │
                          │      │              │ ├──────────┤ │
                          │      │              │ │Standalone│ │
                          │      │              │ │Orch Gen  │ │
                          │      │              │ │(optional)│ │
                          │      │              │ ├──────────┤ │
                          │      │              │ │Validator │ │
                          │      │              │ │& Packager│ │
                          │      │              │ └──────────┘ │
                          │      │              └──────┬───────┘
                          │      │                     │
                          ▼      ▼                     ▼
                    ┌──────────────────────────────────────┐
                    │         PostgreSQL + Redis            │
                    ├──────────────────────────────────────┤
                    │              S3 / MinIO               │
                    │         (export artifacts)            │
                    └──────────────────────────────────────┘

Export Flow (Agent-Only Mode — for Level 3 users):
══════════════════════════════════════════════════

  User clicks        POST /api/          Load agent        Build IR
  "Export Agents" ──▶ export/azure ─────▶ internal  ──────▶ (agent flows
                     -functions           BPMNs              only)

       ──────────▶ Generate agent ──────▶ Package ──────▶ Deploy to
                   code (TS/Azure         ZIP              Azure Functions
                   Functions)

Export Flow (Standalone Mode — for self-hosted users):
═════════════════════════════════════════════════════

  User clicks        POST /api/          Load ALL         Build IR
  "Export Full" ───▶ export/langgraph ──▶ BPMNs ─────────▶ (agent +
                     ?mode=standalone     (orch + agents)   orch flows)

       ──────────▶ Generate ALL ────────▶ Package ──────▶ User deploys
                   code (agents +          ZIP              on own infra
                   orchestrator)
```

---

## Appendix A: Template Example (Agent Internal BPMN → Azure Function)

```handlebars
{{! templates/agent.ts.hbs }}
/**
 * Agent: {{agent.name}}
 * Pattern: {{agent.pattern}}
 * Generated by FlowGrid Export v{{version}}
 * Source: Agent Internal BPMN
 *
 * STRUCTURE generated from BPMN — fill in AI logic where marked TODO.
 */
import { AzureFunction, Context, HttpRequest } from '@azure/functions';

{{#each agent.inputSchema.properties}}
// Input field: {{@key}} ({{this.type}})
{{/each}}

interface {{pascalCase agent.slug}}Input {
{{#each agent.inputSchema.properties}}
  {{@key}}: {{tsType this.type}};
{{/each}}
}

interface {{pascalCase agent.slug}}Output {
{{#each agent.outputSchema.properties}}
  {{@key}}: {{tsType this.type}};
{{/each}}
}

const {{camelCase agent.slug}}: AzureFunction = async (
  context: Context,
  req: HttpRequest,
): Promise<{{pascalCase agent.slug}}Output> => {
  const input: {{pascalCase agent.slug}}Input = req.body;

{{#each agent.steps}}
  // Step {{add @index 1}}: {{this.name}} (from BPMN {{this.bpmnType}})
{{#if (eq this.type "llm_call")}}
  // TODO: Implement LLM call for "{{this.name}}"
  const {{camelCase this.name}}Result = await {{camelCase this.name}}(/* ... */);
{{else if (eq this.type "tool_call")}}
  // TODO: Implement tool call "{{this.toolName}}"
  const {{camelCase this.name}}Result = await {{camelCase this.name}}(/* ... */);
{{else if (eq this.type "condition")}}
  // Gateway: {{this.name}} — route based on {{this.conditionField}}
  if ({{this.condition}}) {
    // {{this.trueBranch}}
  } else {
    // {{this.falseBranch}}
  }
{{else}}
  const {{camelCase this.name}}Result = {{camelCase this.name}}(input);
{{/if}}

{{/each}}
  // TODO: Return final output
  throw new Error('Not fully implemented — fill in AI logic above');
};

{{#each agent.steps}}
{{#if (eq this.type "llm_call")}}
async function {{camelCase this.name}}(/* params */) {
  // TODO: Implement LLM call
  // Suggested prompt: {{this.promptHint}}
  throw new Error('Not implemented: {{this.name}}');
}
{{/if}}
{{/each}}

export default {{camelCase agent.slug}};
```

---

## Appendix B: Key Dependencies

**export-service:**
```json
{
  "dependencies": {
    "handlebars": "^4.7.8",
    "archiver": "^7.0.0",
    "bpmn-moddle": "^9.0.1",
    "ajv": "^8.12.0",
    "minio": "^8.0.0",
    "express": "^4.18.0"
  }
}
```

**Generated Azure Functions package (agent-only):**
```json
{
  "dependencies": {
    "@azure/functions": "^4.0.0",
    "@anthropic-ai/sdk": "^0.30.0"
  }
}
```

**Generated LangGraph package (standalone):**
```
langgraph>=0.2.0
langchain-core>=0.3.0
langchain-anthropic>=0.2.0
langgraph-checkpoint-postgres>=0.1.0
fastapi>=0.115.0
uvicorn>=0.30.0
pydantic>=2.0.0
python-dotenv>=1.0.0
```
