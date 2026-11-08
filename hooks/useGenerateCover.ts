/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for generating comic cover variants.
 * Generates 4 cover style variants in parallel using Gemini image generation.
 */

import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Persona,
  StoryContext,
  CharacterProfile,
  formatIdentityHeader,
  formatConsistencyInstruction,
} from '../types';
import { detectImageMimeType } from '../claudeHelpers';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { COVER_STYLES, CoverStyle, formatCoverPrompt } from '../data/coverStyles';
import { IMAGE_MODEL } from '../config/models';

// ============================================================================
// CONSTANTS
// ============================================================================

const MODEL_IMAGE_GEN_NAME = IMAGE_MODEL;

/** Cover style types supported by this hook */
export type CoverStyleType = 'action' | 'portrait' | 'ensemble' | 'minimalist';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Represents a single cover variant with its generation state
 */
export interface CoverVariant {
  /** Unique identifier for this variant */
  id: string;
  /** The style used for this variant */
  style: CoverStyleType;
  /** Base64 data URL of the generated image */
  imageUrl: string;
  /** Whether this variant is currently being generated */
  isLoading: boolean;
  /** Error message if generation failed */
  error?: string;
}

/**
 * Options for cover generation
 */
export interface UseGenerateCoverOptions {
  /** Story context containing title, genre, art style, etc. */
  storyContext: StoryContext;
  /** AI-analyzed character profiles for consistency */
  profiles: CharacterProfile[];
  /** Main hero character */
  heroPersona: Persona;
  /** Optional co-star character */
  costarPersona?: Persona;
}

/**
 * Configuration for the useGenerateCover hook
 */
export interface GenerateCoverConfig {
  /** Get GoogleGenAI client */
  getAI: () => GoogleGenAI;
  /** Handle API errors */
  onAPIError: (e: unknown) => void;
}

/**
 * Return type for the useGenerateCover hook
 */
export interface UseGenerateCoverReturn {
  /** Array of cover variants with their states */
  variants: CoverVariant[];
  /** Whether any variant is currently being generated */
  isGenerating: boolean;
  /** Start generating all cover variants */
  generateVariants: (options: UseGenerateCoverOptions) => Promise<void>;
  /** Cancel ongoing generation */
  cancelGeneration: () => void;
  /** Select a variant as the chosen cover */
  selectVariant: (variantId: string) => void;
  /** The currently selected variant, if any */
  selectedVariant: CoverVariant | null;
  /** Reset all variants and selection */
  resetVariants: () => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates an inline image object for Gemini API
 */
function createInlineImage(base64Data: string) {
  return {
    inlineData: {
      mimeType: detectImageMimeType(base64Data),
      data: base64Data.includes(',') ? base64Data.split(',')[1] : base64Data,
    },
  };
}

/**
 * Get all reference images from a persona
 */
function getAllRefs(p: Persona): string[] {
  return p.referenceImages || (p.referenceImage ? [p.referenceImage] : []);
}

/**
 * Get emblem description for a persona
 */
function getEmblemDesc(p: Persona): { image: string; placement: string } | null {
  if (!p.emblemImage) return null;
  const placement =
    p.emblemPlacement === 'other'
      ? p.emblemPlacementCustom || 'custom location'
      : p.emblemPlacement?.replace('-', ' ') || 'visible';
  return { image: p.emblemImage, placement };
}

/**
 * Generate a unique ID for a cover variant
 */
function generateVariantId(style: CoverStyleType): string {
  return `cover-${style}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Initialize empty variants for all styles
 */
function initializeVariants(): CoverVariant[] {
  const styles: CoverStyleType[] = ['action', 'portrait', 'ensemble', 'minimalist'];
  return styles.map((style) => ({
    id: generateVariantId(style),
    style,
    imageUrl: '',
    isLoading: false,
    error: undefined,
  }));
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for generating cover variants in parallel.
 * Creates 4 different cover styles (action, portrait, ensemble, minimalist).
 */
export const useGenerateCover = (config: GenerateCoverConfig): UseGenerateCoverReturn => {
  const { getAI, onAPIError } = config;

  // State
  const [variants, setVariants] = useState<CoverVariant[]>(initializeVariants);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Cancellation ref
  const abortControllerRef = useRef<AbortController | null>(null);

  // Store getters (for use in async callbacks)
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters;

  /**
   * Build the prompt for a specific cover style
   */
  const buildCoverPrompt = useCallback(
    (
      coverStyle: CoverStyle,
      options: UseGenerateCoverOptions
    ): string => {
      const { storyContext, profiles } = options;
      const { selectedGenre, selectedLanguage } = useSettingsStore.getState();

      const styleEra = selectedGenre === 'Custom' ? 'Modern American' : selectedGenre;
      const artStyleTag = storyContext.artStyle ? `, ${storyContext.artStyle} style` : '';

      // Build character summary for the cover
      const buildCharacterSummary = (): string => {
        const summaries: string[] = [];
        profiles.forEach((profile) => {
          const ih = profile.identityHeader;
          if (ih) {
            const negatives = profile.hardNegatives?.length
              ? ` NEVER: ${profile.hardNegatives.slice(0, 3).join(', ')}`
              : '';
            summaries.push(
              `[${profile.name.toUpperCase()}]: ${ih.face}, ${ih.hair}, ${ih.skin}.${negatives}`
            );
          } else {
            summaries.push(
              `[${profile.name.toUpperCase()}]: ${profile.faceDescription || 'standard'}, ${profile.colorPalette || 'standard colors'}`
            );
          }
        });
        return summaries.length > 0
          ? `\n=== CRITICAL: CHARACTER IDENTITIES (MATCH EXACTLY) ===\n${summaries.join('\n')}\n===\n`
          : '';
      };

      let promptText = buildCharacterSummary();
      promptText += `[STRICT GENRE: ${selectedGenre}] [STRICT ART STYLE: ${storyContext.artStyle || 'Comic Book'}]\n`;
      promptText += `STYLE: ${styleEra} comic book art${artStyleTag}, detailed ink, vibrant colors.\n`;
      promptText += `STORY TITLE: "${storyContext.title || 'Untitled'}"\n`;
      promptText += `STORY DESCRIPTION: ${storyContext.descriptionText || 'An epic adventure'}\n`;
      promptText += `SERIES: "${storyContext.seriesTitle}" ISSUE #${storyContext.issueNumber || '1'}\n\n`;

      // Add cover style prompt
      promptText += formatCoverPrompt(coverStyle);
      promptText += '\n\n';

      // Cover-specific instructions
      if (storyContext.useOverlayLogo) {
        promptText += `IMPORTANT: LEAVE ROOM AT TOP FOR LOGO AND TITLE OVERLAY. DO NOT DRAW ANY LOGOS, TITLES, OR TEXT ON THE ARTWORK. We will add them digitally.\n`;
      } else {
        promptText += `SERIES TITLE: "${storyContext.seriesTitle.toUpperCase()}". Draw the title prominently on the cover.\n`;
        promptText += `PUBLISHER: "${storyContext.publisherName.toUpperCase()}"\n`;
      }

      // Character consistency directives
      promptText += `\n[CRITICAL CONSISTENCY DIRECTIVES - MUST FOLLOW]:
1. [FACE & IDENTITY] Copy EXACT facial features, hairstyle, body type from REFERENCE images. Characters MUST be instantly recognizable.
2. [ART STYLE] STRICT ${styleEra} comic book art${artStyleTag}, ${selectedGenre} genre. Every pixel must match this style.
3. [EMBLEM/LOGO] If character has emblem reference, draw it EXACTLY at specified placement.
4. [CLOTHING] Copy costume/outfit EXACTLY from references - this is their SIGNATURE LOOK.\n`;

      // Identity blocks (Layer 2)
      if (profiles.length > 0) {
        promptText += '\n--- CHARACTER IDENTITY BLOCKS ---\n';
        profiles.forEach((cp) => {
          promptText += formatIdentityHeader(cp) + '\n\n';
        });
        promptText += '--- END CHARACTER IDENTITY BLOCKS ---\n';

        // Consistency requirements (Layer 4)
        promptText += '\n--- CONSISTENCY REQUIREMENTS ---\n';
        profiles.forEach((cp) => {
          promptText += formatConsistencyInstruction(cp, storyContext.artStyle || 'Comic Book') + '\n\n';
        });
        promptText += '--- END CONSISTENCY REQUIREMENTS ---\n';
      }

      promptText += `\n[FINAL VISUAL ANCHOR]: THIS IS A ${selectedGenre.toUpperCase()} COMIC COVER IN ${storyContext.artStyle.toUpperCase()} STYLE. CREATE A STRIKING, PROFESSIONAL COVER.`;

      return promptText;
    },
    []
  );

  /**
   * Build content array with character references for Gemini API
   */
  const buildContents = useCallback(
    (
      promptText: string,
      options: UseGenerateCoverOptions
    ): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> => {
      const { heroPersona, costarPersona, profiles, storyContext } = options;
      const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      const additionalChars = getAdditionalChars();

      // Helper to get inline identity from profile
      const getInlineIdentity = (name: string): string => {
        const profile = profiles.find((cp) => cp.name === name);
        if (profile) {
          const ih = profile.identityHeader;
          if (ih) {
            return `[${profile.name.toUpperCase()} IDENTITY: ${ih.face}, ${ih.skin}, ${ih.hair}, ${ih.build}]`;
          }
          const hairInfo = profile.hairDetails
            ? `${profile.hairDetails.style} ${profile.hairDetails.color} hair`
            : 'styled hair';
          return `[${profile.name.toUpperCase()} IDENTITY: ${profile.faceDescription || 'standard face'}, ${hairInfo}, ${profile.distinguishingFeatures || 'no notable features'}]`;
        }
        return '';
      };

      // Push prompt text first
      contents.push({ text: promptText });

      // Push character references
      contents.push({ text: '\n=== CHARACTER VISUAL REFERENCES (Match these EXACTLY) ===' });

      // Hero references
      if (heroPersona.base64) {
        const heroIdentity = getInlineIdentity(heroPersona.name);
        contents.push({
          text: `\n[PRIORITY: HIGH] ${heroPersona.name.toUpperCase()} PORTRAIT - COPY THIS FACE EXACTLY:\n${heroIdentity}`,
        });
        contents.push(createInlineImage(heroPersona.base64));

        getAllRefs(heroPersona).forEach((ref, i) => {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${heroPersona.name.toUpperCase()} COSTUME REF ${i + 1}:`,
          });
          contents.push(createInlineImage(ref));
        });

        const heroEmblem = getEmblemDesc(heroPersona);
        if (heroEmblem) {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${heroPersona.name.toUpperCase()} EMBLEM (place on ${heroEmblem.placement}):`,
          });
          contents.push(createInlineImage(heroEmblem.image));
        }
      }

      // Co-star references
      if (costarPersona?.base64) {
        const costarIdentity = getInlineIdentity(costarPersona.name);
        contents.push({
          text: `\n[PRIORITY: HIGH] ${costarPersona.name.toUpperCase()} PORTRAIT - COPY THIS FACE EXACTLY:\n${costarIdentity}`,
        });
        contents.push(createInlineImage(costarPersona.base64));

        getAllRefs(costarPersona).forEach((ref, i) => {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${costarPersona.name.toUpperCase()} COSTUME REF ${i + 1}:`,
          });
          contents.push(createInlineImage(ref));
        });

        const costarEmblem = getEmblemDesc(costarPersona);
        if (costarEmblem) {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${costarPersona.name.toUpperCase()} EMBLEM (place on ${costarEmblem.placement}):`,
          });
          contents.push(createInlineImage(costarEmblem.image));
        }
      }

      // Additional characters references
      additionalChars.forEach((c) => {
        if (c.base64) {
          const charIdentity = getInlineIdentity(c.name);
          contents.push({
            text: `\n[PRIORITY: HIGH] ${c.name.toUpperCase()} PORTRAIT - COPY THIS FACE EXACTLY:\n${charIdentity}`,
          });
          contents.push(createInlineImage(c.base64));
        }
        getAllRefs(c).forEach((ref, ri) => {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${c.name.toUpperCase()} COSTUME REF ${ri + 1}:`,
          });
          contents.push(createInlineImage(ref));
        });
        const charEmblem = getEmblemDesc(c);
        if (charEmblem) {
          contents.push({
            text: `[PRIORITY: MEDIUM] ${c.name.toUpperCase()} EMBLEM (place on ${charEmblem.placement}):`,
          });
          contents.push(createInlineImage(charEmblem.image));
        }
      });

      // Publisher logo if available and not using overlay
      if (storyContext.publisherLogo && !storyContext.useOverlayLogo) {
        contents.push({ text: '\nPUBLISHER LOGO REFERENCE:' });
        contents.push(createInlineImage(storyContext.publisherLogo));
      }

      return contents;
    },
    []
  );

  /**
   * Generate a single cover variant
   */
  const generateSingleVariant = useCallback(
    async (
      style: CoverStyleType,
      options: UseGenerateCoverOptions,
      abortSignal: AbortSignal
    ): Promise<{ imageUrl: string; error?: string }> => {
      const startTime = Date.now();
      console.log(`[generateCover] Starting variant: ${style}`);

      // Find the cover style configuration
      const coverStyle = COVER_STYLES.find((s) => s.id === style);
      if (!coverStyle) {
        return { imageUrl: '', error: `Unknown cover style: ${style}` };
      }

      try {
        // Check for cancellation
        if (abortSignal.aborted) {
          return { imageUrl: '', error: 'Generation cancelled' };
        }

        // Build the prompt and contents
        const promptText = buildCoverPrompt(coverStyle, options);
        const contents = buildContents(promptText, options);

        // Log contents summary
        const imageCount = contents.filter((c) => 'inlineData' in c).length;
        const textCount = contents.filter((c) => 'text' in c).length;
        console.log(
          `[generateCover:${style}] Preparing API call - Images: ${imageCount}, Text blocks: ${textCount}, Prompt length: ${promptText.length} chars`
        );

        // Check for cancellation again before API call
        if (abortSignal.aborted) {
          return { imageUrl: '', error: 'Generation cancelled' };
        }

        const ai = getAI();
        const apiStartTime = Date.now();

        const res = await ai.models.generateContent({
          model: MODEL_IMAGE_GEN_NAME,
          contents: contents,
          config: { imageConfig: { aspectRatio: '2:3' } },
        });

        const apiDuration = Date.now() - apiStartTime;
        const totalDuration = Date.now() - startTime;

        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
        const imageUrl = part?.inlineData?.data
          ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
          : '';

        console.log(
          `[generateCover:${style}] Complete - API: ${apiDuration}ms, Total: ${totalDuration}ms, Success: ${imageUrl ? 'Yes' : 'No (empty)'}`
        );

        if (!imageUrl) {
          const candidate = res.candidates?.[0];
          console.warn(`[generateCover:${style}] Empty image response:`, {
            candidateCount: res.candidates?.length ?? 0,
            finishReason: candidate?.finishReason,
            safetyRatings: candidate?.safetyRatings,
          });
          return { imageUrl: '', error: 'No image generated' };
        }

        return { imageUrl };
      } catch (e) {
        const totalDuration = Date.now() - startTime;
        console.error(`[generateCover:${style}] FAILED after ${totalDuration}ms:`, e);
        onAPIError(e);
        return {
          imageUrl: '',
          error: e instanceof Error ? e.message : 'Generation failed',
        };
      }
    },
    [buildCoverPrompt, buildContents, getAI, onAPIError]
  );

  /**
   * Generate all 4 cover variants in parallel
   */
  const generateVariants = useCallback(
    async (options: UseGenerateCoverOptions): Promise<void> => {
      // Cancel any existing generation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;

      setIsGenerating(true);
      setSelectedVariantId(null);

      // Initialize all variants to loading state
      const styles: CoverStyleType[] = ['action', 'portrait', 'ensemble', 'minimalist'];
      const initialVariants: CoverVariant[] = styles.map((style) => ({
        id: generateVariantId(style),
        style,
        imageUrl: '',
        isLoading: true,
        error: undefined,
      }));
      setVariants(initialVariants);

      console.log('[generateCover] Starting parallel generation of 4 cover variants...');

      // Generate all variants in parallel
      const results = await Promise.all(
        initialVariants.map(async (variant) => {
          const result = await generateSingleVariant(variant.style, options, abortSignal);
          return {
            ...variant,
            imageUrl: result.imageUrl,
            isLoading: false,
            error: result.error,
          };
        })
      );

      // Update state with results (unless cancelled)
      if (!abortSignal.aborted) {
        setVariants(results);
        console.log('[generateCover] All variants generated:', {
          success: results.filter((v) => v.imageUrl).length,
          failed: results.filter((v) => v.error).length,
        });
      }

      setIsGenerating(false);
    },
    [generateSingleVariant]
  );

  /**
   * Cancel ongoing generation
   */
  const cancelGeneration = useCallback((): void => {
    console.log('[generateCover] Cancelling generation...');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Update all loading variants to cancelled state
    setVariants((prev) =>
      prev.map((v) =>
        v.isLoading ? { ...v, isLoading: false, error: 'Generation cancelled' } : v
      )
    );
    setIsGenerating(false);
  }, []);

  /**
   * Select a variant as the chosen cover
   */
  const selectVariant = useCallback((variantId: string): void => {
    setSelectedVariantId(variantId);
  }, []);

  /**
   * Get the currently selected variant
   */
  const selectedVariant = variants.find((v) => v.id === selectedVariantId) || null;

  /**
   * Reset all variants and selection
   */
  const resetVariants = useCallback((): void => {
    cancelGeneration();
    setVariants(initializeVariants());
    setSelectedVariantId(null);
  }, [cancelGeneration]);

  return {
    variants,
    isGenerating,
    generateVariants,
    cancelGeneration,
    selectVariant,
    selectedVariant,
    resetVariants,
  };
};

export default useGenerateCover;
