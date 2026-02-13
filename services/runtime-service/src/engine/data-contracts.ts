/**
 * Parse BPMN documentation blocks to extract task data contracts.
 * Each task's <bpmn:documentation> may contain structured Input/Output specs.
 */

export interface TaskDataContract {
  inputKeys: string[];
  outputKeys: string[];
  agentName: string;
  skillName: string;
}

export interface FlowState {
  originalRequest: string;
  flowSummary: string;
  taskOutputs: Record<string, Record<string, any>>;
}

/**
 * Parse Input/Output field names from a documentation line like:
 * Input: { designBrief: object, brandGuidelines: object }
 */
function parseFieldKeys(line: string): string[] {
  const match = line.match(/\{([^}]+)\}/);
  if (!match) return [];
  // Extract field names before the colon in "fieldName: type"
  return match[1]
    .split(',')
    .map(f => f.trim().split(/\s*:/)[0].trim())
    .filter(f => f.length > 0);
}

/**
 * Parse all task data contracts from BPMN XML.
 * Looks for <bpmn:documentation> blocks within tasks containing structured specs.
 */
export function parseTaskDataContracts(bpmnXml: string): Map<string, TaskDataContract> {
  const contracts = new Map<string, TaskDataContract>();

  // Match tasks (serviceTask, task, sendTask, userTask) that have documentation blocks
  const taskRegex = /<bpmn:(?:serviceTask|task|sendTask|userTask)\s+id="([^"]+)"[^>]*>[\s\S]*?<bpmn:documentation>([\s\S]*?)<\/bpmn:documentation>[\s\S]*?<\/bpmn:(?:serviceTask|task|sendTask|userTask)>/g;
  let m;
  while ((m = taskRegex.exec(bpmnXml)) !== null) {
    const taskId = m[1];
    const doc = m[2].trim();

    // Parse structured lines
    const agentMatch = doc.match(/Agent:\s*(.+)/i);
    const skillMatch = doc.match(/Skill:\s*(.+)/i);
    const inputMatch = doc.match(/Input:\s*(\{[^}]+\})/i);
    const outputMatch = doc.match(/Output:\s*(\{[^}]+\})/i);

    // Only create contract if we have at least input or output spec
    if (inputMatch || outputMatch) {
      contracts.set(taskId, {
        inputKeys: inputMatch ? parseFieldKeys(inputMatch[0]) : [],
        outputKeys: outputMatch ? parseFieldKeys(outputMatch[0]) : [],
        agentName: agentMatch ? agentMatch[1].trim() : '',
        skillName: skillMatch ? skillMatch[1].trim() : '',
      });
      console.log(`[data-contracts] Task ${taskId}: input=[${contracts.get(taskId)!.inputKeys}] output=[${contracts.get(taskId)!.outputKeys}]`);
    }
  }

  return contracts;
}

/**
 * Build scoped input for a task based on its data contract.
 * Only passes fields the task declared it needs, plus flow context.
 */
export function buildScopedInput(
  taskId: string,
  taskName: string,
  contract: TaskDataContract | undefined,
  flowState: FlowState
): any {
  if (!contract || contract.inputKeys.length === 0) {
    // No contract — fall back to passing everything (backward compatible)
    return {
      ...flowState.taskOutputs,
      _currentTask: taskName,
      _flowSummary: flowState.flowSummary,
      originalRequest: flowState.originalRequest,
    };
  }

  const scopedInput: Record<string, any> = {};
  const missingKeys: string[] = [];

  // Search all previous task outputs for the requested input keys
  for (const key of contract.inputKeys) {
    let found = false;
    // Search through all task outputs
    for (const [, outputs] of Object.entries(flowState.taskOutputs)) {
      if (outputs && key in outputs) {
        scopedInput[key] = outputs[key];
        found = true;
        break;
      }
    }
    if (!found) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    scopedInput._missingInputs = missingKeys;
  }

  return {
    ...scopedInput,
    _currentTask: taskName,
    _flowSummary: flowState.flowSummary,
    originalRequest: flowState.originalRequest,
  };
}

/**
 * Extract structured output from an agent's response based on the task's output contract.
 * Looks for JSON blocks and key-value patterns matching the declared output keys.
 */
export function extractStructuredOutput(agentOutput: string, contract: TaskDataContract | undefined): Record<string, any> {
  const result: Record<string, any> = {};

  // Try to extract from JSON blocks first
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
  let jm;
  while ((jm = jsonBlockRegex.exec(agentOutput)) !== null) {
    try {
      const parsed = JSON.parse(jm[1]);
      Object.assign(result, parsed);
    } catch { /* ignore */ }
  }

  // Also try bare JSON objects
  const bareJsonRegex = /(?:^|\n)\s*(\{[^{}]*"[^"]+"\s*:\s*[^{}]*\})/g;
  let bm;
  while ((bm = bareJsonRegex.exec(agentOutput)) !== null) {
    try {
      const parsed = JSON.parse(bm[1]);
      Object.assign(result, parsed);
    } catch { /* ignore */ }
  }

  // If contract specifies output keys, filter to just those (plus any extras from JSON)
  if (contract && contract.outputKeys.length > 0) {
    // Keep all parsed JSON fields but ensure we have entries for declared output keys
    for (const key of contract.outputKeys) {
      if (!(key in result)) {
        // Try pattern matching in the text
        const regex = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']?([\\w-]+)["']?`, 'i');
        const match = agentOutput.match(regex);
        if (match) {
          result[key] = match[1];
        }
      }
    }
  }

  // Always store raw output as fallback
  result._raw = agentOutput;

  return result;
}

/**
 * Update the flow summary string (kept under ~500 chars).
 */
export function updateFlowSummary(currentSummary: string, taskName: string, outputKeys: Record<string, any>): string {
  // Build a brief description of what this task produced
  const keyVals = Object.entries(outputKeys)
    .filter(([k]) => k !== '_raw' && k !== '_lastOutput')
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : typeof v === 'object' ? '[object]' : String(v);
      return `${k}=${val.substring(0, 30)}`;
    })
    .join(', ');

  const addition = keyVals ? `${taskName}: ${keyVals}. ` : `${taskName} completed. `;
  const updated = currentSummary + addition;

  // Trim to ~500 chars, cutting at last sentence boundary
  if (updated.length > 500) {
    const trimmed = updated.substring(updated.length - 480);
    const sentenceStart = trimmed.indexOf('. ');
    return '...' + (sentenceStart >= 0 ? trimmed.substring(sentenceStart + 2) : trimmed);
  }
  return updated;
}
