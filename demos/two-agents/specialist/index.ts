/**
 * Specialist Agent - AI-Powered Azure Function
 * 
 * Receives tasks and uses Azure OpenAI to provide intelligent responses.
 * A2A Protocol compliant.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { ServiceBusClient } from '@azure/service-bus';

const AGENT_ID = 'specialist-agent';
const SERVICE_BUS_CONNECTION = process.env.SERVICE_BUS_CONNECTION || '';
const QUEUE_INBOX = 'specialist-inbox';
const QUEUE_TO_COORDINATOR = 'coordinator-inbox';

// Azure OpenAI config
const AOAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || '';
const AOAI_KEY = process.env.AZURE_OPENAI_KEY || '';
const AOAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-41-mini';

interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response';
  skill?: string;
  payload: Record<string, unknown>;
  correlationId: string;
  timestamp: string;
}

// ============================================================================
// AI Processing with Azure OpenAI
// ============================================================================

async function callAzureOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
  const url = `${AOAI_ENDPOINT}openai/deployments/${AOAI_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`;
  
  const messages = [
    {
      role: 'system',
      content: systemPrompt || `You are a helpful AI Specialist Agent in the FlowGrid platform. 
You provide concise, actionable responses. You're part of a multi-agent system.
Keep responses under 200 words unless more detail is needed.
Be friendly but professional.`
    },
    { role: 'user', content: prompt }
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AOAI_KEY,
    },
    body: JSON.stringify({
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure OpenAI error: ${response.status} - ${error}`);
  }

  const data = await response.json() as any;
  return data.choices[0]?.message?.content || 'I could not generate a response.';
}

// ============================================================================
// Service Bus Trigger - Receive tasks from Coordinator
// ============================================================================

app.serviceBusQueue('specialistInbox', {
  connection: 'SERVICE_BUS_CONNECTION',
  queueName: QUEUE_INBOX,
  handler: async (message: unknown, context: InvocationContext) => {
    const msg = message as AgentMessage;
    context.log(`[${AGENT_ID}] ← [${msg.from}] Received task (correlation: ${msg.correlationId})`);
    
    // Process with AI
    const result = await processWithAI(msg.payload, context);
    
    // Send response back to Coordinator
    const sbClient = new ServiceBusClient(SERVICE_BUS_CONNECTION);
    const sender = sbClient.createSender(QUEUE_TO_COORDINATOR);
    
    const response: AgentMessage = {
      id: crypto.randomUUID(),
      from: AGENT_ID,
      to: msg.from,
      type: 'response',
      skill: msg.skill,
      payload: result,
      correlationId: msg.correlationId,
      timestamp: new Date().toISOString(),
    };
    
    await sender.sendMessages({
      body: response,
      correlationId: msg.correlationId,
      subject: msg.from,
    });
    
    await sender.close();
    await sbClient.close();
    
    context.log(`[${AGENT_ID}] → [${msg.from}] AI response sent!`);
  },
});

// ============================================================================
// AI-Powered Task Processing
// ============================================================================

async function processWithAI(
  payload: Record<string, unknown>,
  context: InvocationContext
): Promise<Record<string, unknown>> {
  const task = payload.task as string;
  const prompt = payload.prompt as string;
  const data = payload.data as Record<string, unknown>;
  
  context.log(`[${AGENT_ID}] 🤖 Processing with AI: ${task || prompt?.slice(0, 50)}`);
  
  // If there's a direct prompt, use it
  if (prompt) {
    const aiResponse = await callAzureOpenAI(prompt);
    return {
      agent: AGENT_ID,
      response: aiResponse,
      processedAt: new Date().toISOString(),
    };
  }
  
  // Handle specific tasks with AI augmentation
  switch (task) {
    case 'analyze-data': {
      const systemPrompt = `You are a data analysis specialist. Analyze the provided context and give insights.`;
      const userPrompt = `Analyze this data request: ${JSON.stringify(data || {})}. 
Provide 3 key insights and a confidence score (0-1).`;
      
      const aiResponse = await callAzureOpenAI(userPrompt, systemPrompt);
      return {
        result: 'Analysis complete',
        aiInsights: aiResponse,
        confidence: 0.87,
        processedBy: AGENT_ID,
        processedAt: new Date().toISOString(),
      };
    }
      
    case 'generate-report': {
      const systemPrompt = `You are a report generation specialist. Create concise, professional reports.`;
      const userPrompt = `Generate a brief report summary for: ${JSON.stringify(data || { topic: 'general' })}`;
      
      const aiResponse = await callAzureOpenAI(userPrompt, systemPrompt);
      return {
        result: 'Report generated',
        reportId: `RPT-${Date.now()}`,
        summary: aiResponse,
        processedBy: AGENT_ID,
      };
    }
      
    case 'validate-config': {
      const systemPrompt = `You are a configuration validation specialist. Check for issues and best practices.`;
      const userPrompt = `Review this configuration: ${JSON.stringify(data || {})}. List any issues or recommendations.`;
      
      const aiResponse = await callAzureOpenAI(userPrompt, systemPrompt);
      return {
        result: 'Configuration reviewed',
        validation: aiResponse,
        processedBy: AGENT_ID,
      };
    }
      
    default: {
      // Generic AI response for any task
      const aiResponse = await callAzureOpenAI(
        `The user asked about: "${task}". Additional context: ${JSON.stringify(data || {})}. Please help.`
      );
      return {
        agent: AGENT_ID,
        task,
        response: aiResponse,
        processedAt: new Date().toISOString(),
      };
    }
  }
}

// ============================================================================
// HTTP endpoint for direct prompts
// ============================================================================

app.http('specialist', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/process',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log(`[${AGENT_ID}] Received direct HTTP request`);
    
    try {
      const body = await request.json() as { 
        task?: string; 
        prompt?: string;
        data?: Record<string, unknown> 
      };
      
      if (!body.task && !body.prompt) {
        return { 
          status: 400, 
          jsonBody: { 
            error: 'Missing task or prompt field',
            usage: 'Send {"prompt": "your question"} or {"task": "analyze-data", "data": {...}}'
          } 
        };
      }
      
      const result = await processWithAI(body, context);
      
      return {
        status: 200,
        jsonBody: result,
      };
      
    } catch (error) {
      context.error(`[${AGENT_ID}] Error:`, error);
      return { status: 500, jsonBody: { error: 'Internal error', details: String(error) } };
    }
  },
});

// ============================================================================
// Chat endpoint - conversational interface
// ============================================================================

app.http('specialistChat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/chat',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log(`[${AGENT_ID}] 💬 Chat request`);
    
    try {
      const body = await request.json() as { message: string };
      
      if (!body.message) {
        return { status: 400, jsonBody: { error: 'Missing message field' } };
      }
      
      const aiResponse = await callAzureOpenAI(body.message);
      
      return {
        status: 200,
        jsonBody: {
          agent: AGENT_ID,
          message: aiResponse,
          timestamp: new Date().toISOString(),
        },
      };
      
    } catch (error) {
      context.error(`[${AGENT_ID}] Chat error:`, error);
      return { status: 500, jsonBody: { error: 'AI processing failed' } };
    }
  },
});

// ============================================================================
// Agent Card endpoint
// ============================================================================

app.http('specialistCard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '.well-known/agent.json',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const baseUrl = `https://${request.headers.get('host')}`;
    
    return {
      status: 200,
      jsonBody: {
        name: 'Specialist Agent (AI-Powered)',
        url: baseUrl,
        version: '2.0.0',
        protocolVersion: '0.2',
        description: 'AI-powered specialist that can analyze data, generate reports, and answer questions using Azure OpenAI',
        provider: {
          organization: 'FlowGrid Platform',
          url: 'https://flowgrid.io',
        },
        capabilities: {
          streaming: false,
          pushNotifications: false,
          stateTransitionHistory: true,
          aiPowered: true,
          model: 'gpt-4.1-mini',
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        skills: [
          {
            id: 'chat',
            name: 'Chat',
            description: 'Have a conversation with the AI agent',
            tags: ['ai', 'chat', 'conversation', 'natural-language'],
            examples: [
              {
                name: 'Ask a question',
                input: { message: 'What is the best practice for API design?' },
                output: { message: 'Here are key API design best practices...' },
              },
            ],
          },
          {
            id: 'analyze',
            name: 'Analyze Data',
            description: 'AI-powered data analysis with insights',
            tags: ['ai', 'analysis', 'data', 'insights'],
            examples: [
              {
                name: 'Analyze metrics',
                input: { task: 'analyze-data', data: { source: 'metrics' } },
                output: { result: 'Analysis complete', aiInsights: '...' },
              },
            ],
          },
          {
            id: 'generate-report',
            name: 'Generate Report',
            description: 'AI-generated reports and summaries',
            tags: ['ai', 'report', 'generation', 'documentation'],
            examples: [
              {
                name: 'Generate summary',
                input: { task: 'generate-report', data: { topic: 'Q4 results' } },
                output: { result: 'Report generated', summary: '...' },
              },
            ],
          },
        ],
      },
    };
  },
});
