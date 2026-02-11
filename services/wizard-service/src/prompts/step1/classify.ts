/**
 * Prompt 1b: Classify Elements
 * 
 * Takes extracted capabilities and classifies them into element types:
 * - Agent: Active workers that perform tasks
 * - Capability: Skills or abilities
 * - DataObject: Information/data stores
 * - Process: Workflows and sequences
 */

import { registerPrompt } from '../index';
import { 
  ClassifyElementsOutputSchema, 
  ClassifyElementsOutput,
  ExtractCapabilitiesOutput 
} from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface ClassifyElementsInput {
  capabilities: ExtractCapabilitiesOutput['capabilities'];
  customContext?: string;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an Enterprise Architecture expert specializing in element classification for multi-agent systems.

Your task is to classify extracted capabilities into four element types, following IT4IT and ArchiMate principles.

## Element Types

### Agent (Active Worker)
- Has agency - makes decisions, takes actions
- Typically named with role/worker nouns: "Manager", "Orchestrator", "Handler", "Processor"
- Or verbs suggesting activity: "Monitor", "Analyzer", "Coordinator"
- Examples: "Ticket Router", "Payment Processor", "Customer Service Agent"

### Capability (Skill/Ability)  
- A skill or ability that agents USE
- Named as abilities: "Classification", "Analysis", "Management", "Processing"
- Often abstract nouns ending in "-tion", "-ment", "-ing"
- Examples: "Natural Language Processing", "Risk Assessment", "Data Validation"

### DataObject (Information Store)
- Stores or represents data
- Named as data containers: "Database", "Repository", "Records", "Inventory"
- Or data entities: "Customer Profile", "Transaction Log", "Configuration"
- Examples: "Customer Database", "Order History", "Product Catalog"

### Process (Workflow)
- A sequence of steps or a workflow
- Named with flow words: "Process", "Flow", "Lifecycle", "Pipeline", "Journey"
- Or sequences: "Onboarding", "Fulfillment", "Escalation"
- Examples: "Order Fulfillment Process", "Customer Onboarding Flow"

## ArchiMate Alignment
Optionally provide ArchiMate type mappings:
- Agent → Business Actor, Application Component
- Capability → Business Capability, Business Function
- DataObject → Data Object, Business Object
- Process → Business Process, Business Interaction

## JSON Output Format
{
  "elements": [
    {
      "id": "cap-001",
      "name": "Customer Service Manager",
      "elementType": "Agent",
      "rationale": "Active role that coordinates support activities",
      "archiMateType": "Business Actor"
    }
  ],
  "summary": {
    "agents": 5,
    "capabilities": 8,
    "dataObjects": 4,
    "processes": 3
  }
}`;

const buildUserMessage = (input: ClassifyElementsInput): string => {
  const capabilitiesList = input.capabilities
    .map(c => `- [${c.id}] ${c.name}: ${c.description} (domain: ${c.domain})`)
    .join('\n');

  let message = `## Capabilities to Classify\n\n${capabilitiesList}`;
  
  if (input.customContext) {
    message += `\n\n## Additional Context\n${input.customContext}`;
  }
  
  message += `\n\n## Instructions
1. Classify EACH capability into exactly one element type
2. Provide a brief rationale (max 100 chars)
3. Optionally map to ArchiMate types
4. Return counts in summary
5. Return ONLY the JSON object, no additional text`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<ClassifyElementsInput, ClassifyElementsOutput>({
  id: 'step1.classify-elements',
  version: '1.0.0',
  description: 'Classify capabilities into Agent/Capability/DataObject/Process',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: ClassifyElementsOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.2,  // Lower temp for more consistent classification
    maxTokens: 4096,
  },
});

// ============================================================================
// Export for direct usage
// ============================================================================

export { ClassifyElementsOutput };
