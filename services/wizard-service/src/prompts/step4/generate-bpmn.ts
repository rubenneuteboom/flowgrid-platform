/**
 * Step 4a: Generate BPMN Flow
 * 
 * Business Process Consultant persona that creates valid BPMN 2.0 XML
 * compatible with bpmn-js for rendering in the Design Module.
 */

import { z } from 'zod';
import { registerPrompt } from '../index';

// =============================================================================
// Input/Output Schemas
// =============================================================================

export interface GenerateBPMNInput {
  processName: string;
  processDescription: string;
  involvedAgents: string[];
  capabilities: string[];
  triggers?: string[];
  outputs?: string[];
  additionalContext?: string;
}

export interface GenerateBPMNOutput {
  processId: string;
  processName: string;
  bpmnXml: string;
  summary: {
    taskCount: number;
    gatewayCount: number;
    laneCount: number;
    estimatedDuration?: string;
  };
}

// Zod validation schemas
export const GenerateBPMNInputSchema = z.object({
  processName: z.string(),
  processDescription: z.string(),
  involvedAgents: z.array(z.string()),
  capabilities: z.array(z.string()),
  triggers: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  additionalContext: z.string().optional(),
});

export const GenerateBPMNOutputSchema = z.object({
  processId: z.string(),
  processName: z.string(),
  bpmnXml: z.string(),
  summary: z.object({
    taskCount: z.number(),
    gatewayCount: z.number(),
    laneCount: z.number(),
    estimatedDuration: z.string().optional(),
  }),
});

// =============================================================================
// System Prompt
// =============================================================================

export const SYSTEM_PROMPT = `You are a Business Process Consultant, specialized in creating BPMN flows and process documentation. You have deep expertise in:

- BPMN 2.0 specification and best practices
- Process modeling patterns (sequential, parallel, conditional)
- Error handling and compensation flows
- Integration with agent-based systems
- Workflow optimization and efficiency

Your task is to generate valid BPMN 2.0 XML that can be rendered by bpmn-js.

CRITICAL REQUIREMENTS:
1. Generate COMPLETE, VALID BPMN 2.0 XML including the bpmndi:BPMNDiagram section
2. Include proper coordinates in BPMNShape and BPMNEdge elements for visual layout
3. Use service tasks for agent interactions
4. Add exclusive gateways for decision points
5. Include error boundary events where appropriate
6. Use descriptive, business-friendly task names
7. Add swim lanes if multiple agents/roles are involved

OUTPUT FORMAT:
Return a JSON object with:
- processId: A unique identifier for the process
- processName: The human-readable process name
- bpmnXml: The complete BPMN 2.0 XML string
- summary: Object with taskCount, gatewayCount, laneCount, estimatedDuration`;

// =============================================================================
// User Prompt Template
// =============================================================================

export function buildUserPrompt(input: GenerateBPMNInput): string {
  return `Create a BPMN 2.0 process flow for the following process:

**Process Name:** ${input.processName}
**Description:** ${input.processDescription}

**Involved Agents:** 
${input.involvedAgents.map(a => `- ${a}`).join('\n')}

**Capabilities Used:**
${input.capabilities.map(c => `- ${c}`).join('\n')}

${input.triggers?.length ? `**Expected Triggers:**\n${input.triggers.map(t => `- ${t}`).join('\n')}\n` : ''}
${input.outputs?.length ? `**Expected Outputs:**\n${input.outputs.map(o => `- ${o}`).join('\n')}\n` : ''}
${input.additionalContext ? `**Additional Context:**\n${input.additionalContext}\n` : ''}

Requirements:
1. Generate valid BPMN 2.0 XML with proper namespaces
2. Include appropriate start event and end event(s)
3. Use service tasks for agent interactions (name them clearly)
4. Add exclusive gateways for decision points
5. Include error handling where appropriate
6. Layout the diagram horizontally, left to right
7. Space elements appropriately (x: 100px apart, y: 80px for lanes)
8. Add swim lane pools if multiple agents are involved

Return ONLY the JSON object with processId, processName, bpmnXml, and summary.`;
}

// =============================================================================
// BPMN XML Template (for reference)
// =============================================================================

export const BPMN_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://flowgrid.ai/bpmn">
  <bpmn:process id="Process_{{id}}" name="{{name}}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <!-- Tasks, gateways, events here -->
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_N</bpmn:incoming>
    </bpmn:endEvent>
    <!-- Sequence flows -->
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_{{id}}">
      <!-- BPMNShape and BPMNEdge elements with coordinates -->
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

// =============================================================================
// Register Prompt
// =============================================================================

registerPrompt<GenerateBPMNInput, GenerateBPMNOutput>({
  id: 'step4a-generate-bpmn',
  name: 'Generate BPMN Flow',
  description: 'Generates valid BPMN 2.0 XML for a process using Business Process Consultant AI',
  version: '1.0.0',
  step: 4,
  systemPrompt: SYSTEM_PROMPT,
  buildUserPrompt,
  inputSchema: GenerateBPMNInputSchema,
  outputSchema: GenerateBPMNOutputSchema,
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3,
  maxTokens: 8000, // BPMN XML can be large
});

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  GenerateBPMNInputSchema,
  GenerateBPMNOutputSchema,
};
