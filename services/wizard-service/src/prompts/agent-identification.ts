/**
 * Agent Identification Prompt
 * 
 * Given a business process and sub-process description from a foundation,
 * identifies the optimal agent swarm to automate it.
 * Used in the 8-step Design Wizard flow.
 */

import { z } from 'zod';
import { registerPrompt } from './index';

// ============================================================================
// Input Type
// ============================================================================

export interface AgentIdentificationInput {
  process: {
    name: string;
    description: string;
  };
  subProcess: {
    name: string;
    description: string;
    expectedOutcome: string;
    constraints?: string;
  };
  foundationCapabilities?: string[];
  foundationIntegrations?: string[];
}

// ============================================================================
// Output Schema
// ============================================================================

// Shared enums for agent configuration
const DecisionAuthorityEnum = z.enum(['propose-only', 'propose-and-execute', 'autonomous-low-risk', 'fully-autonomous']);
const AutonomyLevelEnum = z.enum(['full', 'supervised', 'human-in-loop']);
const InteractionPatternEnum = z.enum(['request-response', 'event-driven', 'publish-subscribe', 'orchestrated', 'collaborative']);

// Shared agent fields
const AgentBaseSchema = z.object({
  name: z.string().max(80),
  purpose: z.string().max(300),
  shortDescription: z.string().max(100).describe('One-sentence summary of the agent'),
  decisionAuthority: DecisionAuthorityEnum,
  autonomyLevel: AutonomyLevelEnum,
  interactionPattern: InteractionPatternEnum,
  triggers: z.array(z.string()).min(1).max(5).describe('Events that trigger this agent'),
  outputs: z.array(z.string()).min(1).max(5).describe('What this agent produces'),
  escalationPath: z.string().max(100).describe('Who to escalate to when needed'),
});

export const AgentIdentificationOutputSchema = z.object({
  orchestrator: AgentBaseSchema.extend({
    pattern: z.literal('Orchestrator'),
  }),
  specialists: z.array(AgentBaseSchema.extend({
    pattern: z.enum(['Specialist', 'Coordinator', 'Monitor', 'Validator', 'Executor', 'Router', 'Transformer']),
    rationale: z.string().max(200),
  })),
});

export type AgentIdentificationOutput = z.infer<typeof AgentIdentificationOutputSchema>;

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in multi-agent system design following IT4IT, TOGAF, and A2A protocol principles.

Given a business process and sub-process description, identify the optimal agent swarm to automate it.

## Rules
1. Always include exactly ONE orchestrator agent that coordinates the others
2. Add specialist agents for domain-specific tasks
3. Each agent should have a single responsibility
4. Typical swarm size: 3-7 agents total (including orchestrator)
5. Use clear, descriptive names (e.g., "Ticket Triage Agent", "Approval Gateway Agent")
6. Consider the foundation's existing capabilities and integrations when proposing agents
7. Assign appropriate autonomy based on risk and complexity

## Available Patterns (Title Case!)
- **Orchestrator**: Coordinates and delegates work to other agents
- **Specialist**: Performs domain-specific tasks (e.g., classification, analysis)
- **Coordinator**: Manages workflow between multiple parties
- **Monitor**: Observes and reports on system state, SLAs, metrics
- **Validator**: Validates data, checks compliance, enforces rules
- **Executor**: Performs concrete actions (creates records, sends notifications)
- **Router**: Routes requests to appropriate handlers
- **Transformer**: Transforms data between formats

## Decision Authority
- **propose-only**: Can only suggest actions, human approves
- **propose-and-execute**: Proposes and executes if no objection
- **autonomous-low-risk**: Acts autonomously for low-risk decisions
- **fully-autonomous**: Full decision-making authority

## Autonomy Level
- **full**: No human oversight required
- **supervised**: Human monitors but doesn't approve each action
- **human-in-loop**: Human approval required for key decisions

## Interaction Pattern
- **request-response**: Synchronous request/response
- **event-driven**: Reacts to events
- **publish-subscribe**: Publishes/subscribes to topics
- **orchestrated**: Controlled by orchestrator
- **collaborative**: Peer-to-peer collaboration

## Output Format
Return valid JSON with this exact structure:
{
  "orchestrator": {
    "name": "Process Orchestrator Agent",
    "purpose": "Full description of what this agent does (2-3 sentences)",
    "shortDescription": "One-sentence summary",
    "pattern": "Orchestrator",
    "decisionAuthority": "propose-and-execute",
    "autonomyLevel": "supervised",
    "interactionPattern": "orchestrated",
    "triggers": ["workflow started", "task completed"],
    "outputs": ["task assignments", "status updates"],
    "escalationPath": "Process Owner, IT Manager"
  },
  "specialists": [
    {
      "name": "Specialist Agent Name",
      "purpose": "Full description",
      "shortDescription": "One-sentence summary",
      "pattern": "Specialist",
      "decisionAuthority": "autonomous-low-risk",
      "autonomyLevel": "supervised",
      "interactionPattern": "event-driven",
      "triggers": ["task assigned", "data received"],
      "outputs": ["analysis results", "recommendations"],
      "escalationPath": "Orchestrator, Domain Expert",
      "rationale": "Why this agent is needed"
    }
  ]
}`;

registerPrompt<AgentIdentificationInput, AgentIdentificationOutput>({
  id: 'agent-identification',
  version: '1.0.0',
  description: 'Identify optimal agent swarm for a business process',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: (input) => {
    let msg = `## Business Process\n**Name:** ${input.process.name}\n**Description:** ${input.process.description}\n\n`;
    msg += `## Sub-Process to Automate\n**Name:** ${input.subProcess.name}\n`;
    msg += `**Goal:** ${input.subProcess.description}\n`;
    msg += `**Expected Outcome:** ${input.subProcess.expectedOutcome}\n`;
    if (input.subProcess.constraints) {
      msg += `**Constraints:** ${input.subProcess.constraints}\n`;
    }
    if (input.foundationCapabilities?.length) {
      msg += `\n## Available Capabilities\n${input.foundationCapabilities.map(c => `- ${c}`).join('\n')}\n`;
    }
    if (input.foundationIntegrations?.length) {
      msg += `\n## Available Integrations\n${input.foundationIntegrations.map(i => `- ${i}`).join('\n')}\n`;
    }
    msg += '\nPropose the optimal agent swarm for this sub-process. Return JSON only.';
    return msg;
  },
  outputSchema: AgentIdentificationOutputSchema,
  modelPreferences: {
    temperature: 0.4,
    maxTokens: 4096,
  },
});
