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
import { createWizardSession } from '../services/database';
import { AnalyzeTextRequest, AnalyzeTextResponse, UploadImageResponse } from '../types/wizard';

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

// ============================================================================
// POST /api/wizard/analyze-text
// Analyze a text description and generate agent recommendations
// ============================================================================

router.post('/analyze-text', async (req: Request, res: Response) => {
  try {
    const { description, requirements } = req.body as AnalyzeTextRequest;
    const tid = req.tenantId;

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!tid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authenticated tenant context required' });
    }

    console.log(`[${SERVICE_NAME}] Analyzing text description (${description.length} chars)`);

    // Call AI service
    const analysis = await analyzeTextDescription(description, requirements);

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
      model: 'claude-sonnet-4-20250514',
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

export default router;
