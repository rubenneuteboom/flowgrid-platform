/**
 * Step Executor - Per-Step Wizard Execution
 * 
 * Provides individual step execution functions for the wizard flow.
 * Each step can be executed independently with proper state management.
 */

import { executePrompt, GenerateBPMNInput, GenerateBPMNOutput } from '../prompts';
import {
  ExtractCapabilitiesOutput,
  ClassifyElementsOutput,
  ProposeAgentsOutput,
  AssignPatternsOutput,
  DefineSkillsOutput,
  RelationshipsOutput,
  IntegrationsOutput,
} from '../prompts/schemas';

// =============================================================================
// Types
// =============================================================================

export interface StepResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  executionTimeMs: number;
}

export interface WizardStepData {
  step1?: {
    rawCapabilities: ExtractCapabilitiesOutput;
  };
  step2?: {
    selectedCapabilityIds: string[];
    classifiedElements: ClassifyElementsOutput;
  };
  step3?: {
    proposedAgents: ProposeAgentsOutput;
    userAdjustments?: any[];
  };
  step4?: {
    patterns: AssignPatternsOutput;
    skills: DefineSkillsOutput;
  };
  step5?: {
    processFlows: { elementId: string; bpmnXml: string }[];
  };
  step6?: {
    relationships: RelationshipsOutput;
    integrations: IntegrationsOutput;
  };
}

// =============================================================================
// Step 1: Extract Capabilities
// =============================================================================

export interface Step1Input {
  description: string;
  customContext?: string;
  industry?: string;
}

export async function executeStep1(input: Step1Input): Promise<StepResult<ExtractCapabilitiesOutput>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 1: Extracting capabilities...');

  try {
    const result = await executePrompt<
      { description: string; customContext?: string; industry?: string },
      ExtractCapabilitiesOutput
    >('step1.extract-capabilities', {
      description: input.description,
      customContext: input.customContext,
      industry: input.industry,
    });

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to extract capabilities',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: result.data,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 1 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Step 2: Classify Elements
// =============================================================================

export interface Step2Input {
  capabilities: ExtractCapabilitiesOutput['capabilities'];
  selectedIds?: string[];
}

export async function executeStep2(input: Step2Input): Promise<StepResult<ClassifyElementsOutput>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 2: Classifying elements...');

  try {
    // Filter to selected capabilities if provided
    let capsToClassify = input.selectedIds
      ? input.capabilities.filter(c => input.selectedIds!.includes(c.id))
      : input.capabilities;
    
    // Limit to 50 capabilities to avoid timeout (AI can handle ~50 well)
    if (capsToClassify.length > 50) {
      console.log(`[step-executor] Limiting from ${capsToClassify.length} to 50 capabilities`);
      capsToClassify = capsToClassify.slice(0, 50);
    }
    
    console.log(`[step-executor] Classifying ${capsToClassify.length} capabilities...`);

    const result = await executePrompt<
      { capabilities: ExtractCapabilitiesOutput['capabilities'] },
      ClassifyElementsOutput
    >('step1.classify-elements', {
      capabilities: capsToClassify,
    });

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to classify elements',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: result.data,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 2 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Step 3: Propose Agents
// =============================================================================

export interface Step3Input {
  elements: ClassifyElementsOutput['elements'];
  targetAgentCount?: number;
}

export async function executeStep3(input: Step3Input): Promise<StepResult<ProposeAgentsOutput>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 3: Proposing agents...');

  try {
    const result = await executePrompt<
      { elements: ClassifyElementsOutput['elements']; targetAgentCount?: number },
      ProposeAgentsOutput
    >('step3.propose-agents', {
      elements: input.elements,
      targetAgentCount: input.targetAgentCount || Math.min(15, Math.ceil(input.elements.length / 3)),
    });

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to propose agents',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: result.data,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 3 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Step 4: Configure Agents (Patterns + Skills)
// =============================================================================

export interface Step4Input {
  agents: ProposeAgentsOutput['agents'];
}

export interface Step4Output {
  patterns: AssignPatternsOutput;
  skills: DefineSkillsOutput;
}

export async function executeStep4(input: Step4Input): Promise<StepResult<Step4Output>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 4: Configuring agents (patterns + skills)...');

  try {
    // Step 4a: Assign Patterns
    const patternsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents'] },
      AssignPatternsOutput
    >('step3.assign-patterns', {
      agents: input.agents,
    });

    if (!patternsResult.success || !patternsResult.data) {
      return {
        success: false,
        error: patternsResult.error || 'Failed to assign patterns',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Step 4b: Define Skills
    const skillsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents']; patterns: AssignPatternsOutput['agentPatterns'] },
      DefineSkillsOutput
    >('step3.define-skills', {
      agents: input.agents,
      patterns: patternsResult.data.agentPatterns,
    });

    if (!skillsResult.success || !skillsResult.data) {
      return {
        success: false,
        error: skillsResult.error || 'Failed to define skills',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: {
        patterns: patternsResult.data,
        skills: skillsResult.data,
      },
      usage: {
        inputTokens: (patternsResult.usage?.inputTokens || 0) + (skillsResult.usage?.inputTokens || 0),
        outputTokens: (patternsResult.usage?.outputTokens || 0) + (skillsResult.usage?.outputTokens || 0),
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 4 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Step 5: Generate BPMN
// =============================================================================

export interface Step5Input {
  processId: string;  // Element ID for tracking
  processName: string;
  processDescription: string;
  involvedAgents: string[];
  capabilities: string[];
  triggers?: string[];
  outputs?: string[];
}

export interface BPMNOutput {
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

export async function executeStep5(input: Step5Input): Promise<StepResult<BPMNOutput>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 5: Generating BPMN for', input.processName);

  try {
    const result = await executePrompt<GenerateBPMNInput, GenerateBPMNOutput>(
      'step4.generate-bpmn',
      {
        processName: input.processName,
        processDescription: input.processDescription,
        involvedAgents: input.involvedAgents,
        capabilities: input.capabilities,
        triggers: input.triggers,
        outputs: input.outputs,
      }
    );

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to generate BPMN',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: result.data,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 5 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Step 6: Relationships + Integrations
// =============================================================================

export interface Step6Input {
  agents: ProposeAgentsOutput['agents'];
  patterns: AssignPatternsOutput['agentPatterns'];
  industryContext?: string;
  knownSystems?: string[];
}

export interface Step6Output {
  relationships: RelationshipsOutput;
  integrations: IntegrationsOutput;
}

export async function executeStep6(input: Step6Input): Promise<StepResult<Step6Output>> {
  const startTime = Date.now();
  console.log('[step-executor] Step 6: Defining relationships and integrations...');

  try {
    // Step 6a: Relationships
    const relationshipsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents']; patterns: AssignPatternsOutput['agentPatterns'] },
      RelationshipsOutput
    >('step5.relationships', {
      agents: input.agents,
      patterns: input.patterns,
    });

    if (!relationshipsResult.success || !relationshipsResult.data) {
      return {
        success: false,
        error: relationshipsResult.error || 'Failed to define relationships',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Step 6b: Integrations
    const integrationsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents']; patterns: AssignPatternsOutput['agentPatterns']; industry?: string; knownSystems?: string[] },
      IntegrationsOutput
    >('step5.integrations', {
      agents: input.agents,
      patterns: input.patterns,
      industry: input.industryContext,
      knownSystems: input.knownSystems,
    });

    if (!integrationsResult.success || !integrationsResult.data) {
      return {
        success: false,
        error: integrationsResult.error || 'Failed to identify integrations',
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: {
        relationships: relationshipsResult.data,
        integrations: integrationsResult.data,
      },
      usage: {
        inputTokens: (relationshipsResult.usage?.inputTokens || 0) + (integrationsResult.usage?.inputTokens || 0),
        outputTokens: (relationshipsResult.usage?.outputTokens || 0) + (integrationsResult.usage?.outputTokens || 0),
      },
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[step-executor] Step 6 error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}

export default {
  executeStep1,
  executeStep2,
  executeStep3,
  executeStep4,
  executeStep5,
  executeStep6,
};
