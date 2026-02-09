/**
 * AI Service - Abstraction Layer for AI Providers
 * 
 * Platform Architecture: Following Hohpe's "Floating Platform" principle -
 * decouple AI models from the API. Easy to swap GPT-4 → GPT-5 or Claude → other models.
 * 
 * This service hides the complexity of multiple AI providers behind a clean interface.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getPatternPromptReference } from './patterns';
import { AnalysisResult, ProposedAgent } from '../types/wizard';

// ============================================================================
// AI Provider Configuration
// ============================================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Anthropic client (singleton)
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

export function isAnthropicConfigured(): boolean {
  return !!ANTHROPIC_API_KEY;
}

export function isOpenAIConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

// ============================================================================
// Version Tracking (Floating Platform - track AI versions)
// ============================================================================

export interface AIModelVersion {
  provider: 'openai' | 'anthropic';
  model: string;
  version: string;
}

export function getCurrentModels(): AIModelVersion[] {
  return [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', version: '4.5' },
    { provider: 'openai', model: 'gpt-4o', version: '2024-05' },
  ];
}

// ============================================================================
// Image Analysis (GPT-4 Vision)
// ============================================================================

interface VisionExtractionResult {
  title?: string;
  structure: {
    level0: string[];
    level1: string[];
    level2: string[];
  };
  hierarchy: Array<{
    name: string;
    children: Array<{ name: string; children: unknown[] }>;
  }>;
  totalItems: number;
  additionalText: string[];
}

export async function analyzeImageWithVision(
  base64Image: string,
  mimeType: string,
  customPrompt?: string
): Promise<VisionExtractionResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured for vision analysis');
  }

  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

  const visionPrompt = customPrompt 
    ? `USER CONTEXT: ${customPrompt}\n\nYou are analyzing a capability model diagram.\n\nTASK: Extract ALL text and structure from this image.`
    : `You are analyzing a capability model diagram.\n\nTASK: Extract ALL text and structure from this image.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'user', 
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
            { type: 'text', text: `${visionPrompt}

Return a JSON object with:
{
  "title": "Name of the model if visible",
  "structure": {
    "level0": ["List all top-level sections/value streams"],
    "level1": ["List all mid-level capability groups"],
    "level2": ["List all detailed capabilities/functions"]
  },
  "hierarchy": [
    {
      "name": "Top level item name",
      "children": [{ "name": "Child item name", "children": [] }]
    }
  ],
  "totalItems": <count>,
  "additionalText": ["Any other text visible"]
}

Be thorough - extract EVERY piece of text you can see.` }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI Vision error: ${response.status} - ${error}`);
  }

  const data = await response.json() as any;
  let extractedText = data.choices[0].message.content;

  // Clean markdown
  if (extractedText.startsWith('```')) {
    extractedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  }

  try {
    return JSON.parse(extractedText);
  } catch {
    return {
      title: undefined,
      structure: { level0: [], level1: [], level2: [] },
      hierarchy: [],
      totalItems: 0,
      additionalText: [extractedText],
    };
  }
}

// ============================================================================
// Agent Design Analysis (Claude)
// ============================================================================

export async function designAgentsFromCapabilities(
  extractedData: VisionExtractionResult,
  customPrompt?: string
): Promise<AnalysisResult> {
  const patternReference = getPatternPromptReference();

  const analysisPrompt = `Je bent een enterprise architect. Analyseer deze geëxtraheerde capability structuur en ontwerp een compleet agent model.

${patternReference}

## GEËXTRAHEERDE DATA UIT AFBEELDING:
${JSON.stringify(extractedData, null, 2)}

${customPrompt ? `## EXTRA CONTEXT VAN GEBRUIKER:\n${customPrompt}` : ''}

## ONTWERP NU EEN COMPLEET AGENT MODEL:

Return valid JSON:
{
  "summary": {
    "totalCapabilities": <number>,
    "valueStreams": [<level 0 items>],
    "capabilityGroups": <number>,
    "recommendedAgents": <number>,
    "complexity": "low|medium|high",
    "overview": "<beschrijving>"
  },
  "extractedCapabilities": [
    {"name": "<naam>", "level": <0-2>, "parentName": "<parent of null>", "description": "<beschrijving>", "automationPotential": "low|medium|high"}
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "<Agent Naam>",
      "layer": "value-stream|functional-component|capability",
      "valueStream": "<level 0 naam>",
      "purpose": "<doel>",
      "description": "<uitgebreide beschrijving>",
      "capabilities": [<capability namen>],
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router|routing|planning|tool-use|orchestration|human-in-loop|rag|reflection|guardrails",
      "patternRationale": "<why this pattern was chosen>",
      "autonomyLevel": "autonomous|supervised|human-in-loop",
      "riskAppetite": "low|medium|high",
      "triggers": [<triggers>],
      "outputs": [<outputs>]
    }
  ],
  "agentRelationships": [
    {"sourceAgentId": "agent-1", "targetAgentId": "agent-2", "messageType": "<type>", "description": "<wat>"}
  ],
  "integrations": [
    {"agentId": "agent-1", "name": "<naam>", "system": "<systeem>", "type": "API|Webhook", "direction": "inbound|outbound"}
  ]
}

REGELS:
- Max 20 agents to ensure complete JSON output
- Keep descriptions SHORT (max 80 chars)
- Define relationships between related agents
- Include realistic integrations (ServiceNow, Jira, etc.)
- Return ONLY valid JSON, no markdown`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system: 'You are an expert enterprise architect. Respond with ONLY valid JSON.',
    messages: [{ role: 'user', content: analysisPrompt }],
  });

  let analysis = message.content[0].type === 'text' ? message.content[0].text : '';
  
  // Clean markdown
  if (analysis.includes('```')) {
    analysis = analysis.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  }
  const jsonMatch = analysis.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    analysis = jsonMatch[0];
  }

  return JSON.parse(analysis) as AnalysisResult;
}

// ============================================================================
// Text Description Analysis (Claude)
// ============================================================================

export async function analyzeTextDescription(
  description: string,
  requirements?: string[]
): Promise<AnalysisResult> {
  const patternReference = getPatternPromptReference();

  const prompt = `Je bent een enterprise architect. Analyseer deze beschrijving en ontwerp een compleet agent model.

${patternReference}

## BESCHRIJVING:
${description}

${requirements && requirements.length > 0 ? `## EISEN:\n${requirements.join('\n')}` : ''}

## ONTWERP NU EEN COMPLEET AGENT MODEL:

Return valid JSON:
{
  "summary": {
    "totalCapabilities": <number>,
    "recommendedAgents": <number>,
    "complexity": "low|medium|high",
    "overview": "<beschrijving>"
  },
  "extractedCapabilities": [
    {"name": "<naam>", "level": <0-2>, "description": "<beschrijving>", "automationPotential": "low|medium|high"}
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "<Agent Naam>",
      "purpose": "<doel>",
      "description": "<uitgebreide beschrijving>",
      "capabilities": [<capability namen>],
      "pattern": "Orchestrator|Specialist|Coordinator|Gateway|Monitor|Executor|Analyzer|Aggregator|Router|routing|planning|tool-use|orchestration|human-in-loop|rag|reflection|guardrails",
      "patternRationale": "<waarom dit pattern>",
      "autonomyLevel": "autonomous|supervised|human-in-loop",
      "riskAppetite": "low|medium|high",
      "triggers": [<triggers>],
      "outputs": [<outputs>]
    }
  ],
  "agentRelationships": [
    {"sourceAgentId": "agent-1", "targetAgentId": "agent-2", "messageType": "<type>", "description": "<wat>"}
  ],
  "integrations": [
    {"agentId": "agent-1", "name": "<naam>", "system": "<systeem>", "type": "API|Webhook", "direction": "inbound|outbound"}
  ]
}

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 6000,
    system: 'You are an expert enterprise architect. Respond with ONLY valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  let analysis = message.content[0].type === 'text' ? message.content[0].text : '';
  
  if (analysis.includes('```')) {
    analysis = analysis.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  }
  const jsonMatch = analysis.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    analysis = jsonMatch[0];
  }

  return JSON.parse(analysis) as AnalysisResult;
}

// ============================================================================
// Process Flow Generation (Claude)
// ============================================================================

export interface ProcessFlowResult {
  processSteps: string;
  decisionPoints: string;
  errorHandling: string;
}

export async function generateProcessFlow(agent: ProposedAgent): Promise<ProcessFlowResult> {
  const prompt = `Generate a simple process flow for an agent with these specifications:

Name: ${agent.name}
Purpose: ${agent.purpose || agent.description || 'No purpose specified'}
Pattern: ${agent.pattern || 'Specialist'}
Capabilities: ${(agent.capabilities || []).join(', ')}

Return in this format:

PROCESS STEPS:
1. [First step]
2. [Second step]
3. [Continue...]

DECISION POINTS:
- IF [condition] THEN [action]
- IF [condition] THEN [action]

ERROR HANDLING:
- ON [error type] THEN [handling action]
- ON [error type] THEN [handling action]

Be specific to the agent's purpose and capabilities.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const reply = message.content[0].type === 'text' ? message.content[0].text : '';

  // Parse the response
  const stepsMatch = reply.match(/PROCESS STEPS:([\s\S]*?)(?=DECISION POINTS:|$)/i);
  const decisionsMatch = reply.match(/DECISION POINTS:([\s\S]*?)(?=ERROR HANDLING:|$)/i);
  const errorsMatch = reply.match(/ERROR HANDLING:([\s\S]*?)$/i);

  return {
    processSteps: stepsMatch ? stepsMatch[1].trim() : reply,
    decisionPoints: decisionsMatch ? decisionsMatch[1].trim() : '',
    errorHandling: errorsMatch ? errorsMatch[1].trim() : '',
  };
}

// ============================================================================
// Interaction Suggestions (Claude)
// ============================================================================

export interface InteractionSuggestion {
  sourceAgent: string;
  targetAgent: string;
  messageType: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export async function suggestInteractions(
  agents: ProposedAgent[]
): Promise<InteractionSuggestion[]> {
  if (agents.length < 2) {
    return [];
  }

  const prompt = `Given these IT service management agents, suggest meaningful interactions between them:

Agents:
${agents.map(a => 
  `- ${a.name} (${a.pattern || 'Specialist'}): ${a.purpose || a.description || 'No description'}\n  Capabilities: ${(a.capabilities || []).join(', ')}`
).join('\n')}

Suggest interactions in this JSON format:
{
  "suggestions": [
    {
      "sourceAgent": "agent name",
      "targetAgent": "agent name", 
      "messageType": "type of message/event",
      "description": "why this interaction is valuable",
      "priority": "high|medium|low"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.suggestions || [];
    }
  } catch {
    // Return empty on parse failure
  }

  return [];
}
