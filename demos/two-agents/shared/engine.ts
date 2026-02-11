/**
 * FlowGrid Agent Engine - Minimal Runtime
 * 
 * A lightweight A2A-compliant agent runtime for Azure Functions.
 */

import { ServiceBusClient, ServiceBusSender, ServiceBusReceiver } from '@azure/service-bus';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// FlowGrid Agent Engine
// ============================================================================

export class FlowGridEngine {
  private agentId: string;
  private skills: Map<string, AgentSkill> = new Map();
  private serviceBusClient: ServiceBusClient | null = null;
  private sender: ServiceBusSender | null = null;
  
  constructor(agentId: string) {
    this.agentId = agentId;
  }
  
  /**
   * Register a skill handler
   */
  registerSkill(skill: AgentSkill): void {
    this.skills.set(skill.id, skill);
    console.log(`[${this.agentId}] Registered skill: ${skill.id}`);
  }
  
  /**
   * Initialize Service Bus connection
   */
  async connect(connectionString: string, queueName: string): Promise<void> {
    this.serviceBusClient = new ServiceBusClient(connectionString);
    this.sender = this.serviceBusClient.createSender(queueName);
    console.log(`[${this.agentId}] Connected to Service Bus queue: ${queueName}`);
  }
  
  /**
   * Send a message to another agent
   */
  async sendMessage(to: string, payload: Record<string, unknown>, skill?: string, correlationId?: string): Promise<void> {
    if (!this.sender) {
      throw new Error('Not connected to Service Bus');
    }
    
    const message: AgentMessage = {
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
  async processMessage(message: AgentMessage): Promise<AgentMessage | null> {
    console.log(`[${this.agentId}] ← [${message.from}] Received: ${message.type} (skill: ${message.skill || 'default'})`);
    
    // Find the skill handler
    const skill = message.skill ? this.skills.get(message.skill) : this.skills.values().next().value;
    
    if (!skill) {
      console.error(`[${this.agentId}] No handler for skill: ${message.skill}`);
      return null;
    }
    
    // Create context
    const context: AgentContext = {
      agentId: this.agentId,
      correlationId: message.correlationId || message.id,
      sendMessage: (to, payload, skill) => this.sendMessage(to, payload, skill, message.correlationId),
      log: (msg, data) => console.log(`[${this.agentId}] ${msg}`, data || ''),
    };
    
    // Execute skill
    try {
      const result = await skill.handler(message.payload, context);
      
      // Create response message
      const response: AgentMessage = {
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
      
    } catch (error) {
      console.error(`[${this.agentId}] Error processing message:`, error);
      return null;
    }
  }
  
  /**
   * Get the agent card
   */
  getAgentCard(baseUrl: string): AgentCard {
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
        handler: undefined as any, // Don't expose handler
      })),
    };
  }
  
  /**
   * Cleanup
   */
  async close(): Promise<void> {
    if (this.sender) await this.sender.close();
    if (this.serviceBusClient) await this.serviceBusClient.close();
  }
}

export default FlowGridEngine;
