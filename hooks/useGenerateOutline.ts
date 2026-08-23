/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for generating story outlines.
 * Extracted from App.tsx as part of Batch 2.2 decomposition.
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import {
  StoryOutline,
  StoryContext,
  PageCharacterPlan,
  PanelLayout,
  ShotType,
  TransitionType,
  EmotionalBeat,
  PacingIntent,
  LANGUAGES,
  getComicConfig,
} from '../types';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMetricsStore } from '../stores/useMetricsStore';

// ============================================================================
// TYPES
// ============================================================================

/** Configuration for the useGenerateOutline hook */
export interface GenerateOutlineConfig {
  /** Get GoogleGenAI client */
  getAI: () => GoogleGenAI;
  /** Get Anthropic client (returns null if not configured) */
  getClaude: () => Anthropic | null;
  /** Handle Gemini API errors */
  onAPIError: (e: unknown) => void;
  /** Handle Anthropic API errors */
  onAnthropicError: (e: unknown) => void;
}

/** Parameters for the generateOutline function */
export interface GenerateOutlineParams {
  /** Story context (title, description, art style, etc.) */
  storyContext: StoryContext;
  /** Extra pages to add beyond base count */
  extraPages: number;
  /** Optional user notes to guide the outline */
  userNotes?: string;
}

/** Result from outline generation */
export interface GenerateOutlineResult {
  /** Generated outline text content */
  content: string;
  /** Parsed page breakdown with comic fundamentals */
  pageBreakdown?: PageCharacterPlan[];
  /** Whether the outline was successfully enhanced with page breakdown */
  isEnhanced: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MODEL_TEXT_NAME = "gemini-2.5-pro";
const MODEL_TEXT_NAME_CLAUDE = "claude-sonnet-4-5-20250929";

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides outline generation functionality.
 * Reads character and settings data from Zustand stores.
 */
export const useGenerateOutline = (config: GenerateOutlineConfig) => {
  const { getAI, getClaude, onAPIError, onAnthropicError } = config;

  // Store getters (for use in async callbacks)
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters;

  /**
   * Parse enhanced outline text into structured PageCharacterPlan array.
   * Uses multiple fallback strategies for robustness.
   */
  const parseEnhancedOutline = (
    text: string,
    comicConfig: ReturnType<typeof getComicConfig>
  ): PageCharacterPlan[] => {
    const expectedPages = comicConfig.TOTAL_PAGES;
    let plans: PageCharacterPlan[] = [];

    // ===== HELPER FUNCTIONS =====

    // Map character name to internal ID
    const mapCharacterNameToId = (name: string): string => {
      const normalized = name.trim().toLowerCase();
      if (!normalized || normalized === 'none') return '';

      // Check hero
      if (normalized.includes('hero') || normalized === getHero()?.name?.toLowerCase()) {
        return 'hero';
      }
      // Check co-star/friend
      if (normalized.includes('co-star') || normalized.includes('sidekick') ||
          normalized.includes('friend') || normalized === getFriend()?.name?.toLowerCase()) {
        return 'friend';
      }
      // Check additional characters
      const found = getAdditionalChars().find(c =>
        c.name.toLowerCase() === normalized || c.name.toLowerCase().includes(normalized)
      );
      if (found) return found.id;

      // Fallback: return hero if unrecognized
      console.warn(`[parseEnhancedOutline] Unknown character "${name}", defaulting to hero`);
      return 'hero';
    };

    // Extract field value with flexible matching
    const extractField = (block: string, fieldName: string): string => {
      // Try multiple patterns: "- Field: value", "Field: value", "**Field:** value"
      const patterns = [
        new RegExp(`-\\s*${fieldName}:\\s*(.+?)(?=\\n-|\\n\\*\\*|$)`, 'i'),
        new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+?)(?=\\n|$)`, 'i'),
        new RegExp(`${fieldName}:\\s*(.+?)(?=\\n|$)`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = block.match(pattern);
        if (match && match[1]) return match[1].trim();
      }
      return '';
    };

    // Parse enum value with fuzzy matching
    const parseEnumValue = <T extends string>(
      value: string,
      validValues: T[],
      defaultValue: T
    ): T => {
      const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      // Exact match
      if (validValues.includes(normalized as T)) return normalized as T;
      // Partial match
      for (const valid of validValues) {
        if (normalized.includes(valid) || valid.includes(normalized)) return valid;
      }
      return defaultValue;
    };

    // Generate default plan for a page
    const generateDefaultPlan = (pageIndex: number): PageCharacterPlan => ({
      pageIndex,
      primaryCharacters: ['hero'],
      focusCharacter: 'hero',
      sceneDescription: `Page ${pageIndex} scene`,
      isDecisionPage: comicConfig.DECISION_PAGES.includes(pageIndex),
      panelLayout: pageIndex === 1 ? 'splash' : 'grid-2x3',
      suggestedShot: 'medium',
      transitionType: 'action-to-action',
      emotionalBeat: 'action',
      pacingIntent: 'medium',
      isFlashback: false
    });

    // Parse a single page block into PageCharacterPlan
    const parsePageBlock = (block: string, pageNum: number): PageCharacterPlan => {
      const validLayouts: PanelLayout[] = ['splash', 'horizontal-split', 'vertical-split', 'grid-2x2', 'grid-2x3', 'grid-3x3', 'asymmetric'];
      const validShots: ShotType[] = ['extreme-close-up', 'close-up', 'medium', 'full', 'wide', 'extreme-wide'];
      const validTransitions: TransitionType[] = ['moment-to-moment', 'action-to-action', 'subject-to-subject', 'scene-to-scene', 'aspect-to-aspect', 'non-sequitur'];
      const validBeats: EmotionalBeat[] = ['establishing', 'action', 'dialogue', 'reaction', 'climax', 'transition', 'reveal'];

      // Extract characters
      const charsStr = extractField(block, 'Characters');
      const charNames = charsStr.split(/[,&]/).map(c => c.trim()).filter(Boolean);
      const primaryCharacters = charNames.map(mapCharacterNameToId).filter(Boolean);

      // Extract focus
      const focusStr = extractField(block, 'Focus');
      const focusCharacter = focusStr ? mapCharacterNameToId(focusStr) : 'hero';

      // Extract scene
      const sceneDescription = extractField(block, 'Scene') || `Page ${pageNum} action scene`;

      // Extract and parse enums
      const panelLayout = parseEnumValue(extractField(block, 'Layout'), validLayouts, pageNum === 1 ? 'splash' : 'grid-2x3');
      const suggestedShot = parseEnumValue(extractField(block, 'Shot'), validShots, 'medium');
      const transitionType = parseEnumValue(extractField(block, 'Transition'), validTransitions, 'action-to-action');
      const emotionalBeat = parseEnumValue(extractField(block, 'Beat'), validBeats, 'action');
      const pacingIntent = parseEnumValue<PacingIntent>(extractField(block, 'Pacing'), ['slow', 'medium', 'fast'], 'medium');

      // Extract flashback
      const flashbackStr = extractField(block, 'Flashback').toLowerCase();
      const isFlashback = flashbackStr === 'yes' || flashbackStr === 'true';

      const plan: PageCharacterPlan = {
        pageIndex: pageNum,
        primaryCharacters: primaryCharacters.length > 0 ? primaryCharacters : ['hero'],
        focusCharacter: focusCharacter || 'hero',
        sceneDescription,
        isDecisionPage: comicConfig.DECISION_PAGES.includes(pageNum),
        panelLayout,
        suggestedShot,
        transitionType,
        emotionalBeat,
        pacingIntent,
        isFlashback
      };

      const locationMatch = plan.sceneDescription?.match(
        /\b(?:in|at|on|near|inside|outside|within|atop|beneath|above|below)\b.{0,60}/i
      );
      if (locationMatch) plan.location = locationMatch[0].trim();

      return plan;
    };

    // ===== STRATEGY 1: Strict format (original regex) =====
    const strictRegex = /PAGE\s*(\d+):\s*\n-\s*Characters:\s*(.+)\n-\s*Focus:\s*(.+)\n-\s*Scene:\s*(.+)\n-\s*Layout:\s*(.+)\n-\s*Shot:\s*(.+)\n-\s*Transition:\s*(.+)\n-\s*Beat:\s*(.+)\n-\s*Pacing:\s*(.+)\n-\s*Flashback:\s*(.+)/gi;

    let match;
    while ((match = strictRegex.exec(text)) !== null) {
      const pageIndex = parseInt(match[1]);
      const charNames = match[2].split(',').map(c => c.trim());
      const primaryCharacters = charNames.map(mapCharacterNameToId).filter(Boolean);
      const focusCharacter = mapCharacterNameToId(match[3]) || 'hero';

      const validLayouts: PanelLayout[] = ['splash', 'horizontal-split', 'vertical-split', 'grid-2x2', 'grid-2x3', 'grid-3x3', 'asymmetric'];
      const validShots: ShotType[] = ['extreme-close-up', 'close-up', 'medium', 'full', 'wide', 'extreme-wide'];
      const validTransitions: TransitionType[] = ['moment-to-moment', 'action-to-action', 'subject-to-subject', 'scene-to-scene', 'aspect-to-aspect', 'non-sequitur'];
      const validBeats: EmotionalBeat[] = ['establishing', 'action', 'dialogue', 'reaction', 'climax', 'transition', 'reveal'];

      plans.push({
        pageIndex,
        primaryCharacters: primaryCharacters.length > 0 ? primaryCharacters : ['hero'],
        focusCharacter,
        sceneDescription: match[4].trim(),
        isDecisionPage: comicConfig.DECISION_PAGES.includes(pageIndex),
        panelLayout: parseEnumValue(match[5], validLayouts, 'grid-2x3'),
        suggestedShot: parseEnumValue(match[6], validShots, 'medium'),
        transitionType: parseEnumValue(match[7], validTransitions, 'action-to-action'),
        emotionalBeat: parseEnumValue(match[8], validBeats, 'action'),
        pacingIntent: parseEnumValue<PacingIntent>(match[9], ['slow', 'medium', 'fast'], 'medium'),
        isFlashback: match[10].trim().toLowerCase() === 'yes'
      });
    }

    if (plans.length > 0) {
      console.log(`[parseEnhancedOutline] Strategy 1 (strict): Found ${plans.length} pages`);
    }

    // ===== STRATEGY 2: Flexible block-based parsing =====
    if (plans.length < expectedPages) {
      console.log('[parseEnhancedOutline] Strategy 1 incomplete, trying flexible parsing...');

      // Split by PAGE headers
      const pageBlocks = text.split(/(?=PAGE\s*\d+)/i).filter(b => b.trim());

      for (const block of pageBlocks) {
        const pageMatch = block.match(/PAGE\s*(\d+)/i);
        if (!pageMatch) continue;

        const pageNum = parseInt(pageMatch[1]);
        // Skip if already parsed
        if (plans.some(p => p.pageIndex === pageNum)) continue;

        const plan = parsePageBlock(block, pageNum);
        plans.push(plan);
      }

      if (plans.length > 0) {
        console.log(`[parseEnhancedOutline] Strategy 2 (flexible): Now have ${plans.length} pages`);
      }
    }

    // ===== STRATEGY 3: Simple numbered page detection =====
    if (plans.length < expectedPages) {
      console.log('[parseEnhancedOutline] Still incomplete, trying simple detection...');

      // Try to find any numbered sections
      const simpleMatches = text.matchAll(/(?:^|\n)(?:PAGE\s*)?(\d+)[.):]\s*(.+?)(?=\n(?:PAGE\s*)?\d+[.):]\s|\n*$)/gis);

      for (const simpleMatch of simpleMatches) {
        const pageNum = parseInt(simpleMatch[1]);
        if (pageNum < 1 || pageNum > expectedPages) continue;
        if (plans.some(p => p.pageIndex === pageNum)) continue;

        const content = simpleMatch[2].trim();
        const plan = generateDefaultPlan(pageNum);
        plan.sceneDescription = content.substring(0, 200); // Use content as scene description
        plans.push(plan);
      }

      console.log(`[parseEnhancedOutline] Strategy 3 (simple): Now have ${plans.length} pages`);
    }

    // ===== VALIDATION & FILL MISSING =====
    const parsedPageNums = new Set(plans.map(p => p.pageIndex));
    const missingPages: number[] = [];

    for (let i = 1; i <= expectedPages; i++) {
      if (!parsedPageNums.has(i)) {
        missingPages.push(i);
        plans.push(generateDefaultPlan(i));
      }
    }

    if (missingPages.length > 0) {
      console.warn(`[parseEnhancedOutline] Missing pages filled with defaults: ${missingPages.join(', ')}`);
    }

    // Sort by page index and remove duplicates
    plans.sort((a, b) => a.pageIndex - b.pageIndex);
    const uniquePlans = plans.filter((plan, idx, arr) =>
      idx === 0 || plan.pageIndex !== arr[idx - 1].pageIndex
    );

    console.log(`[parseEnhancedOutline] Final result: ${uniquePlans.length} pages for ${expectedPages} expected`);
    return uniquePlans;
  };

  /**
   * Generate a story outline with comic fundamentals.
   * Uses Claude as primary, falls back to Gemini.
   */
  const generateOutline = async (params: GenerateOutlineParams): Promise<GenerateOutlineResult> => {
    const outlineStartTime = Date.now();
    const { storyContext, extraPages, userNotes } = params;

    // Read settings from store
    const settingsState = useSettingsStore.getState();
    const { selectedGenre, selectedLanguage, selectedPageLength } = settingsState;

    const comicConfig = getComicConfig(selectedPageLength, extraPages);
    const langName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || "English";

    // Build character names list for the prompt
    const characterNames: string[] = [];
    if (getHero()?.name) characterNames.push(getHero()!.name);
    if (getFriend()?.name) characterNames.push(getFriend()!.name);
    getAdditionalChars().forEach(c => { if (c.name) characterNames.push(c.name); });

    const charContext = [
      `HERO: ${getHero()?.name || 'Main Hero'}. Backstory: ${getHero()?.backstoryText || 'Unknown'}.`,
      getFriend() ? `CO-STAR: ${getFriend()!.name || 'Sidekick'}. Backstory: ${getFriend()!.backstoryText || 'Unknown'}.` : null,
      ...getAdditionalChars().map(c => `${c.name}: ${c.backstoryText || 'Unknown'}.`)
    ].filter(Boolean).join('\n');

    // GAP-18: Inject compact visual summaries so outline scene descriptions are visually accurate.
    // Prevents AI-written scenes from contradicting character reference images.
    const profiles = useCharacterStore.getState().getProfilesArray();
    const buildOutlineVisualSummary = (): string => {
      const lines: string[] = [];
      const hero = getHero();
      const friend = getFriend();
      const additionalChars = getAdditionalChars();

      const addSummaryLine = (persona: typeof hero, roleLabel: string) => {
        if (!persona) return;
        const profile = profiles.find(p => p.id === persona.id || p.name === persona.name);
        if (!profile?.identityHeader) return;
        const ih = profile.identityHeader;
        const hairDesc = ih.hair || '';
        const outfitDesc = profile.clothing ? profile.clothing.slice(0, 60) : '';
        const nevers = profile.hardNegatives?.slice(0, 3).join(', ') || '';
        const parts = [hairDesc, outfitDesc].filter(Boolean);
        if (parts.length === 0) return;
        lines.push(`• ${roleLabel}: ${parts.join(', ')}${nevers ? `. NEVER describe as: ${nevers}` : ''}`);
      };

      addSummaryLine(hero, `HERO [${hero?.name || 'Hero'}]`);
      addSummaryLine(friend, `CO-STAR [${friend?.name || 'Co-Star'}]`);
      additionalChars.forEach(c => addSummaryLine(c, `[${c.name}]`));

      return lines.length > 0
        ? `\nVISUAL REFERENCE (for scene writing accuracy):\n${lines.join('\n')}`
        : '';
    };
    const visualRefBlock = buildOutlineVisualSummary();

    // Enhanced outline prompt with comic fundamentals
    const prompt = `
SCENE DESCRIPTION LIMITS: every page you plan must be drawable by an image model with a strict safety policy. Imply violence through aftermath, reaction, and framing. No blood, gore, wounds, corpses, nudity, sexual content, self-harm, or harm to children. No real public figures, brands, or logos. Stakes stay high; the camera looks elsewhere.

You are a professional comic book writer planning a ${comicConfig.MAX_STORY_PAGES}-page story.

STORY TITLE: ${storyContext.title}
GENRE: ${selectedGenre}
LANGUAGE: ${langName}
ART STYLE: ${storyContext.artStyle}
CHARACTERS: ${characterNames.join(', ')}
${charContext}${visualRefBlock}
STORY DESCRIPTION: ${storyContext.descriptionText}
${userNotes ? `USER NOTES: ${userNotes}` : ''}

For EACH page, provide the following structured breakdown:

PAGE [N]:
- Characters: [who appears, comma-separated]
- Focus: [primary character name]
- Scene: [1-2 sentence visual description]
- Layout: [splash|horizontal-split|vertical-split|grid-2x2|grid-2x3|grid-3x3|asymmetric]
- Shot: [extreme-close-up|close-up|medium|full|wide|extreme-wide]
- Transition: [moment-to-moment|action-to-action|subject-to-subject|scene-to-scene|aspect-to-aspect]
- Beat: [establishing|action|dialogue|reaction|climax|transition|reveal]
- Pacing: [slow|medium|fast]
- Flashback: [yes|no]

=== COMIC LAYOUT GUIDELINES ===
- Use "splash" for: character introductions, major reveals, climaxes (MAX 2-3 per issue)
- Use "grid-2x3" for: dialogue scenes, standard narrative (MOST COMMON - 60%+)
- Use "grid-3x3" for: building tension, dense information
- Use "asymmetric" for: action sequences, dynamic moments (small-small-small-LARGE pattern)
- Use "horizontal-split" for: panoramic environments, cause-and-effect
- Use "vertical-split" for: simultaneous events, character comparisons

=== SHOT TYPE GUIDELINES ===
- extreme-close-up: Eyes/detail only, maximum emotional impact
- close-up: Face fills frame, emotion focus
- medium: Waist-up, balance of character and context (MOST COMMON)
- full: Full body visible, body language emphasis
- wide: Environment prominent with characters
- extreme-wide: Establishing shots, vast environments

=== TRANSITION GUIDELINES (McCloud's Types) ===
- action-to-action: Physical action progression (~65% of panels - MOST COMMON)
- subject-to-subject: Same scene, different subject - dialogue/reactions (~20%)
- scene-to-scene: Time/location jump - "Meanwhile..." or "Later..." (~10%)
- moment-to-moment: Slow-motion emphasis - dramatic pauses (rare)
- aspect-to-aspect: Mood/atmosphere - environmental poetry (rare)

=== PACING RHYTHM ===
- Pages 1-2: SLOW (establishing, setting the scene)
- Pages 3-5: MEDIUM (rising action, character dynamics)
- Pages 6-7: FAST (complication, tension building)
- Page 8-9: SLOW->FAST (climax build)
- Page ${comicConfig.MAX_STORY_PAGES}: SLOW (resolution/cliffhanger)

=== CRITICAL RULES ===
1. DO NOT REPEAT poses, locations, or camera angles between consecutive pages
2. VARY layouts - don't use the same layout more than 3 times in a row
3. SHOW character development through interactions
4. Decision pages (${comicConfig.DECISION_PAGES.join(', ')}) should use dramatic layouts (splash or asymmetric)

OUTPUT: Structured text EXACTLY as shown above for each page.
`;

    // Try Claude first
    const claude = getClaude();
    if (claude) {
      try {
        console.log('[Claude] Generating story outline...');
        const response = await claude.messages.create({
          model: MODEL_TEXT_NAME_CLAUDE,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        });
        const outlineText = response.content[0].type === 'text' ? response.content[0].text : '';
        console.log('[Claude] Outline generated');

        const pageBreakdown = parseEnhancedOutline(outlineText, comicConfig);
        useMetricsStore.getState().recordGeneration('outline', true, Date.now() - outlineStartTime, 'claude',
          response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : undefined
        );
        return {
          content: outlineText,
          pageBreakdown: pageBreakdown.length > 0 ? pageBreakdown : undefined,
          isEnhanced: pageBreakdown.length > 0
        };
      } catch (e) {
        console.warn('[Claude] Outline generation failed, falling back to Gemini:', e);
        onAnthropicError(e);
      }
    }

    // Gemini fallback
    try {
      console.log('[Gemini] Generating story outline...');
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: MODEL_TEXT_NAME,
        contents: { text: prompt }
      });
      const outlineText = res.text || "";
      console.log('[Gemini] Outline generated');

      const pageBreakdown = parseEnhancedOutline(outlineText, comicConfig);
      useMetricsStore.getState().recordGeneration('outline', true, Date.now() - outlineStartTime, 'gemini');
      return {
        content: outlineText,
        pageBreakdown: pageBreakdown.length > 0 ? pageBreakdown : undefined,
        isEnhanced: pageBreakdown.length > 0
      };
    } catch (e) {
      console.error("Outline generation failed", e);
      onAPIError(e);
      useMetricsStore.getState().recordGeneration('outline', false, Date.now() - outlineStartTime, 'gemini');
      return {
        content: '',
        pageBreakdown: undefined,
        isEnhanced: false
      };
    }
  };

  return { generateOutline, parseEnhancedOutline };
};

export default useGenerateOutline;
