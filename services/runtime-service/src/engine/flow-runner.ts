const { Engine } = require('bpmn-engine');
import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { StateManager, FlowRun } from './state-manager';
import { executeAgent, AgentConfig, routeGateway, ScopedContext } from './agent-executor';
import { parseTaskDataContracts, buildScopedInput, extractStructuredOutput, updateFlowSummary, FlowState, TaskDataContract } from './data-contracts';

export interface FoundationAgent {
  id: string;
  name: string;
  config: any;
}

interface TaskAgentMapping {
  [taskId: string]: FoundationAgent;
}

export class FlowRunner extends EventEmitter {
  private stateManager: StateManager;
  private activeEngines: Map<string, any> = new Map();

  // Max times a single task can execute before we force the "positive" gateway path
  private static MAX_TASK_ITERATIONS = 3;

  constructor(private pool: Pool) {
    super();
    this.stateManager = new StateManager(pool);
  }

  /**
   * Parse BPMN XML to build task→agent mapping via participant/process structure
   */
  private buildTaskAgentMap(bpmnXml: string, agents: FoundationAgent[]): TaskAgentMapping {
    const mapping: TaskAgentMapping = {};

    // Build participant name → processRef
    const participantMap = new Map<string, string>(); // processRef → participant name
    const participantRegex = /<bpmn:participant\s+id="[^"]+"\s+name="([^"]+)"\s+processRef="([^"]+)"/g;
    let m;
    while ((m = participantRegex.exec(bpmnXml)) !== null) {
      participantMap.set(m[2], m[1]); // processRef → name
    }

    // Build agent lookup by fuzzy name matching
    const agentLookup = new Map<string, FoundationAgent>();
    for (const agent of agents) {
      agentLookup.set(agent.name.toLowerCase(), agent);
      // Also match without " Agent" suffix
      const shortName = agent.name.replace(/\s+agent$/i, '').toLowerCase();
      agentLookup.set(shortName, agent);
    }

    // For each process, find its tasks and map them to the participant's agent
    const processRegex = /<bpmn:process\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:process>/g;
    while ((m = processRegex.exec(bpmnXml)) !== null) {
      const processId = m[1];
      const processBody = m[2];
      const participantName = participantMap.get(processId);
      
      if (!participantName) continue;

      // Find matching agent for this participant
      const agent = agentLookup.get(participantName.toLowerCase()) 
        || agentLookup.get(participantName.replace(/\s+agent$/i, '').toLowerCase());

      if (!agent) {
        console.log(`[flow-runner] No agent match for participant "${participantName}"`);
        continue;
      }

      // Map all tasks in this process to this agent
      const taskRegex = /<bpmn:(?:serviceTask|task|sendTask)\s+id="([^"]+)"\s+name="([^"]+)"/g;
      let tm;
      while ((tm = taskRegex.exec(processBody)) !== null) {
        mapping[tm[1]] = agent;
        console.log(`[flow-runner] Mapped task "${tm[2]}" (${tm[1]}) → agent "${agent.name}"`);
      }
    }

    return mapping;
  }

  /**
   * Extract the orchestrator's process as a standalone BPMN for execution.
   * bpmn-engine can't handle multi-process collaboration, so we extract the 
   * orchestrator process and treat message flows as regular sequence flows.
   */
  /**
   * Parse gateway outgoing flows from BPMN XML.
   * Returns map of gatewayId → [{ id, name, targetRef, condition }]
   */
  private parseGatewayFlows(processXml: string): Map<string, { id: string; name: string; targetRef: string; condition?: string }[]> {
    const gatewayFlows = new Map<string, { id: string; name: string; targetRef: string; condition?: string }[]>();

    // Find all exclusive gateways
    const gwRegex = /<bpmn:exclusiveGateway\s+id="([^"]+)"[^>]*(?:name="([^"]*)")?/g;
    let gm;
    while ((gm = gwRegex.exec(processXml)) !== null) {
      const gwId = gm[1];
      const flows: { id: string; name: string; targetRef: string; condition?: string }[] = [];

      // Find all sequence flows FROM this gateway
      const flowRegex = new RegExp(`<bpmn:sequenceFlow\\s+id="([^"]+)"\\s+(?:name="([^"]*)"\\s+)?sourceRef="${gwId}"\\s+targetRef="([^"]+)"[^>]*>([\\s\\S]*?)</bpmn:sequenceFlow>|<bpmn:sequenceFlow\\s+id="([^"]+)"\\s+(?:name="([^"]*)"\\s+)?sourceRef="${gwId}"\\s+targetRef="([^"]+)"[^/]*/?>`, 'g');
      let fm;
      while ((fm = flowRegex.exec(processXml)) !== null) {
        const flowId = fm[1] || fm[5];
        const flowName = fm[2] || fm[6] || '';
        const targetRef = fm[3] || fm[7];
        const body = fm[4] || '';
        
        // Extract condition if present
        let condition: string | undefined;
        const condMatch = body.match(/<bpmn:conditionExpression[^>]*>([\s\S]*?)<\/bpmn:conditionExpression>/);
        if (condMatch) {
          condition = condMatch[1].trim();
        }

        flows.push({ id: flowId, name: flowName, targetRef, condition });
      }

      if (flows.length > 0) {
        gatewayFlows.set(gwId, flows);
      }
    }

    return gatewayFlows;
  }

  private extractExecutableProcess(bpmnXml: string, orchestratorAgent: FoundationAgent): { xml: string, humanTaskIds: Set<string>, gatewayFlows: Map<string, { id: string; name: string; targetRef: string; condition?: string }[]>, dataContracts: Map<string, TaskDataContract> } {
    // Find orchestrator participant's processRef
    const participantRegex = /<bpmn:participant\s+id="[^"]+"\s+name="([^"]+)"\s+processRef="([^"]+)"/g;
    let orchestratorProcessId: string | null = null;
    let m;
    
    const agentShortName = orchestratorAgent.name.replace(/\s+agent$/i, '').toLowerCase();
    
    while ((m = participantRegex.exec(bpmnXml)) !== null) {
      const pName = m[1].toLowerCase();
      if (pName === orchestratorAgent.name.toLowerCase() || pName === agentShortName) {
        orchestratorProcessId = m[2];
        break;
      }
    }

    if (!orchestratorProcessId) {
      // Fallback: use the first non-human process
      const procRegex = /<bpmn:process\s+id="([^"]+)"/g;
      while ((m = procRegex.exec(bpmnXml)) !== null) {
        if (!m[1].toLowerCase().includes('human')) {
          orchestratorProcessId = m[1];
          break;
        }
      }
    }

    if (!orchestratorProcessId) {
      throw new Error('Cannot find orchestrator process in BPMN');
    }

    // Extract the process body
    const procBodyRegex = new RegExp(`<bpmn:process\\s+id="${orchestratorProcessId}"[^>]*>([\\s\\S]*?)</bpmn:process>`);
    const procMatch = procBodyRegex.exec(bpmnXml);
    if (!procMatch) {
      throw new Error(`Cannot extract process ${orchestratorProcessId}`);
    }

    // Track HITL tasks: orchestrator tasks that RECEIVE from human pool via message flows
    const humanTaskIds = new Set<string>();

    // 1. Find human participant processes
    const humanProcessIds = new Set<string>();
    const hitlParticipantRegex = /participant[^/]*name="([^"]*)"[^/]*processRef="([^"]*)"/g;
    let pm;
    while ((pm = hitlParticipantRegex.exec(bpmnXml)) !== null) {
      if (/human|reviewer|approver|stakeholder|client|manager/i.test(pm[1])) {
        humanProcessIds.add(pm[2]);
      }
    }

    // 2. Find all task IDs inside human processes
    const humanTaskRefs = new Set<string>();
    for (const hpId of humanProcessIds) {
      const hpRegex = new RegExp(`<bpmn:process\\s+id="${hpId}"[^>]*>([\\s\\S]*?)</bpmn:process>`);
      const hpMatch = hpRegex.exec(bpmnXml);
      if (hpMatch) {
        const taskIdRegex = /id="([^"]+)"/g;
        let tm;
        while ((tm = taskIdRegex.exec(hpMatch[1])) !== null) {
          humanTaskRefs.add(tm[1]);
        }
      }
    }

    // 3. Find message flows FROM orchestrator TO human tasks — those orchestrator tasks trigger HITL pause
    const msgFlowRegex = /messageFlow[^/]*sourceRef="([^"]*)"[^/]*targetRef="([^"]*)"/g;
    let mf;
    while ((mf = msgFlowRegex.exec(bpmnXml)) !== null) {
      if (humanTaskRefs.has(mf[2])) {
        // Target is human, source is orchestrator task — mark source as HITL (pause after it completes)
        humanTaskIds.add(mf[1]);
        console.log(`[flow-runner] HITL task detected: "${mf[1]}" (sends to human "${mf[2]}")`);
      }
    }

    // Also include any original userTasks in the orchestrator process
    const userTaskRegex = /<bpmn:userTask\s+id="([^"]+)"/g;
    let utm;
    while ((utm = userTaskRegex.exec(procMatch[1])) !== null) {
      humanTaskIds.add(utm[1]);
    }
    console.log(`[flow-runner] Human HITL tasks: ${[...humanTaskIds].join(', ') || 'none'}`);

    // Parse gateway outgoing flows before conversion
    const gatewayFlows = this.parseGatewayFlows(procMatch[1]);

    // Parse data contracts from full BPMN (documentation blocks may be in any process)
    const dataContracts = parseTaskDataContracts(bpmnXml);
    console.log(`[flow-runner] Parsed ${dataContracts.size} task data contracts`);

    // Convert service tasks to user tasks so bpmn-engine pauses on them (allows async handling)
    // Also convert #{} expressions to ${} for bpmn-engine compatibility (Spring-style → BPMN-engine style)
    let processBody = procMatch[1]
      .replace(/<bpmn:serviceTask/g, '<bpmn:userTask')
      .replace(/<\/bpmn:serviceTask>/g, '</bpmn:userTask>')
      .replace(/#\{/g, '${');

    // Replace condition expressions with simple variable checks for AI routing.
    // The route variable will be set BEFORE gateway evaluation by the preceding task handler.
    for (const [gwId, flows] of gatewayFlows.entries()) {
      for (const flow of flows) {
        // Remove existing conditions from flows coming out of this gateway
        const flowBodyRegex = new RegExp(
          `(<bpmn:sequenceFlow[^>]*id="${flow.id}"[^>]*>)[\\s\\S]*?(<\\/bpmn:sequenceFlow>)`, 'g'
        );
        processBody = processBody.replace(flowBodyRegex, 
          `$1<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${_route_${gwId} == '${flow.id}'}</bpmn:conditionExpression>$2`);
      }
    }

    // Build a minimal executable BPMN with just this process
    console.log(`[flow-runner] Parsed ${gatewayFlows.size} exclusive gateways with AI-routable conditions`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" 
             xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             id="Definitions_1" targetNamespace="http://flowgrid.io/bpmn">
  <process id="${orchestratorProcessId}" isExecutable="true">
    ${processBody}
  </process>
</definitions>`;
    return { xml, humanTaskIds, gatewayFlows, dataContracts };
  }

  async startRun(tenantId: string, foundationId: string, inputData: any, orchestratorId?: string): Promise<FlowRun> {
    // Load foundation
    const foundationResult = await this.pool.query(
      `SELECT * FROM foundations WHERE id = $1 AND tenant_id = $2`,
      [foundationId, tenantId]
    );
    if (foundationResult.rows.length === 0) {
      throw new Error('Foundation not found');
    }

    // Load agents for this foundation (stored in config JSON)
    const agentsResult = await this.pool.query(
      `SELECT * FROM agents WHERE tenant_id = $1 AND config->>'foundationId' = $2`,
      [tenantId, foundationId]
    );
    const agents: FoundationAgent[] = agentsResult.rows;

    // Find orchestrator agent with BPMN (specific or first available)
    const orchestrator = orchestratorId 
      ? agents.find(a => a.id === orchestratorId && a.config?.bpmnXml)
      : agents.find(a => a.config?.pattern === 'orchestrator' && a.config?.bpmnXml);
    if (!orchestrator) {
      throw new Error('No orchestrator with BPMN found in this foundation');
    }

    const fullBpmnXml = orchestrator.config.bpmnXml;

    // Build task→agent mapping from full BPMN
    const taskAgentMap = this.buildTaskAgentMap(fullBpmnXml, agents);
    console.log(`[flow-runner] Task mappings: ${Object.keys(taskAgentMap).length} tasks mapped`);

    // Extract executable single-process BPMN
    let executableBpmn: string;
    let humanTaskIds = new Set<string>();
    let gatewayFlows = new Map<string, { id: string; name: string; targetRef: string; condition?: string }[]>();
    let dataContracts = new Map<string, TaskDataContract>();
    try {
      const extracted = this.extractExecutableProcess(fullBpmnXml, orchestrator);
      executableBpmn = extracted.xml;
      humanTaskIds = extracted.humanTaskIds;
      gatewayFlows = extracted.gatewayFlows;
      dataContracts = extracted.dataContracts;
    } catch (err: any) {
      console.log(`[flow-runner] Could not extract process, using full BPMN: ${err.message}`);
      executableBpmn = fullBpmnXml;
    }

    // Create run record
    const run = await this.stateManager.createRun(tenantId, foundationId, inputData, orchestrator.id);

    // Execute asynchronously
    this.executeFlow(run, executableBpmn, agents, taskAgentMap, humanTaskIds, gatewayFlows, dataContracts, tenantId, inputData).catch(err => {
      console.error(`[flow-runner] Run ${run.id} failed:`, err.message);
    });

    return run;
  }

  private async executeFlow(
    run: FlowRun, 
    bpmnXml: string, 
    agents: FoundationAgent[], 
    taskAgentMap: TaskAgentMapping,
    humanTaskIds: Set<string>,
    gatewayFlows: Map<string, { id: string; name: string; targetRef: string; condition?: string }[]>,
    dataContracts: Map<string, TaskDataContract>,
    tenantId: string, 
    inputData: any
  ): Promise<void> {
    const runId = run.id;
    let lastOutput: any = inputData;
    const stepStates = new Map<string, string>();
    const taskIterations = new Map<string, number>(); // track how many times each task has executed

    // Initialize structured flow state for smart context passing
    const flowState: FlowState = {
      originalRequest: inputData?.request || inputData?.input?.request || JSON.stringify(inputData).substring(0, 500),
      flowSummary: '',
      taskOutputs: {},
    };

    try {
      const engine: any = Engine({
        name: `run-${runId}`,
        source: bpmnXml,
        expressions: {
          resolveExpression(expression: string, context: any, expressionFnContext?: any): any {
            // Handle ${} wrapper
            const match = expression.match(/^\$\{(.+)\}$/);
            if (!match) return expression;
            const inner = match[1].trim();

            // Handle comparison expressions: varName == 'value' or varName === 'value'
            const compMatch = inner.match(/^(\w+(?:\.\w+)*)\s*={2,3}\s*['"]([^'"]+)['"]\s*$/);
            if (compMatch) {
              const varPath = compMatch[1];
              const expectedValue = compMatch[2];
              // Resolve variable from environment.variables or context
              let actual: any;
              const parts = varPath.split('.');
              if (parts.length === 1) {
                // Simple variable: look in environment.variables first, then context
                actual = context?.environment?.variables?.[parts[0]] 
                  ?? context?.variables?.[parts[0]]
                  ?? context?.[parts[0]];
              } else {
                // Dotted path: traverse
                actual = context;
                for (const p of parts) {
                  actual = actual?.[p];
                }
              }
              const result = String(actual).toLowerCase() === expectedValue.toLowerCase();
              console.log(`[flow-runner] Expression: ${inner} → ${varPath}="${actual}" == "${expectedValue}" → ${result}`);
              return result;
            }

            // Handle != comparisons
            const neqMatch = inner.match(/^(\w+(?:\.\w+)*)\s*!=\s*['"]([^'"]+)['"]\s*$/);
            if (neqMatch) {
              const varPath = neqMatch[1];
              const expectedValue = neqMatch[2];
              let actual: any;
              const parts = varPath.split('.');
              if (parts.length === 1) {
                actual = context?.environment?.variables?.[parts[0]] 
                  ?? context?.variables?.[parts[0]]
                  ?? context?.[parts[0]];
              } else {
                actual = context;
                for (const p of parts) {
                  actual = actual?.[p];
                }
              }
              return String(actual).toLowerCase() !== expectedValue.toLowerCase();
            }

            // Handle simple boolean: ${varName}
            if (/^\w+$/.test(inner)) {
              const val = context?.environment?.variables?.[inner]
                ?? context?.variables?.[inner]
                ?? context?.[inner];
              return val;
            }

            // Fallback: try to resolve as-is
            console.log(`[flow-runner] Unhandled expression: ${expression}`);
            return undefined;
          },
          isExpression(text: string): boolean {
            if (!text) return false;
            return /^\$\{.+\}$/.test(text);
          },
          hasExpression(text: string): boolean {
            if (!text) return false;
            return /\$\{.+?\}/.test(text);
          },
        },
      });

      this.activeEngines.set(runId, engine);

      const listener = new EventEmitter();

      listener.on('activity.start', async (api: any) => {
        const elementType = api.type;
        const elementId = api.id;
        const elementName = api.name || api.id;

        let stepType = 'agent';
        if (elementType === 'bpmn:StartEvent') stepType = 'start';
        else if (elementType === 'bpmn:EndEvent') stepType = 'end';
        else if (elementType === 'bpmn:UserTask') stepType = 'human';
        else if (elementType?.includes('Gateway')) stepType = 'gateway';

        const matchedAgent = taskAgentMap[elementId];

        try {
          const step = await this.stateManager.createStep(
            runId, elementId, elementName, stepType,
            matchedAgent?.id || undefined, matchedAgent?.name || undefined
          );
          stepStates.set(elementId, step.id);
          await this.stateManager.updateStepStatus(step.id, 'running');
          await this.stateManager.updateStepInput(step.id, lastOutput);
          this.emit('step.update', { runId, step: { ...step, status: 'running' } });
        } catch (err: any) {
          console.error(`[flow-runner] Error creating step for ${elementId}:`, err.message);
        }
      });

      const completedByWait = new Set<string>();

      listener.on('activity.end', async (api: any) => {
        const elementId = api.id;
        const stepId = stepStates.get(elementId);
        if (stepId && !completedByWait.has(stepId)) {
          await this.stateManager.updateStepStatus(stepId, 'completed');
          this.emit('step.update', { runId, stepId, status: 'completed' });
        }
        completedByWait.delete(stepId || '');
      });

      listener.on('activity.wait', async (api: any) => {
        const elementId = api.id;
        const elementName = api.name || api.id;
        // Wait for activity.start to finish creating the step (race condition)
        let stepId = stepStates.get(elementId);
        if (!stepId) {
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            stepId = stepStates.get(elementId);
            if (stepId) break;
          }
        }
        const isHumanTask = humanTaskIds.has(elementId);

        // Handle IntermediateCatchEvent (e.g., signal/message catch) — auto-signal to continue
        if (api.type === 'bpmn:IntermediateCatchEvent') {
          console.log(`[flow-runner] IntermediateCatchEvent "${elementName}" — auto-signaling to continue`);
          if (stepId) await this.stateManager.updateStepStatus(stepId, 'completed', { note: 'Auto-signaled catch event' });
          api.signal();
          return;
        }

        console.log(`[flow-runner] activity.wait: "${elementName}" (${elementId}) type=${api.type} isHuman=${isHumanTask} stepId=${stepId}`);

        if (api.type === 'bpmn:UserTask' && isHumanTask && stepId) {
          // HITL task: run agent first (e.g. validate brief), then pause for human review
          console.log(`[flow-runner] 🙋 HITL task "${elementName}" — running agent then pausing for human review`);
          let agentOutput = '';
          const matchedAgent = taskAgentMap[elementId];
          if (matchedAgent) {
            try {
              const agentConfig: any = {
                name: matchedAgent.name,
                system_prompt: matchedAgent.config?.systemPrompt || matchedAgent.config?.purpose,
                model: matchedAgent.config?.model,
                purpose: matchedAgent.config?.purpose,
              };
              const result = await executeAgent(agentConfig, {
                ...lastOutput,
                _currentTask: elementName,
              });
              if (result.success) {
                agentOutput = result.output;
                lastOutput = { ...lastOutput, [elementId]: result.output, _lastOutput: result.output };
              }
            } catch (err: any) {
              console.error(`[flow-runner] Agent error before HITL pause:`, err.message);
            }
          }
          // Now create approval with the agent's analysis as context
          try {
            const approvalResult = await this.pool.query(
              `INSERT INTO approval_requests (tenant_id, title, description, context, urgency)
               VALUES ($1, $2, $3, $4, 'normal')
               RETURNING *`,
              [tenantId, `Review needed: ${elementName}`, 
               agentOutput || `Flow run is waiting for human review at step "${elementName}"`,
               JSON.stringify({ runId, stepId: elementId, agentAnalysis: agentOutput, input: lastOutput })]
            );
            const approval = approvalResult.rows[0];
            await this.stateManager.setStepApproval(stepId, approval.id);
            await this.stateManager.updateStepStatus(stepId, 'waiting_approval', { response: agentOutput });
            completedByWait.add(stepId);
            await this.stateManager.updateRunStatus(runId, 'paused');
            this.emit('step.update', { runId, stepId, status: 'waiting_approval', approvalId: approval.id });
          } catch (err: any) {
            console.error(`[flow-runner] Error creating approval:`, err.message);
            api.signal();
          }
          return;
        }

        // Track iterations for loop detection
        const iterations = (taskIterations.get(elementId) || 0) + 1;
        taskIterations.set(elementId, iterations);
        console.log(`[flow-runner] Task "${elementName}" iteration #${iterations}`);

        // If we've hit max iterations, force positive path by setting all gateway variables to positive values
        if (iterations >= FlowRunner.MAX_TASK_ITERATIONS) {
          console.log(`[flow-runner] ⚠️ Task "${elementName}" hit max iterations (${FlowRunner.MAX_TASK_ITERATIONS}), forcing positive gateway path`);
          // Set common validation/quality variables to their "positive" values
          const forceVars: Record<string, string> = {
            validationStatus: 'valid',
            conceptQuality: 'acceptable',
            approvalStatus: 'approved',
            briefValid: 'true',
            isValid: 'true',
            status: 'valid',
            result: 'approved',
          };
          Object.assign(api.environment.variables, forceVars);
          // Force gateway routes to the last (happy) path
          for (const [gwId, flows] of gatewayFlows.entries()) {
            if (flows.length > 0) {
              const happyPath = flows[flows.length - 1].id;
              api.environment.variables[`_route_${gwId}`] = happyPath;
              console.log(`[flow-runner] Forced gateway "${gwId}" → happy path "${happyPath}"`);
            }
          }
          console.log(`[flow-runner] Forced environment variables:`, JSON.stringify(forceVars));
          if (stepId) await this.stateManager.updateStepStatus(stepId, 'completed', { note: `Forced after ${iterations} iterations` });
          api.signal();
          return;
        }

        // Converted service task → execute agent LLM call
        const matchedAgent = taskAgentMap[elementId];
        if (matchedAgent && matchedAgent.config) {
          try {
            const agentConfig: AgentConfig = {
              name: matchedAgent.name,
              system_prompt: matchedAgent.config?.system_prompt || matchedAgent.config?.systemPrompt,
              model: matchedAgent.config?.model,
              purpose: matchedAgent.config?.purpose || matchedAgent.config?.detailedPurpose,
            };
            console.log(`[flow-runner] Executing "${elementName}" via "${matchedAgent.name}"`);

            // Build scoped context if data contract exists for this task
            const contract = dataContracts.get(elementId);
            let scopedContext: ScopedContext | undefined;

            if (contract && contract.inputKeys.length > 0) {
              const scopedInput = buildScopedInput(elementId, elementName, contract, flowState);
              scopedContext = {
                taskName: elementName,
                skillName: contract.skillName,
                agentName: contract.agentName || matchedAgent.name,
                scopedInput,
                flowSummary: flowState.flowSummary,
                originalRequest: flowState.originalRequest,
                outputKeys: contract.outputKeys,
              };
              console.log(`[flow-runner] Using scoped context for "${elementName}" — input keys: [${contract.inputKeys}], output keys: [${contract.outputKeys}]`);
            }

            const result = await executeAgent(
              agentConfig,
              scopedContext ? undefined : {
                ...lastOutput,
                _currentTask: elementName,
                _agentRole: matchedAgent.config?.pattern,
              },
              scopedContext
            );

            if (result.success) {
              lastOutput = { ...lastOutput, [elementId]: result.output, _lastOutput: result.output };
              if (stepId) {
                // Parse out DALL-E images if present
              let outputData: Record<string, any> = { response: result.output };
              const imagesMarker = '---IMAGES---';
              const imagesIdx = result.output.indexOf(imagesMarker);
              if (imagesIdx !== -1) {
                const textPart = result.output.substring(0, imagesIdx).trimEnd();
                try {
                  const imagePayload = JSON.parse(result.output.substring(imagesIdx + imagesMarker.length).trim());
                  outputData = { response: textPart, images: imagePayload.images || [] };
                  // Also clean the output for downstream use
                  result.output = textPart;
                } catch { /* keep original if parse fails */ }
              }
              console.log(`[flow-runner] Saving output for "${elementName}" stepId=${stepId} outputLen=${JSON.stringify(outputData).length}`);
              await this.stateManager.updateStepStatus(stepId, 'completed', outputData);
                completedByWait.add(stepId);
              }

              // Extract structured output and store in flow state
              const structuredOutput = extractStructuredOutput(result.output, contract);
              flowState.taskOutputs[elementId] = structuredOutput;
              flowState.flowSummary = updateFlowSummary(flowState.flowSummary, elementName, structuredOutput);
              console.log(`[flow-runner] Flow summary: "${flowState.flowSummary.substring(0, 200)}"`);

              // Extract decision variables from agent output and set in environment
              const extractedVars = this.extractDecisionVariables(result.output);
              if (Object.keys(extractedVars).length > 0) {
                Object.assign(api.environment.variables, extractedVars);
                console.log(`[flow-runner] Set environment variables from agent output:`, JSON.stringify(extractedVars));
              }
            } else {
              if (stepId) await this.stateManager.updateStepStatus(stepId, 'failed', undefined, result.error);
            }
          } catch (err: any) {
            console.error(`[flow-runner] Agent error for ${elementId}:`, err.message);
            if (stepId) await this.stateManager.updateStepStatus(stepId, 'failed', undefined, err.message);
          }
        } else {
          console.log(`[flow-runner] No agent for "${elementName}" — pass through`);
          if (stepId) await this.stateManager.updateStepStatus(stepId, 'completed', { note: 'Pass-through' });
        }

        // Pre-route ALL gateways with latest context (re-routes on every task for loops)
        // Use flow summary + latest task output for concise, relevant context
        const latestTaskOutput = flowState.taskOutputs[elementId];
        const contextParts = [
          `Flow summary: ${flowState.flowSummary || 'Flow just started.'}`,
          `Original request: ${flowState.originalRequest}`,
          latestTaskOutput ? `Latest output: ${JSON.stringify(latestTaskOutput).substring(0, 800)}` : '',
        ];
        const context = contextParts.filter(Boolean).join('\n').substring(0, 2000);
        
        for (const [gwId, flows] of gatewayFlows.entries()) {
          if (flows.length > 0) {
            const gwNameMatch = bpmnXml.match(new RegExp(`<bpmn:exclusiveGateway\\s+id="${gwId}"[^>]*name="([^"]+)"`));
            const gatewayName = gwNameMatch ? gwNameMatch[1] : gwId;
            
            console.log(`[flow-runner] 🤖 Pre-routing gateway "${gatewayName}"`);
            const chosenFlowId = await routeGateway(gatewayName, flows, context);
            api.environment.variables[`_route_${gwId}`] = chosenFlowId;
            console.log(`[flow-runner] 🤖 Routed "${gatewayName}" → "${chosenFlowId}"`);
          }
        }

        // Signal to continue the flow
        api.signal();
      });

      console.log(`[flow-runner] Human tasks: ${[...humanTaskIds].join(', ') || 'none'}`);

      // Register engine-level events before executing
      engine.on('end', async () => {
        await this.stateManager.updateRunStatus(runId, 'completed', lastOutput);
        this.activeEngines.delete(runId);
        this.emit('run.complete', { runId });
        console.log(`[flow-runner] Run ${runId} completed`);
      });

      engine.on('error', async (err: any) => {
        console.error(`[flow-runner] Engine error for run ${runId}:`, err.message);
        await this.stateManager.updateRunStatus(runId, 'failed', undefined, err.message);
        this.activeEngines.delete(runId);
        this.emit('run.error', { runId, error: err.message });
      });

      listener.on('activity.enter', (api: any) => {
        console.log(`[flow-runner] ENTER: ${api.type} "${api.name || api.id}" (${api.id})`);
      });

      // Execute
      console.log(`[flow-runner] Starting engine execution...`);
      const execution = await engine.execute({ listener });
      console.log(`[flow-runner] Engine execution started, state: ${execution?.state || 'unknown'}`);

    } catch (err: any) {
      console.error(`[flow-runner] Failed to start engine for run ${runId}:`, err.message);
      await this.stateManager.updateRunStatus(runId, 'failed', undefined, err.message);
      this.activeEngines.delete(runId);
    }
  }

  /**
   * Extract decision-relevant variables from agent LLM output.
   * Looks for common patterns like "validationStatus: valid", JSON objects, etc.
   * These get set in the bpmn-engine environment so gateway conditions can evaluate.
   */
  private extractDecisionVariables(output: string): Record<string, any> {
    const vars: Record<string, any> = {};

    // Try to parse JSON blocks from the output
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    let jsonMatch;
    while ((jsonMatch = jsonBlockRegex.exec(output)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        Object.assign(vars, this.flattenForEnvironment(parsed));
      } catch { /* ignore parse errors */ }
    }

    // Try to find a top-level JSON object in the output
    const jsonObjRegex = /\{[^{}]*"[^"]+"\s*:\s*[^{}]*\}/g;
    let objMatch;
    while ((objMatch = jsonObjRegex.exec(output)) !== null) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        Object.assign(vars, this.flattenForEnvironment(parsed));
      } catch { /* ignore */ }
    }

    // Pattern match common decision variables: "key: value" or "key = value"
    const knownKeys = [
      'validationStatus', 'conceptQuality', 'approvalStatus', 'status',
      'briefValid', 'isValid', 'result', 'decision', 'quality',
      'processStatus', 'conceptsReceived', 'deliveryReady', 'approvalProcessed',
    ];
    for (const key of knownKeys) {
      // Match "validationStatus": "valid" or validationStatus: valid
      const regex = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']?([\\w-]+)["']?`, 'i');
      const match = output.match(regex);
      if (match) {
        let value: any = match[1].toLowerCase();
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        vars[key] = value;
      }
    }

    return vars;
  }

  /**
   * Flatten a JSON object for bpmn-engine environment variables.
   * Only takes top-level string/boolean/number values.
   */
  private flattenForEnvironment(obj: any): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
        result[key] = value;
      }
    }
    return result;
  }

  async resumeRun(runId: string, tenantId: string): Promise<void> {
    const engine = this.activeEngines.get(runId);
    if (!engine) {
      throw new Error('Run engine not found (may have been restarted). Cannot resume.');
    }

    const run = await this.stateManager.getRun(runId, tenantId);
    if (!run || run.status !== 'paused') {
      throw new Error('Run is not in paused state');
    }

    const execution = engine.execution;
    if (execution) {
      const waiting = execution.getPostponed();
      if (waiting && waiting.length > 0) {
        waiting.forEach((activity: any) => activity.signal());
        await this.stateManager.updateRunStatus(runId, 'running');
      }
    }
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }
}
