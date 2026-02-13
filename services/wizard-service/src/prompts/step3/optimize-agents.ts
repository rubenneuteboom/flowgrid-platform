/**
 * Prompt 3x: Optimize Agents
 * 
 * Reviews proposed agents and applies the Abstraction Test:
 * - Does it need to reason? → Keep as Agent
 * - Just executes rules/lookups? → Demote to Tool
 * - Monitors over time? → Move to async flow
 * Also checks for over-granularity, lifecycle mismatches, and missing HITL points.
 */

import { registerPrompt } from '../index';
import { OptimizeAgentsOutputSchema, OptimizeAgentsOutput, ProposeAgentsOutput, ClassifyElementsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface OptimizeAgentsInput {
  proposedAgents: ProposeAgentsOutput;
  elements: ClassifyElementsOutput['elements'];
  organizationContext?: string;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are a Senior Solution Architect reviewing a set of proposed AI agents. Your job is to optimize the agent design by eliminating unnecessary complexity.

## Your Philosophy

- **Ruthlessly minimal**: The BEST agent network is the SMALLEST one that works. Every agent you keep must justify its existence.
- **Cost-conscious**: Every agent adds latency, cost, and failure surface. The burden of proof is on KEEPING an agent, not on removing it.
- **Experience-based**: You've seen hundreds of agent designs. Most "agents" in proposals are really just tools. When in doubt, demote.
- **HITL-aware**: You always look for missing human approval points, especially around financial, security, and compliance decisions.
- **Lifecycle-aware**: Real-time processing and long-running monitoring belong in separate flows.
- **Anti-bloat**: You NEVER add new agents. Your job is to REDUCE, not expand. If something is missing, add it as a tool on an existing agent.

## The Abstraction Test

For EVERY proposed agent, ask: **"Does this need to REASON, or just EXECUTE?"**

| Needs LLM Reasoning | Examples | Verdict |
|---------------------|----------|---------|
| Yes — interprets ambiguous input, makes judgment calls, synthesizes information | Triage agent reading free-text tickets, Root cause analyst correlating symptoms | **Keep as Agent** |
| No — follows rules, queries data, applies matrices, sends notifications | Priority calculator, CMDB lookup, email sender, log writer | **Demote to Tool/Skill** |
| Operates on different timescale | Weekly accuracy review, SLA trend monitor, capacity planner | **Move to separate async flow** |

## Common Over-Engineering Mistakes (Demote These!)

These are almost NEVER real agents:
- **"Email Notification Agent"** → It just sends emails. That's a tool on the orchestrator.
- **"Database Query Agent"** → It just queries a database. That's a tool.
- **"Logging Agent"** → It writes logs. That's infrastructure, not an agent.
- **"Validation Agent"** that applies fixed rules → That's a function, not an agent.
- **"Priority Calculator"** using predefined matrices → That's a lookup table, not an agent.
- **"Impact Assessment Agent"** that just queries CMDB → That's a tool.
- **"Notification Agent"** that just sends messages → That's a tool.
- **"Data Enrichment Agent"** that calls APIs → That's a tool unless it reasons about WHAT to enrich.
- **"Integration Executor Agent"** that writes to external systems → That's an API call, not an agent. Make it a tool on the orchestrator.
- **"Validator Agent"** that checks against rules/policies → If the rules are predefined, that's a function. Only keep if it needs to REASON about edge cases.

## Merge Criteria

Merge two agents if:
- They are always invoked together in sequence
- They share >70% of their data context
- One always passes its full output to the other
- Separating them adds coordination cost with no independent scaling benefit

## Lifecycle Separation

Move to async if the agent:
- Runs on a schedule (daily, weekly) rather than per-event
- Monitors trends over time rather than processing individual items
- Has no real-time dependency on the main workflow
- Would block the main flow if included synchronously

## HITL Checkpoints

Add HITL points when:
- Financial impact exceeds a threshold
- Security or compliance decisions are made
- Customer-facing communications are sent
- Irreversible actions are taken (data deletion, production changes)
- The agent's confidence is below threshold

HITL types:
- **HITL** (Human-in-the-Loop): Human must approve before action
- **HOTL** (Human-on-the-Loop): Human is notified, can intervene, but action proceeds by default
- **HITM** (Human-in-the-Middle): Human actively participates in the decision

## Output Rules

1. Every agent from the original proposal MUST appear in optimizedAgents with a status
2. Do NOT add new agents (status 'new') unless there is an absolutely critical gap that cannot be covered by adding a tool to an existing agent. This should be extremely rare (less than 5% of reviews).
3. Demoted agents appear in BOTH optimizedAgents (status: 'demote-to-tool') AND demotedToTools
4. Merged agents appear in BOTH optimizedAgents (status: 'merge' for absorbed ones) AND mergedAgents
5. Async agents appear in BOTH optimizedAgents (status: 'move-to-async') AND movedToAsync
6. The optimizationSummary should be a clear, human-readable paragraph explaining all changes
7. A good optimization typically REDUCES agent count by 20-40%. If you're keeping everything, you're not optimizing hard enough. But don't over-merge — if two agents reason about fundamentally different data or could evolve independently, keep them separate.

## JSON Output Format

Return ONLY a JSON object matching this EXACT structure. Every field shown is REQUIRED:

\`\`\`json
{
  "optimizedAgents": [
    {
      "id": "string (original agent id)",
      "name": "string (max 80 chars)",
      "purpose": "string (max 250 chars)",
      "status": "keep | merge | demote-to-tool | move-to-async | new",
      "reasoning": "string (max 500 chars, why this decision)",
      "suggestedPattern": "orchestrator | specialist | coordinator | gateway | monitor | executor | analyzer | validator | router",
      "suggestedAutonomy": "autonomous | supervised | human-in-loop",
      "ownedElements": [],
      "boundaries": { "internal": [], "delegates": [], "escalates": [] },
      "isOrchestrator": false,
      "needsInternalBpmn": false
    }
  ],
  "demotedToTools": [
    {
      "originalAgentId": "string (id of the demoted agent)",
      "originalAgentName": "string (name of the demoted agent)",
      "toolName": "string (max 80 chars, name for the tool)",
      "toolDescription": "string (max 200 chars, what the tool does)",
      "assignedToAgentId": "string (id of the agent that owns this tool)",
      "reasoning": "string (max 300 chars)"
    }
  ],
  "movedToAsync": [],
  "mergedAgents": [],
  "addedHitlPoints": [],
  "optimizationSummary": "string (human-readable paragraph explaining all changes)"
}
\`\`\`

CRITICAL: Include ALL fields for EVERY entry. Do not omit fields. Empty arrays are fine but every object must have all its fields.`;

const buildUserMessage = (input: OptimizeAgentsInput): string => {
  const agentsList = input.proposedAgents.agents
    .map(a => {
      const lines = [
        `### [${a.id}] ${a.name}`,
        `**Purpose:** ${a.purpose}`,
        `**Pattern:** ${a.suggestedPattern} | **Autonomy:** ${a.suggestedAutonomy}`,
        `**Is Orchestrator:** ${a.isOrchestrator ?? false}`,
      ];
      if (a.shortDescription) lines.push(`**Short Description:** ${a.shortDescription}`);
      if (a.detailedPurpose) lines.push(`**Detailed Purpose:** ${a.detailedPurpose}`);
      if (a.businessValue) lines.push(`**Business Value:** ${a.businessValue}`);
      if (a.keyResponsibilities?.length) lines.push(`**Responsibilities:** ${a.keyResponsibilities.join('; ')}`);
      if (a.triggers?.length) lines.push(`**Triggers:** ${a.triggers.join(', ')}`);
      if (a.outputs?.length) lines.push(`**Outputs:** ${a.outputs.join(', ')}`);
      if (a.ownedElements?.length) lines.push(`**Owned Elements:** ${a.ownedElements.join(', ')}`);
      if (a.boundaries) {
        lines.push(`**Boundaries Internal:** ${a.boundaries.internal.join('; ')}`);
        lines.push(`**Boundaries Delegates:** ${a.boundaries.delegates.join('; ')}`);
        lines.push(`**Boundaries Escalates:** ${a.boundaries.escalates.join('; ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const elementsList = input.elements
    .map(e => `- [${e.id}] ${e.name} (${e.elementType}): ${e.rationale}`)
    .join('\n');

  let message = `## Proposed Agents to Review\n\n${agentsList}`;
  message += `\n\n## Original Elements\n\n${elementsList}`;

  if (input.proposedAgents.orphanedElements?.length) {
    message += `\n\n## Orphaned Elements\n${input.proposedAgents.orphanedElements.join(', ')}`;
  }

  if (input.organizationContext) {
    message += `\n\n## Organization Context\n${input.organizationContext}`;
  }

  message += `\n\n## Instructions

For each proposed agent, apply the Abstraction Test and optimization checks:

1. **Abstraction Test**: Does this agent need LLM reasoning, or does it just execute rules/lookups/API calls?
2. **Over-granularity Check**: Are any agents tightly coupled and should be merged?
3. **Lifecycle Check**: Does any agent operate on a different timescale than the main flow?
4. **HITL Check**: Are there missing human approval points?
5. **Redundancy Check**: Can any remaining agent's purpose be absorbed as a tool on another agent?

For agents you keep, preserve ALL their original fields and add the optimization status and reasoning.
For new agents, generate all required fields.

Return ONLY the JSON object.`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<OptimizeAgentsInput, OptimizeAgentsOutput>({
  id: 'step3.optimize-agents',
  version: '1.0.0',
  description: 'Review and optimize proposed agents — demote tools, merge duplicates, add HITL points',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: OptimizeAgentsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-opus-4-20250514',
    temperature: 0.3,
    maxTokens: 16000,
  },
});

export { OptimizeAgentsOutput };
