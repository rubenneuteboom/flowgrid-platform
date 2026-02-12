/**
 * Step 4a: Generate Orchestrator BPMN
 * 
 * Creates BPMN 2.0 workflow for orchestrating multiple agents.
 * Each activity represents a skill invocation on a specific agent.
 * 
 * Key difference from regular BPMN: activities include flowgrid:agentId 
 * and flowgrid:skillId attributes for execution mapping.
 */

import { z } from 'zod';
import { registerPrompt } from '../index';

// =============================================================================
// Input/Output Schemas
// =============================================================================

export interface OrchestratorAgent {
  id: string;
  name: string;
  skills: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
}

export interface ParticipantAgent {
  id: string;
  name: string;
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    inputSchema?: object;
    outputSchema?: object;
  }>;
}

export interface GenerateOrchestratorBPMNInput {
  orchestrator: OrchestratorAgent;
  participants: ParticipantAgent[];
  processGoal: string;
  processDescription?: string;
  triggers?: string[];
  outputs?: string[];
}

export interface GenerateOrchestratorBPMNOutput {
  processId: string;
  processName: string;
  bpmnXml: string;
  activityMapping: Array<{
    activityId: string;
    activityName: string;
    agentId: string;
    skillId: string;
    hasInternalBpmn: boolean;
  }>;
  summary: {
    taskCount: number;
    gatewayCount: number;
    participantCount: number;
    estimatedDuration?: string;
  };
}

// Zod schemas
export const GenerateOrchestratorBPMNInputSchema = z.object({
  orchestrator: z.object({
    id: z.string(),
    name: z.string(),
    skills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    })),
  }),
  participants: z.array(z.object({
    id: z.string(),
    name: z.string(),
    skills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.object({}).passthrough().optional(),
      outputSchema: z.object({}).passthrough().optional(),
    })),
  })),
  processGoal: z.string(),
  processDescription: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
});

export const GenerateOrchestratorBPMNOutputSchema = z.object({
  processId: z.string(),
  processName: z.string(),
  bpmnXml: z.string(),
  activityMapping: z.array(z.object({
    activityId: z.string(),
    activityName: z.string(),
    agentId: z.string(),
    skillId: z.string(),
    hasInternalBpmn: z.boolean(),
  })),
  summary: z.object({
    taskCount: z.number(),
    gatewayCount: z.number(),
    participantCount: z.number(),
    estimatedDuration: z.string().optional(),
  }),
});

// =============================================================================
// System Prompt
// =============================================================================

export const SYSTEM_PROMPT = `You are a Business Process Architect specializing in multi-agent orchestration workflows.

Your task is to generate BPMN 2.0 XML that defines how an orchestrator agent coordinates work across multiple specialist agents.

## KEY PRINCIPLE: Inter-Agent Coordination

This BPMN defines the ORCHESTRATION layer - how agents work together:
- Each activity = a skill invocation on a specific agent
- Swim lanes represent different agents
- Sequence flows show the handoff between agents
- Gateways determine which agent handles what

## Activity Attributes (REQUIRED)

Every service task MUST include these custom attributes in the flowgrid namespace:
- flowgrid:agentId - ID of the agent to invoke
- flowgrid:skillId - ID of the skill to call on that agent
- flowgrid:hasInternalBpmn - Whether this agent has internal workflow (true for all)

Example:
<bpmn:serviceTask id="Task_Analyze" name="Analyze Impact"
  flowgrid:agentId="analysis-agent"
  flowgrid:skillId="analyze-impact"
  flowgrid:hasInternalBpmn="true">
  <bpmn:documentation>
    Agent: Analysis Agent
    Skill: analyze-impact
    Input: { changeRequest: object }
    Output: { risk: string, impact: array, recommendation: string }
  </bpmn:documentation>
</bpmn:serviceTask>

## BPMN Structure Requirements

1. Use collaboration with pools for each agent
2. Include message flows between pools for inter-agent communication
3. Add exclusive gateways for decision points
4. Include error boundary events for fault handling
5. Add documentation elements explaining each activity
6. Generate proper bpmndi:BPMNDiagram with coordinates

## Layout Guidelines

- Horizontal flow, left to right
- Pools stacked vertically (orchestrator at top)
- 150px horizontal spacing between activities
- 120px vertical spacing between pools
- Start at x=180, y=80

## Output Format

Return JSON with:
- processId: Unique process identifier
- processName: Human-readable name
- bpmnXml: Complete BPMN 2.0 XML with diagram
- activityMapping: Array mapping each activity to agent/skill
- summary: Counts of tasks, gateways, participants`;

// =============================================================================
// User Prompt Builder
// =============================================================================

export function buildUserPrompt(input: GenerateOrchestratorBPMNInput): string {
  const orchestratorSkills = input.orchestrator.skills
    .map(s => `  - ${s.name} (${s.id})${s.description ? `: ${s.description}` : ''}`)
    .join('\n');

  const participantsList = input.participants.map(p => {
    const skills = p.skills
      .map(s => `    - ${s.name} (${s.id})${s.description ? `: ${s.description}` : ''}`)
      .join('\n');
    return `**${p.name}** (${p.id})\n  Skills:\n${skills}`;
  }).join('\n\n');

  return `Create an orchestration BPMN workflow for:

## Process Goal
${input.processGoal}

${input.processDescription ? `## Process Description\n${input.processDescription}\n` : ''}

## Orchestrator Agent
**${input.orchestrator.name}** (${input.orchestrator.id})
Skills:
${orchestratorSkills}

## Participant Agents
${participantsList}

${input.triggers?.length ? `## Triggers\n${input.triggers.map(t => `- ${t}`).join('\n')}\n` : ''}
${input.outputs?.length ? `## Expected Outputs\n${input.outputs.map(o => `- ${o}`).join('\n')}\n` : ''}

## Requirements
1. Create a collaboration diagram with pools for orchestrator and each participant
2. Show the complete workflow from trigger to output
3. Each activity MUST specify flowgrid:agentId and flowgrid:skillId
4. Use exclusive gateways for routing decisions
5. Include error handling boundaries where appropriate
6. Add message flows between pools to show inter-agent communication
7. Generate valid BPMN 2.0 XML with bpmndi diagram coordinates

Return ONLY the JSON object with processId, processName, bpmnXml, activityMapping, and summary.`;
}

// =============================================================================
// Register Prompt
// =============================================================================

registerPrompt<GenerateOrchestratorBPMNInput, GenerateOrchestratorBPMNOutput>({
  id: 'step4.generate-orchestrator-bpmn',
  version: '1.0.0',
  description: 'Generates orchestrator BPMN showing inter-agent coordination with skill invocations',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: buildUserPrompt,
  outputSchema: GenerateOrchestratorBPMNOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 12000, // Orchestrator BPMN with pools is larger
  },
});

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  GenerateOrchestratorBPMNInputSchema,
  GenerateOrchestratorBPMNOutputSchema,
};
