"use strict";
/**
 * FlowGrid Agent Engine - Minimal Runtime
 *
 * A lightweight A2A-compliant agent runtime for Azure Functions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowGridEngine = void 0;
const service_bus_1 = require("@azure/service-bus");
// ============================================================================
// FlowGrid Agent Engine
// ============================================================================
class FlowGridEngine {
    agentId;
    skills = new Map();
    serviceBusClient = null;
    sender = null;
    constructor(agentId) {
        this.agentId = agentId;
    }
    /**
     * Register a skill handler
     */
    registerSkill(skill) {
        this.skills.set(skill.id, skill);
        console.log(`[${this.agentId}] Registered skill: ${skill.id}`);
    }
    /**
     * Initialize Service Bus connection
     */
    async connect(connectionString, queueName) {
        this.serviceBusClient = new service_bus_1.ServiceBusClient(connectionString);
        this.sender = this.serviceBusClient.createSender(queueName);
        console.log(`[${this.agentId}] Connected to Service Bus queue: ${queueName}`);
    }
    /**
     * Send a message to another agent
     */
    async sendMessage(to, payload, skill, correlationId) {
        if (!this.sender) {
            throw new Error('Not connected to Service Bus');
        }
        const message = {
            id: crypto.randomUUID(),
            from: this.agentId,
            to,
            type: 'request',
            skill,
            payload,
            correlationId: correlationId || crypto.randomUUID(),
            timestamp: new Date().toISOString(),
        };
        await this.sender.sendMessages({
            body: message,
            subject: to,
            correlationId: message.correlationId,
            applicationProperties: {
                from: this.agentId,
                to,
                skill: skill || 'default',
            },
        });
        console.log(`[${this.agentId}] → [${to}] Sent message: ${message.id}`);
    }
    /**
     * Process an incoming message
     */
    async processMessage(message) {
        console.log(`[${this.agentId}] ← [${message.from}] Received: ${message.type} (skill: ${message.skill || 'default'})`);
        // Find the skill handler
        const skill = message.skill ? this.skills.get(message.skill) : this.skills.values().next().value;
        if (!skill) {
            console.error(`[${this.agentId}] No handler for skill: ${message.skill}`);
            return null;
        }
        // Create context
        const context = {
            agentId: this.agentId,
            correlationId: message.correlationId || message.id,
            sendMessage: (to, payload, skill) => this.sendMessage(to, payload, skill, message.correlationId),
            log: (msg, data) => console.log(`[${this.agentId}] ${msg}`, data || ''),
        };
        // Execute skill
        try {
            const result = await skill.handler(message.payload, context);
            // Create response message
            const response = {
                id: crypto.randomUUID(),
                from: this.agentId,
                to: message.from,
                type: 'response',
                skill: message.skill,
                payload: result,
                correlationId: message.correlationId,
                timestamp: new Date().toISOString(),
            };
            console.log(`[${this.agentId}] Processed successfully, result:`, result);
            return response;
        }
        catch (error) {
            console.error(`[${this.agentId}] Error processing message:`, error);
            return null;
        }
    }
    /**
     * Get the agent card
     */
    getAgentCard(baseUrl) {
        return {
            name: this.agentId,
            url: `${baseUrl}/${this.agentId}`,
            version: '1.0.0',
            protocolVersion: '0.2',
            description: `FlowGrid Agent: ${this.agentId}`,
            skills: Array.from(this.skills.values()).map(s => ({
                id: s.id,
                name: s.name,
                description: s.description,
                tags: s.tags,
                handler: undefined, // Don't expose handler
            })),
        };
    }
    /**
     * Cleanup
     */
    async close() {
        if (this.sender)
            await this.sender.close();
        if (this.serviceBusClient)
            await this.serviceBusClient.close();
    }
}
exports.FlowGridEngine = FlowGridEngine;
exports.default = FlowGridEngine;
