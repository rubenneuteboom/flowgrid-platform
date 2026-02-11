/**
 * Prompt 5a: Relationships
 * 
 * Defines A2A relationships between agents.
 * Creates the message contracts for inter-agent communication.
 */

import { registerPrompt } from '../index';
import { RelationshipsOutputSchema, RelationshipsOutput, ProposeAgentsOutput, AssignPatternsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface RelationshipsInput {
  agents: ProposeAgentsOutput['agents'];
  patterns: AssignPatternsOutput['agentPatterns'];
  existingRelationships?: Array<{ source: string; target: string; type: string }>;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in multi-agent system design and the A2A (Agent-to-Agent) protocol.

Your task is to define relationships between agents - how they communicate and collaborate.

## Relationship Types

| Type | Direction | Description | Example |
|------|-----------|-------------|---------|
| orchestrates | Parent → Child | Controls workflow execution | Orchestrator → Specialist |
| delegates | Peer → Peer | Passes specific task | Router → Handler |
| monitors | Observer → Subject | Watches for events/status | Monitor → Any |
| notifies | Any → Any | Sends alerts/updates | Any → Orchestrator |
| queries | Requester → Provider | Requests information | Any → Gateway |
| reports-to | Child → Parent | Sends results/status | Specialist → Coordinator |

## Message Design Principles

1. **Purpose-Driven**: Each message has a clear intent
2. **Self-Contained**: Include all needed context
3. **Typed**: Use consistent message schemas
4. **Traceable**: Include correlation IDs

## Common Message Patterns

### Command Messages (orchestrates, delegates)
- Instruct another agent to do something
- Include: action, parameters, deadline, priority

### Event Messages (notifies, reports-to)  
- Inform about something that happened
- Include: eventType, timestamp, payload, source

### Query Messages (queries)
- Request information
- Include: queryType, parameters, responseFormat

### Status Messages (monitors)
- Report current state
- Include: status, metrics, timestamp

## Async vs Sync
- **Sync (isAsync: false)**: Caller waits for response
- **Async (isAsync: true)**: Fire-and-forget, response via callback

## Priority Levels
- **low**: Can be delayed, batch processed
- **normal**: Standard processing order
- **high**: Prioritize, may preempt normal

## JSON Output Format
{
  "relationships": [
    {
      "id": "rel-001",
      "sourceAgentId": "agent-001",
      "targetAgentId": "agent-002",
      "relationshipType": "orchestrates",
      "messageType": "task_assignment",
      "description": "Orchestrator assigns analysis tasks to specialist",
      "messageSchema": {
        "type": "object",
        "properties": {
          "taskId": { "type": "string", "description": "Unique task identifier" },
          "taskType": { "type": "string", "description": "Type of analysis needed" },
          "payload": { "type": "object", "description": "Task-specific data" },
          "deadline": { "type": "string", "description": "ISO timestamp deadline" }
        }
      },
      "isAsync": false,
      "priority": "normal"
    }
  ]
}`;

const buildUserMessage = (input: RelationshipsInput): string => {
  const agentsList = input.agents.map(a => {
    const pattern = input.patterns.find(p => p.agentId === a.id);
    const boundaries = a.boundaries;
    return `- [${a.id}] ${a.name} (${pattern?.pattern || a.suggestedPattern})
  Delegates to: ${boundaries.delegates.join(', ') || 'none'}
  Escalates to: ${boundaries.escalates.join(', ') || 'none'}
  Triggers: ${pattern?.triggers?.join(', ') || 'not defined'}
  Outputs: ${pattern?.outputs?.join(', ') || 'not defined'}`;
  }).join('\n\n');

  let message = `## Agents\n\n${agentsList}`;
  
  if (input.existingRelationships?.length) {
    message += `\n\n## Existing Relationships (preserve or enhance)\n`;
    message += input.existingRelationships
      .map(r => `- ${r.source} --[${r.type}]--> ${r.target}`)
      .join('\n');
  }
  
  message += `\n\n## Instructions
1. Define relationships based on agent boundaries and responsibilities
2. Every agent should have at least one relationship (no orphans)
3. Use appropriate relationship types
4. Define message schemas for key relationships
5. Set isAsync based on communication pattern
6. Set priority based on business criticality
7. Generate unique IDs (rel-001, rel-002, etc.)
8. Return ONLY the JSON object`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<RelationshipsInput, RelationshipsOutput>({
  id: 'step5.relationships',
  version: '1.0.0',
  description: 'Define A2A relationships and message contracts between agents',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: RelationshipsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 6144,
  },
});

export { RelationshipsOutput };
