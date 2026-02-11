/**
 * FlowGrid Agent Engine - Minimal Runtime
 *
 * A lightweight A2A-compliant agent runtime for Azure Functions.
 */
export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    type: 'request' | 'response' | 'event';
    skill?: string;
    payload: Record<string, unknown>;
    correlationId?: string;
    timestamp: string;
}
export interface AgentCard {
    name: string;
    url: string;
    version: string;
    protocolVersion: string;
    description: string;
    skills: AgentSkill[];
}
export interface AgentSkill {
    id: string;
    name: string;
    description: string;
    tags: string[];
    handler: (input: Record<string, unknown>, context: AgentContext) => Promise<Record<string, unknown>>;
}
export interface AgentContext {
    agentId: string;
    correlationId: string;
    sendMessage: (to: string, payload: Record<string, unknown>, skill?: string) => Promise<void>;
    log: (message: string, data?: unknown) => void;
}
export declare class FlowGridEngine {
    private agentId;
    private skills;
    private serviceBusClient;
    private sender;
    constructor(agentId: string);
    /**
     * Register a skill handler
     */
    registerSkill(skill: AgentSkill): void;
    /**
     * Initialize Service Bus connection
     */
    connect(connectionString: string, queueName: string): Promise<void>;
    /**
     * Send a message to another agent
     */
    sendMessage(to: string, payload: Record<string, unknown>, skill?: string, correlationId?: string): Promise<void>;
    /**
     * Process an incoming message
     */
    processMessage(message: AgentMessage): Promise<AgentMessage | null>;
    /**
     * Get the agent card
     */
    getAgentCard(baseUrl: string): AgentCard;
    /**
     * Cleanup
     */
    close(): Promise<void>;
}
export default FlowGridEngine;
