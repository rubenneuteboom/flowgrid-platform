/**
 * AI Chain Service - A2A-Compliant Prompt Orchestration
 * 
 * Orchestrates the new prompt chain for A2A-compliant agent design:
 * - Step 1: Extract capabilities + Classify elements
 * - Step 3: Propose agents + Assign patterns + Define skills
 * - Step 5: Relationships + Integrations
 * 
 * This replaces the monolithic prompts in ai.ts with structured,
 * validated, and composable prompts.
 */

import { executePrompt } from '../prompts';
import { 
  ExtractCapabilitiesOutput,
  ClassifyElementsOutput,
  ProposeAgentsOutput,
  AssignPatternsOutput,
  DefineSkillsOutput,
  RelationshipsOutput,
  IntegrationsOutput,
} from '../prompts/schemas';
import { AnalysisResult, ProposedAgent, Integration, AgentRelationship, AgentRelationshipExtended } from '../types/wizard';

// ============================================================================
// Types
// ============================================================================

export interface ChainInput {
  /** Raw text description OR extracted content from image/XML */
  rawContent: string;
  /** Optional custom context from user */
  customPrompt?: string;
  /** Source type for context */
  sourceType: 'text' | 'image' | 'xml';
  /** Industry context for better integration suggestions */
  industryContext?: string;
  /** Known systems in the organization */
  knownSystems?: string[];
}

export interface ChainResult {
  success: boolean;
  analysis?: AnalysisResult;
  error?: string;
  /** Detailed results from each step */
  steps?: {
    extract?: ExtractCapabilitiesOutput;
    classify?: ClassifyElementsOutput;
    agents?: ProposeAgentsOutput;
    patterns?: AssignPatternsOutput;
    skills?: DefineSkillsOutput;
    relationships?: RelationshipsOutput;
    integrations?: IntegrationsOutput;
  };
  /** Total tokens used */
  totalTokens?: {
    input: number;
    output: number;
  };
  /** Total execution time */
  executionTimeMs?: number;
}

// ============================================================================
// Main Chain Executor
// ============================================================================

/**
 * Execute the full A2A-compliant prompt chain
 */
export async function executeA2AChain(input: ChainInput): Promise<ChainResult> {
  const startTime = Date.now();
  const steps: ChainResult['steps'] = {};
  let totalInput = 0;
  let totalOutput = 0;

  console.log('[ai-chain] Starting A2A chain execution');

  try {
    // =========================================================================
    // Step 1a: Extract Capabilities
    // =========================================================================
    console.log('[ai-chain] Step 1a: Extracting capabilities...');
    const extractResult = await executePrompt<
      { description: string; customContext?: string; industry?: string },
      ExtractCapabilitiesOutput
    >('step1.extract-capabilities', {
      description: input.rawContent,
      customContext: input.customPrompt,
      industry: input.industryContext,
    });

    if (!extractResult.success || !extractResult.data) {
      console.error('[ai-chain] Step 1a failed:', extractResult.error);
      return {
        success: false,
        error: `Step 1a (Extract) failed: ${extractResult.error}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.extract = extractResult.data;
    totalInput += extractResult.usage?.inputTokens || 0;
    totalOutput += extractResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 1b: Classify Elements
    // =========================================================================
    console.log('[ai-chain] Step 1b: Classifying elements...');
    const classifyResult = await executePrompt<
      { capabilities: ExtractCapabilitiesOutput['capabilities'] },
      ClassifyElementsOutput
    >('step1.classify-elements', {
      capabilities: extractResult.data.capabilities,
    });

    if (!classifyResult.success || !classifyResult.data) {
      console.error('[ai-chain] Step 1b failed:', classifyResult.error);
      return {
        success: false,
        error: `Step 1b (Classify) failed: ${classifyResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.classify = classifyResult.data;
    totalInput += classifyResult.usage?.inputTokens || 0;
    totalOutput += classifyResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 3a: Propose Agents
    // =========================================================================
    console.log('[ai-chain] Step 3a: Proposing agents...');
    const proposeResult = await executePrompt<
      { elements: ClassifyElementsOutput['elements']; targetAgentCount?: number },
      ProposeAgentsOutput
    >('step3.propose-agents', {
      elements: classifyResult.data.elements,
      targetAgentCount: Math.min(15, Math.ceil(classifyResult.data.elements.length / 3)),
    });

    if (!proposeResult.success || !proposeResult.data) {
      console.error('[ai-chain] Step 3a failed:', proposeResult.error);
      return {
        success: false,
        error: `Step 3a (Propose Agents) failed: ${proposeResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.agents = proposeResult.data;
    totalInput += proposeResult.usage?.inputTokens || 0;
    totalOutput += proposeResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 3b: Assign Patterns
    // =========================================================================
    console.log('[ai-chain] Step 3b: Assigning patterns...');
    const patternsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents'] },
      AssignPatternsOutput
    >('step3.assign-patterns', {
      agents: proposeResult.data.agents,
    });

    if (!patternsResult.success || !patternsResult.data) {
      console.error('[ai-chain] Step 3b failed:', patternsResult.error);
      return {
        success: false,
        error: `Step 3b (Assign Patterns) failed: ${patternsResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.patterns = patternsResult.data;
    totalInput += patternsResult.usage?.inputTokens || 0;
    totalOutput += patternsResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 3c: Define Skills
    // =========================================================================
    console.log('[ai-chain] Step 3c: Defining skills...');
    const skillsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents']; patterns: AssignPatternsOutput['agentPatterns'] },
      DefineSkillsOutput
    >('step3.define-skills', {
      agents: proposeResult.data.agents,
      patterns: patternsResult.data.agentPatterns,
    });

    if (!skillsResult.success || !skillsResult.data) {
      console.error('[ai-chain] Step 3c failed:', skillsResult.error);
      return {
        success: false,
        error: `Step 3c (Define Skills) failed: ${skillsResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.skills = skillsResult.data;
    totalInput += skillsResult.usage?.inputTokens || 0;
    totalOutput += skillsResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 5a: Relationships
    // =========================================================================
    console.log('[ai-chain] Step 5a: Defining relationships...');
    const relationshipsResult = await executePrompt<
      { agents: ProposeAgentsOutput['agents']; patterns: AssignPatternsOutput['agentPatterns'] },
      RelationshipsOutput
    >('step5.relationships', {
      agents: proposeResult.data.agents,
      patterns: patternsResult.data.agentPatterns,
    });

    if (!relationshipsResult.success || !relationshipsResult.data) {
      console.error('[ai-chain] Step 5a failed:', relationshipsResult.error);
      return {
        success: false,
        error: `Step 5a (Relationships) failed: ${relationshipsResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.relationships = relationshipsResult.data;
    totalInput += relationshipsResult.usage?.inputTokens || 0;
    totalOutput += relationshipsResult.usage?.outputTokens || 0;

    // =========================================================================
    // Step 5b: Integrations
    // =========================================================================
    console.log('[ai-chain] Step 5b: Identifying integrations...');
    const integrationsResult = await executePrompt<
      { 
        agents: ProposeAgentsOutput['agents']; 
        patterns: AssignPatternsOutput['agentPatterns'];
        knownSystems?: string[];
        industryContext?: string;
      },
      IntegrationsOutput
    >('step5.integrations', {
      agents: proposeResult.data.agents,
      patterns: patternsResult.data.agentPatterns,
      knownSystems: input.knownSystems,
      industryContext: input.industryContext,
    });

    if (!integrationsResult.success || !integrationsResult.data) {
      console.error('[ai-chain] Step 5b failed:', integrationsResult.error);
      return {
        success: false,
        error: `Step 5b (Integrations) failed: ${integrationsResult.error}`,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    }

    steps.integrations = integrationsResult.data;
    totalInput += integrationsResult.usage?.inputTokens || 0;
    totalOutput += integrationsResult.usage?.outputTokens || 0;

    // =========================================================================
    // Assemble Final Result
    // =========================================================================
    console.log('[ai-chain] Assembling final result...');
    const analysis = assembleAnalysisResult(steps);

    console.log(`[ai-chain] Chain complete: ${analysis.agents.length} agents, ${analysis.agentRelationships.length} relationships`);

    return {
      success: true,
      analysis,
      steps,
      totalTokens: { input: totalInput, output: totalOutput },
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    console.error('[ai-chain] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      steps,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Result Assembly
// ============================================================================

// Helper to capitalize pattern (schemas use lowercase, ProposedAgent uses capitalized)
function capitalizePattern(pattern: string): string {
  return pattern.charAt(0).toUpperCase() + pattern.slice(1);
}

function assembleAnalysisResult(steps: ChainResult['steps']): AnalysisResult {
  const { extract, classify, agents, patterns, skills, relationships, integrations } = steps!;

  // Build agents array with full A2A data
  const proposedAgents: ProposedAgent[] = agents!.agents.map((agent) => {
    const pattern = patterns?.agentPatterns.find(p => p.agentId === agent.id);
    const agentSkills = skills?.agentSkills.find(s => s.agentId === agent.id);

    return {
      id: agent.id,
      name: agent.name,
      elementType: 'Agent' as const,
      purpose: agent.purpose,
      description: agent.purpose,
      shortDescription: agent.shortDescription || '',
      capabilities: agent.ownedElements || [],
      pattern: capitalizePattern(pattern?.pattern || agent.suggestedPattern) as any,
      patternRationale: pattern?.patternRationale || '',
      autonomyLevel: pattern?.autonomyLevel || 'supervised',
      riskAppetite: pattern?.riskAppetite || 'medium',
      triggers: pattern?.triggers || [],
      outputs: pattern?.outputs || [],
      // A2A extensions
      a2aSkills: agentSkills?.skills,
      boundaries: agent.boundaries,
    };
  });

  // Build relationships
  const agentRelationships: AgentRelationship[] = (relationships?.relationships || []).map(rel => ({
    sourceAgentId: rel.sourceAgentId,
    targetAgentId: rel.targetAgentId,
    messageType: rel.messageType,
    description: rel.description,
    messageSchema: rel.messageSchema,
    isAsync: rel.isAsync,
    priority: rel.priority,
  }));

  // Build integrations
  const integrationsArray: Integration[] = (integrations?.integrations || []).map(int => ({
    agentId: int.agentId,
    name: int.name,
    system: int.system,
    type: int.type as 'API' | 'Webhook',
    direction: int.direction as 'inbound' | 'outbound' | 'bidirectional',
    dataFlows: int.dataFlows,
  }));

  // Build capabilities list
  const extractedCapabilities = (extract?.capabilities || []).map(cap => ({
    name: cap.name,
    level: (cap.level || 1) as 0 | 1 | 2,
    description: cap.description || '',
    automationPotential: 'medium' as 'low' | 'medium' | 'high', // Default, not in schema
  }));

  return {
    summary: {
      totalCapabilities: extractedCapabilities.length,
      recommendedAgents: proposedAgents.length,
      complexity: proposedAgents.length > 15 ? 'high' : proposedAgents.length > 8 ? 'medium' : 'low',
      overview: `Designed ${proposedAgents.length} A2A-compliant agents from ${extract?.metadata?.totalExtracted || extractedCapabilities.length} capabilities`,
    },
    extractedCapabilities,
    agents: proposedAgents,
    agentRelationships,
    integrations: integrationsArray,
  };
}

// ============================================================================
// Quick Analysis (Single-Step Fallback)
// ============================================================================

/**
 * Quick single-step analysis for simple inputs
 * Uses only Step 1a + 3a for speed
 */
export async function executeQuickAnalysis(input: ChainInput): Promise<ChainResult> {
  const startTime = Date.now();
  
  console.log('[ai-chain] Running quick analysis (2-step)');
  
  try {
    // Step 1a only
    const extractResult = await executePrompt<
      { rawText: string; sourceType: string; customPrompt?: string },
      ExtractCapabilitiesOutput
    >('step1.extract-capabilities', {
      rawText: input.rawContent,
      sourceType: input.sourceType,
      customPrompt: input.customPrompt,
    });

    if (!extractResult.success || !extractResult.data) {
      return {
        success: false,
        error: `Quick analysis failed: ${extractResult.error}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Step 3a only (propose agents without full A2A metadata)
    const proposeResult = await executePrompt<
      { elements: Array<{ name: string; elementType: string; description?: string }> },
      ProposeAgentsOutput
    >('step3.propose-agents', {
      elements: extractResult.data.capabilities.map(c => ({
        name: c.name,
        elementType: 'Capability',
        description: c.description,
      })),
    });

    if (!proposeResult.success || !proposeResult.data) {
      return {
        success: false,
        error: `Quick analysis failed at agent proposal: ${proposeResult.error}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Minimal assembly
    const analysis: AnalysisResult = {
      summary: {
        totalCapabilities: extractResult.data.capabilities.length,
        recommendedAgents: proposeResult.data.agents.length,
        complexity: 'low',
        overview: `Quick analysis: ${proposeResult.data.agents.length} agents from ${extractResult.data.capabilities.length} capabilities`,
      },
      extractedCapabilities: extractResult.data.capabilities.map(c => ({
        name: c.name,
        level: 1 as const,
        description: c.description || '',
        automationPotential: 'medium' as const,
      })),
      agents: proposeResult.data.agents.map(a => ({
        id: a.id,
        name: a.name,
        elementType: 'Agent' as const,
        purpose: a.purpose,
        description: a.purpose,
        shortDescription: a.shortDescription || '',
        capabilities: a.ownedElements || [],
        pattern: capitalizePattern(a.suggestedPattern) as any,
        patternRationale: '',
        autonomyLevel: a.suggestedAutonomy || 'supervised' as const,
        riskAppetite: 'medium' as const,
        triggers: a.triggers || [],
        outputs: a.outputs || [],
        escalationPath: a.escalationPath || '',
        interactionPattern: a.interactionPattern || 'event-driven',
      })),
      agentRelationships: [],
      integrations: [],
    };

    return {
      success: true,
      analysis,
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
    };
  }
}
