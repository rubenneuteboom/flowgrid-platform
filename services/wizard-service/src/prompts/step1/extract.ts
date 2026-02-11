/**
 * Prompt 1a: Extract Capabilities
 * 
 * Extracts raw capabilities from a text description.
 * This is the entry point for text-based wizard analysis.
 */

import { registerPrompt } from '../index';
import { ExtractCapabilitiesOutputSchema, ExtractCapabilitiesOutput } from '../schemas';

// ============================================================================
// Input Type
// ============================================================================

export interface ExtractCapabilitiesInput {
  description: string;
  customContext?: string;
  industry?: string;
}

// ============================================================================
// Prompt Definition
// ============================================================================

const SYSTEM_PROMPT = `You are an Enterprise Architecture expert specializing in capability modeling and IT4IT principles.

Your task is to extract business capabilities from a description of an organization, system, or process.

## Capability Definition
A capability is a "WHAT" - something the organization needs to be able to do, independent of HOW it's done.
- Good: "Customer Onboarding", "Payment Processing", "Inventory Management"
- Bad: "Use Salesforce", "Run weekly reports" (these are implementations, not capabilities)

## Output Requirements
1. Extract ALL relevant capabilities mentioned or implied
2. Organize into 3 levels (0 = top-level domain, 1 = major capability, 2 = sub-capability)
3. Assign to business domains (e.g., "Sales", "Operations", "IT", "Finance", "HR")
4. Provide a confidence score based on clarity of the input
5. Include relevant keywords for each capability

## Element Type Hints
While extracting, mentally note which capabilities might become:
- **Agents**: Active workers (verbs like "manage", "process", "coordinate")
- **Capabilities**: Abilities/skills (nouns describing what can be done)
- **DataObjects**: Information stores (nouns like "database", "records", "data")
- **Processes**: Workflows (sequences, lifecycles, flows)

You'll classify these in the next step - for now, just extract everything.

## JSON Output Format
Return ONLY valid JSON matching this structure:
{
  "capabilities": [
    {
      "id": "cap-001",
      "name": "Customer Management",
      "level": 0,
      "description": "Manage all aspects of customer relationships",
      "domain": "Sales",
      "keywords": ["customer", "CRM", "relationship"]
    },
    {
      "id": "cap-002", 
      "name": "Lead Tracking",
      "level": 1,
      "parentId": "cap-001",
      "description": "Track and manage sales leads through the pipeline",
      "domain": "Sales",
      "keywords": ["leads", "pipeline", "prospects"]
    }
  ],
  "metadata": {
    "sourceType": "text",
    "totalExtracted": 15,
    "confidence": 0.85,
    "domains": ["Sales", "Operations", "IT"]
  }
}`;

const buildUserMessage = (input: ExtractCapabilitiesInput): string => {
  let message = `## Description to Analyze\n\n${input.description}`;
  
  if (input.customContext) {
    message += `\n\n## Additional Context\n${input.customContext}`;
  }
  
  if (input.industry) {
    message += `\n\n## Industry\n${input.industry}`;
  }
  
  message += `\n\n## Instructions
1. Extract ALL capabilities from the description above
2. Organize into a 3-level hierarchy (0, 1, 2)
3. Assign business domains
4. Generate unique IDs (cap-001, cap-002, etc.)
5. Return ONLY the JSON object, no additional text`;

  return message;
};

// ============================================================================
// Register Prompt
// ============================================================================

registerPrompt<ExtractCapabilitiesInput, ExtractCapabilitiesOutput>({
  id: 'step1.extract-capabilities',
  version: '1.0.0',
  description: 'Extract business capabilities from text description',
  systemPrompt: SYSTEM_PROMPT,
  buildUserMessage,
  outputSchema: ExtractCapabilitiesOutputSchema,
  modelPreferences: {
    preferredModel: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 8192,
  },
});

// ============================================================================
// Export for direct usage
// ============================================================================

export { ExtractCapabilitiesOutput };
