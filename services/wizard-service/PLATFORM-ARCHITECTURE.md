# Platform Architecture - Wizard Service

## Gregor Hohpe's Platform Strategy Principles

This service is designed following Gregor Hohpe's "Platform Strategy" framework, treating the wizard as a foundational platform capability rather than just another microservice.

---

## 1. Harmonization Engine (Not Service Collection)

> "Platforms are harmonization engines, not service collections"

### Implementation

The wizard-service standardizes the **onboarding experience** across all tenants:

| What We Harmonize | How |
|-------------------|-----|
| **Pattern Vocabulary** | Single set of agentic patterns (Orchestrator, Specialist, Gateway, etc.) |
| **Agent Structure** | Consistent fields: capabilities, triggers, outputs, autonomy level |
| **Integration Types** | Standardized: API, Webhook, EventBus, Database |
| **Risk Levels** | Unified scale: low, medium, high |

### Benefits

- New tenants get consistent agent architectures
- Shared vocabulary enables cross-team collaboration
- Patterns can be improved once, benefit all

---

## 2. Real Abstraction (Enables Innovation)

> "Build real abstractions that enable innovation"

### Implementation

Users interact with clean, high-level concepts:

```
User Input                    → Wizard Abstraction → Output
─────────────────────────────────────────────────────────────
"Capability model diagram"    → analyze            → Agent recommendations
"Text description"            → analyze            → Agent recommendations  
"Selected capabilities"       → generate           → Filtered agent network
"Final confirmation"          → apply              → Agents in database
```

### What We Hide

| Hidden Complexity | User Sees |
|-------------------|-----------|
| GPT-4 Vision API calls | "Upload image" |
| Claude prompt engineering | "AI recommendations" |
| JSON parsing/validation | Clean response objects |
| Database transactions | "Apply changes" |

### Escape Hatches

- Export to JSON (for manual editing)
- Direct agent creation (skip wizard entirely)
- Pattern override (users can change AI suggestions)

---

## 3. Floating Platform (Shed Redundant Capabilities)

> "Floating platforms shed redundant capabilities"

### Implementation

The wizard is **decoupled from AI models**:

```typescript
// ai.ts - Model abstraction
export function getCurrentModels(): AIModelVersion[] {
  return [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', version: '4.5' },
    { provider: 'openai', model: 'gpt-4o', version: '2024-05' },
  ];
}
```

### Future-Proofing

| Scenario | Platform Response |
|----------|-------------------|
| GPT-5 released | Update model string, API unchanged |
| Claude 4 available | Swap provider, same interface |
| New vision model | Add to vision abstraction layer |
| Model deprecated | Switch fallback, users unaffected |

### Version Tracking

Each wizard session records:
- AI models used
- Model versions
- Generation timestamp

This enables:
- Reproducibility
- Quality analysis
- Model comparison

---

## 4. Utility-Driven Adoption (Not Mandated)

> "Adoption driven by utility, not mandates"

### Implementation

The wizard is **optional**:

```
Path A: Wizard Onboarding (recommended)
  ─ Upload diagram → Review agents → Apply
  
Path B: Manual Creation (always available)
  ─ Create agent → Configure → Save
```

### Metrics We Track

| Metric | Purpose |
|--------|---------|
| `wizard.sessions.created` | Adoption rate |
| `wizard.sessions.completed` | Completion rate |
| `wizard.time_to_first_agent` | Time value |
| `wizard.agents_per_session` | Efficiency |
| `wizard.manual_vs_wizard` | Preference |

### Value Proposition

| Manual Creation | Wizard Onboarding |
|-----------------|-------------------|
| ~30 min for 5 agents | ~5 min for 5 agents |
| Requires pattern knowledge | AI suggests patterns |
| No capability extraction | Automatic from image |
| Error-prone | Validated by AI |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FLOWGRID PLATFORM                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────┐     ┌─────────────────┐                      │
│   │   wizard.html   │     │  Manual Design  │                      │
│   │  (Onboarding)   │     │    (Direct)     │                      │
│   └────────┬────────┘     └────────┬────────┘                      │
│            │                       │                                │
│            ▼                       ▼                                │
│   ┌────────────────────────────────────────────────────────┐       │
│   │                    NGINX GATEWAY                        │       │
│   │           /api/wizard → wizard-service:3005             │       │
│   │           /api/design → design-service:3003             │       │
│   └────────────────────────────────────────────────────────┘       │
│            │                       │                                │
│            ▼                       ▼                                │
│   ┌─────────────────┐     ┌─────────────────┐                      │
│   │ WIZARD-SERVICE  │     │ DESIGN-SERVICE  │                      │
│   │ (Harmonization) │     │ (Design Tools)  │                      │
│   │                 │     │                 │                      │
│   │ • analyze-text  │     │ • refine-agent  │                      │
│   │ • upload-image  │     │ • generate-code │                      │
│   │ • apply         │     │ • chat          │                      │
│   └────────┬────────┘     └────────┬────────┘                      │
│            │                       │                                │
│            ▼                       ▼                                │
│   ┌────────────────────────────────────────────────────────┐       │
│   │                      POSTGRESQL                         │       │
│   │   wizard_sessions │ agents │ agent_capabilities         │       │
│   └────────────────────────────────────────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Service Responsibilities

### Wizard-Service (This Service)

**Role:** Onboarding Harmonization Engine

| Endpoint | Purpose |
|----------|---------|
| `POST /analyze-text` | Extract capabilities from description |
| `POST /upload-image` | Extract capabilities from diagram |
| `POST /generate-network` | Generate/filter agent network |
| `POST /apply` | Create agents in database |

**Writes:** wizard_sessions, agents, agent_capabilities, agent_interactions

### Design-Service (Separate)

**Role:** Ongoing Design Tools

| Endpoint | Purpose |
|----------|---------|
| `POST /refine-agent` | Improve existing agent |
| `POST /generate-code` | Generate agent code |
| `POST /chat` | AI design assistance |

**Reads/Writes:** agents, agent_capabilities

---

## Summary

| Hohpe Principle | Wizard Implementation |
|-----------------|----------------------|
| Harmonization Engine | Standardized onboarding, shared patterns |
| Real Abstraction | Hide AI complexity, clean API |
| Floating Platform | Decoupled AI models, version tracking |
| Utility-Driven | Optional wizard, tracked metrics |

The wizard-service is not just a feature—it's a **platform foundation** that makes the entire Flowgrid ecosystem more accessible and consistent.
