"use strict";
/**
 * Coordinator Agent - Azure Function
 *
 * Receives HTTP requests and delegates work to the Specialist agent.
 * Demonstrates A2A agent-to-agent communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const service_bus_1 = require("@azure/service-bus");
const AGENT_ID = 'coordinator-agent';
const SERVICE_BUS_CONNECTION = process.env.SERVICE_BUS_CONNECTION || '';
const QUEUE_TO_SPECIALIST = 'specialist-inbox';
const QUEUE_FROM_SPECIALIST = 'coordinator-inbox';
// ============================================================================
// HTTP Trigger - Receive external requests
// ============================================================================
functions_1.app.http('coordinator', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'agent/request',
    handler: async (request, context) => {
        context.log(`[${AGENT_ID}] Received HTTP request`);
        try {
            const body = await request.json();
            if (!body.task) {
                return { status: 400, jsonBody: { error: 'Missing task field' } };
            }
            // Create correlation ID for tracking
            const correlationId = crypto.randomUUID();
            context.log(`[${AGENT_ID}] Processing task: ${body.task} (correlation: ${correlationId})`);
            // Decide: handle locally or delegate?
            if (body.task === 'simple-greeting') {
                // Handle locally
                return {
                    status: 200,
                    jsonBody: {
                        agent: AGENT_ID,
                        message: `Hello! I'm the Coordinator. How can I help you today?`,
                        correlationId,
                    },
                };
            }
            // Delegate to Specialist
            context.log(`[${AGENT_ID}] Delegating to specialist-agent...`);
            const sbClient = new service_bus_1.ServiceBusClient(SERVICE_BUS_CONNECTION);
            const sender = sbClient.createSender(QUEUE_TO_SPECIALIST);
            const message = {
                id: crypto.randomUUID(),
                from: AGENT_ID,
                to: 'specialist-agent',
                type: 'request',
                skill: 'analyze',
                payload: {
                    task: body.task,
                    data: body.data || {},
                    requestedBy: 'coordinator',
                },
                correlationId,
                timestamp: new Date().toISOString(),
            };
            await sender.sendMessages({
                body: message,
                correlationId,
                subject: 'specialist-agent',
                applicationProperties: { from: AGENT_ID, skill: 'analyze' },
            });
            await sender.close();
            await sbClient.close();
            context.log(`[${AGENT_ID}] → [specialist-agent] Message sent!`);
            return {
                status: 202,
                jsonBody: {
                    agent: AGENT_ID,
                    status: 'delegated',
                    message: `Task "${body.task}" delegated to specialist. Check back with correlationId.`,
                    correlationId,
                    delegatedTo: 'specialist-agent',
                },
            };
        }
        catch (error) {
            context.error(`[${AGENT_ID}] Error:`, error);
            return { status: 500, jsonBody: { error: 'Internal error', details: String(error) } };
        }
    },
});
// ============================================================================
// Service Bus Trigger - Receive responses from Specialist
// ============================================================================
functions_1.app.serviceBusQueue('coordinatorInbox', {
    connection: 'SERVICE_BUS_CONNECTION',
    queueName: QUEUE_FROM_SPECIALIST,
    handler: async (message, context) => {
        const msg = message;
        context.log(`[${AGENT_ID}] ← [${msg.from}] Received response (correlation: ${msg.correlationId})`);
        context.log(`[${AGENT_ID}] Result:`, JSON.stringify(msg.payload, null, 2));
        // In a real system, we'd store this or notify the original requester
        // For this demo, we just log it
        context.log(`[${AGENT_ID}] ✅ Task complete! Specialist says: "${msg.payload.result || msg.payload.message}"`);
    },
});
// ============================================================================
// Agent Card endpoint
// ============================================================================
functions_1.app.http('coordinatorCard', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: '.well-known/agent.json',
    handler: async (request) => {
        const baseUrl = `https://${request.headers.get('host')}`;
        return {
            status: 200,
            jsonBody: {
                name: 'Coordinator Agent',
                url: baseUrl,
                version: '1.0.0',
                protocolVersion: '0.2',
                description: 'Orchestrates tasks by delegating to specialist agents',
                provider: {
                    organization: 'FlowGrid Platform',
                    url: 'https://flowgrid.io',
                },
                capabilities: {
                    streaming: false,
                    pushNotifications: false,
                    stateTransitionHistory: true,
                },
                defaultInputModes: ['text'],
                defaultOutputModes: ['text'],
                skills: [
                    {
                        id: 'delegate-task',
                        name: 'Delegate Task',
                        description: 'Receives a task and delegates to the appropriate specialist agent',
                        tags: ['orchestration', 'delegation', 'routing'],
                        examples: [
                            {
                                name: 'Analyze Data Request',
                                input: { task: 'analyze-data', data: { source: 'metrics' } },
                                output: { status: 'delegated', delegatedTo: 'specialist-agent' },
                            },
                        ],
                    },
                    {
                        id: 'simple-greeting',
                        name: 'Simple Greeting',
                        description: 'Returns a friendly greeting without delegation',
                        tags: ['greeting', 'local'],
                        examples: [
                            {
                                name: 'Hello',
                                input: { task: 'simple-greeting' },
                                output: { message: 'Hello! I\'m the Coordinator.' },
                            },
                        ],
                    },
                ],
            },
        };
    },
});
