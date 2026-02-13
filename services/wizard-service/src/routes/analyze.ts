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
  complete,
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

const uploadData = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max for data files
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
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
    const perStep = req.query.perStep === 'true' || req.body.perStep === true;

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!tid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    console.log(`[${SERVICE_NAME}] Analyzing text description (${description.length} chars, a2a=${useA2A}, perStep=${perStep})`);

    let analysis;
    let model;

    if (perStep) {
      // Per-step mode: Just create session, don't run analysis
      // Analysis will happen via individual /step1, /step2, etc. endpoints
      analysis = {
        summary: { totalCapabilities: 0, recommendedAgents: 0, complexity: 'low' as const, overview: 'Pending per-step analysis' },
        extractedCapabilities: [],
        agents: [],
        agentRelationships: [],
        integrations: [],
      };
      model = 'pending (per-step mode)';
      console.log(`[${SERVICE_NAME}] Per-step mode: Created empty session, analysis deferred to step endpoints`);
    } else if (useA2A) {
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

    // Extract top-level capabilities for AI processing
    const capabilities = extractTopLevelCapabilities(parsed);
    console.log(`[${SERVICE_NAME}] Extracted ${capabilities.length} top-level capabilities`);

    // Create minimal analysis with just capabilities (AI will generate agents)
    const analysis: AnalysisResult = {
      summary: {
        totalCapabilities: capabilities.length,
        recommendedAgents: 0, // AI will determine this
        complexity: (capabilities.length > 20 ? 'high' : capabilities.length > 10 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
        overview: `Extracted ${capabilities.length} top-level capabilities from ArchiMate model "${parsed.modelName || 'Unknown'}"`,
      },
      extractedCapabilities: capabilities as any, // Extended capability format from XML
      agents: [], // Will be populated by AI in step 3
      agentRelationships: [], // Will be populated by AI in step 6
      integrations: [], // Will be populated by AI in step 6
    };

    // Create wizard session with step_data for per-step AI processing
    const sessionName = parsed.modelName || `ArchiMate Import ${new Date().toLocaleDateString()}`;
    const initialStepData = {
      step1: {
        capabilities: capabilities,
        description: `Extracted from ArchiMate model: ${parsed.modelName || 'Unknown'}`,
      }
    };
    const sessionId = await createWizardSession(
      tenantId,
      sessionName,
      'xml',
      { elements: parsed.elements.length, relationships: parsed.relationships.length } as Record<string, unknown>,
      analysis,
      undefined,
      initialStepData,
      1 // Start at step 1 completed
    );

    console.log(`[${SERVICE_NAME}] Created session ${sessionId} with ${capabilities.length} capabilities for AI processing`);

    res.json({
      success: true,
      sessionId,
      analysis,
      source: 'xml',
      usePerStepMode: true, // Signal frontend to use AI per-step flow
      stats: {
        totalElements: parsed.elements.length,
        totalRelationships: parsed.relationships.length,
        extractedCapabilities: capabilities.length,
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
// POST /api/wizard/upload-data
// Upload and analyze CSV or Excel files
// ============================================================================

router.post('/upload-data', uploadData.single('file'), async (req: Request, res: Response) => {
  console.log(`[${SERVICE_NAME}] Data file upload started`);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const tid = req.tenantId;
    if (!tid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileName = req.file.originalname.toLowerCase();
    const context = req.body.context || '';
    let textContent = '';

    if (fileName.endsWith('.csv')) {
      // Parse CSV
      textContent = req.file.buffer.toString('utf-8');
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      return res.status(400).json({
        error: 'Excel files (.xlsx/.xls) are not supported. Please convert to CSV first.',
        details: 'Excel binary formats require specialized parsing. Export your spreadsheet as CSV (File → Save As → CSV) and re-upload.',
        suggestion: 'csv',
      });
    }

    console.log(`[${SERVICE_NAME}] Processing data file: ${fileName} (${textContent.length} chars)`);

    // Build prompt for AI analysis
    const prompt = `Analyze this data file and extract IT/business capabilities and processes.

File: ${req.file.originalname}
${context ? `\nContext: ${context}` : ''}

Data Content:
${textContent.slice(0, 15000)}

Extract:
1. Business capabilities (what functions/services are represented)
2. Data objects (key entities and data types)
3. Processes (workflows and procedures implied by the data)

Focus on IT service management, technology, and operational aspects.`;

    // Use text analysis
    const analysis = await analyzeTextDescription(prompt);

    // Create wizard session
    const sessionId = await createWizardSession(tid, 'data-upload', 'text', { 
      fileName: req.file.originalname, 
      context 
    }, analysis);

    res.json({
      success: true,
      sessionId,
      analysis,
      source: 'data',
      fileName: req.file.originalname,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Data file processing error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to process data file'
    });
  }
});

// ============================================================================
// POST /api/wizard/analyze-website
// Analyze a company website to extract capabilities and processes
// ============================================================================

router.post('/analyze-website', async (req: Request, res: Response) => {
  try {
    const { url, context } = req.body;
    const tid = req.tenantId;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!tid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // --- SSRF Protection ---
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // 1. Validate scheme
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only http and https URLs are allowed' });
    }

    // 2. Block localhost and internal hostnames
    const blockedHostnames = [
      'localhost',
      'metadata.google.internal',
      'metadata',
      'kubernetes.default',
      'kubernetes.default.svc',
    ];
    const hostname = parsedUrl.hostname.toLowerCase();
    if (blockedHostnames.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return res.status(400).json({ error: 'URLs pointing to internal/local hosts are not allowed' });
    }

    // 3. Block private/reserved IP ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      const isPrivate =
        a === 10 ||                                      // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) ||             // 172.16.0.0/12
        (a === 192 && b === 168) ||                      // 192.168.0.0/16
        a === 127 ||                                     // 127.0.0.0/8
        (a === 169 && b === 254) ||                      // 169.254.0.0/16 (link-local)
        a === 0 ||                                       // 0.0.0.0/8
        (a === 100 && b >= 64 && b <= 127) ||            // 100.64.0.0/10 (CGN)
        (a === 198 && (b === 18 || b === 19));           // 198.18.0.0/15 (benchmarking)
      if (isPrivate) {
        return res.status(400).json({ error: 'URLs pointing to private/reserved IP addresses are not allowed' });
      }
    }

    // Block IPv6 loopback/private (basic check for bracket notation)
    if (hostname === '[::1]' || hostname.startsWith('[fc') || hostname.startsWith('[fd') || hostname.startsWith('[fe80')) {
      return res.status(400).json({ error: 'URLs pointing to private/reserved IP addresses are not allowed' });
    }

    console.log(`[${SERVICE_NAME}] Analyzing website: ${url}`);

    // Fetch website content
    let websiteContent = '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FlowGrid Discovery Bot/1.0 (+https://flowgrid.io)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        redirect: 'manual', // Don't follow redirects automatically (prevent redirect-based SSRF)
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Handle redirects safely - validate redirect target
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        return res.status(400).json({ 
          error: 'URL redirects are not followed for security reasons. Please provide the final URL.',
          details: `Received HTTP ${response.status} redirect`
        });
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      
      // Extract text content (simple approach - strip HTML tags)
      websiteContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15000); // Limit to ~15k chars
    } catch (fetchError: any) {
      console.error(`[${SERVICE_NAME}] Failed to fetch website:`, fetchError.message);
      return res.status(400).json({ 
        error: 'Failed to fetch website',
        details: fetchError.message 
      });
    }

    // Build prompt for AI analysis
    const prompt = `Analyze this company website content and extract their IT/business capabilities and processes.

Website URL: ${url}
${context ? `\nAdditional Context: ${context}` : ''}

Website Content:
${websiteContent}

Extract:
1. Business capabilities (what the company does)
2. Data objects (key data they work with)
3. Processes (workflows and procedures)

Focus on IT service management, technology, and operational processes where visible.`;

    // Use text analysis
    const analysis = await analyzeTextDescription(prompt);

    // Create wizard session
    const sessionId = await createWizardSession(tid, 'website-analysis', 'text', { url, context }, analysis);

    res.json({
      success: true,
      sessionId,
      analysis,
      source: 'website',
      url,
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Website analysis error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to analyze website'
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
  // Flexible regex - attributes can be in any order
  // <relationship identifier="..." xsi:type="..." source="..." target="...">
  const relationshipTagRegex = /<relationship\s+([^>]+)>/gi;
  while ((match = relationshipTagRegex.exec(xmlContent)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/identifier="([^"]+)"/);
    const typeMatch = attrs.match(/xsi:type="([^"]+)"/);
    const sourceMatch = attrs.match(/source="([^"]+)"/);
    const targetMatch = attrs.match(/target="([^"]+)"/);
    
    if (idMatch && sourceMatch && targetMatch) {
      relationships.push({
        id: idMatch[1],
        type: normalizeRelationType(typeMatch?.[1] || 'Association'),
        sourceId: sourceMatch[1],
        targetId: targetMatch[1],
      });
    }
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

/**
 * Extract top-level capabilities from parsed ArchiMate model
 * Filters to Capability-type elements and identifies hierarchy via composition relationships
 */
function extractTopLevelCapabilities(parsed: ParsedArchiMate) {
  // Capability-related types
  const capabilityTypes = ['Capability', 'BusinessFunction', 'ApplicationFunction'];
  
  // Filter to capability elements
  const capabilities = parsed.elements.filter(el => 
    capabilityTypes.includes(el.type)
  );
  
  // Build set of child IDs (elements that are targets of composition relationships)
  const childIds = new Set<string>();
  parsed.relationships
    .filter(r => r.type === 'Composition' || r.type === 'Aggregation')
    .forEach(r => childIds.add(r.targetId));
  
  // Find parent names for capabilities that ARE children
  const parentMap = new Map<string, string>();
  parsed.relationships
    .filter(r => r.type === 'Composition' || r.type === 'Aggregation')
    .forEach(r => {
      const parent = parsed.elements.find(e => e.id === r.sourceId);
      if (parent) {
        parentMap.set(r.targetId, parent.name);
      }
    });
  
  // Convert to capability format compatible with AI prompts
  const result = capabilities.map(cap => ({
    id: cap.id,
    name: cap.name,
    description: cap.documentation || `${cap.type} from ArchiMate model`,
    level: (childIds.has(cap.id) ? 1 : 0) as 0 | 1 | 2, // 0 = top-level, 1 = child
    parentId: parentMap.get(cap.id) ? cap.id : undefined, // For hierarchy
    parentName: parentMap.get(cap.id),
    domain: cap.type, // Use ArchiMate type as domain
    keywords: [cap.type, cap.name.split(' ')[0]].filter(Boolean), // Generate keywords from type and first word
    automationPotential: 'medium' as 'low' | 'medium' | 'high',
    sourceType: cap.type,
  }));
  
  // Sort: top-level first, then by name
  result.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });
  
  console.log(`[XML Parser] Found ${result.filter(c => c.level === 0).length} top-level, ${result.filter(c => c.level === 1).length} child capabilities`);
  
  return result;
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
 * Helper: Get session step data with current step
 */
interface SessionState {
  stepData: WizardStepData | null;
  currentStep: number;
  status: string;
}

async function getSessionStepData(sessionId: string, tenantId: string): Promise<WizardStepData | null> {
  const result = await pool.query(
    'SELECT step_data FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );
  return result.rows[0]?.step_data || null;
}

async function getSessionState(sessionId: string, tenantId: string): Promise<SessionState | null> {
  const result = await pool.query(
    'SELECT step_data, current_step, status FROM wizard_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId]
  );
  if (!result.rows[0]) return null;
  return {
    stepData: result.rows[0].step_data || null,
    currentStep: result.rows[0].current_step || 0,
    status: result.rows[0].status || 'created',
  };
}

/**
 * Helper: Validate step order
 */
function validateStepOrder(currentStep: number, requiredStep: number, stepName: string): string | null {
  if (currentStep < requiredStep - 1) {
    return `Step ${requiredStep - 1} must be completed before ${stepName}`;
  }
  return null;
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

  // Validate step order and get data
  const session = await getSessionState(sessionId, tenantId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const orderError = validateStepOrder(session.currentStep, 2, 'step2');
  if (orderError) {
    return res.status(400).json({ error: orderError });
  }

  const stepData = session.stepData as any;
  // Support both formats: rawCapabilities (from text flow) or capabilities (from XML)
  const step1Capabilities = stepData?.step1?.rawCapabilities?.capabilities || stepData?.step1?.capabilities;
  if (!step1Capabilities) {
    return res.status(400).json({ error: 'Step 1 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 2: Classifying ${step1Capabilities.length} elements for session ${sessionId}`);

  let result;
  try {
    result = await executeStep2({
      capabilities: step1Capabilities,
      selectedIds: selectedCapabilityIds,
    });

    if (!result.success) {
      console.error(`[${SERVICE_NAME}] Step 2 failed:`, result.error);
      return res.status(500).json({ error: result.error });
    }
  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Step 2 exception:`, error);
    return res.status(500).json({ error: error.message || 'Step 2 failed' });
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

  // Validate step order and get data
  const session = await getSessionState(sessionId, tenantId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const orderError = validateStepOrder(session.currentStep, 3, 'step3');
  if (orderError) {
    return res.status(400).json({ error: orderError });
  }

  const stepData = session.stepData;
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

  // Save to session (include optimization metadata)
  await updateSessionStepData(sessionId, tenantId, 'step3', {
    proposedAgents: result.data,
    optimization: result.metadata?.optimization || null,
    userAdjustments,
  }, 3);

  res.json({
    success: true,
    data: result.data,
    optimization: result.metadata?.optimization || null,
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

  // Validate step order and get data
  const session = await getSessionState(sessionId, tenantId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const orderError = validateStepOrder(session.currentStep, 4, 'step4');
  if (orderError) {
    return res.status(400).json({ error: orderError });
  }

  const stepData = session.stepData;
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
  const { processId, processName, processDescription, involvedAgents, capabilities, triggers, outputs } = req.body;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!processId || !processName || !processDescription) {
    return res.status(400).json({ error: 'Process ID, name and description required' });
  }

  // Validate step order and get data
  const session = await getSessionState(sessionId, tenantId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const orderError = validateStepOrder(session.currentStep, 5, 'step5');
  if (orderError) {
    return res.status(400).json({ error: orderError });
  }

  const stepData = session.stepData;
  if (!stepData?.step4?.patterns) {
    return res.status(400).json({ error: 'Step 4 must be completed first' });
  }

  console.log(`[${SERVICE_NAME}] Step 5: Generating BPMN for "${processName}" (${processId}) in session ${sessionId}`);

  const result = await executeStep5({
    processId,
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

  // Append to session's process flows (keyed by element ID)
  const existingFlows = stepData?.step5?.processFlows || [];
  // Replace existing flow for same element, or append new
  const filteredFlows = existingFlows.filter(f => f.elementId !== processId);
  const newFlows = [...filteredFlows, { elementId: processId, bpmnXml: result.data!.bpmnXml }];

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

  // Validate step order and get data
  const session = await getSessionState(sessionId, tenantId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  // Step 6 requires at least step 4 to be complete (step 5 is optional for BPMN)
  const orderError = validateStepOrder(session.currentStep, 5, 'step6');
  if (orderError && session.currentStep < 4) {
    return res.status(400).json({ error: 'Step 4 must be completed before step 6' });
  }

  const stepData = session.stepData as any;
  
  // Get agents from step3 or step2 (fallback for XML flow)
  const agents = stepData?.step3?.proposedAgents?.agents || stepData?.step3?.agents || [];
  const patterns = stepData?.step4?.patterns?.agentPatterns || [];
  
  console.log(`[${SERVICE_NAME}] Step 6 debug: agents=${agents.length}, patterns=${patterns.length}`);
  
  if (agents.length === 0) {
    // Return empty result if no agents available
    console.log(`[${SERVICE_NAME}] Step 6: No agents found, returning empty relationships`);
    return res.json({
      success: true,
      data: {
        relationships: { relationships: [] },
        integrations: { integrations: [] },
      },
      executionTimeMs: 0,
    });
  }

  console.log(`[${SERVICE_NAME}] Step 6: Defining relationships for ${agents.length} agents in session ${sessionId}`);

  const result = await executeStep6({
    agents: agents,
    patterns: patterns,
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
    const classifiedElements = stepData.step2?.classifiedElements?.elements || [];
    const patterns = stepData.step4?.patterns?.agentPatterns || [];
    const skills = stepData.step4?.skills?.agentSkills || [];
    const relationships = stepData.step6?.relationships?.relationships || [];
    const integrations = stepData.step6?.integrations?.integrations || [];
    const processFlows = stepData.step5?.processFlows || [];

    // Build element type lookup from step 2 classification
    const elementTypeMap = new Map<string, string>();
    for (const el of classifiedElements) {
      elementTypeMap.set(el.id, el.elementType);
      elementTypeMap.set(el.name, el.elementType); // Also map by name for fallback
    }

    const agentIdMap = new Map<string, string>(); // Maps temp IDs to real UUIDs

    // Create agents
    for (const agent of agents) {
      const pattern = patterns.find(p => p.agentId === agent.id);
      const agentSkillsEntry = skills.find(s => s.agentId === agent.id);
      const bpmn = processFlows.find(p => p.elementId === agent.id)?.bpmnXml;

      // Determine element type: from owned elements classification, or default to Agent
      let elementType = 'Agent';
      if (agent.ownedElements?.length) {
        // Check if any owned element has a classified type
        const ownedType = agent.ownedElements
          .map(oe => elementTypeMap.get(oe))
          .find(t => t);
        if (ownedType) elementType = ownedType;
      }
      // Also check if the agent itself was classified
      const directType = elementTypeMap.get(agent.id) || elementTypeMap.get(agent.name);
      if (directType) elementType = directType;

      // Normalize pattern to lowercase for consistency
      const rawPattern = pattern?.pattern || agent.suggestedPattern || 'specialist';
      const normalizedPattern = rawPattern.toLowerCase();

      const result = await client.query(
        `INSERT INTO agents (tenant_id, name, description, status, element_type, pattern, pattern_rationale, 
         autonomy_level, risk_appetite, triggers, outputs, process_bpmn, capabilities)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          tenantId,
          agent.name,
          agent.purpose, // Use 'purpose' from schema
          elementType, // Use actual element type from classification
          normalizedPattern, // Normalized to lowercase
          pattern?.patternRationale || '', // Use 'patternRationale' from schema
          (pattern?.autonomyLevel || agent.suggestedAutonomy || 'supervised').toLowerCase(),
          (pattern?.riskAppetite || 'medium').toLowerCase(),
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
            `INSERT INTO agent_skills (agent_id, tenant_id, skill_id, name, display_name, description, input_schema, output_schema, tags, examples)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              realId,
              tenantId,
              skill.skillId,
              skill.name,
              skill.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), // Generate display_name from skill name
              skill.description,
              JSON.stringify(skill.inputSchema || {}),
              JSON.stringify(skill.outputSchema || {}),
              skill.tags || [],
              JSON.stringify(skill.examples || []),
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

// ============================================================================
// POST /api/wizard/suggest-subprocess
// AI-powered sub-process suggestion based on process name
// ============================================================================

router.post('/suggest-subprocess', async (req: Request, res: Response) => {
  console.log(`[${SERVICE_NAME}] Suggest sub-process request`);

  try {
    const { processName, foundationContext } = req.body;

    if (!processName) {
      return res.status(400).json({ error: 'Process name is required' });
    }

    const prompt = `You are an IT service management expert. Given a process, suggest ONE specific sub-process that would benefit most from AI agent automation.

Process: ${processName}
${foundationContext ? `\nOrganization context: ${foundationContext}` : ''}

Respond in JSON format only (no markdown, no explanation):
{
  "name": "Sub-process name (specific and actionable)",
  "description": "Detailed description of what should be automated, including inputs, steps, and expected behavior (2-3 sentences)",
  "expectedOutcome": "Measurable success criteria with specific metrics where possible",
  "constraints": "Key constraints, integrations needed, or approval requirements"
}

Focus on high-impact, feasible automation opportunities. Be specific and practical.`;

    const response = await complete({
      userPrompt: prompt,
      systemPrompt: 'You are an IT service management expert. Respond only with valid JSON.',
      maxTokens: 1024
    });
    
    // Parse JSON from response
    let suggestion;
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestion = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error(`[${SERVICE_NAME}] Failed to parse AI response:`, response.content);
      return res.status(500).json({ error: 'Failed to parse AI suggestion' });
    }

    res.json({
      success: true,
      suggestion
    });

  } catch (error: any) {
    console.error(`[${SERVICE_NAME}] Suggest sub-process error:`, error);
    res.status(500).json({ error: error.message || 'Failed to generate suggestion' });
  }
});

export default router;
