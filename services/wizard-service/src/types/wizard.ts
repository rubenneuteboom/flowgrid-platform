/**
 * Wizard Service Type Definitions
 * 
 * Platform Architecture: These types define the wizard's data contracts.
 * Following Hohpe's principle of "Real Abstraction" - users interact with
 * clean interfaces, not AI model specifics.
 */

// ============================================================================
// Session Types
// ============================================================================

export interface WizardSession {
  id: string;
  tenantId: string;
  sessionName: string;
  sourceType: 'image' | 'text' | 'template' | 'xml';
  sourceData: Record<string, unknown>;
  analysisResult: AnalysisResult | null;
  customPrompt?: string;
  status: 'created' | 'analyzing' | 'analyzed' | 'applied' | 'failed';
  step_data?: Record<string, unknown>; // Per-step wizard data
  current_step?: number;
  createdAt: Date;
  updatedAt: Date;
  appliedAt?: Date;
}

export interface CreateSessionRequest {
  tenantId: string;
  sessionName?: string;
  sourceType: 'image' | 'text' | 'template' | 'xml';
}

// ============================================================================
// Analysis Types  
// ============================================================================

export interface AnalysisResult {
  summary: AnalysisSummary;
  extractedCapabilities: ExtractedCapability[];
  agents: ProposedAgent[];
  agentRelationships: AgentRelationship[];
  integrations: ProposedIntegration[];
}

export interface AnalysisSummary {
  totalCapabilities: number;
  valueStreams?: string[];
  capabilityGroups?: number;
  recommendedAgents: number;
  complexity: 'low' | 'medium' | 'high';
  overview: string;
}

export interface ExtractedCapability {
  name: string;
  level: 0 | 1 | 2;
  parentName?: string | null;
  description: string;
  automationPotential: 'low' | 'medium' | 'high';
}

// ============================================================================
// Agent Types
// ============================================================================

export type AgenticPattern = 
  // Core Platform Patterns
  | 'Orchestrator'
  | 'Specialist' 
  | 'Coordinator'
  | 'Gateway'
  | 'Monitor'
  | 'Executor'
  | 'Analyzer'
  | 'Aggregator'
  | 'Router'
  // Anthropic Patterns
  | 'routing'
  | 'planning'
  | 'tool-use'
  | 'orchestration'
  | 'human-in-loop'
  | 'rag'
  | 'reflection'
  | 'guardrails';

export type AutonomyLevel = 'autonomous' | 'supervised' | 'human-in-loop';
export type RiskAppetite = 'low' | 'medium' | 'high';
export type AgentLayer = 'value-stream' | 'functional-component' | 'capability';

export type ElementType = 'Agent' | 'Capability' | 'DataObject' | 'Process';

export interface ProposedAgent {
  id: string;
  name: string;
  elementType?: ElementType;
  layer?: AgentLayer;
  valueStream?: string;
  purpose: string;
  description: string;
  capabilities: string[];
  pattern: AgenticPattern;
  patternRationale: string;
  autonomyLevel: AutonomyLevel;
  riskAppetite: RiskAppetite;
  triggers: string[];
  outputs: string[];
  objectives?: string[];
  processSteps?: string;
  decisionPoints?: string;
  errorHandling?: string;
  // A2A extensions
  a2aSkills?: A2ASkill[];
  boundaries?: AgentBoundaries;
}

// A2A Skill definition
export interface A2ASkill {
  skillId: string;
  name: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
  examples?: Array<{ input: object; output: object }>;
}

// Agent boundaries (who they delegate to / escalate to)
export interface AgentBoundaries {
  delegates: string[];
  escalates: string[];
}

export interface AgentRelationship {
  sourceAgentId: string;
  targetAgentId: string;
  messageType: string;
  description: string;
}

// ============================================================================
// Integration Types
// ============================================================================

export interface ProposedIntegration {
  agentId: string;
  name: string;
  system: string;
  type: 'API' | 'Webhook' | 'EventBus' | 'Database';
  direction: 'inbound' | 'outbound' | 'bidirectional';
}

// A2A-compliant extended integration (with dataFlows)
export interface Integration extends ProposedIntegration {
  dataFlows?: string[];
}

// A2A-compliant extended relationship (with messageSchema)
export interface AgentRelationshipExtended extends AgentRelationship {
  messageSchema?: object;
  isAsync?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface AnalyzeTextRequest {
  description: string;
  requirements?: string[];
  tenantId?: string;
}

export interface AnalyzeTextResponse {
  success: boolean;
  sessionId: string;
  analysis: AnalysisResult;
  source: 'text';
  model: string;
}

export interface UploadImageRequest {
  file: Express.Multer.File;
  tenantId?: string;
  customPrompt?: string;
}

export interface UploadImageResponse {
  success: boolean;
  sessionId: string;
  analysis: AnalysisResult;
  source: 'image';
  model: string;
}

export interface GenerateNetworkRequest {
  sessionId: string;
  tenantId?: string;
  selectedCapabilities?: string[];
}

export interface GenerateNetworkResponse {
  success: boolean;
  sessionId: string;
  agents: ProposedAgent[];
  relationships: AgentRelationship[];
  integrations: ProposedIntegration[];
}

export interface ApplyWizardRequest {
  sessionId: string;
  tenantId?: string;
}

export interface ApplyWizardResponse {
  success: boolean;
  created: {
    agents: number;
    interactions: number;
    integrations: number;
  };
  agents: Array<{
    id: string;
    name: string;
    type: AgenticPattern;
  }>;
  redirectUrl?: string;
}

export interface GenerateProcessRequest {
  agent: ProposedAgent;
}

export interface GenerateProcessResponse {
  success: boolean;
  processSteps: string;
  decisionPoints: string;
  errorHandling: string;
}

// ============================================================================
// Platform Metrics Types (Hohpe: Utility-Driven Adoption)
// ============================================================================

export interface WizardMetrics {
  sessionId: string;
  tenantId: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  source: 'image' | 'text';
  agentsGenerated: number;
  agentsApplied: number;
  userFeedback?: 'positive' | 'neutral' | 'negative';
}
