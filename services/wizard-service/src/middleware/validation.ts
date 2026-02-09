/**
 * Input Validation Middleware for Wizard Service
 * 
 * Validates input sizes to prevent DoS attacks:
 * - Text descriptions: max 50KB
 * - Image uploads: max 10MB
 * - JSON payloads: enforced by express.json({ limit })
 */

import { Request, Response, NextFunction } from 'express';

// Size limits (in bytes)
const LIMITS = {
  description: 50 * 1024,      // 50KB for text descriptions
  imageBase64: 15 * 1024 * 1024, // 15MB for base64 (accounts for ~33% overhead)
  customPrompt: 5 * 1024,       // 5KB for custom prompts
  requirements: 10 * 1024,      // 10KB for requirements array
  agentName: 200,               // 200 chars for agent names
  agentDescription: 5 * 1024,   // 5KB for agent descriptions
};

/**
 * Calculate string size in bytes
 */
function byteSize(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Validate text analysis input
 */
export function validateTextAnalysis(req: Request, res: Response, next: NextFunction) {
  const { description, requirements, customPrompt } = req.body;

  if (description && byteSize(description) > LIMITS.description) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Description exceeds maximum size of ${LIMITS.description / 1024}KB`,
      code: 'DESCRIPTION_TOO_LARGE',
      maxSize: LIMITS.description,
    });
  }

  if (customPrompt && byteSize(customPrompt) > LIMITS.customPrompt) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Custom prompt exceeds maximum size of ${LIMITS.customPrompt / 1024}KB`,
      code: 'CUSTOM_PROMPT_TOO_LARGE',
      maxSize: LIMITS.customPrompt,
    });
  }

  if (requirements && Array.isArray(requirements)) {
    const totalSize = requirements.reduce((sum, r) => sum + byteSize(String(r)), 0);
    if (totalSize > LIMITS.requirements) {
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `Requirements exceed maximum size of ${LIMITS.requirements / 1024}KB`,
        code: 'REQUIREMENTS_TOO_LARGE',
        maxSize: LIMITS.requirements,
      });
    }
  }

  next();
}

/**
 * Validate image upload input (for base64 uploads)
 */
export function validateImageUpload(req: Request, res: Response, next: NextFunction) {
  const { imageBase64, customPrompt } = req.body;

  if (imageBase64 && byteSize(imageBase64) > LIMITS.imageBase64) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Image exceeds maximum size of 10MB',
      code: 'IMAGE_TOO_LARGE',
      maxSize: LIMITS.imageBase64,
    });
  }

  if (customPrompt && byteSize(customPrompt) > LIMITS.customPrompt) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Custom prompt exceeds maximum size of ${LIMITS.customPrompt / 1024}KB`,
      code: 'CUSTOM_PROMPT_TOO_LARGE',
      maxSize: LIMITS.customPrompt,
    });
  }

  next();
}

/**
 * Validate agent data
 */
export function validateAgentData(req: Request, res: Response, next: NextFunction) {
  const { agent, agents } = req.body;

  const validateSingleAgent = (a: any, index?: number) => {
    const prefix = index !== undefined ? `Agent ${index}: ` : '';

    if (a.name && byteSize(a.name) > LIMITS.agentName) {
      return {
        error: 'Payload Too Large',
        message: `${prefix}Agent name exceeds maximum length of ${LIMITS.agentName} characters`,
        code: 'AGENT_NAME_TOO_LONG',
      };
    }

    if (a.description && byteSize(a.description) > LIMITS.agentDescription) {
      return {
        error: 'Payload Too Large',
        message: `${prefix}Agent description exceeds maximum size of ${LIMITS.agentDescription / 1024}KB`,
        code: 'AGENT_DESCRIPTION_TOO_LARGE',
      };
    }

    return null;
  };

  if (agent) {
    const error = validateSingleAgent(agent);
    if (error) {
      return res.status(413).json(error);
    }
  }

  if (agents && Array.isArray(agents)) {
    for (let i = 0; i < agents.length; i++) {
      const error = validateSingleAgent(agents[i], i);
      if (error) {
        return res.status(413).json(error);
      }
    }
  }

  next();
}

/**
 * Generic size check for any string field
 */
export function checkFieldSize(fieldName: string, maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];

    if (value && typeof value === 'string' && byteSize(value) > maxBytes) {
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `${fieldName} exceeds maximum size of ${maxBytes / 1024}KB`,
        code: `${fieldName.toUpperCase()}_TOO_LARGE`,
        maxSize: maxBytes,
      });
    }

    next();
  };
}

export default {
  validateTextAnalysis,
  validateImageUpload,
  validateAgentData,
  checkFieldSize,
  LIMITS,
};
