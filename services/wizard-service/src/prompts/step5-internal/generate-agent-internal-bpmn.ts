/**
 * Step 5 (Internal): Generate Agent Internal BPMN
 * 
 * Creates BPMN 2.0 workflow for an agent's internal behavior.
 * Models how the agent processes a skill request internally:
 * - LLM calls (prompt steps)
 * - Tool invocations
 * - Data transformations
 * - Reflection/validation loops
 * 
 * This is the INTRA-agent workflow, complementing the 
 * INTER-agent orchestrator BPMN.
 * 
 * Supports data input/output associations for orchestrator integration
 * and error boundary events on risky steps.
 */

import { z } from 'zod';
import { registerPrompt } from '../index';

// =============================================================================
// Input/Output Schemas
// =============================================================================

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  inputSchema?: object;
  outputSchema?: object;
}

export interface AgentIntegration {
  id: string;
  name: string;
  type: string; // api, database, queue, etc.
  description?: string;
}

export interface GenerateAgentInternalBPMNInput {
  agent: {
    id: string;
    name: string;
    pattern: string; // orchestrator, specialist, coordinator, etc.
    description?: string;
  };
  skill: AgentSkill;
  integrations?: AgentIntegration[];
  usesReflection?: boolean;
  complexityHint?: 'simple' | 'moderate' | 'complex';
}

export interface GenerateAgentInternalBPMNOutput {
  processId: string;
  processName: string;
  bpmnXml: string;
  stepMapping: Array<{
    stepId: string;
    stepName: string;
    stepType: 'llm-call' | 'tool-call' | 'transform' | 'decision' | 'validation';
    description?: string;
  }>;
  summary: {
    llmCallCount: number;
    toolCallCount: number;
    transformCount: number;
    hasReflectionLoop: boolean;
  };
}

// Zod schemas
export const GenerateAgentInternalBPMNInputSchema = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    pattern: z.string(),
    description: z.string().optional(),
  }),
  skill: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.object({}).passthrough().optional(),
    outputSchema: z.object({}).passthrough().optional(),
  }),
  integrations: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
  })).optional(),
  usesReflection: z.boolean().optional(),
  complexityHint: z.enum(['simple', 'moderate', 'complex']).optional(),
});

export const GenerateAgentInternalBPMNOutputSchema = z.object({
  processId: z.string(),
  processName: z.string(),
  bpmnXml: z.string(),
  stepMapping: z.array(z.object({
    stepId: z.string(),
    stepName: z.string(),
    stepType: z.enum(['llm-call', 'tool-call', 'transform', 'decision', 'validation']),
    description: z.string().optional(),
  })),
  summary: z.object({
    llmCallCount: z.number(),
    toolCallCount: z.number(),
    transformCount: z.number(),
    hasReflectionLoop: z.boolean(),
  }),
});

// =============================================================================
// System Prompt
// =============================================================================

export const SYSTEM_PROMPT = `You are an AI Agent Architect specializing in designing internal agent workflows.

Your task is to generate BPMN 2.0 XML that models an agent's INTERNAL behavior when executing a skill.

## KEY PRINCIPLE: Intra-Agent Workflow

This BPMN shows what happens INSIDE a single agent:
- How it processes incoming requests
- What LLM prompts it uses
- What tools it invokes
- How it validates and transforms data
- Whether it uses reflection/self-correction

This BPMN is typically invoked as a sub-process from the orchestrator BPMN.
The orchestrator passes input data and expects output data back.

## Step Types (flowgrid:stepType)

Every activity MUST have a flowgrid:stepType attribute:

1. **llm-call** - Calling an LLM with a prompt
   <bpmn:serviceTask flowgrid:stepType="llm-call" flowgrid:promptId="analyze">

2. **tool-call** - Invoking an external tool/API
   <bpmn:serviceTask flowgrid:stepType="tool-call" flowgrid:toolId="database-query">

3. **transform** - Data transformation/parsing
   <bpmn:task flowgrid:stepType="transform">

4. **decision** - Conditional logic (use with gateways)
   <bpmn:exclusiveGateway flowgrid:stepType="decision">

5. **validation** - Output validation
   <bpmn:serviceTask flowgrid:stepType="validation">

## Data Input/Output Associations

Model the data this agent receives from and returns to the orchestrator:

<bpmn:dataObject id="DataObject_SkillInput" name="Skill Input">
  <bpmn:documentation>
    Source: Orchestrator
    Schema: (matches skill input schema)
  </bpmn:documentation>
</bpmn:dataObject>
<bpmn:dataObjectReference id="DataObjectRef_SkillInput" dataObjectRef="DataObject_SkillInput" />

<bpmn:dataObject id="DataObject_SkillOutput" name="Skill Output">
  <bpmn:documentation>
    Target: Orchestrator
    Schema: (matches skill output schema)
  </bpmn:documentation>
</bpmn:dataObject>
<bpmn:dataObjectReference id="DataObjectRef_SkillOutput" dataObjectRef="DataObject_SkillOutput" />

On the first task (receiving input):
<bpmn:dataInputAssociation>
  <bpmn:sourceRef>DataObjectRef_SkillInput</bpmn:sourceRef>
</bpmn:dataInputAssociation>

On the final task (producing output):
<bpmn:dataOutputAssociation>
  <bpmn:targetRef>DataObjectRef_SkillOutput</bpmn:targetRef>
</bpmn:dataOutputAssociation>

For intermediate shared state within the agent, add agent-scoped data objects:
<bpmn:dataObject id="DataObject_WorkingMemory" name="Working Memory">
  <bpmn:documentation>
    Scope: agent
    Schema: { context: object, intermediateResults: array }
  </bpmn:documentation>
</bpmn:dataObject>

## Error Boundary Events

Add error boundary events on risky steps — especially tool calls and external API invocations:

<bpmn:boundaryEvent id="BoundaryEvent_ToolError" attachedToRef="Task_CallAPI" cancelActivity="true">
  <bpmn:errorEventDefinition errorRef="Error_ToolFailed" />
</bpmn:boundaryEvent>

Define errors at the definitions level:
<bpmn:error id="Error_ToolFailed" name="ToolCallFailed" errorCode="TOOL_FAIL" />

Connect error boundaries to:
- Retry logic (loop back with a counter)
- Fallback paths (alternative tool or LLM-based workaround)
- Error end events (propagate failure to orchestrator)

## Common Patterns to Model

### Simple Agent (1-2 LLM calls)
Start → Parse Input → Call LLM → Format Output → End

### Tool-Using Agent
Start → Gather Context → Plan → Execute Tool → Process Result → Respond → End

### Reflection Pattern
Start → Generate → Self-Review → [Gateway: Quality OK?]
  → Yes: Output
  → No: Refine → (loop back to Self-Review)

### Multi-Step Reasoning
Start → Analyze → Reason → Validate → Synthesize → Output → End

## BPMN Structure Requirements

1. Single pool (this is ONE agent)
2. Include error boundary events for LLM/tool failures
3. Use exclusive gateways for conditional paths
4. Include subprocess for complex loops
5. Add documentation to each step
6. Generate bpmndi:BPMNDiagram with coordinates
7. Include data input/output associations for orchestrator integration

## Layout Guidelines

- Horizontal flow, left to right
- 120px horizontal spacing
- Reflection loops should go below main flow
- Start at x=180, y=100

## Output Format

Return JSON with:
- processId: Unique process identifier  
- processName: "[Agent Name] - [Skill Name] Internal Workflow"
- bpmnXml: Complete BPMN 2.0 XML with diagram
- stepMapping: Array mapping each step to its type
- summary: Counts of different step types`;

// =============================================================================
// User Prompt Builder
// =============================================================================

export function buildUserPrompt(input: GenerateAgentInternalBPMNInput): string {
  const integrationsList = input.integrations?.length
    ? input.integrations.map(i => `- ${i.name} (${i.type}): ${i.description || 'No description'}`).join('\n')
    : 'None specified';

  const complexity = input.complexityHint || 'moderate';
  const stepCountGuide = {
    simple: '3-5 steps (minimal processing)',
    moderate: '5-8 steps (typical agent)',
    complex: '8-12 steps (multi-stage reasoning)',
  }[complexity];

  return `Create an internal workflow BPMN for this agent skill:

## Agent
**${input.agent.name}** (${input.agent.id})
Pattern: ${input.agent.pattern}
${input.agent.description ? `Description: ${input.agent.description}` : ''}

## Skill to Model
**${input.skill.name}** (${input.skill.id})
${input.skill.description ? `Description: ${input.skill.description}` : ''}

${input.skill.inputSchema ? `Input Schema: ${JSON.stringify(input.skill.inputSchema, null, 2)}` : ''}
${input.skill.outputSchema ? `Output Schema: ${JSON.stringify(input.skill.outputSchema, null, 2)}` : ''}

## Available Integrations/Tools
${integrationsList}

## Configuration
- Uses Reflection: ${input.usesReflection ? 'Yes' : 'No/Unknown'}
- Complexity: ${complexity} (${stepCountGuide})

## Requirements
1. Model the INTERNAL workflow of this single agent/skill
2. Each step must have flowgrid:stepType attribute
3. Include appropriate LLM calls for reasoning
4. Include tool calls if integrations are available
5. ${input.usesReflection ? 'Include a reflection/self-review loop' : 'Keep the flow linear unless validation requires branching'}
6. Add error handling boundaries on risky steps (tool calls, external APIs)
7. Generate valid BPMN 2.0 XML with bpmndi coordinates
8. Include data input/output associations showing what this agent receives from and returns to the orchestrator
9. Add agent-scoped data objects for intermediate working state if needed

Return ONLY the JSON object with processId, processName, bpmnXml, stepMapping, and summary.`;
}

// =============================================================================
// Register Prompt
// =============================================================================

registerPrompt<GenerateAgentInternalBPMNInput, GenerateAgentInternalBPMNOutput>({
  id: 'step5.generate-agent-internal-bpmn',
  version: '2.0.0',
  description: 'Generates internal BPMN showing agent skill execution workflow with data associations and error handling',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: buildUserPrompt,
  outputSchema: GenerateAgentInternalBPMNOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.1,
    maxTokens: 10000, // Larger due to data associations and error handling
  },
});

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  GenerateAgentInternalBPMNInputSchema,
  GenerateAgentInternalBPMNOutputSchema,
};
