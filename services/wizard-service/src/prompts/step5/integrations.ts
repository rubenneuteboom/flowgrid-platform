/**
 * Prompt 5b: Integrations
 * 
 * Identifies external system integrations for each agent.
 * Defines data flows and connection types.
 */

import { registerPrompt } from '../index';
import { IntegrationsOutputSchema, IntegrationsOutput, ProposeAgentsOutput, AssignPatternsOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface IntegrationsInput {
  agents: ProposeAgentsOutput['agents'];
  patterns: AssignPatternsOutput['agentPatterns'];
  knownSystems?: string[];
  industryContext?: string;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an expert in enterprise integration architecture and IT4IT principles.

Your task is to identify external system integrations for each agent.

## Integration Types

| Type | Description | Examples |
|------|-------------|----------|
| API | REST/GraphQL/SOAP endpoints | ServiceNow API, Salesforce REST |
| Webhook | Event-driven callbacks | GitHub webhooks, Slack events |
| Database | Direct database connections | PostgreSQL, MongoDB, Redis |
| Queue | Message queue systems | RabbitMQ, Kafka, AWS SQS |
| File | File-based integration | SFTP, S3, network shares |

## Direction

- **inbound**: External system sends data TO the agent
- **outbound**: Agent sends data TO external system  
- **bidirectional**: Both directions

## Common Enterprise Systems

### IT Service Management
- ServiceNow, Jira Service Management, BMC Remedy
- Typical agents: Orchestrators, Monitors, Coordinators

### CRM & Sales
- Salesforce, HubSpot, Microsoft Dynamics
- Typical agents: Gateway, Coordinator

### Communication
- Slack, Microsoft Teams, Email (Exchange/SMTP)
- Typical agents: Any (notifications)

### Monitoring & Observability
- Datadog, Splunk, New Relic, Prometheus
- Typical agents: Monitor, Analyzer

### Cloud & Infrastructure
- AWS, Azure, GCP, Kubernetes
- Typical agents: Executor, Monitor, Gateway

### Data & Analytics
- Snowflake, Databricks, Power BI, Tableau
- Typical agents: Analyzer, Reporter

### ERP & Finance
- SAP, Oracle, NetSuite
- Typical agents: Gateway, Executor

## Data Flows

Describe what data moves through each integration:
- "Customer records sync"
- "Alert notifications"
- "Ticket status updates"
- "Performance metrics"

## JSON Output Format
{
  "integrations": [
    {
      "agentId": "agent-001",
      "name": "ServiceNow Tickets",
      "system": "ServiceNow",
      "type": "API",
      "direction": "bidirectional",
      "description": "Create, read, and update tickets in ServiceNow ITSM",
      "dataFlows": [
        "Incoming tickets (inbound)",
        "Status updates (outbound)",
        "Resolution details (outbound)"
      ]
    },
    {
      "agentId": "agent-002",
      "name": "Slack Notifications",
      "system": "Slack",
      "type": "Webhook",
      "direction": "outbound",
      "description": "Send alert notifications to team channels",
      "dataFlows": [
        "Critical alerts",
        "SLA warnings",
        "Escalation notices"
      ]
    }
  ]
}`;

const buildUserMessage = (input: IntegrationsInput): string => {
  const patterns = input.patterns || [];
  const agentsList = input.agents.map(a => {
    const pattern = patterns.find(p => p.agentId === a.id);
    return `- [${a.id}] ${a.name} (${pattern?.pattern || a.suggestedPattern})
  Purpose: ${a.purpose}
  Triggers: ${pattern?.triggers?.join(', ') || 'not defined'}
  Outputs: ${pattern?.outputs?.join(', ') || 'not defined'}`;
  }).join('\n\n');

  let message = `## Agents\n\n${agentsList}`;
  
  if (input.knownSystems?.length) {
    message += `\n\n## Known Systems in Environment\n${input.knownSystems.join(', ')}`;
  }
  
  if (input.industryContext) {
    message += `\n\n## Industry Context\n${input.industryContext}`;
  }
  
  message += `\n\n## Instructions
1. Identify logical external integrations for each agent
2. Gateway agents typically have the most integrations
3. Consider both operational and analytical systems
4. Include communication channels (Slack, email, etc.) where appropriate
5. Describe data flows for each integration
6. Be realistic - don't add unnecessary integrations
7. Return ONLY the JSON object`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<IntegrationsInput, IntegrationsOutput>({
  id: 'step5.integrations',
  version: '1.0.0',
  description: 'Identify external system integrations and data flows',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: IntegrationsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.4,
    maxTokens: 4096,
  },
});

export { IntegrationsOutput };
