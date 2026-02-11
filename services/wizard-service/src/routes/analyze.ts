/**
 * Analysis Routes - Text and Image Analysis
 * 
 * Platform Architecture: Entry point for capability extraction and agent design.
 * This is the "onboarding harmonization" - standardizing how users enter the platform.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  analyzeImageWithVision,
  designAgentsFromCapabilities,
  analyzeTextDescription,
  isOpenAIConfigured,
} from '../services/ai';
import { executeA2AChain, executeQuickAnalysis } from '../services/ai-chain';
import { createWizardSession } from '../services/database';
import { AnalyzeTextRequest, AnalyzeTextResponse, UploadImageResponse, AnalysisResult, ElementType, AgenticPattern } from '../types/wizard';

const router = Router();
const SERVICE_NAME = 'wizard-service';

// ============================================================================
// Multer Configuration for Image Uploads
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
  }
});

const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for XML
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/xml', 'application/xml', 'application/octet-stream'];
    const allowedExtensions = ['.xml', '.archimate'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only XML/ArchiMate files are allowed'));
    }
  }
});

// ============================================================================
// POST /api/wizard/analyze-text
// Analyze a text description and generate agent recommendations
// ============================================================================

router.post('/analyze-text', async (req: Request, res: Response) => {
  try {
    const { description, requirements, industryContext, knownSystems } = req.body as AnalyzeTextRequest & { 
      industryContext?: string; 
      knownSystems?: string[];
    };
    const tid = req.tenantId;
    const useA2A = req.query.a2a === 'true' || req.body.a2a === true;

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!tid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    console.log(`[${SERVICE_NAME}] Analyzing text description (${description.length} chars, a2a=${useA2A})`);

    let analysis;
    let model;

    if (useA2A) {
      // New A2A-compliant prompt chain
      const chainResult = await executeA2AChain({
        rawContent: description,
        customPrompt: requirements?.join('\n'),
        sourceType: 'text',
        industryContext,
        knownSystems,
      });

      if (!chainResult.success || !chainResult.analysis) {
        return res.status(500).json({
          error: chainResult.error || 'A2A chain failed',
          details: 'Failed to execute A2A prompt chain',
        });
      }

      analysis = chainResult.analysis;
      model = 'claude-sonnet-4-20250514 (A2A chain)';
      console.log(`[${SERVICE_NAME}] A2A chain completed in ${chainResult.executionTimeMs}ms`);
    } else {
      // Legacy single-prompt analysis
      analysis = await analyzeTextDescription(description, requirements);
      model = 'claude-sonnet-4-20250514';
    }

    // Create wizard session
    const sessionName = `Text Analysis ${new Date().toLocaleDateString()}`;
    const sessionId = await createWizardSession(
      tid,
      sessionName,
      'text',
      { description, requirements },
      analysis
    );

    const response: AnalyzeTextResponse = {
      success: true,
      sessionId,
      analysis,
      source: 'text',
      model,
    };

    console.log(`[${SERVICE_NAME}] Created session ${sessionId} with ${analysis.agents?.length || 0} agents`);
    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Text analysis error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to analyze text description'
    });
  }
});

// ============================================================================
// POST /api/wizard/upload-image
// Upload and analyze an image (capability model diagram)
// Uses GPT-4 Vision for extraction + Claude for agent design
// ============================================================================

router.post('/upload-image', upload.single('file'), async (req: Request, res: Response) => {
  console.log(`[${SERVICE_NAME}] Image upload started`);
  
  if (!isOpenAIConfigured()) {
    return res.status(500).json({ 
      error: 'OpenAI API key not configured for vision analysis' 
    });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const customPrompt = req.body.customPrompt?.trim() || undefined;
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log(`[${SERVICE_NAME}] Analyzing image: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    // Phase 1: GPT-4 Vision - Extract text and structure
    const extractedData = await analyzeImageWithVision(base64Image, mimeType, customPrompt);
    console.log(`[${SERVICE_NAME}] Vision extracted ${extractedData.totalItems || 'unknown'} items`);

    // Phase 2: Claude - Design agents from extracted capabilities
    const analysis = await designAgentsFromCapabilities(extractedData, customPrompt);

    // Create wizard session
    const sessionName = extractedData.title || `Image Analysis ${new Date().toLocaleDateString()}`;
    const sessionId = await createWizardSession(
      tenantId,
      sessionName,
      'image',
      extractedData as unknown as Record<string, unknown>,
      analysis,
      customPrompt
    );

    console.log(`[${SERVICE_NAME}] Created session ${sessionId} with ${analysis.agents?.length || 0} agents`);

    const response: UploadImageResponse = {
      success: true,
      sessionId,
      analysis,
      source: 'image',
      model: 'hybrid (gpt-4o + claude-sonnet)',
    };

    res.json(response);

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Image analysis error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to analyze uploaded image'
    });
  }
});

// ============================================================================
// POST /api/wizard/upload-xml
// Upload and parse an ArchiMate XML file
// ============================================================================

router.post('/upload-xml', uploadXml.single('file'), async (req: Request, res: Response) => {
  console.log(`[${SERVICE_NAME}] XML upload started`);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No XML file uploaded' });
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    const xmlContent = req.file.buffer.toString('utf-8');
    console.log(`[${SERVICE_NAME}] Parsing XML: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    // Parse ArchiMate XML
    const parsed = parseArchiMateXml(xmlContent);
    
    if (!parsed.elements.length) {
      return res.status(400).json({ 
        error: 'No elements found in XML file',
        details: 'The file does not appear to contain valid ArchiMate elements'
      });
    }

    console.log(`[${SERVICE_NAME}] Parsed ${parsed.elements.length} elements, ${parsed.relationships.length} relationships`);

    // Convert to analysis format
    const analysis = convertArchiMateToAnalysis(parsed);

    // Create wizard session
    const sessionName = parsed.modelName || `ArchiMate Import ${new Date().toLocaleDateString()}`;
    const sessionId = await createWizardSession(
      tenantId,
      sessionName,
      'xml',
      { elements: parsed.elements.length, relationships: parsed.relationships.length } as Record<string, unknown>,
      analysis,
      undefined
    );

    console.log(`[${SERVICE_NAME}] Created session ${sessionId} with ${analysis.agents?.length || 0} agents`);

    res.json({
      success: true,
      sessionId,
      analysis,
      source: 'xml',
      stats: {
        elements: parsed.elements.length,
        relationships: parsed.relationships.length,
      }
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] XML parsing error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to parse ArchiMate XML file'
    });
  }
});

// ============================================================================
// ArchiMate XML Parser
// ============================================================================

/**
 * Sanitize string for safe JSON serialization
 * Removes/escapes control characters that could break JSON
 */
function sanitizeForJson(str: string): string {
  if (!str) return str;
  return str
    // Remove null bytes
    .replace(/\0/g, '')
    // Escape backslashes first
    .replace(/\\/g, '\\\\')
    // Remove control characters except common whitespace
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize newlines
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Limit consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim excessive whitespace
    .trim();
}

interface ArchiMateElement {
  id: string;
  name: string;
  type: string;
  documentation?: string;
}

interface ArchiMateRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name?: string;
}

interface ParsedArchiMate {
  modelName?: string;
  elements: ArchiMateElement[];
  relationships: ArchiMateRelationship[];
}

function parseArchiMateXml(xmlContent: string): ParsedArchiMate {
  const elements: ArchiMateElement[] = [];
  const relationships: ArchiMateRelationship[] = [];
  let modelName: string | undefined;

  // Extract model name - try multiple formats
  // Format 1: <name xml:lang="...">Model Name</name>
  const modelNameMatch = xmlContent.match(/<model[^>]*>[\s\S]*?<name[^>]*>([^<]+)<\/name>/i);
  if (modelNameMatch) {
    modelName = modelNameMatch[1].trim();
  }
  // Format 2: name attribute
  if (!modelName) {
    const modelAttrMatch = xmlContent.match(/<(?:archimate:)?model[^>]*name="([^"]+)"/i);
    if (modelAttrMatch) modelName = modelAttrMatch[1];
  }

  console.log(`[XML Parser] Detected model name: ${modelName || 'unknown'}`);

  // ===== OpenGroup ArchiMate 3.0 Format =====
  // <element identifier="id-cap-root" xsi:type="Capability">
  //   <name xml:lang="nl">Name Here</name>
  //   <documentation>...</documentation>
  // </element>
  const openGroupRegex = /<element\s+identifier="([^"]+)"\s+xsi:type="([^"]+)"[^>]*>([\s\S]*?)<\/element>/gi;
  let match: RegExpExecArray | null;
  
  while ((match = openGroupRegex.exec(xmlContent)) !== null) {
    const id = match[1];
    const type = match[2];
    const innerContent = match[3];
    
    // Extract name from <name> child element
    const nameMatch = innerContent.match(/<name[^>]*>([^<]+)<\/name>/i);
    const name = nameMatch ? sanitizeForJson(nameMatch[1].trim()) : `Unnamed ${type}`;
    
    // Extract documentation (handle multi-line and special chars)
    const docMatch = innerContent.match(/<documentation[^>]*>([\s\S]*?)<\/documentation>/i);
    const documentation = docMatch ? sanitizeForJson(docMatch[1].trim()) : undefined;

    // Skip junction/connector elements
    if (type.toLowerCase().includes('junction')) continue;

    elements.push({
      id,
      name,
      type: normalizeArchiMateType(type),
      documentation,
    });
  }

  console.log(`[XML Parser] Found ${elements.length} elements via OpenGroup format`);

  // ===== Archi Tool Format =====
  // <element xsi:type="archimate:ApplicationFunction" id="..." name="...">
  if (elements.length === 0) {
    const archiRegex = /<element[^>]*xsi:type="(?:archimate:)?([^"]+)"[^>]*id="([^"]+)"[^>]*name="([^"]*)"[^>]*>/gi;
    while ((match = archiRegex.exec(xmlContent)) !== null) {
      const type = match[1];
      const id = match[2];
      const name = sanitizeForJson(match[3]) || `Unnamed ${type}`;

      if (type.toLowerCase().includes('junction')) continue;

      elements.push({
        id,
        name,
        type: normalizeArchiMateType(type),
      });
    }
    console.log(`[XML Parser] Found ${elements.length} elements via Archi format`);
  }

  // ===== OpenGroup Relationships =====
  // <relationship identifier="..." xsi:type="CompositionRelationship" source="..." target="...">
  const ogRelRegex = /<relationship\s+identifier="([^"]+)"\s+xsi:type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"[^>]*>/gi;
  while ((match = ogRelRegex.exec(xmlContent)) !== null) {
    relationships.push({
      id: match[1],
      type: normalizeRelationType(match[2]),
      sourceId: match[3],
      targetId: match[4],
    });
  }

  // ===== Archi Tool Relationships =====
  if (relationships.length === 0) {
    const archiRelRegex = /<(?:relationship|element)[^>]*xsi:type="(?:archimate:)?([^"]*[Rr]elationship)"[^>]*id="([^"]+)"[^>]*source="([^"]+)"[^>]*target="([^"]+)"[^>]*/gi;
    while ((match = archiRelRegex.exec(xmlContent)) !== null) {
      relationships.push({
        id: match[2],
        type: normalizeRelationType(match[1]),
        sourceId: match[3],
        targetId: match[4],
      });
    }
  }

  console.log(`[XML Parser] Found ${relationships.length} relationships`);

  return { modelName, elements, relationships };
}

function normalizeArchiMateType(type: string): string {
  // Map ArchiMate types to FlowGrid element types
  const typeMap: Record<string, string> = {
    'applicationfunction': 'ApplicationFunction',
    'applicationservice': 'ApplicationService',
    'applicationcomponent': 'Agent',
    'applicationprocess': 'Process',
    'businessfunction': 'Capability',
    'businessprocess': 'Process',
    'businessservice': 'BusinessService',
    'businessobject': 'DataObject',
    'dataobject': 'DataObject',
    'artifact': 'DataObject',
    'requirement': 'Requirement',
    'constraint': 'Requirement',
    'goal': 'Requirement',
    'resource': 'Resource',
    'capability': 'Capability',
    'valuestream': 'Process',
    'grouping': 'Grouping',
    'plateau': 'Plateau',
  };
  
  const normalized = type.toLowerCase().replace(/relationship$/, '');
  return typeMap[normalized] || type;
}

function normalizeRelationType(type: string): string {
  const typeMap: Record<string, string> = {
    'compositionrelationship': 'Composition',
    'aggregationrelationship': 'Composition',
    'assignmentrelationship': 'Association',
    'realizationrelationship': 'Realization',
    'servingrelationship': 'Serving',
    'accessrelationship': 'Access',
    'flowrelationship': 'Flow',
    'triggeringrelationship': 'Flow',
    'associationrelationship': 'Association',
    'specializationrelationship': 'Association',
    'influencerelationship': 'Association',
  };
  
  const normalized = type.toLowerCase();
  return typeMap[normalized] || type.replace(/Relationship$/i, '');
}

function convertArchiMateToAnalysis(parsed: ParsedArchiMate): AnalysisResult {
  // Group elements by type for summary
  const typeCounts: Record<string, number> = {};
  parsed.elements.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  });

  // Build element ID to name map for relationship resolution
  const idToElement = new Map(parsed.elements.map(e => [e.id, e]));

  // Convert elements to agents format
  const agents = parsed.elements.map((el, idx) => ({
    id: `agent-${idx + 1}`,
    originalId: el.id,
    name: el.name,
    elementType: el.type as ElementType,
    purpose: el.documentation || `${el.type} element from ArchiMate model`,
    description: `Imported from ArchiMate: ${el.type}`,
    capabilities: [] as string[],
    pattern: mapTypeToPattern(el.type) as AgenticPattern,
    patternRationale: `Derived from ArchiMate ${el.type}`,
    autonomyLevel: 'supervised' as 'autonomous' | 'supervised' | 'human-in-loop',
    riskAppetite: 'medium' as 'low' | 'medium' | 'high',
    triggers: [] as string[],
    outputs: [] as string[],
  }));

  // Build ID mapping for relationships
  const originalToNewId = new Map(agents.map(a => [a.originalId, a.id]));

  // Convert relationships
  const agentRelationships = parsed.relationships
    .filter(r => originalToNewId.has(r.sourceId) && originalToNewId.has(r.targetId))
    .map(r => ({
      sourceAgentId: originalToNewId.get(r.sourceId)!,
      targetAgentId: originalToNewId.get(r.targetId)!,
      messageType: r.type,
      description: `${r.type} relationship`,
    }));

  // Extract capabilities from elements of type Capability/Function
  const extractedCapabilities = parsed.elements
    .filter(e => ['Capability', 'ApplicationFunction', 'BusinessFunction'].includes(e.type))
    .map(e => ({
      name: e.name,
      level: 1 as 0 | 1 | 2,
      description: e.documentation || `${e.type} capability`,
      automationPotential: 'medium' as 'low' | 'medium' | 'high',
    }));

  return {
    summary: {
      totalCapabilities: extractedCapabilities.length,
      recommendedAgents: agents.length,
      complexity: (agents.length > 20 ? 'high' : agents.length > 10 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
      overview: `Imported ${parsed.elements.length} elements and ${parsed.relationships.length} relationships from ArchiMate model${parsed.modelName ? ` "${parsed.modelName}"` : ''}`,
    },
    extractedCapabilities,
    agents: agents.map(({ originalId, ...rest }) => rest), // Remove originalId from output
    agentRelationships,
    integrations: [],
  };
}

function mapTypeToPattern(type: string): string {
  const patternMap: Record<string, string> = {
    'ApplicationFunction': 'Executor',
    'ApplicationService': 'Gateway',
    'Agent': 'Orchestrator',
    'Process': 'orchestration',
    'Capability': 'Specialist',
    'DataObject': 'Aggregator',
    'Requirement': 'Monitor',
    'Resource': 'Executor',
  };
  return patternMap[type] || 'Specialist';
}

// ============================================================================
// PER-STEP WIZARD ENDPOINTS
// ============================================================================

import {
  executeStep1,
  executeStep2,
  executeStep3,
  executeStep4,
  executeStep5,
  executeStep6,
  WizardStepData,
} from '../services/step-executor';
import { pool } from '../services/database';

/**
 * Helper: Get session step data
 */
async function getSessionStepData(sessionId: string, tenantId: string): Promise<WizardStepData | null> {
  const result = await pool.query(
    'SELECT step_data FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );
  return result.rows[0]?.step_data || null;
}

/**
 * Helper: Update session step data
 */
async function updateSessionStepData(
  sessionId: string,
  tenantId: string,
  stepKey: string,
  data: any,
  currentStep: number
): Promise<void> {
  await pool.query(
    `UPDATE wizard_sessions 
     SET step_data = jsonb_set(COALESCE(step_data, '{}'), $3, $4::jsonb),
         current_step = $5,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [sessionId, tenantId, `{${stepKey}}`, JSON.stringify(data), currentStep]
  );
}

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step1
// Extract capabilities from description
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step1', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const { description, customContext, industry } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  console.log(`[${SERVICE_NAME}] Step 1: Extracting capabilities for session ${sessionId}`);

  const result = await executeStep1({ description, customContext, industry });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Save to session
  await updateSessionStepData(sessionId, tenantId, 'step1', {
    rawCapabilities: result.data,
    description,
  }, 1);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step2
// Classify selected capabilities
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step2', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const { selectedCapabilityIds } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get step 1 data
  const stepData = await getSessionStepData(sessionId, tenantId);
  if (!stepData?.step1?.rawCapabilities) {
    return res.status(400).json({ error: 'Step 1 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 2: Classifying elements for session ${sessionId}`);

  const result = await executeStep2({
    capabilities: stepData.step1.rawCapabilities.capabilities,
    selectedIds: selectedCapabilityIds,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Save to session
  await updateSessionStepData(sessionId, tenantId, 'step2', {
    selectedCapabilityIds,
    classifiedElements: result.data,
  }, 2);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step3
// Propose agent groupings
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step3', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const { targetAgentCount, userAdjustments } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get step 2 data
  const stepData = await getSessionStepData(sessionId, tenantId);
  if (!stepData?.step2?.classifiedElements) {
    return res.status(400).json({ error: 'Step 2 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 3: Proposing agents for session ${sessionId}`);

  const result = await executeStep3({
    elements: stepData.step2.classifiedElements.elements,
    targetAgentCount,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Save to session
  await updateSessionStepData(sessionId, tenantId, 'step3', {
    proposedAgents: result.data,
    userAdjustments,
  }, 3);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step4
// Configure agents (patterns + skills)
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step4', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get step 3 data
  const stepData = await getSessionStepData(sessionId, tenantId);
  if (!stepData?.step3?.proposedAgents) {
    return res.status(400).json({ error: 'Step 3 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 4: Configuring agents for session ${sessionId}`);

  const result = await executeStep4({
    agents: stepData.step3.proposedAgents.agents,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Save to session
  await updateSessionStepData(sessionId, tenantId, 'step4', result.data, 4);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step5
// Generate BPMN for a process element
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step5', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const { processName, processDescription, involvedAgents, capabilities, triggers, outputs } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!processName || !processDescription) {
    return res.status(400).json({ error: 'Process name and description required' });
  }

  console.log(`[${SERVICE_NAME}] Step 5: Generating BPMN for "${processName}" in session ${sessionId}`);

  const result = await executeStep5({
    processName,
    processDescription,
    involvedAgents: involvedAgents || [],
    capabilities: capabilities || [],
    triggers,
    outputs,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Append to session's process flows
  const stepData = await getSessionStepData(sessionId, tenantId);
  const existingFlows = stepData?.step5?.processFlows || [];
  const newFlows = [...existingFlows, { elementId: processName, bpmnXml: result.data!.bpmnXml }];

  await updateSessionStepData(sessionId, tenantId, 'step5', { processFlows: newFlows }, 5);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/step6
// Define relationships and integrations
// ----------------------------------------------------------------------------
router.post('/sessions/:id/step6', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const { industryContext, knownSystems } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get required step data
  const stepData = await getSessionStepData(sessionId, tenantId);
  if (!stepData?.step3?.proposedAgents || !stepData?.step4?.patterns) {
    return res.status(400).json({ error: 'Steps 3 and 4 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 6: Defining relationships for session ${sessionId}`);

  const result = await executeStep6({
    agents: stepData.step3.proposedAgents.agents,
    patterns: stepData.step4.patterns.agentPatterns,
    industryContext,
    knownSystems,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Save to session
  await updateSessionStepData(sessionId, tenantId, 'step6', result.data, 6);

  res.json({
    success: true,
    data: result.data,
    executionTimeMs: result.executionTimeMs,
  });
});

// ----------------------------------------------------------------------------
// POST /api/wizard/sessions/:id/apply
// Save all wizard data to the database
// ----------------------------------------------------------------------------
router.post('/sessions/:id/apply', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stepData = await getSessionStepData(sessionId, tenantId);
  if (!stepData?.step3?.proposedAgents) {
    return res.status(400).json({ error: 'Wizard not completed - missing agent data' });
  }

  console.log(`[${SERVICE_NAME}] Applying wizard session ${sessionId} to database`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const agents = stepData.step3.proposedAgents.agents;
    const patterns = stepData.step4?.patterns?.agentPatterns || [];
    const skills = stepData.step4?.skills?.agentSkills || [];
    const relationships = stepData.step6?.relationships?.relationships || [];
    const integrations = stepData.step6?.integrations?.integrations || [];
    const processFlows = stepData.step5?.processFlows || [];

    const agentIdMap = new Map<string, string>(); // Maps temp IDs to real UUIDs

    // Create agents
    for (const agent of agents) {
      const pattern = patterns.find(p => p.agentId === agent.id);
      const agentSkillsEntry = skills.find(s => s.agentId === agent.id);
      const bpmn = processFlows.find(p => p.elementId === agent.name)?.bpmnXml;

      const result = await client.query(
        `INSERT INTO agents (tenant_id, name, description, status, element_type, pattern, pattern_rationale, 
         autonomy_level, risk_appetite, triggers, outputs, process_bpmn, capabilities)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          tenantId,
          agent.name,
          agent.purpose, // Use 'purpose' from schema
          'Agent', // Default element type
          pattern?.pattern || agent.suggestedPattern || 'specialist',
          pattern?.patternRationale || '', // Use 'patternRationale' from schema
          pattern?.autonomyLevel || agent.suggestedAutonomy || 'supervised',
          pattern?.riskAppetite || 'medium',
          pattern?.triggers || [],
          pattern?.outputs || [],
          bpmn || null,
          agent.ownedElements || [], // Use 'ownedElements' as capabilities
        ]
      );

      const realId = result.rows[0].id;
      agentIdMap.set(agent.id, realId);

      // Create skills for this agent (skills are nested in agentSkills[].skills[])
      if (agentSkillsEntry?.skills) {
        for (const skill of agentSkillsEntry.skills) {
          await client.query(
            `INSERT INTO agent_skills (agent_id, skill_id, name, description, input_schema, output_schema)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              realId,
              skill.skillId,
              skill.name,
              skill.description,
              JSON.stringify(skill.inputSchema || {}),
              JSON.stringify(skill.outputSchema || {}),
            ]
          );
        }
      }
    }

    // Create relationships
    for (const rel of relationships) {
      const sourceId = agentIdMap.get(rel.sourceAgentId);
      const targetId = agentIdMap.get(rel.targetAgentId);
      if (sourceId && targetId) {
        await client.query(
          `INSERT INTO agent_interactions (source_agent_id, target_agent_id, message_type, description,
           relationship_type, is_async, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            sourceId,
            targetId,
            rel.messageType,
            rel.description,
            rel.relationshipType || 'triggers',
            rel.isAsync || false,
            rel.priority || 'normal',
          ]
        );
      }
    }

    // Create integrations
    for (const integration of integrations) {
      const agentId = agentIdMap.get(integration.agentId);
      if (agentId) {
        await client.query(
          `INSERT INTO agent_integrations (agent_id, integration_type, config, status)
           VALUES ($1, $2, $3, 'pending')`,
          [agentId, integration.type, JSON.stringify({
            name: integration.name,
            system: integration.system,
            direction: integration.direction,
            dataFlows: integration.dataFlows || [],
          })]
        );
      }
    }

    // Update session status
    await client.query(
      `UPDATE wizard_sessions SET status = 'applied', updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      created: {
        agents: agents.length,
        skills: skills.length,
        relationships: relationships.length,
        integrations: integrations.length,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[${SERVICE_NAME}] Apply error:`, error);
    res.status(500).json({ error: 'Failed to apply wizard data' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// GET /api/wizard/sessions/:id/state
// Get current wizard session state
// ----------------------------------------------------------------------------
router.get('/sessions/:id/state', async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await pool.query(
    'SELECT current_step, step_data, status FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId,
    currentStep: result.rows[0].current_step,
    stepData: result.rows[0].step_data,
    status: result.rows[0].status,
  });
});

export default router;
