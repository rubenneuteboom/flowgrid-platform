/**
 * Step 4a: Generate BPMN Flow
 * 
 * Business Process Consultant persona that creates valid BPMN 2.0 XML
 * compatible with bpmn-js for rendering in the Design Module.
 * 
 * This BPMN may be called as a sub-process from the orchestrator BPMN.
 * Supports data input/output associations and error boundary events.
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

IMPORTANT: This BPMN may be invoked as a sub-process from an orchestrator BPMN.
When used as a sub-process, the orchestrator passes input data and expects output data.
Model data flow explicitly using data input/output associations.

CRITICAL REQUIREMENTS:
1. Generate COMPLETE, VALID BPMN 2.0 XML including the bpmndi:BPMNDiagram section
2. Include proper coordinates in BPMNShape and BPMNEdge elements for visual layout
3. Use service tasks for agent interactions
4. Add exclusive gateways for decision points
5. Include error boundary events where appropriate
6. Use descriptive, business-friendly task names
7. Add swim lanes if multiple agents/roles are involved

DATA INPUT/OUTPUT ASSOCIATIONS:
Model what data the agent receives and produces using data objects and associations:

<bpmn:dataObject id="DataObject_Input" name="Agent Input">
  <bpmn:documentation>
    Schema: { requestId: string, payload: object }
    Source: Orchestrator or upstream agent
  </bpmn:documentation>
</bpmn:dataObject>
<bpmn:dataObjectReference id="DataObjectRef_Input" dataObjectRef="DataObject_Input" />

<bpmn:dataObject id="DataObject_Output" name="Agent Output">
  <bpmn:documentation>
    Schema: { result: object, status: string }
    Target: Orchestrator or downstream agent
  </bpmn:documentation>
</bpmn:dataObject>
<bpmn:dataObjectReference id="DataObjectRef_Output" dataObjectRef="DataObject_Output" />

On the first task (receiving input):
<bpmn:dataInputAssociation>
  <bpmn:sourceRef>DataObjectRef_Input</bpmn:sourceRef>
</bpmn:dataInputAssociation>

On the last task (producing output):
<bpmn:dataOutputAssociation>
  <bpmn:targetRef>DataObjectRef_Output</bpmn:targetRef>
</bpmn:dataOutputAssociation>

ERROR BOUNDARY EVENTS:
Add error boundary events on risky tasks (external API calls, long-running operations, tasks with side effects):

<bpmn:boundaryEvent id="BoundaryEvent_Error" attachedToRef="Task_RiskyOperation" cancelActivity="true">
  <bpmn:errorEventDefinition errorRef="Error_OperationFailed" />
</bpmn:boundaryEvent>

Define errors at the definitions level:
<bpmn:error id="Error_OperationFailed" name="OperationFailed" errorCode="OP_FAIL" />

Connect error boundaries to error handling tasks or end events for graceful degradation.

HUMAN TASK SWIM LANES (HITL/HOTL):
When the process involves human review, approval, or oversight, you MUST create a proper collaboration with separate participants and processes — NOT an empty pool.

Structure:
1. Create a <bpmn:collaboration> with two <bpmn:participant> elements: one for the Agent, one for the Human Reviewer
2. Each participant references its own <bpmn:process>
3. The Agent's process contains bpmn:serviceTask elements (the automated work)
4. The Human's process contains bpmn:userTask elements (review, approve, etc.)
5. Use <bpmn:messageFlow> in the collaboration to connect agent tasks to human tasks and back
6. The BPMNPlane bpmnElement must reference the collaboration id, NOT a process id

Layout rules for human swim lanes:
- The Human pool is on TOP (y=0), the Agent pool is BELOW (y=250)
- This reflects that humans oversee and approve agent work — human is the authority above
- Each pool has a BPMNShape with isHorizontal="true"
- Human userTask BPMNShape x-coordinates MUST match the x-coordinate of the corresponding agent serviceTask they interact with
- Both pools should have the same width
- Include BPMNEdge elements for all messageFlow connections (dashed lines between pools)

Example collaboration structure:
<bpmn:collaboration id="Collaboration_1">
  <bpmn:participant id="Participant_Human" name="Human Reviewer" processRef="Process_Human" />
  <bpmn:participant id="Participant_Agent" name="{{AgentName}}" processRef="Process_Agent" />
  <bpmn:messageFlow id="MF_ToReview" sourceRef="Task_AgentAnalyze" targetRef="Task_HumanReview" />
  <bpmn:messageFlow id="MF_FromReview" sourceRef="Task_HumanReview" targetRef="Task_AgentProcessApproval" />
</bpmn:collaboration>

<bpmn:process id="Process_Agent" isExecutable="true">
  <bpmn:startEvent id="StartEvent_1" name="Start">
    <bpmn:outgoing>Flow_1</bpmn:outgoing>
  </bpmn:startEvent>
  <bpmn:serviceTask id="Task_AgentAnalyze" name="Analyze Content">
    <bpmn:incoming>Flow_1</bpmn:incoming>
    <bpmn:outgoing>Flow_2</bpmn:outgoing>
  </bpmn:serviceTask>
  <bpmn:serviceTask id="Task_AgentProcessApproval" name="Process Approval Result">
    <bpmn:incoming>Flow_2</bpmn:incoming>
    <bpmn:outgoing>Flow_3</bpmn:outgoing>
  </bpmn:serviceTask>
  <bpmn:endEvent id="EndEvent_1" name="End">
    <bpmn:incoming>Flow_3</bpmn:incoming>
  </bpmn:endEvent>
</bpmn:process>

<bpmn:process id="Process_Human" isExecutable="false">
  <bpmn:userTask id="Task_HumanReview" name="Review Analysis Results" />
</bpmn:process>

In the BPMNDiagram:
- BPMNPlane bpmnElement="Collaboration_1"
- BPMNShape for Participant_Human: bounds x=160, y=0, width=800, height=120, isHorizontal="true"  (HUMAN ON TOP)
- BPMNShape for Participant_Agent: bounds x=160, y=170, width=800, height=200, isHorizontal="true"  (AGENT BELOW)
- Human tasks inside the human pool y-range (y=30 to y=100)
- Agent tasks inside the agent pool y-range (y=200 to y=330)
- Human task x-position matches the agent task it corresponds to
- BPMNEdge for each messageFlow with waypoints going vertically between the pools

If NO human interaction is needed, use a simple single-process BPMN without collaboration.

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
9. If the process involves human review/approval (HITL/HOTL), create a collaboration with a separate Human Reviewer participant and process containing bpmn:userTask elements — do NOT leave the human pool empty
10. Position human userTask elements at the same x-coordinate as the corresponding agent task they relate to
11. Use messageFlow elements in the collaboration to connect agent outputs to human tasks and human approvals back to agent tasks
12. Include data input/output associations showing what data this agent receives and produces
13. Add error boundary events on risky tasks (external API calls, side effects)
14. Note: This BPMN may be called as a sub-process from an orchestrator BPMN — model data flow accordingly

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
  id: 'step4.generate-bpmn',
  version: '2.0.0',
  description: 'Generates valid BPMN 2.0 XML for a process with data associations and error handling',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: buildUserPrompt,
  outputSchema: GenerateBPMNOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.1,
    maxTokens: 16000, // Specialist flows are simpler than orchestrator
  },
});

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  GenerateBPMNInputSchema,
  GenerateBPMNOutputSchema,
};
