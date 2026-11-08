/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for generating character profiles.
 * Extracted from App.tsx as part of Batch 2.2 decomposition.
 */

import { useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import {
  Persona,
  CharacterProfile,
  IdentityHeader,
  generateHardNegatives,
  isCastMember,
} from '../types';
import { buildAllCharacterReferences } from '../utils/buildCharacterReference';
import {
  createTextContent,
  createImageContent,
  extractJsonFromResponse,
  ClaudeContentBlock,
  detectImageMimeType,
} from '../claudeHelpers';
import { useCharacterStore } from '../stores/useCharacterStore';
import { validateProfileCompleteness } from '../utils/profileValidation';
import { useMetricsStore } from '../stores/useMetricsStore';
import { profileFingerprint } from '../utils/characterFingerprint';

// ============================================================================
// TYPES
// ============================================================================

/** Configuration for the useGenerateProfile hook */
export interface GenerateProfileConfig {
  /** Get GoogleGenAI client */
  getAI: () => GoogleGenAI;
  /** Get Anthropic client (returns null if not configured) */
  getClaude: () => Anthropic | null;
  /** Handle Gemini API errors */
  onAPIError: (e: unknown) => void;
  /** Handle Anthropic API errors */
  onAnthropicError: (e: unknown) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MODEL_TEXT_NAME = "gemini-2.5-pro";
const MODEL_TEXT_NAME_CLAUDE = "claude-sonnet-4-5-20250929";

// ============================================================================
// IDENTITY HEADER EXTRACTION HELPERS
// ============================================================================

/**
 * Checks if an object is a valid IdentityHeader with non-empty required fields.
 */
const isValidIdentityHeader = (obj: unknown): obj is IdentityHeader => {
  if (!obj || typeof obj !== 'object') return false;
  const header = obj as Record<string, unknown>;
  const face = typeof header.face === 'string' ? header.face.trim() : '';
  const eyes = typeof header.eyes === 'string' ? header.eyes.trim() : '';
  const hair = typeof header.hair === 'string' ? header.hair.trim() : '';
  const skin = typeof header.skin === 'string' ? header.skin.trim() : '';
  const build = typeof header.build === 'string' ? header.build.trim() : '';
  // Require at least face, eyes, hair, and skin to be non-empty
  return face.length > 0 && eyes.length > 0 && hair.length > 0 && skin.length > 0 && build.length > 0;
};

/**
 * Helper to ensure string fields are actually strings (AI sometimes returns objects)
 */
const ensureStringStatic = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
  return String(val);
};

/**
 * Extract eyes description from parsed profile fields using multiple strategies.
 */
const extractEyesFromFields = (parsed: Record<string, unknown>): string => {
  // Strategy 1: Check colorPalette for "eyes: X" pattern
  const colorPalette = ensureStringStatic(parsed.colorPalette);
  const eyesFromPalette = colorPalette.match(/eyes?[:\s]+([^,;]+)/i)?.[1]?.trim();
  if (eyesFromPalette && eyesFromPalette.length > 0) {
    return eyesFromPalette;
  }

  // Strategy 2: Check faceDescription for "[color] eyes" or "eyes are [color]" patterns
  const faceDesc = ensureStringStatic(parsed.faceDescription);
  // Match patterns like "brown eyes", "deep blue eyes", "almond-shaped green eyes"
  const eyesFromFace = faceDesc.match(/(\w+(?:[-\s]\w+)*)\s+eyes/i)?.[1]?.trim();
  if (eyesFromFace && eyesFromFace.length > 0 && eyesFromFace.toLowerCase() !== 'the') {
    return `${eyesFromFace} eyes`;
  }
  // Match "eyes are [description]" pattern
  const eyesArePattern = faceDesc.match(/eyes\s+(?:are\s+)?([^,.;]+)/i)?.[1]?.trim();
  if (eyesArePattern && eyesArePattern.length > 0) {
    return eyesArePattern;
  }

  // Strategy 3: Check distinguishingFeatures for eye-related info
  const features = ensureStringStatic(parsed.distinguishingFeatures);
  const eyesFromFeatures = features.match(/(\w+(?:[-\s]\w+)*)\s+eyes/i)?.[1]?.trim();
  if (eyesFromFeatures && eyesFromFeatures.length > 0) {
    return `${eyesFromFeatures} eyes`;
  }

  return '';
};

/**
 * Extract hair description from parsed profile fields using multiple strategies.
 */
const extractHairFromFields = (parsed: Record<string, unknown>): string => {
  // Strategy 1: Check hairDetails.color and combine with length/style
  const hairDetails = parsed.hairDetails as Record<string, unknown> | undefined;
  if (hairDetails) {
    const color = ensureStringStatic(hairDetails.color);
    const length = ensureStringStatic(hairDetails.length);
    const type = ensureStringStatic(hairDetails.type);
    const style = ensureStringStatic(hairDetails.style);

    if (color || length || type) {
      const parts = [length, color, type].filter(p => p.length > 0);
      const hairDesc = parts.join(' ');
      if (style && style.length > 0) {
        return `${hairDesc} hair worn ${style}`;
      }
      return hairDesc.length > 0 ? `${hairDesc} hair` : '';
    }
  }

  // Strategy 2: Check colorPalette for "hair: X" pattern
  const colorPalette = ensureStringStatic(parsed.colorPalette);
  const hairFromPalette = colorPalette.match(/hair[:\s]+([^,;]+)/i)?.[1]?.trim();
  if (hairFromPalette && hairFromPalette.length > 0) {
    return hairFromPalette.includes('hair') ? hairFromPalette : `${hairFromPalette} hair`;
  }

  // Strategy 3: Check faceDescription for hair mentions
  const faceDesc = ensureStringStatic(parsed.faceDescription);
  const hairFromFace = faceDesc.match(/(\w+(?:[-\s]\w+)*)\s+hair/i)?.[1]?.trim();
  if (hairFromFace && hairFromFace.length > 0 && hairFromFace.toLowerCase() !== 'the') {
    return `${hairFromFace} hair`;
  }

  // Strategy 4: Check distinguishingFeatures
  const features = ensureStringStatic(parsed.distinguishingFeatures);
  const hairFromFeatures = features.match(/(\w+(?:[-\s]\w+)*)\s+hair/i)?.[1]?.trim();
  if (hairFromFeatures && hairFromFeatures.length > 0) {
    return `${hairFromFeatures} hair`;
  }

  return '';
};

/**
 * Extract skin description from parsed profile fields using multiple strategies.
 */
const extractSkinFromFields = (parsed: Record<string, unknown>): string => {
  // Strategy 1: Check colorPalette for "skin: X" pattern
  const colorPalette = ensureStringStatic(parsed.colorPalette);
  const skinFromPalette = colorPalette.match(/skin[:\s]+([^,;]+)/i)?.[1]?.trim();
  if (skinFromPalette && skinFromPalette.length > 0) {
    return skinFromPalette;
  }

  // Strategy 2: Check faceDescription for skin tone mentions
  const faceDesc = ensureStringStatic(parsed.faceDescription);
  // Match patterns like "fair skin", "dark complexion", "olive-toned skin"
  const skinFromFace = faceDesc.match(/(\w+(?:[-\s]\w+)*)\s+(?:skin|complexion)/i)?.[1]?.trim();
  if (skinFromFace && skinFromFace.length > 0 && skinFromFace.toLowerCase() !== 'the') {
    return `${skinFromFace} skin`;
  }
  // Also check for "skin is [description]"
  const skinIsPattern = faceDesc.match(/skin\s+(?:is\s+)?([^,.;]+)/i)?.[1]?.trim();
  if (skinIsPattern && skinIsPattern.length > 0) {
    return skinIsPattern;
  }

  // Strategy 3: Check bodyType for skin-related info
  const bodyType = ensureStringStatic(parsed.bodyType);
  const skinFromBody = bodyType.match(/(\w+(?:[-\s]\w+)*)\s+(?:skin|complexion)/i)?.[1]?.trim();
  if (skinFromBody && skinFromBody.length > 0) {
    return `${skinFromBody} skin`;
  }

  return '';
};

/**
 * Build signature array from various profile fields.
 */
const buildSignatureArray = (parsed: Record<string, unknown>): string[] => {
  const signature: string[] = [];

  // Add from distinguishingFeatures
  const features = ensureStringStatic(parsed.distinguishingFeatures);
  if (features.length > 0) {
    const featureList = features.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 0);
    signature.push(...featureList.slice(0, 2)); // Take first 2 distinguishing features
  }

  // Add emblem if present
  const emblem = ensureStringStatic(parsed.emblemDescription);
  if (emblem.length > 0) {
    signature.push('signature emblem/logo');
  }

  // Add mask if present
  const mask = ensureStringStatic(parsed.maskDescription);
  if (mask.length > 0) {
    signature.push(mask.length > 30 ? 'distinctive mask' : mask);
  }

  // Add weapon if present
  const weapon = ensureStringStatic(parsed.weaponDescription);
  if (weapon.length > 0) {
    signature.push('signature weapon');
  }

  // Ensure we have at least one item
  if (signature.length === 0) {
    signature.push('unique appearance');
  }

  return signature;
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides character profile generation functionality.
 * Reads character data from Zustand stores.
 */
export const useGenerateProfile = (config: GenerateProfileConfig) => {
  const { getAI, getClaude, onAPIError, onAnthropicError } = config;

  // Prevents concurrent profile generation for the same character ID
  // (rapid double-click or overlapping calls would otherwise overwrite each other)
  const generatingProfileIds = useRef(new Set<string>());

  // Store getters (for use in async callbacks)
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters.filter(isCastMember);

  /**
   * Helper to ensure string fields are actually strings (AI sometimes returns objects)
   */
  const ensureString = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
      return Object.entries(val as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
    }
    return String(val);
  };

  /**
   * Helper to process parsed JSON into CharacterProfile
   * Uses 3-tier strategy for identity header extraction:
   *   1. Use structured identityHeader if provided AND valid
   *   2. Extract from individual fields with better parsing
   *   3. Use sensible defaults as fallback
   */
  const processProfileResponse = (parsed: Record<string, unknown>, persona: Persona): CharacterProfile => {
    let identityHeader: IdentityHeader;

    // Strategy 1: Use structured identityHeader if provided AND valid
    if (isValidIdentityHeader(parsed.identityHeader)) {
      const rawHeader = parsed.identityHeader as IdentityHeader;
      identityHeader = {
        face: rawHeader.face,
        eyes: rawHeader.eyes,
        hair: rawHeader.hair,
        skin: rawHeader.skin,
        build: rawHeader.build,
        // Ensure signature is always an array with items
        signature: Array.isArray(rawHeader.signature) && rawHeader.signature.length > 0
          ? rawHeader.signature
          : buildSignatureArray(parsed),
      };
    } else {
      // Strategy 2: Extract from individual fields with better multi-strategy parsing
      const extractedFace = ensureString(parsed.faceDescription);
      const extractedEyes = extractEyesFromFields(parsed);
      const extractedHair = extractHairFromFields(parsed);
      const extractedSkin = extractSkinFromFields(parsed);
      const extractedBuild = ensureString(parsed.bodyType);
      const extractedSignature = buildSignatureArray(parsed);

      // Strategy 3: Apply sensible defaults for any still-empty fields
      identityHeader = {
        face: extractedFace || 'distinctive facial features',
        eyes: extractedEyes || 'expressive eyes',
        hair: extractedHair || 'styled hair',
        skin: extractedSkin || 'natural skin tone',
        build: extractedBuild || 'standard build',
        signature: extractedSignature,
      };
    }

    const hardNegatives = (parsed.hardNegatives as string[]) || generateHardNegatives(identityHeader);

    // Parse hair details if present
    const parsedHairDetails = parsed.hairDetails as Record<string, unknown> | undefined;
    const hairDetails = parsedHairDetails ? {
      length: ensureString(parsedHairDetails.length),
      type: ensureString(parsedHairDetails.type),
      color: ensureString(parsedHairDetails.color),
      style: ensureString(parsedHairDetails.style),
    } : undefined;

    // Get emblem placement from persona (user's selection)
    const emblemPlacement = persona.emblemPlacement === 'other'
      ? persona.emblemPlacementCustom || 'custom location'
      : persona.emblemPlacement?.replace(/-/g, ' ') || undefined;

    // Parse extractedColors (Feature B)
    const rawExtractedColors = parsed.extractedColors as Record<string, unknown> | undefined;
    let extractedColors: CharacterProfile['extractedColors'];
    if (rawExtractedColors && typeof rawExtractedColors === 'object') {
      extractedColors = {
        skin: ensureString(rawExtractedColors.skin),
        hair: ensureString(rawExtractedColors.hair),
        eyes: ensureString(rawExtractedColors.eyes),
        outfit: Array.isArray(rawExtractedColors.outfit)
          ? rawExtractedColors.outfit.map(String).filter(Boolean)
          : [],
        emblem: Array.isArray(rawExtractedColors.emblem)
          ? rawExtractedColors.emblem.map(String).filter(Boolean)
          : [],
      };
    }

    return {
      id: persona.id,
      name: persona.name || 'Unknown',
      // What this profile was analysed from. If the character is edited later,
      // the profile is out of date and gets re-analysed instead of reused.
      sourceFingerprint: profileFingerprint(persona),
      faceDescription: ensureString(parsed.faceDescription),
      bodyType: ensureString(parsed.bodyType),
      clothing: ensureString(parsed.clothing),
      colorPalette: ensureString(parsed.colorPalette),
      distinguishingFeatures: ensureString(parsed.distinguishingFeatures),
      emblemDescription: parsed.emblemDescription ? ensureString(parsed.emblemDescription) : undefined,
      emblemPlacement,
      maskDescription: parsed.maskDescription ? ensureString(parsed.maskDescription) : undefined,
      hairDetails,
      weaponDescription: parsed.weaponDescription ? ensureString(parsed.weaponDescription) : undefined,
      identityHeader,
      hardNegatives,
      contrastFeatures: Array.isArray(parsed.contrastFeatures)
        ? (parsed.contrastFeatures as string[]).filter(s => typeof s === 'string' && s.length > 0).slice(0, 3)
        : [],
      extractedColors,
    };
  };

  /**
   * Generate a character profile from persona data.
   * Uses Claude as primary, falls back to Gemini.
   */
  const generateCharacterProfile = async (persona: Persona, forceAnalysis = false): Promise<CharacterProfile> => {
    const profileStartTime = Date.now();

    // Guard: prevent concurrent generation for the same character
    if (generatingProfileIds.current.has(persona.id)) {
      console.debug(`[generateCharacterProfile] Skipping duplicate request for "${persona.name}" (${persona.id})`);
      // Return the currently stored profile if available, else wait for the running call to finish
      const existing = useCharacterStore.getState().getProfilesArray().find(p => p.id === persona.id);
      if (existing) return existing;
    }
    generatingProfileIds.current.add(persona.id);
    // Build content for both Claude and Gemini
    const claudeContent: ClaudeContentBlock[] = [];
    const geminiContent: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    let hasData = false;

    if (persona.base64) {
      const portraitMime = detectImageMimeType(persona.base64);
      claudeContent.push(createTextContent(`Analyze this character portrait for: ${persona.name || 'Unknown'}`));
      claudeContent.push(createImageContent(persona.base64, portraitMime));
      geminiContent.push({ text: `Analyze this character portrait for: ${persona.name || 'Unknown'}` });
      geminiContent.push({ inlineData: { mimeType: portraitMime, data: persona.base64 } });
      hasData = true;
    }

    const allRefs = persona.referenceImages || (persona.referenceImage ? [persona.referenceImage] : []);
    allRefs.forEach((ref, i) => {
      const refMime = detectImageMimeType(ref);
      claudeContent.push(createTextContent(`Additional reference ${i + 1}:`));
      claudeContent.push(createImageContent(ref, refMime));
      geminiContent.push({ text: `Additional reference ${i + 1}:` });
      geminiContent.push({ inlineData: { mimeType: refMime, data: ref } });
      hasData = true;
    });

    // Include emblem/logo if provided
    if (persona.emblemImage) {
      const emblemMime = detectImageMimeType(persona.emblemImage);
      const placementDesc = persona.emblemPlacement === 'other'
        ? persona.emblemPlacementCustom || 'custom location'
        : persona.emblemPlacement?.replace('-', ' ') || 'unspecified location';
      claudeContent.push(createTextContent(`EMBLEM/LOGO (placed on ${placementDesc}):`));
      claudeContent.push(createImageContent(persona.emblemImage, emblemMime));
      geminiContent.push({ text: `EMBLEM/LOGO (placed on ${placementDesc}):` });
      geminiContent.push({ inlineData: { mimeType: emblemMime, data: persona.emblemImage } });
      hasData = true;
    }

    // Include weapon reference if provided
    if (persona.weaponImage) {
      const weaponMime = detectImageMimeType(persona.weaponImage);
      const weaponDesc = persona.weaponDescriptionText || 'signature weapon';
      claudeContent.push(createTextContent(`SIGNATURE WEAPON (${weaponDesc}):`));
      claudeContent.push(createImageContent(persona.weaponImage, weaponMime));
      geminiContent.push({ text: `SIGNATURE WEAPON (${weaponDesc}):` });
      geminiContent.push({ inlineData: { mimeType: weaponMime, data: persona.weaponImage } });
      hasData = true;
    }

    // Include character description/backstory text (check both fields for compatibility)
    const descriptionText = persona.backstoryText?.trim() || '';
    if (descriptionText.trim().length > 0) {
      claudeContent.push(createTextContent(`Character Description/Backstory: ${descriptionText}`));
      geminiContent.push({ text: `Character Description/Backstory: ${descriptionText}` });
      hasData = true;
    }

    if (persona.backstoryFiles && persona.backstoryFiles.length > 0) {
      persona.backstoryFiles.forEach(file => {
        if (file.mimeType.startsWith('text/')) {
          try {
            const text = atob(file.base64);
            claudeContent.push(createTextContent(`Additional Details (${file.name}): ${text}`));
            geminiContent.push({ text: `Additional Details (${file.name}): ${text}` });
            hasData = true;
          } catch {
            // Skip malformed base64
          }
        } else if (file.mimeType.startsWith('image/')) {
          claudeContent.push(createImageContent(file.base64, file.mimeType));
          geminiContent.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } });
          hasData = true;
        }
      });
    }

    if (!hasData && !forceAnalysis) {
      console.log(`Skipping profile generation for ${persona.name} (no data provided)`);
      generatingProfileIds.current.delete(persona.id);
      return {
        id: persona.id,
        name: persona.name || 'Unknown',
        faceDescription: '',
        bodyType: '',
        clothing: '',
        colorPalette: '',
        distinguishingFeatures: ''
      };
    }

    const analysisPrompt = `
Analyze the character based on the images and text provided above. Produce a STRICT JSON visual profile.
If only text is provided, infer the visual details based on the description.
If an EMBLEM/LOGO image is provided, describe it accurately and note its placement.

OUTPUT JSON ONLY (no markdown):
{
  "faceDescription": "Shape, eye color, nose, jawline, expression, any scars/markings",
  "bodyType": "Height, build (slim/athletic/muscular/heavy), proportions",
  "clothing": "Exact outfit description with all details, armor, accessories",
  "colorPalette": "Primary and secondary colors of skin, hair, eyes, outfit",
  "distinguishingFeatures": "Unique traits: tattoos, glowing eyes, tail, pointed ears, scars, etc.",
  "emblemDescription": "If emblem/logo provided: describe the emblem design, colors, and its placement on the character. Include this in EVERY panel featuring this character.",
  "maskDescription": "If character wears a mask: describe the mask type (full face, half face, domino, bandana, etc.), material, colors, patterns, and any distinctive features. If NO MASK, leave empty string.",
  "hairDetails": {
    "length": "Describe length (bald, buzz cut, short, medium, long, very long, floor-length)",
    "type": "Straight, wavy, curly, coily, braided, dreadlocks, etc.",
    "color": "Exact color(s) including highlights, ombre, tips, roots if different",
    "style": "How it's worn (loose, ponytail, bun, pigtails, mohawk, spikes, slicked back, parted, messy, neat)"
  },
  "weaponDescription": "If character has a signature weapon: describe weapon type (sword, gun, staff, etc.), size, material, colors, engravings, glowing effects, and any unique features. If no weapon, leave empty string.",
  "identityHeader": {
    "face": "Face shape, cheekbones, chin, distinctive facial features",
    "eyes": "Eye color, shape, spacing, typical expression",
    "hair": "DETAILED: [length] [color] [type] hair worn [style] - e.g., 'long crimson wavy hair worn loose with side-swept bangs'",
    "skin": "Skin tone, any visible marks (scars, tattoos, moles)",
    "build": "Body type, height impression, posture",
    "signature": ["item1 always worn/visible", "emblem/logo if provided", "mask if worn", "item3 if any"]
  },
  "extractedColors": {
    "skin": "Primary skin tone, e.g. 'warm olive'",
    "hair": "Primary hair color, e.g. 'deep auburn'",
    "eyes": "Eye color, e.g. 'emerald green'",
    "outfit": ["primary outfit color 1", "primary outfit color 2"],
    "emblem": ["emblem color 1 if present"]
  },
  "hardNegatives": ["feature to never include based on what you see - e.g. if no glasses, add 'no glasses'"],
  "contrastFeatures": ["visual feature 1 that distinguishes this character in a group scene", "feature 2", "optional feature 3"]
}

For contrastFeatures, list 2-3 visual features that make this character visually distinct from other characters who might appear in the same scene (e.g., "only character with red outfit", "tallest character with distinctive silhouette", "unique glowing blue eyes", "only character wearing a mask").

For hardNegatives, analyze the image and add negatives for:
- If they have a specific hairstyle, add "no [opposite style]" (e.g., curly hair -> "no straight hair")
- If specific hair length, add "no [opposite length] hair" (e.g., long hair -> "no short hair")
- If specific hair color, add "no [other colors] hair"
- If they don't wear glasses, add "no glasses"
- If specific eye color, add "no [other colors] eyes"
- If clean-shaven, add "no beard", "no facial hair"
- If no bangs, add "no bangs"
- If NO MASK in reference, add "no mask", "no face covering"
- If character HAS a mask, add "must always wear [mask type]"
- If no helmet in reference, add "no helmet"
`;
    claudeContent.push(createTextContent(analysisPrompt));
    geminiContent.push({ text: analysisPrompt });

    // Try Claude first
    const claude = getClaude();
    if (claude) {
      try {
        console.log(`[Claude] Generating profile for ${persona.name}...`);
        const response = await claude.messages.create({
          model: MODEL_TEXT_NAME_CLAUDE,
          max_tokens: 2048,
          messages: [{ role: 'user', content: claudeContent }]
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
        const cleaned = extractJsonFromResponse(text);
        const parsed = JSON.parse(cleaned);
        console.log(`[Claude] Profile generated for ${persona.name}`);
        const profile = processProfileResponse(parsed, persona);

        // Log profile quality for debugging
        const profileQuality = validateProfileCompleteness(profile);
        console.log(`[Profile Quality] ${persona.name}:`, {
          score: profileQuality.score,
          missingFields: profileQuality.missingFields,
          hasIdentityHeader: !!profile.identityHeader,
          identityHeaderFields: {
            face: !!profile.identityHeader?.face,
            eyes: !!profile.identityHeader?.eyes,
            hair: !!profile.identityHeader?.hair,
            skin: !!profile.identityHeader?.skin,
            build: !!profile.identityHeader?.build
          },
          hardNegativesCount: profile.hardNegatives?.length || 0,
          warnings: profileQuality.warnings
        });

        useMetricsStore.getState().recordGeneration('profile', true, Date.now() - profileStartTime, 'claude',
          response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : undefined
        );
        generatingProfileIds.current.delete(persona.id);
        return profile;
      } catch (e) {
        console.warn(`[Claude] Failed for ${persona.name}, falling back to Gemini:`, e);
        onAnthropicError(e);
      }
    }

    // Gemini fallback
    try {
      console.log(`[Gemini] Generating profile for ${persona.name}...`);
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: MODEL_TEXT_NAME,
        contents: geminiContent,
      });
      const text = res.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      console.log(`[Gemini] Profile generated for ${persona.name}`);
      const profile = processProfileResponse(parsed, persona);

      // Log profile quality for debugging
      const profileQuality = validateProfileCompleteness(profile);
      console.log(`[Profile Quality] ${persona.name}:`, {
        score: profileQuality.score,
        missingFields: profileQuality.missingFields,
        hasIdentityHeader: !!profile.identityHeader,
        identityHeaderFields: {
          face: !!profile.identityHeader?.face,
          eyes: !!profile.identityHeader?.eyes,
          hair: !!profile.identityHeader?.hair,
          skin: !!profile.identityHeader?.skin,
          build: !!profile.identityHeader?.build
        },
        hardNegativesCount: profile.hardNegatives?.length || 0,
        warnings: profileQuality.warnings
      });

      useMetricsStore.getState().recordGeneration('profile', true, Date.now() - profileStartTime, 'gemini');
      generatingProfileIds.current.delete(persona.id);
      return profile;
    } catch (e) {
      console.warn('Failed to generate character profile for', persona.name, e);
      onAPIError(e);
      useMetricsStore.getState().recordGeneration('profile', false, Date.now() - profileStartTime, 'gemini');
      generatingProfileIds.current.delete(persona.id);
      return {
        id: persona.id,
        name: persona.name || 'Unknown',
        // Callers must not treat this blank as a real analysis.
        analysisFailed: true,
        faceDescription: '',
        bodyType: '',
        clothing: '',
        colorPalette: '',
        distinguishingFeatures: ''
      };
    }
  };

  /**
   * Generate profiles for all characters (hero, friend, additional characters).
   * Syncs results to the Zustand store.
   */
  const generateAllProfiles = async (): Promise<CharacterProfile[]> => {
    const personas: Persona[] = [];
    const hero = getHero();
    const friend = getFriend();
    const additionalChars = getAdditionalChars();

    if (hero) personas.push(hero);
    if (friend) personas.push(friend);
    personas.push(...additionalChars); // getAdditionalChars already drops blank cards

    const profiles: CharacterProfile[] = [];
    for (const p of personas) {
      profiles.push(await generateCharacterProfile(p));
    }

    // Sync all profiles to Zustand store
    useCharacterStore.getState().setAllProfiles(profiles);
    console.log('[Character Profiles Generated]', profiles);

    // Feature A: Compile and store character reference objects from persona + profile pairs.
    // These frozen references are read by useGenerateImage for every subsequent generation call.
    try {
      const refs = buildAllCharacterReferences(personas, profiles);
      useCharacterStore.getState().setAllReferences(refs);
      console.log('[Character References Compiled]', refs.length, 'references');
    } catch (e) {
      console.warn('[Character References] Failed to compile references:', e);
    }

    return profiles;
  };

  /**
   * Generate blank profiles for manual entry (when skipProfileAnalysis is enabled).
   */
  const generateBlankProfiles = (): CharacterProfile[] => {
    const personas: Persona[] = [];
    const hero = getHero();
    const friend = getFriend();
    const additionalChars = getAdditionalChars();

    if (hero) personas.push(hero);
    if (friend) personas.push(friend);
    personas.push(...additionalChars.filter(c => c.base64 || c.backstoryText));

    const profiles: CharacterProfile[] = personas.map(p => ({
      id: p.id,
      name: p.name || 'Unknown',
      faceDescription: '',
      bodyType: '',
      clothing: '',
      colorPalette: '',
      distinguishingFeatures: '',
    }));

    // Sync blank profiles to Zustand store
    useCharacterStore.getState().setAllProfiles(profiles);
    console.log('[Blank Profiles Generated]', profiles);
    return profiles;
  };

  return {
    generateCharacterProfile,
    generateAllProfiles,
    generateBlankProfiles,
  };
};

export default useGenerateProfile;
