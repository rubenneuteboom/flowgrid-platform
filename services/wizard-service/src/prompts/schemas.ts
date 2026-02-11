/**
 * Prompt Validation Schemas
 * 
 * Zod schemas for validating AI prompt outputs.
 * Each schema matches the expected output format from a specific prompt.
 */

import { z } from 'zod';

// ============================================================================
// Common Types
// ============================================================================

export const ElementType = z.enum(['Agent', 'Capability', 'DataObject', 'Process']);
export type ElementType = z.infer<typeof ElementType>;

export const AgenticPattern = z.enum([
  'orchestrator',
  'specialist', 
  'coordinator',
  'gateway',
  'monitor',
  'executor',
  'analyzer'
]);
export type AgenticPattern = z.infer<typeof AgenticPattern>;

export const AutonomyLevel = z.enum(['autonomous', 'supervised', 'human-in-loop']);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const RiskAppetite = z.enum(['low', 'medium', 'high']);
export type RiskAppetite = z.infer<typeof RiskAppetite>;

// ============================================================================
// Step 1: Extract & Classify
// ============================================================================

/** 1a: Raw capability extraction from text/image */
export const ExtractCapabilitiesOutputSchema = z.object({
  capabilities: z.array(z.object({
    id: z.string(),
    name: z.string().max(100),
    level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    parentId: z.string().optional(),
    description: z.string().max(200),
    domain: z.string(),
    keywords: z.array(z.string()).max(5),
  })),
  metadata: z.object({
    sourceType: z.enum(['text', 'image', 'xml']),
    totalExtracted: z.number(),
    confidence: z.number().min(0).max(1),
    domains: z.array(z.string()),
  }),
});
export type ExtractCapabilitiesOutput = z.infer<typeof ExtractCapabilitiesOutputSchema>;

/** 1b: Element classification */
export const ClassifyElementsOutputSchema = z.object({
  elements: z.array(z.object({
    id: z.string(),
    name: z.string(),
    elementType: ElementType,
    rationale: z.string().max(100),
    archiMateType: z.string().optional(),
  })),
  summary: z.object({
    agents: z.number(),
    capabilities: z.number(),
    dataObjects: z.number(),
    processes: z.number(),
  }),
});
export type ClassifyElementsOutput = z.infer<typeof ClassifyElementsOutputSchema>;

// ============================================================================
// Step 3: Agent Design
// ============================================================================

/** 3a: Propose agents from capabilities */
export const ProposeAgentsOutputSchema = z.object({
  agents: z.array(z.object({
    id: z.string(),
    name: z.string().max(80),
    purpose: z.string().max(250),
    // Description fields
    shortDescription: z.string().max(100).optional(),
    detailedPurpose: z.string().max(500).optional(),
    businessValue: z.string().max(300).optional(),
    keyResponsibilities: z.array(z.string()).max(6).optional(),
    successCriteria: z.string().max(300).optional(),
    // Design fields
    suggestedPattern: AgenticPattern,
    suggestedAutonomy: AutonomyLevel,
    decisionAuthority: z.enum(['propose-only', 'propose-and-execute', 'autonomous-low-risk', 'fully-autonomous']).optional(),
    valueStream: z.string().max(100).optional(),
    capabilityGroup: z.string().max(100).optional(),
    objectives: z.array(z.string()).max(5).optional(),
    kpis: z.array(z.string()).max(5).optional(),
    // Interaction fields
    interactionPattern: z.enum(['request-response', 'event-driven', 'publish-subscribe', 'orchestrated', 'collaborative']).optional(),
    triggers: z.array(z.string()).max(5).optional(),
    outputs: z.array(z.string()).max(5).optional(),
    escalationPath: z.string().max(150).optional(),
    // Original fields
    responsibilities: z.array(z.string()).min(2).max(6),
    ownedElements: z.array(z.string()),
    boundaries: z.object({
      internal: z.array(z.string()),
      delegates: z.array(z.string()),
      escalates: z.array(z.string()),
    }),
  })),
  orphanedElements: z.array(z.string()),
});
export type ProposeAgentsOutput = z.infer<typeof ProposeAgentsOutputSchema>;

/** 3b: Assign patterns with A2A metadata */
export const AssignPatternsOutputSchema = z.object({
  agentPatterns: z.array(z.object({
    agentId: z.string(),
    pattern: AgenticPattern,
    patternRationale: z.string().max(150),
    autonomyLevel: AutonomyLevel,
    riskAppetite: RiskAppetite,
    a2aCapabilities: z.object({
      streaming: z.boolean(),
      pushNotifications: z.boolean(),
    }),
    triggers: z.array(z.string()),
    outputs: z.array(z.string()),
  })),
});
export type AssignPatternsOutput = z.infer<typeof AssignPatternsOutputSchema>;

/** 3c: Define A2A skills for each agent (A2A Protocol v0.2 compliant) */
export const DefineSkillsOutputSchema = z.object({
  agentSkills: z.array(z.object({
    agentId: z.string(),
    skills: z.array(z.object({
      skillId: z.string(),
      name: z.string().max(60),
      description: z.string().max(200),
      tags: z.array(z.string()).min(2).max(6), // Required for A2A compliance
      inputSchema: z.object({
        type: z.literal('object'),
        properties: z.record(z.object({
          type: z.string(),
          description: z.string().optional(),
        })),
        required: z.array(z.string()).optional(),
      }),
      outputSchema: z.object({
        type: z.literal('object'),
        properties: z.record(z.object({
          type: z.string(),
          description: z.string().optional(),
        })),
      }),
      examples: z.array(z.object({
        name: z.string(), // Required for A2A compliance
        input: z.record(z.unknown()),
        output: z.record(z.unknown()),
      })).min(1).max(3), // At least 1 example required
    })),
  })),
});
export type DefineSkillsOutput = z.infer<typeof DefineSkillsOutputSchema>;

// ============================================================================
// Step 5: Relationships
// ============================================================================

/** 5a: A2A relationships between agents */
export const RelationshipsOutputSchema = z.object({
  relationships: z.array(z.object({
    id: z.string(),
    sourceAgentId: z.string(),
    targetAgentId: z.string(),
    relationshipType: z.enum([
      'orchestrates',
      'delegates',
      'monitors',
      'notifies',
      'queries',
      'reports-to',
    ]),
    messageType: z.string().max(60),
    description: z.string().max(150),
    messageSchema: z.object({
      type: z.literal('object'),
      properties: z.record(z.object({
        type: z.string(),
        description: z.string().optional(),
      })),
    }).optional(),
    isAsync: z.boolean(),
    priority: z.enum(['low', 'normal', 'high']),
  })),
});
export type RelationshipsOutput = z.infer<typeof RelationshipsOutputSchema>;

/** 5b: External integrations */
export const IntegrationsOutputSchema = z.object({
  integrations: z.array(z.object({
    agentId: z.string(),
    name: z.string().max(60),
    system: z.string(),
    type: z.enum(['API', 'Webhook', 'Database', 'Queue', 'File']),
    direction: z.enum(['inbound', 'outbound', 'bidirectional']),
    description: z.string().max(150),
    dataFlows: z.array(z.string()).optional(),
  })),
});
export type IntegrationsOutput = z.infer<typeof IntegrationsOutputSchema>;

// ============================================================================
// Full Analysis Result (Combined)
// ============================================================================

export const FullAnalysisResultSchema = z.object({
  elements: z.array(z.object({
    id: z.string(),
    name: z.string(),
    elementType: ElementType,
    description: z.string(),
    pattern: AgenticPattern.optional(),
    autonomyLevel: AutonomyLevel.optional(),
    riskAppetite: RiskAppetite.optional(),
    responsibilities: z.array(z.string()).optional(),
    triggers: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
  })),
  relationships: z.array(z.object({
    sourceAgentId: z.string(),
    targetAgentId: z.string(),
    relationshipType: z.string(),
    messageType: z.string(),
    description: z.string(),
  })),
  integrations: z.array(z.object({
    agentId: z.string(),
    name: z.string(),
    system: z.string(),
    type: z.string(),
    direction: z.string(),
  })),
  skills: z.array(z.object({
    agentId: z.string(),
    skillId: z.string(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
  })).optional(),
});
export type FullAnalysisResult = z.infer<typeof FullAnalysisResultSchema>;
