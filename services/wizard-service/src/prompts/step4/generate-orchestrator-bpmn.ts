/**
 * Step 4a: Generate Orchestrator BPMN
 * 
 * Creates BPMN 2.0 workflow for orchestrating multiple agents.
 * Each activity represents a skill invocation on a specific agent.
 * 
 * Key difference from regular BPMN: activities include flowgrid:agentId 
 * and flowgrid:skillId attributes for execution mapping.
 * 
 * Supports:
 * - Service tasks for automated agent work
 * - User tasks for human-in-the-loop (HITL) approval/review
 * - Data objects for shared state between agents
 * - Signal/message events for external triggers and notifications
 * - Error/compensation handling for rollback scenarios
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

export interface HumanTouchpoint {
  taskId: string;
  approvalType: 'single' | 'multi' | 'advisory';
  channel: string;
  timeoutMinutes: number;
  escalationPolicy: 'escalate' | 'auto-approve' | 'auto-reject';
}

export interface DataObjectDef {
  id: string;
  name: string;
  scope: 'flow' | 'agent' | 'global';
  schema: string;
}

export interface SignalEventDef {
  id: string;
  name: string;
  type: 'catch' | 'throw';
  trigger: string;
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
  activityMapping?: Array<{
    activityId?: string;
    activityName?: string;
    agentId?: string;
    skillId?: string;
    hasInternalBpmn?: boolean;
    type?: 'serviceTask' | 'userTask' | 'signalEvent';
  }>;
  humanTouchpoints?: HumanTouchpoint[];
  dataObjects?: DataObjectDef[];
  signalEvents?: SignalEventDef[];
  summary?: {
    taskCount?: number;
    gatewayCount?: number;
    participantCount?: number;
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

const HumanTouchpointSchema = z.object({
  taskId: z.string(),
  approvalType: z.enum(['single', 'multi', 'advisory']),
  channel: z.string(),
  timeoutMinutes: z.number(),
  escalationPolicy: z.enum(['escalate', 'auto-approve', 'auto-reject']),
});

const DataObjectDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['flow', 'agent', 'global']),
  schema: z.string(),
});

const SignalEventDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['catch', 'throw']),
  trigger: z.string(),
});

export const GenerateOrchestratorBPMNOutputSchema = z.object({
  processId: z.string(),
  processName: z.string(),
  bpmnXml: z.string(),
  activityMapping: z.array(z.record(z.any())).optional().default([]),
  humanTouchpoints: z.array(HumanTouchpointSchema).optional().default([]),
  dataObjects: z.array(DataObjectDefSchema).optional().default([]),
  signalEvents: z.array(SignalEventDefSchema).optional().default([]),
  summary: z.object({
    taskCount: z.number().optional().default(0),
    gatewayCount: z.number().optional().default(0),
    participantCount: z.number().optional().default(0),
    estimatedDuration: z.string().optional(),
  }).optional().default({}),
});

// =============================================================================
// System Prompt
// =============================================================================

export const SYSTEM_PROMPT = `You are a Business Process Architect specializing in multi-agent orchestration workflows.

Your task is to generate BPMN 2.0 XML that defines how an orchestrator agent coordinates work across multiple specialist agents, including human participants.

## KEY PRINCIPLE: Inter-Agent Coordination

This BPMN defines the ORCHESTRATION layer - how agents work together:
- Each activity = a skill invocation on a specific agent OR a human approval step
- Swim lanes represent different agents
- Sequence flows show the handoff between agents
- Gateways determine which agent handles what

## Activity Types

### A) Service Tasks (Automated Agent Work)

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

### B) User Tasks (Human-in-the-Loop)

Use bpmn:userTask when human approval, review, or judgment is needed.
Include flowgrid-specific attributes for approval routing:

<bpmn:userTask id="Task_Approve" name="Manager Approval"
  flowgrid:approvalType="single|multi|advisory"
  flowgrid:approvalChannel="slack|teams|email|web"
  flowgrid:timeoutMinutes="60"
  flowgrid:escalationPolicy="escalate|auto-approve|auto-reject">
  <bpmn:documentation>
    Approval Type: Single approver
    Channel: Slack + Email
    Timeout: 60 minutes
    Escalation: Escalate to IT Director
    Context: Review the risk assessment before proceeding
  </bpmn:documentation>
</bpmn:userTask>

#### WHEN to use userTask:
- High-risk decisions (infrastructure changes, production deployments)
- Financial approvals above threshold
- External-facing actions (sending emails to customers, publishing content)
- Compliance-required checkpoints (audit trail, regulatory sign-off)
- Any step where human judgment is needed over automated logic

#### HITL Patterns:

**Human-in-the-loop (HITL):** userTask blocks the flow until approved.
Use when a human MUST approve before proceeding.
  Agent Task → userTask (Approve) → Next Agent Task

**Human-on-the-loop (HOTL):** serviceTask proceeds in parallel; a notification userTask runs alongside for monitoring.
Use when humans should be aware but don't need to block.
  Parallel Gateway → [serviceTask (Execute), userTask (Monitor/Notify)] → Join Gateway

**Human-in-the-middle (HITM):** userTask placed between two agent pools for mediation.
Use when a human must mediate or translate between agents.
  Agent A Task → userTask (Mediate) → Agent B Task

### C) Data Objects (Shared State)

Define bpmn:dataObject elements for state that flows between agents.
Use bpmn:dataObjectReference and data associations to show reads/writes.

<bpmn:dataObject id="DataObject_Context" name="Shared Context">
  <bpmn:documentation>
    Scope: flow
    Schema: { requestId: string, status: string, findings: object[] }
  </bpmn:documentation>
</bpmn:dataObject>
<bpmn:dataObjectReference id="DataObjectRef_Context" dataObjectRef="DataObject_Context" />

On tasks that read from shared state:
<bpmn:dataInputAssociation>
  <bpmn:sourceRef>DataObjectRef_Context</bpmn:sourceRef>
</bpmn:dataInputAssociation>

On tasks that write to shared state:
<bpmn:dataOutputAssociation>
  <bpmn:targetRef>DataObjectRef_Context</bpmn:targetRef>
</bpmn:dataOutputAssociation>

Guidelines for data objects:
- Define data objects for state that flows between agents (request context, findings, decisions)
- Show which tasks read from and write to shared state via associations
- Include scope in documentation: flow (single process), agent (within one pool), or global (cross-process)
- Include a schema description in the documentation element

### D) Signal and Message Events

Use intermediate catch/throw events for external triggers, notifications, and escalations.

**Message throw (notify someone):**
<bpmn:intermediateThrowEvent id="Event_NotifyHuman" name="Notify Stakeholder">
  <bpmn:messageEventDefinition messageRef="Message_Notification" />
</bpmn:intermediateThrowEvent>

**Signal catch (wait for external input):**
<bpmn:intermediateCatchEvent id="Event_WaitForInput" name="Wait for External Input">
  <bpmn:signalEventDefinition signalRef="Signal_ExternalInput" />
</bpmn:intermediateCatchEvent>

Use signal/message events for:
- External triggers (webhook callbacks, timer expirations, manual triggers)
- Agent-to-agent notifications outside the main sequence flow
- Escalation signals (timeout escalation, priority change)

Define the referenced messages and signals at the definitions level:
<bpmn:message id="Message_Notification" name="StakeholderNotification" />
<bpmn:signal id="Signal_ExternalInput" name="ExternalInputReceived" />

### E) Error and Compensation Handling

Add boundary events for fault handling and rollback:

**Error boundary (catch failures):**
<bpmn:boundaryEvent id="BoundaryEvent_Error" attachedToRef="Task_Execute" cancelActivity="true">
  <bpmn:errorEventDefinition errorRef="Error_ExecutionFailed" />
</bpmn:boundaryEvent>

**Compensation (rollback on failure):**
<bpmn:boundaryEvent id="BoundaryEvent_Compensate" attachedToRef="Task_Provision" cancelActivity="false">
  <bpmn:compensateEventDefinition />
</bpmn:boundaryEvent>

Define errors at the definitions level:
<bpmn:error id="Error_ExecutionFailed" name="ExecutionFailed" errorCode="EXEC_FAIL" />

Include error/compensation handling especially on:
- External API calls that may fail
- Long-running tasks that may time out
- Tasks with side effects that need rollback (provisioning, sending notifications)

## HUMAN REVIEWER SWIM LANE (CRITICAL)

When userTask elements exist (HITL/HOTL/HITM patterns), you MUST create a dedicated Human Reviewer participant with its own process containing actual bpmn:userTask elements. Do NOT leave the human pool empty.

Structure:
1. Add a <bpmn:participant> for the Human Reviewer in the collaboration, referencing a separate <bpmn:process>
2. The Human process (isExecutable="false") contains bpmn:userTask elements for each human interaction point
3. Use <bpmn:messageFlow> in the collaboration to connect:
   - Agent serviceTask → Human userTask (sends work for review)
   - Human userTask → Agent serviceTask (returns approval/feedback)
4. The BPMNPlane bpmnElement MUST reference the collaboration id
5. Human userTask BPMNShape x-coordinates MUST align with the corresponding agent task

Example with human reviewer:
<bpmn:collaboration id="Collaboration_1">
  <bpmn:participant id="Participant_Orchestrator" name="Orchestrator" processRef="Process_Orchestrator" />
  <bpmn:participant id="Participant_Analyst" name="Analysis Agent" processRef="Process_Analyst" />
  <bpmn:participant id="Participant_Human" name="Human Reviewer" processRef="Process_Human" />
  <bpmn:messageFlow id="MF_ToReview" sourceRef="Task_Analyze" targetRef="Task_HumanReview" />
  <bpmn:messageFlow id="MF_FromReview" sourceRef="Task_HumanReview" targetRef="Task_ProcessApproval" />
</bpmn:collaboration>

<bpmn:process id="Process_Human" isExecutable="false">
  <bpmn:userTask id="Task_HumanReview" name="Review Analysis Results"
    flowgrid:approvalType="single"
    flowgrid:approvalChannel="web"
    flowgrid:timeoutMinutes="60"
    flowgrid:escalationPolicy="escalate">
    <bpmn:documentation>Review and approve the analysis before proceeding</bpmn:documentation>
  </bpmn:userTask>
</bpmn:process>

Layout for human pool:
- Human Reviewer pool placed ABOVE all agent pools (humans oversee agents — authority on top)
- BPMNShape with isHorizontal="true", same width as other pools
- Each human userTask positioned at the same x-coordinate as the agent task it corresponds to
- BPMNEdge for messageFlow with vertical waypoints between the agent and human pools

## BPMN Structure Requirements

1. Use collaboration with pools for each agent
2. Include message flows between pools for inter-agent communication
3. Add exclusive gateways for decision points
4. Include error boundary events for fault handling
5. Add documentation elements explaining each activity
6. Generate proper bpmndi:BPMNDiagram with coordinates
7. Define all referenced messages, signals, and errors at the definitions level
8. When human tasks exist, create a Human Reviewer participant with actual userTask elements in its process — NEVER leave a human pool empty

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
- activityMapping: Array mapping each activity to agent/skill, with type field ('serviceTask' | 'userTask' | 'signalEvent')
- humanTouchpoints: Array of { taskId, approvalType, channel, timeoutMinutes, escalationPolicy } for each userTask
- dataObjects: Array of { id, name, scope, schema } for each data object
- signalEvents: Array of { id, name, type: 'catch'|'throw', trigger } for each signal/message event
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
3. Each service task MUST specify flowgrid:agentId and flowgrid:skillId
4. Use exclusive gateways for routing decisions
5. Include error handling boundaries where appropriate
6. Add message flows between pools to show inter-agent communication
7. Generate valid BPMN 2.0 XML with bpmndi diagram coordinates
8. Add bpmn:userTask elements where human approval/review is needed (high-risk decisions, compliance checkpoints, external-facing actions)
9. Place ALL userTask elements in a dedicated Human Reviewer participant with its own process — do NOT leave the human pool empty
10. Position human userTask shapes at the same x-coordinate as the corresponding agent task, and use messageFlow to connect them
11. Define bpmn:dataObject elements for shared state between agents, with data associations on tasks
12. Include signal/message intermediate events for external triggers, notifications, and escalations
13. Add error boundary events and compensation flows for tasks with side effects

Return ONLY the JSON object with processId, processName, bpmnXml, activityMapping, humanTouchpoints, dataObjects, signalEvents, and summary.`;
}

// =============================================================================
// Register Prompt
// =============================================================================

registerPrompt<GenerateOrchestratorBPMNInput, GenerateOrchestratorBPMNOutput>({
  id: 'step4.generate-orchestrator-bpmn',
  version: '2.0.0',
  description: 'Generates orchestrator BPMN showing inter-agent coordination with skill invocations, HITL, shared state, and signal events',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage: buildUserPrompt,
  outputSchema: GenerateOrchestratorBPMNOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.1,
    maxTokens: 32000, // Larger due to HITL, data objects, signals + BPMN XML verbosity
  },
});

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  GenerateOrchestratorBPMNInputSchema,
  GenerateOrchestratorBPMNOutputSchema,
};
