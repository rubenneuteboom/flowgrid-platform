/**
 * Prompt 3a: Propose Agents
 * 
 * Groups classified elements into logical agents.
 * Assigns responsibilities and suggests patterns.
 */

import { registerPrompt } from '../index';
import { ProposeAgentsOutputSchema, ProposeAgentsOutput, ClassifyElementsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface ProposeAgentsInput {
  elements: ClassifyElementsOutput['elements'];
  organizationContext?: string;
  preferredAgentCount?: number;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in designing multi-agent systems following IT4IT, TOGAF, and agentic AI principles.

Your task is to propose a set of AI agents that will work together to achieve the organization's goals.

## Agent Design Principles

### Single Responsibility
Each agent should have ONE clear purpose. If you're describing an agent with "and" in its purpose, consider splitting it.

### Appropriate Granularity
- Too few agents = monolithic, hard to maintain
- Too many agents = coordination overhead
- Sweet spot: 4-8 agents for most domains

### Clear Boundaries
Define what each agent:
- **Handles internally**: Core responsibilities it owns
- **Delegates**: Tasks it passes to other agents  
- **Escalates**: Situations requiring human review

## Agentic Patterns Reference

| Pattern | Use When | Example |
|---------|----------|---------|
| Orchestrator | Coordinating multiple agents/workflows | "Ticket Workflow Manager" |
| Specialist | Deep domain expertise needed | "Compliance Checker" |
| Coordinator | Managing handoffs between teams | "Incident Coordinator" |
| Gateway | External system integration | "ERP Integration Agent" |
| Monitor | Watching for conditions/thresholds | "SLA Monitor" |
| Executor | Performing automated actions | "Auto-Remediation Agent" |
| Analyzer | Processing data for insights | "Trend Analyzer" |

## JSON Output Format
{
  "agents": [
    {
      "id": "agent-001",
      "name": "Service Desk Orchestrator",
      "purpose": "Coordinates ticket lifecycle from creation to resolution",
      "responsibilities": [
        "Route incoming tickets to appropriate handlers",
        "Track SLA compliance",
        "Escalate stalled tickets",
        "Report on service metrics"
      ],
      "ownedElements": ["cap-001", "cap-002", "cap-003"],
      "suggestedPattern": "orchestrator",
      "suggestedAutonomy": "supervised",
      "boundaries": {
        "internal": ["Ticket routing", "Status tracking"],
        "delegates": ["Technical diagnosis to Specialist"],
        "escalates": ["VIP customer issues", "Security incidents"]
      }
    }
  ],
  "orphanedElements": ["cap-015"]
}`;

const buildUserMessage = (input: ProposeAgentsInput): string => {
  const elementsList = input.elements
    .map(e => `- [${e.id}] ${e.name} (${e.elementType}): ${e.rationale}`)
    .join('\n');

  let message = `## Classified Elements\n\n${elementsList}`;
  
  if (input.organizationContext) {
    message += `\n\n## Organization Context\n${input.organizationContext}`;
  }
  
  if (input.preferredAgentCount) {
    message += `\n\n## Preferred Agent Count\nAim for approximately ${input.preferredAgentCount} agents.`;
  }
  
  message += `\n\n## Instructions
1. Group elements into logical agents (typically 4-8 agents)
2. Only elements with type "Agent" become agents; others are assigned as owned elements
3. Each agent needs a clear purpose (max 250 chars)
4. List 3-6 responsibilities per agent
5. Suggest an agentic pattern for each
6. IMPORTANT: Use the EXACT IDs from brackets [id] in ownedElements - do NOT generate new IDs
6. Define boundaries (internal/delegates/escalates)
7. List any orphaned elements that don't fit any agent
8. Return ONLY the JSON object`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<ProposeAgentsInput, ProposeAgentsOutput>({
  id: 'step3.propose-agents',
  version: '1.0.0',
  description: 'Group elements into logical agents with responsibilities',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: ProposeAgentsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.4,
    maxTokens: 8192,
  },
});

export { ProposeAgentsOutput };
