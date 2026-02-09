// =============================================================================
// Flowgrid Platform - Shared Type Definitions
// =============================================================================

// -----------------------------------------------------------------------------
// Common Types
// -----------------------------------------------------------------------------

export interface Timestamp {
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: Pagination;
}

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Tenant Types
// -----------------------------------------------------------------------------

export type TenantTier = 'standard' | 'professional' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'trial';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tier: TenantTier;
  status: TenantStatus;
  maxAgents: number;
  maxUsers: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// User Types
// -----------------------------------------------------------------------------

export type UserRole = 'admin' | 'user' | 'viewer';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  lastLoginAt?: string;
  createdAt: string;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  roles: UserRole[];
}

// -----------------------------------------------------------------------------
// Agent Types
// -----------------------------------------------------------------------------

export type AgentPattern = 
  | 'Orchestrator'
  | 'Specialist'
  | 'Monitor'
  | 'Executor'
  | 'Analyst'
  | 'Communicator';

export type AgentStatus = 'draft' | 'active' | 'inactive' | 'archived';

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  pattern: AgentPattern;
  status: AgentStatus;
  version: number;
  config: AgentConfig;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  triggers: AgentTrigger[];
  capabilities: string[];
  integrations: string[];
  aiProvider?: 'anthropic' | 'openai';
  model?: string;
}

export interface AgentTrigger {
  type: 'schedule' | 'event' | 'webhook' | 'manual';
  config: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Integration Types
// -----------------------------------------------------------------------------

export type IntegrationName = 'servicenow' | 'jira' | 'github' | 'azure-devops';

export interface Integration {
  name: IntegrationName;
  displayName: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync?: string;
  config?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Design Types
// -----------------------------------------------------------------------------

export interface DesignAnalysis {
  analysis: string;
  suggestions: DesignSuggestion[];
  capabilities: string[];
}

export interface DesignSuggestion {
  type: 'pattern' | 'integration' | 'capability';
  name: string;
  reason: string;
  confidence: number;
}
