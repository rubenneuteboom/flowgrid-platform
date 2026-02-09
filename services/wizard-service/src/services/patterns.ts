/**
 * Agentic Design Patterns Service
 * 
 * Platform Architecture: This is the "harmonization engine" for pattern knowledge.
 * Following Hohpe's principle - we standardize pattern vocabulary across the platform.
 */

import { AgenticPattern } from '../types/wizard';

// ============================================================================
// Pattern Definitions (Core Knowledge Base)
// ============================================================================

export interface PatternDefinition {
  name: AgenticPattern;
  emoji: string;
  category: 'core' | 'anthropic';
  useWhen: string;
  characteristics: string;
  examples: string[];
}

export const CORE_PATTERNS: PatternDefinition[] = [
  {
    name: 'Orchestrator',
    emoji: '🎭',
    category: 'core',
    useWhen: 'Coordinates multiple agents/workflows',
    characteristics: 'High-level control, delegates tasks, manages state',
    examples: ['Service Desk Coordinator', 'Incident Commander', 'Change Manager'],
  },
  {
    name: 'Specialist',
    emoji: '🎯',
    category: 'core',
    useWhen: 'Deep domain expertise needed',
    characteristics: 'Focused scope, expert knowledge, handles specific tasks',
    examples: ['Network Troubleshooter', 'Security Analyst', 'Database Expert'],
  },
  {
    name: 'Coordinator',
    emoji: '🔗',
    category: 'core',
    useWhen: 'Manages handoffs between teams/systems',
    characteristics: 'Routing, load balancing, ensures continuity',
    examples: ['Team Handoff Agent', 'Shift Coordinator', 'Escalation Manager'],
  },
  {
    name: 'Gateway',
    emoji: '🚪',
    category: 'core',
    useWhen: 'External system integration',
    characteristics: 'API facade, protocol translation, security boundary',
    examples: ['ServiceNow Gateway', 'Jira Gateway', 'Email Gateway'],
  },
  {
    name: 'Monitor',
    emoji: '📊',
    category: 'core',
    useWhen: 'Observes and alerts on conditions',
    characteristics: 'Passive, threshold-based triggers, escalation',
    examples: ['SLA Monitor', 'Queue Monitor', 'System Health Monitor'],
  },
  {
    name: 'Executor',
    emoji: '⚡',
    category: 'core',
    useWhen: 'Performs automated actions',
    characteristics: 'Task execution, scripted workflows, idempotent',
    examples: ['Password Reset Agent', 'Provisioning Agent', 'Cleanup Agent'],
  },
  {
    name: 'Analyzer',
    emoji: '🔬',
    category: 'core',
    useWhen: 'Processes data for insights',
    characteristics: 'Pattern detection, ML/analytics, reporting',
    examples: ['Trend Analyzer', 'Root Cause Analyzer', 'Capacity Planner'],
  },
  {
    name: 'Aggregator',
    emoji: '📦',
    category: 'core',
    useWhen: 'Combines data from multiple sources',
    characteristics: 'Data fusion, normalization, single view',
    examples: ['CMDB Aggregator', 'Asset Consolidator', 'Report Generator'],
  },
  {
    name: 'Router',
    emoji: '🔀',
    category: 'core',
    useWhen: 'Directs work to appropriate handler',
    characteristics: 'Rule-based routing, load distribution',
    examples: ['Ticket Router', 'Request Dispatcher', 'Priority Classifier'],
  },
];

export const ANTHROPIC_PATTERNS: PatternDefinition[] = [
  {
    name: 'routing',
    emoji: '🔀',
    category: 'anthropic',
    useWhen: 'Routes work to the appropriate specialist',
    characteristics: 'Intelligent classification, dynamic routing',
    examples: ['Intent Classifier', 'Skill-Based Router'],
  },
  {
    name: 'planning',
    emoji: '📋',
    category: 'anthropic',
    useWhen: 'Breaks down complex tasks into steps',
    characteristics: 'Task decomposition, dependency management',
    examples: ['Project Planner', 'Change Sequencer'],
  },
  {
    name: 'tool-use',
    emoji: '🔧',
    category: 'anthropic',
    useWhen: 'Integrates with external systems/APIs',
    characteristics: 'Function calling, API orchestration',
    examples: ['Integration Agent', 'API Orchestrator'],
  },
  {
    name: 'orchestration',
    emoji: '🎭',
    category: 'anthropic',
    useWhen: 'Coordinates multiple agents',
    characteristics: 'Multi-agent coordination, workflow management',
    examples: ['Workflow Conductor', 'Agent Coordinator'],
  },
  {
    name: 'human-in-loop',
    emoji: '👤',
    category: 'anthropic',
    useWhen: 'Requires human approval for decisions',
    characteristics: 'Approval workflows, escalation, oversight',
    examples: ['Approval Agent', 'Review Agent', 'Exception Handler'],
  },
  {
    name: 'rag',
    emoji: '📚',
    category: 'anthropic',
    useWhen: 'Retrieves information from knowledge bases',
    characteristics: 'Knowledge retrieval, context augmentation',
    examples: ['Knowledge Agent', 'FAQ Agent', 'Documentation Helper'],
  },
  {
    name: 'reflection',
    emoji: '🔍',
    category: 'anthropic',
    useWhen: 'Evaluates and improves own output',
    characteristics: 'Self-evaluation, quality improvement',
    examples: ['Quality Checker', 'Response Validator'],
  },
  {
    name: 'guardrails',
    emoji: '🛡️',
    category: 'anthropic',
    useWhen: 'Validates input/output and enforces security',
    characteristics: 'Policy enforcement, safety checks',
    examples: ['Policy Enforcer', 'Compliance Agent', 'Input Validator'],
  },
];

export const ALL_PATTERNS = [...CORE_PATTERNS, ...ANTHROPIC_PATTERNS];

// ============================================================================
// Pattern Selection Helpers
// ============================================================================

/**
 * Suggests a pattern based on agent purpose/description
 */
export function suggestPattern(purpose: string): AgenticPattern {
  const loweredPurpose = purpose.toLowerCase();

  // Pattern matching based on keywords
  if (loweredPurpose.includes('coordinate') || loweredPurpose.includes('orchestrate') || loweredPurpose.includes('manage agents')) {
    return 'Orchestrator';
  }
  if (loweredPurpose.includes('integrate') || loweredPurpose.includes('gateway') || loweredPurpose.includes('external')) {
    return 'Gateway';
  }
  if (loweredPurpose.includes('monitor') || loweredPurpose.includes('alert') || loweredPurpose.includes('watch')) {
    return 'Monitor';
  }
  if (loweredPurpose.includes('execute') || loweredPurpose.includes('automate') || loweredPurpose.includes('run')) {
    return 'Executor';
  }
  if (loweredPurpose.includes('analyze') || loweredPurpose.includes('insight') || loweredPurpose.includes('report')) {
    return 'Analyzer';
  }
  if (loweredPurpose.includes('aggregate') || loweredPurpose.includes('combine') || loweredPurpose.includes('consolidate')) {
    return 'Aggregator';
  }
  if (loweredPurpose.includes('route') || loweredPurpose.includes('dispatch') || loweredPurpose.includes('classify')) {
    return 'Router';
  }
  if (loweredPurpose.includes('handoff') || loweredPurpose.includes('transfer') || loweredPurpose.includes('between teams')) {
    return 'Coordinator';
  }
  if (loweredPurpose.includes('knowledge') || loweredPurpose.includes('faq') || loweredPurpose.includes('documentation')) {
    return 'rag';
  }
  if (loweredPurpose.includes('approval') || loweredPurpose.includes('human') || loweredPurpose.includes('review')) {
    return 'human-in-loop';
  }

  // Default to Specialist for domain-specific agents
  return 'Specialist';
}

/**
 * Get the AI prompt reference for patterns
 */
export function getPatternPromptReference(): string {
  const coreTable = CORE_PATTERNS.map(p => 
    `| ${p.emoji} **${p.name}** | ${p.useWhen} | ${p.characteristics} |`
  ).join('\n');

  const anthropicTable = ANTHROPIC_PATTERNS.map(p =>
    `| ${p.emoji} **${p.name}** | ${p.useWhen} | ${p.characteristics} |`
  ).join('\n');

  return `
## AGENTIC DESIGN PATTERNS

### Core Platform Patterns
| Pattern | Use When | Characteristics |
|---------|----------|-----------------|
${coreTable}

### Additional Patterns (Anthropic's Guide)
| Pattern | Use When | Characteristics |
|---------|----------|-----------------|
${anthropicTable}

PATTERN SELECTION CRITERIA:
- Manages other agents → Orchestrator
- Talks to external systems → Gateway  
- Watches and alerts → Monitor
- Deep domain knowledge → Specialist
- Executes automated actions → Executor
- Analyzes data/patterns → Analyzer
- Combines multiple data sources → Aggregator
- Routes requests to handlers → Router/routing
- Breaks tasks into steps → planning
- Needs human oversight → human-in-loop
- Retrieves knowledge → rag`;
}

/**
 * Get pattern by name
 */
export function getPatternByName(name: string): PatternDefinition | undefined {
  return ALL_PATTERNS.find(p => p.name.toLowerCase() === name.toLowerCase());
}
