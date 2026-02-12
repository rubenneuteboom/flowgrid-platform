/**
 * Prompt 3c: Define Skills
 * 
 * Generates A2A-compliant skill definitions for each agent.
 * Skills define what an agent can do and the input/output contracts.
 */

import { registerPrompt } from '../index';
import { DefineSkillsOutputSchema, DefineSkillsOutput, ProposeAgentsOutput, AssignPatternsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface DefineSkillsInput {
  agents: ProposeAgentsOutput['agents'];
  patterns: AssignPatternsOutput['agentPatterns'];
  detailLevel?: 'minimal' | 'standard' | 'detailed';
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in API design and the A2A (Agent-to-Agent) protocol.

Your task is to define skills for each agent. Skills are the "verbs" - the actions an agent can perform.

## A2A Skills Overview

A skill represents a single capability that other agents (or humans) can invoke.

### Skill Structure (A2A Protocol v0.2)
- **skillId**: Unique identifier (kebab-case, e.g., "route-ticket")
- **name**: Human-readable name (e.g., "Route Ticket")
- **description**: What the skill does (max 200 chars)
- **tags**: Array of category tags for discoverability (e.g., ["itsm", "routing", "triage"])
- **inputSchema**: JSON Schema for required input
- **outputSchema**: JSON Schema for expected output
- **examples**: Input/output examples (REQUIRED for A2A compliance)

### Skill Design Principles

1. **Single Purpose**: Each skill does ONE thing well
2. **Clear Contracts**: Input/output schemas are unambiguous
3. **Idempotent When Possible**: Same input = same result
4. **Descriptive Names**: Action verbs (route, analyze, create, validate)

### Common Skill Patterns

| Agent Type | Typical Skills |
|------------|----------------|
| Orchestrator | assign-task, check-status, escalate, generate-report |
| Specialist | analyze, diagnose, recommend, validate |
| Coordinator | handoff, notify, schedule-meeting, request-approval |
| Gateway | fetch-data, sync-records, transform, validate-schema |
| Monitor | check-threshold, generate-alert, get-metrics |
| Executor | execute-action, rollback, apply-change |
| Analyzer | analyze-trend, predict, classify, summarize |

## JSON Schema Basics

Use simple JSON Schema types:
- "string", "number", "boolean", "array", "object"
- Add descriptions for clarity

Example:
{
  "type": "object",
  "properties": {
    "ticketId": { "type": "string", "description": "Unique ticket identifier" },
    "priority": { "type": "string", "description": "Priority level: low, medium, high, critical" }
  },
  "required": ["ticketId"]
}

## JSON Output Format
{
  "agentSkills": [
    {
      "agentId": "agent-001",
      "skills": [
        {
          "skillId": "route-ticket",
          "name": "Route Ticket",
          "description": "Routes an incoming ticket to the appropriate handler based on category and priority",
          "tags": ["itsm", "routing", "triage", "ticket-management"],
          "inputSchema": {
            "type": "object",
            "properties": {
              "ticketId": { "type": "string", "description": "Ticket ID" },
              "category": { "type": "string", "description": "Ticket category" },
              "priority": { "type": "string", "description": "Priority level" }
            },
            "required": ["ticketId", "category"]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "assignedTo": { "type": "string", "description": "Agent or team assigned" },
              "estimatedTime": { "type": "number", "description": "Estimated handling time in minutes" },
              "confidence": { "type": "number", "description": "Confidence score 0-1" }
            }
          },
          "examples": [
            {
              "name": "High Priority Hardware Issue",
              "input": { "ticketId": "TKT-123", "category": "hardware", "priority": "high" },
              "output": { "assignedTo": "hardware-specialist", "estimatedTime": 30, "confidence": 0.92 }
            },
            {
              "name": "Standard Software Request",
              "input": { "ticketId": "TKT-456", "category": "software", "priority": "medium" },
              "output": { "assignedTo": "software-team", "estimatedTime": 60, "confidence": 0.88 }
            }
          ]
        }
      ]
    }
  ]
}`;

const buildUserMessage = (input: DefineSkillsInput): string => {
  const agentsList = input.agents.map(a => {
    const pattern = input.patterns.find(p => p.agentId === a.id);
    return `- [${a.id}] ${a.name}
  Pattern: ${pattern?.pattern || a.suggestedPattern}
  Purpose: ${a.purpose}
  Triggers: ${(a.triggers || []).join('; ') || 'Not specified'}
  Outputs: ${(a.outputs || []).join('; ') || 'Not specified'}`;
  }).join('\n\n');

  const detailLevel = input.detailLevel || 'standard';
  const skillCount = detailLevel === 'minimal' ? '2-3' : detailLevel === 'detailed' ? '4-6' : '3-4';

  let message = `## Agents\n\n${agentsList}`;
  
  message += `\n\n## Instructions
1. Define ${skillCount} skills per agent
2. Each skill should map to a key responsibility
3. Use kebab-case for skillId (e.g., "analyze-trend")
4. Keep descriptions under 200 characters
5. Include 3-5 relevant tags per skill for discoverability (lowercase, hyphenated)
6. Define clear input/output schemas with descriptions
7. Include 2 examples per skill with descriptive names
8. Examples must have: name, input object, output object
9. Return ONLY the JSON object`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<DefineSkillsInput, DefineSkillsOutput>({
  id: 'step3.define-skills',
  version: '1.0.0',
  description: 'Generate A2A-compliant skill definitions for each agent',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: DefineSkillsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 16000,
  },
});

export { DefineSkillsOutput };
