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
      
      "shortDescription": "AI agent that orchestrates IT service desk operations",
      "detailedPurpose": "This agent serves as the central coordinator for all service desk activities. It receives incoming tickets, analyzes their content and urgency, routes them to appropriate handlers, and monitors progress through resolution.",
      "businessValue": "Reduces ticket resolution time by 40%, improves first-contact resolution rates, and provides 24/7 automated triage and routing.",
      "keyResponsibilities": [
        "Intelligent ticket triage and classification",
        "Automated routing to appropriate handlers",
        "SLA monitoring and proactive escalation",
        "Performance metrics and reporting"
      ],
      "successCriteria": "Achieve >90% correct ticket routing, maintain SLA compliance >95%, reduce average resolution time by 30%",
      
      "suggestedPattern": "orchestrator",
      "suggestedAutonomy": "supervised",
      "decisionAuthority": "propose-and-execute",
      "valueStream": "Detect to Correct",
      "capabilityGroup": "Incident Management",
      "objectives": [
        "Reduce mean time to resolution by 30%",
        "Achieve 95% SLA compliance",
        "Automate 60% of ticket routing"
      ],
      "kpis": ["MTTR", "SLA compliance %", "Automation rate", "Customer satisfaction"],
      
      "interactionPattern": "orchestrated",
      "triggers": ["incident.created", "ticket.submitted", "sla.warning"],
      "outputs": ["ticket.routed", "escalation.triggered", "report.generated"],
      "escalationPath": "Service Manager → IT Director",
      
      "responsibilities": [
        "Route incoming tickets to appropriate handlers",
        "Track SLA compliance",
        "Escalate stalled tickets",
        "Report on service metrics"
      ],
      "ownedElements": ["cap-001", "cap-002", "cap-003"],
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
3. IMPORTANT: Use the EXACT IDs from brackets [id] in ownedElements - do NOT generate new IDs
4. Define boundaries (internal/delegates/escalates)
5. List any orphaned elements that don't fit any agent
6. Return ONLY the JSON object

## REQUIRED FIELDS FOR EACH AGENT (Generate ALL of these!)

### Description Fields
- shortDescription: One-line summary (max 100 chars)
- detailedPurpose: 2-3 sentences explaining what the agent does (max 500 chars)
- businessValue: Value proposition - what benefits does this agent provide? (max 300 chars)
- keyResponsibilities: Array of 3-5 specific responsibilities
- successCriteria: How do we measure if this agent is successful?

### Design Fields
- suggestedPattern: One of: specialist, orchestrator, coordinator, gateway, monitor, executor, analyzer
- suggestedAutonomy: One of: full, supervised, human-in-loop
- decisionAuthority: One of: propose-only, propose-and-execute, autonomous-low-risk, fully-autonomous
- valueStream: IT4IT value stream (e.g., "Strategy to Portfolio", "Detect to Correct")
- capabilityGroup: Logical grouping (e.g., "Incident Management", "Change Management")
- objectives: Array of 3-5 measurable objectives
- kpis: Array of 3-5 KPIs

### Interaction Fields
- interactionPattern: One of: request-response, event-driven, publish-subscribe, orchestrated, collaborative
- triggers: Array of events that trigger this agent (e.g., "incident.created", "approval.requested")
- outputs: Array of outputs this agent produces (e.g., "ticket.routed", "report.generated")
- escalationPath: Who to escalate to (e.g., "Service Manager → IT Director")`;

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
    maxTokens: 16000,
  },
});

export { ProposeAgentsOutput };
