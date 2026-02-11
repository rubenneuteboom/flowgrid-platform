/**
 * Prompt 3b: Assign Patterns
 * 
 * Refines pattern assignments and adds A2A metadata.
 * Determines autonomy levels, risk appetite, and capabilities.
 */

import { registerPrompt } from '../index';
import { AssignPatternsOutputSchema, AssignPatternsOutput, ProposeAgentsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface AssignPatternsInput {
  agents: ProposeAgentsOutput['agents'];
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  complianceRequirements?: string[];
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in AI agent governance, risk management, and the A2A (Agent-to-Agent) protocol.

Your task is to finalize pattern assignments and add operational metadata for each agent.

## Agentic Patterns (Deep Dive)

### Orchestrator
- **Autonomy**: Usually supervised - coordinates but humans approve major decisions
- **Risk**: Medium - mistakes can cascade but are typically recoverable
- **Streaming**: Yes - needs real-time coordination updates
- **Triggers**: Workflow events, escalations, schedules
- **Outputs**: Task assignments, status updates, reports

### Specialist  
- **Autonomy**: Can be autonomous for narrow domain
- **Risk**: Depends on domain (financial = high, reporting = low)
- **Streaming**: Rarely needed
- **Triggers**: Specific task requests, analysis requests
- **Outputs**: Expert recommendations, analysis results

### Coordinator
- **Autonomy**: Supervised - manages human-to-human handoffs
- **Risk**: Low - facilitates but doesn't decide
- **Streaming**: Yes - handoff status updates
- **Triggers**: Process stage completions, team availability
- **Outputs**: Handoff requests, coordination messages

### Gateway
- **Autonomy**: Autonomous for standard integrations
- **Risk**: Medium - data integrity concerns
- **Streaming**: Depends on integration type
- **Triggers**: API calls, webhooks, schedules
- **Outputs**: Transformed data, sync confirmations

### Monitor
- **Autonomy**: Autonomous for observation, supervised for actions
- **Risk**: Low (observation) to High (auto-remediation)
- **Streaming**: Yes - continuous monitoring feeds
- **Triggers**: Thresholds, anomalies, schedules
- **Outputs**: Alerts, reports, trigger events

### Executor
- **Autonomy**: Usually autonomous for predefined actions
- **Risk**: High - performs actual changes
- **Streaming**: Sometimes - progress updates
- **Triggers**: Approved action requests
- **Outputs**: Execution results, confirmations

### Analyzer
- **Autonomy**: Autonomous for analysis, supervised for recommendations
- **Risk**: Low to Medium
- **Streaming**: For large dataset processing
- **Triggers**: Data availability, schedules, ad-hoc requests
- **Outputs**: Insights, patterns, predictions

## Autonomy Levels
- **autonomous**: Agent decides and acts without approval
- **supervised**: Agent proposes, human approves
- **human-in-loop**: Human involved in every decision

## Risk Appetite
- **low**: Conservative, always err on side of caution
- **medium**: Balanced, reasonable risk for efficiency
- **high**: Aggressive, optimize for speed/throughput

## JSON Output Format
{
  "agentPatterns": [
    {
      "agentId": "agent-001",
      "pattern": "orchestrator",
      "patternRationale": "Coordinates multiple specialists and manages workflow state",
      "autonomyLevel": "supervised",
      "riskAppetite": "medium",
      "a2aCapabilities": {
        "streaming": true,
        "pushNotifications": true
      },
      "triggers": ["ticket_created", "sla_threshold", "escalation_request"],
      "outputs": ["task_assignment", "status_update", "escalation_alert"]
    }
  ]
}`;

const buildUserMessage = (input: AssignPatternsInput): string => {
  const agentsList = input.agents
    .map(a => `- [${a.id}] ${a.name}\n  Pattern: ${a.suggestedPattern}\n  Purpose: ${a.purpose}\n  Autonomy: ${a.suggestedAutonomy}`)
    .join('\n\n');

  let message = `## Agents to Configure\n\n${agentsList}`;
  
  if (input.riskTolerance) {
    message += `\n\n## Organization Risk Tolerance\n${input.riskTolerance}`;
  }
  
  if (input.complianceRequirements?.length) {
    message += `\n\n## Compliance Requirements\n${input.complianceRequirements.join(', ')}`;
  }
  
  message += `\n\n## Instructions
1. Confirm or adjust the suggested pattern for each agent
2. Provide a rationale for the pattern choice (max 150 chars)
3. Set autonomy level based on risk and compliance needs
4. Set risk appetite aligned with organization tolerance
5. Determine A2A capabilities (streaming, push notifications)
6. List triggers (what activates this agent)
7. List outputs (what this agent produces)
8. Return ONLY the JSON object`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<AssignPatternsInput, AssignPatternsOutput>({
  id: 'step3.assign-patterns',
  version: '1.0.0',
  description: 'Finalize patterns and add A2A operational metadata',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: AssignPatternsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 4096,
  },
});

export { AssignPatternsOutput };
