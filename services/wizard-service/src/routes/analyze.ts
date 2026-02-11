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

export default router;
