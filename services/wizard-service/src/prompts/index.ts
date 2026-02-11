/**
 * Prompt Registry & Executor
 * 
 * Central registry for all AI prompts. Each prompt is:
 * - Typed with Zod schemas for input/output validation
 * - Versioned for A/B testing and rollback
 * - Cacheable for repeated executions
 * 
 * Following Hohpe's "Floating Platform" - prompts are decoupled from AI providers.
 */

import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Types
// ============================================================================

export interface PromptDefinition<TInput, TOutput> {
  /** Unique identifier */
  id: string;
  /** Semantic version */
  version: string;
  /** Human description */
  description: string;
  /** The system prompt template */
  systemPrompt: string;
  /** Function to build user message from input */
  buildUserMessage: (input: TInput) => string;
  /** Zod schema for output validation */
  outputSchema: z.ZodSchema<TOutput>;
  /** Model preferences */
  modelPreferences?: {
    preferredModel?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface PromptExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rawResponse?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  promptVersion: string;
  executionTimeMs: number;
}

// ============================================================================
// Prompt Registry
// ============================================================================

const promptRegistry = new Map<string, PromptDefinition<unknown, unknown>>();

export function registerPrompt<TInput, TOutput>(
  prompt: PromptDefinition<TInput, TOutput>
): void {
  promptRegistry.set(prompt.id, prompt as PromptDefinition<unknown, unknown>);
}

export function getPrompt<TInput, TOutput>(
  id: string
): PromptDefinition<TInput, TOutput> | undefined {
  return promptRegistry.get(id) as PromptDefinition<TInput, TOutput> | undefined;
}

export function listPrompts(): Array<{ id: string; version: string; description: string }> {
  return Array.from(promptRegistry.values()).map(p => ({
    id: p.id,
    version: p.version,
    description: p.description,
  }));
}

// ============================================================================
// Prompt Executor
// ============================================================================

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.3;

/**
 * Execute a registered prompt with validation
 */
export async function executePrompt<TInput, TOutput>(
  promptId: string,
  input: TInput,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<PromptExecutionResult<TOutput>> {
  const startTime = Date.now();
  const prompt = getPrompt<TInput, TOutput>(promptId);
  
  if (!prompt) {
    return {
      success: false,
      error: `Prompt not found: ${promptId}`,
      model: 'none',
      promptVersion: 'unknown',
      executionTimeMs: Date.now() - startTime,
    };
  }

  const model = options?.model ?? prompt.modelPreferences?.preferredModel ?? DEFAULT_MODEL;
  const temperature = options?.temperature ?? prompt.modelPreferences?.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = options?.maxTokens ?? prompt.modelPreferences?.maxTokens ?? DEFAULT_MAX_TOKENS;

  try {
    // Build the user message
    const userMessage = prompt.buildUserMessage(input);
    
    // Call Anthropic
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: prompt.systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ],
    });

    // Extract text content
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return {
        success: false,
        error: 'No text content in response',
        model,
        promptVersion: prompt.version,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const rawResponse = textContent.text;

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse JSON: ${parseError}`,
        rawResponse,
        model,
        promptVersion: prompt.version,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Validate with Zod
    const validated = prompt.outputSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        success: false,
        error: `Validation failed: ${validated.error.message}`,
        rawResponse,
        model,
        promptVersion: prompt.version,
        executionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: validated.data as TOutput,
      rawResponse,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model,
      promptVersion: prompt.version,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      model,
      promptVersion: prompt.version,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Helper: Chain multiple prompts
// ============================================================================

export interface PromptChainStep<TIn, TOut> {
  promptId: string;
  transform?: (prevOutput: unknown, input: TIn) => TIn;
}

/**
 * Execute a chain of prompts where output of one feeds into the next
 */
export async function executePromptChain<TInitial, TFinal>(
  steps: PromptChainStep<unknown, unknown>[],
  initialInput: TInitial
): Promise<PromptExecutionResult<TFinal>> {
  let currentInput: unknown = initialInput;
  let lastResult: PromptExecutionResult<unknown> | null = null;
  const startTime = Date.now();

  for (const step of steps) {
    const stepInput: unknown = step.transform 
      ? step.transform(lastResult?.data, currentInput)
      : currentInput;
    
    lastResult = await executePrompt(step.promptId, stepInput);
    
    if (!lastResult.success) {
      return {
        ...lastResult,
        executionTimeMs: Date.now() - startTime,
      } as PromptExecutionResult<TFinal>;
    }
    
    currentInput = lastResult.data;
  }

  return {
    ...lastResult!,
    executionTimeMs: Date.now() - startTime,
  } as PromptExecutionResult<TFinal>;
}

// ============================================================================
// Auto-register prompts on import
// ============================================================================

// Import and register all prompts
// Step 1: Extract & Classify
import './step1/extract';
import './step1/classify';

// Step 3: Agent Design
import './step3/propose-agents';
import './step3/assign-patterns';
import './step3/define-skills';

// Step 4: BPMN Generation
import './step4/generate-bpmn';
export { GenerateBPMNInput, GenerateBPMNOutput } from './step4/generate-bpmn';

// Step 5: Relationships & Integrations
import './step5/relationships';
import './step5/integrations';
