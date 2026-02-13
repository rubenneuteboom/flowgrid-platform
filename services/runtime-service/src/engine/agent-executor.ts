import OpenAI from 'openai';

const openai = new OpenAI();
const DEFAULT_MODEL = 'gpt-4o';

// --- DALL-E Image Generation Support ---

const CREATIVE_TASK_KEYWORDS = ['design', 'create', 'generate', 'concept', 'visual', 'illustration', 'artwork', 'mockup', 'draft'];
const CREATIVE_AGENT_KEYWORDS = ['design', 'creative', 'artist', 'illustrator'];
const CREATIVE_OUTPUT_KEYWORDS = ['design', 'concept', 'visual', 'image', 'artwork', 'mockup'];
const MAX_IMAGES_PER_TASK = 3;

function isCreativeTask(scopedContext?: ScopedContext, agentName?: string): boolean {
  const taskName = (scopedContext?.taskName || '').toLowerCase();
  const agent = (agentName || scopedContext?.agentName || '').toLowerCase();
  const outputKeys = (scopedContext?.outputKeys || []).map(k => k.toLowerCase());

  const taskMatch = CREATIVE_TASK_KEYWORDS.some(kw => taskName.includes(kw));
  const agentMatch = CREATIVE_AGENT_KEYWORDS.some(kw => agent.includes(kw));
  const outputMatch = CREATIVE_OUTPUT_KEYWORDS.some(kw => outputKeys.some(ok => ok.includes(kw)));

  return taskMatch || agentMatch || outputMatch;
}

interface GeneratedImage {
  url: string;
  prompt: string;
  theme: string;
}

async function generateImages(themes: { theme: string; prompt: string }[]): Promise<GeneratedImage[]> {
  const limited = themes.slice(0, MAX_IMAGES_PER_TASK);
  const results: GeneratedImage[] = [];

  for (const { theme, prompt } of limited) {
    try {
      console.log(`[agent-executor] Generating DALL-E image for theme: "${theme}"`);
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
      const url = response.data?.[0]?.url;
      if (url) {
        results.push({ url, prompt, theme });
        console.log(`[agent-executor] Image generated for "${theme}"`);
      }
    } catch (err: any) {
      console.error(`[agent-executor] DALL-E error for "${theme}":`, err.message);
      // Continue with other images
    }
  }

  return results;
}

async function createDallePrompts(textOutput: string, scopedContext?: ScopedContext): Promise<{ theme: string; prompt: string }[]> {
  const taskContext = scopedContext
    ? `Task: ${scopedContext.taskName}\nOriginal request: ${scopedContext.originalRequest}\nAgent output:\n${textOutput.substring(0, 2000)}`
    : textOutput.substring(0, 2000);

  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: `You are a DALL-E prompt engineer. Given a creative task output, extract the distinct design themes/concepts and create detailed DALL-E 3 prompts for each. Return JSON array only, max ${MAX_IMAGES_PER_TASK} items: [{"theme": "short name", "prompt": "detailed DALL-E prompt"}]. No markdown, just JSON.`
        },
        { role: 'user', content: taskContext }
      ]
    });

    const raw = response.choices[0]?.message?.content?.trim() || '[]';
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error('[agent-executor] Failed to create DALL-E prompts:', err.message);
    return [];
  }
}

/**
 * Lightweight AI gateway router — picks the right outgoing path from an exclusive gateway.
 */
export async function routeGateway(
  gatewayName: string,
  outgoingFlows: { id: string; name: string; condition?: string }[],
  context: string
): Promise<string> {
  const flowOptions = outgoingFlows
    .map((f, i) => `${i + 1}. "${f.name || f.id}"${f.condition ? ` (condition: ${f.condition})` : ''}`)
    .join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: 50,
      messages: [
        { role: 'system', content: 'You are a workflow routing engine. Given a gateway decision point, the available paths, and the current context, pick the most logical path. Respond with ONLY the number (1, 2, etc.) of the best path. Nothing else.' },
        { role: 'user', content: `Gateway: "${gatewayName}"\n\nAvailable paths:\n${flowOptions}\n\nCurrent context (recent agent output):\n${context.substring(0, 1500)}\n\nWhich path? Reply with just the number.` }
      ]
    });

    const answer = response.choices[0]?.message?.content?.trim() || '';
    const pathIndex = parseInt(answer) - 1;
    if (pathIndex >= 0 && pathIndex < outgoingFlows.length) {
      console.log(`[gateway-router] "${gatewayName}" → path ${pathIndex + 1}: "${outgoingFlows[pathIndex].name || outgoingFlows[pathIndex].id}"`);
      return outgoingFlows[pathIndex].id;
    }

    console.log(`[gateway-router] "${gatewayName}" → couldn't parse "${answer}", using last path`);
    return outgoingFlows[outgoingFlows.length - 1].id;
  } catch (err: any) {
    console.error(`[gateway-router] Error routing "${gatewayName}":`, err.message);
    return outgoingFlows[outgoingFlows.length - 1].id;
  }
}

export interface AgentConfig {
  name: string;
  system_prompt?: string;
  model?: string;
  purpose?: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ScopedContext {
  taskName: string;
  skillName?: string;
  agentName?: string;
  scopedInput: Record<string, any>;
  flowSummary: string;
  originalRequest: string;
  outputKeys?: string[];
}

export async function executeAgent(agent: AgentConfig, input: any, scopedContext?: ScopedContext): Promise<ExecutionResult> {
  const systemPrompt = agent.system_prompt || agent.purpose || `You are ${agent.name}. Process the input and provide your output.`;

  let userContent: string;

  if (scopedContext) {
    const { taskName, skillName, scopedInput, flowSummary, originalRequest, outputKeys } = scopedContext;
    const inputFields = { ...scopedInput };
    delete inputFields._currentTask;
    delete inputFields._flowSummary;
    delete inputFields.originalRequest;
    delete inputFields._missingInputs;

    const inputText = Object.keys(inputFields).length > 0
      ? JSON.stringify(inputFields, null, 2)
      : '(No specific input fields from previous steps)';

    const missingNote = scopedInput._missingInputs
      ? `\nNote: These expected inputs were not found in previous outputs: ${(scopedInput._missingInputs as string[]).join(', ')}`
      : '';

    const outputFormat = outputKeys && outputKeys.length > 0
      ? `\nEXPECTED OUTPUT FORMAT:\nPlease structure your response to include these fields: ${outputKeys.join(', ')}\nInclude a JSON block at the end with these exact keys.\n\`\`\`json\n{${outputKeys.map(k => `"${k}": "..."`).join(', ')}}\n\`\`\``
      : `\nIMPORTANT: At the end of your response, include a JSON block with key decision variables, e.g.:\n\`\`\`json\n{"validationStatus": "valid", "conceptQuality": "acceptable"}\n\`\`\``;

    userContent = `CURRENT TASK: ${taskName}${skillName ? `\nYOUR SKILL: ${skillName}` : ''}

EXPECTED INPUT:
${inputText}${missingNote}

FLOW CONTEXT:
${flowSummary || 'This is the first step in the flow.'}
${outputFormat}

USER REQUEST:
${originalRequest}`;
  } else {
    const inputText = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    userContent = `Process the following input and provide your output.

IMPORTANT: At the end of your response, include a JSON block with key decision variables, e.g.:
\`\`\`json
{"validationStatus": "valid", "conceptQuality": "acceptable"}
\`\`\`
Use values like "valid"/"invalid" for validationStatus, "acceptable"/"needs_revision" for conceptQuality.

Input:
${inputText}`;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: agent.model || DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      });

      const output = response.choices[0]?.message?.content || '';

      // For creative tasks, generate images via DALL-E
      if (isCreativeTask(scopedContext, agent.name)) {
        console.log(`[agent-executor] Creative task detected: "${scopedContext?.taskName || agent.name}" — generating images`);
        try {
          const themes = await createDallePrompts(output, scopedContext);
          if (themes.length > 0) {
            const images = await generateImages(themes);
            if (images.length > 0) {
              // Embed image data in the output as a JSON appendix
              const imagePayload = { response: output, images };
              const imageBlock = `\n\n---IMAGES---\n${JSON.stringify(imagePayload)}`;
              return { success: true, output: output + imageBlock };
            }
          }
        } catch (imgErr: any) {
          console.error('[agent-executor] Image generation failed, returning text only:', imgErr.message);
        }
      }

      return { success: true, output };
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      const isRetryable = status === 429 || status === 529 || status === 503;
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`[agent-executor] ${agent.name} attempt ${attempt}/${maxRetries} failed (${status}) — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.error(`[agent-executor] Error executing agent ${agent.name}:`, error.message);
      return { success: false, output: '', error: error.message };
    }
  }
  return { success: false, output: '', error: 'Max retries exceeded' };
}
