/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for generating narrative beats for comic pages.
 * Extracted from App.tsx as part of Batch 2.2 decomposition.
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import {
  ArtDirection,
  Beat,
  ComicFace,
  Persona,
  StoryContext,
  StoryOutline,
  EmotionalBeat,
  PacingIntent,
  LANGUAGES,
  getComicConfig,
  getLayoutInstructions,
  getShotInstructions,
  getTransitionContext,
  isCastMember,
} from '../types';
import { createTextContent, createImageContent, extractJsonFromResponse, getTextFromClaudeResponse, ClaudeContentBlock } from '../claudeHelpers';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMetricsStore } from '../stores/useMetricsStore';
import { formatStoryDriver, resolveTone, getArcGuidance, getFinalePageInstruction, formatAttachedText, isImageFile } from '../utils/storyBrief';
import { softenScene, looksRisky } from '../utils/sceneSafety';
import { CLAUDE_TEXT_MODEL, GEMINI_TEXT_MODEL } from '../config/models';

// ============================================================================
// TYPES
// ============================================================================

/** Configuration for the useGenerateBeat hook */
export interface GenerateBeatConfig {
  /** Get GoogleGenAI client */
  getAI: () => GoogleGenAI;
  /** Get Anthropic client (returns null if not configured) */
  getClaude: () => Anthropic | null;
  /** Handle Gemini API errors */
  onAPIError: (e: unknown) => void;
  /** Handle Anthropic API errors */
  onAnthropicError: (e: unknown) => void;
}

/** Parameters for the generateBeat function */
export interface GenerateBeatParams {
  /** Previous comic pages for context */
  history: ComicFace[];
  /** Whether this is a right-side page (affects layout) */
  isRightPage: boolean;
  /** Current page number (1-indexed) */
  pageNum: number;
  /** Whether this page should present choices to the user */
  isDecisionPage: boolean;
  /** Optional user instruction for reroll */
  instruction?: string;
  /** Previous choices the user rejected (for variety) */
  previousChoices?: string[];
  /** Story context (title, description, files) */
  storyContext: StoryContext;
  /** Story outline state */
  storyOutline: StoryOutline;
  /** Whether rich/novel mode is enabled */
  richMode: boolean;
  /** Extra pages added to story */
  extraPages: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MODEL_TEXT_NAME = GEMINI_TEXT_MODEL;
const MODEL_TEXT_NAME_CLAUDE = CLAUDE_TEXT_MODEL;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Builds a rolling story summary from recent story pages for narrative continuity.
 * Injects into beat prompts so the AI maintains coherent story context.
 */
const buildStorySummary = (history: ComicFace[], maxPages = 3): string => {
  const recent = history
    .filter(f => f.narrative && f.type === 'story')
    .slice(-maxPages);
  if (recent.length === 0) return '';
  const lines = recent.map((f) => {
    const scene = f.narrative?.scene ?? '';
    const caption = f.narrative?.caption ?? '';
    return `Page ${f.pageIndex}: ${scene}${caption ? ` — "${caption}"` : ''}`;
  });
  return `Story so far:\n${lines.join('\n')}\n`;
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides beat generation functionality.
 * Reads character and settings data from Zustand stores.
 */
export const useGenerateBeat = (config: GenerateBeatConfig) => {
  const { getAI, getClaude, onAPIError, onAnthropicError } = config;

  // Store getters (for use in async callbacks)
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters.filter(isCastMember);

  // Helper to get role label
  const getRoleLabel = (p: Persona): string => {
    if (!p.role) return '';
    if (p.role === 'Family/Friend' || p.role === 'Custom') return p.customRole || p.role;
    return p.role;
  };

  /**
   * Coerce the model's `art` object into a valid ArtDirection.
   * Returns undefined when the model omitted it or gave us nothing usable —
   * callers fall back to the prose `scene` field.
   */
  const cleanArtDirection = (raw: unknown, sceneFallback: string): ArtDirection | undefined => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const o = raw as Record<string, unknown>;

    const str = (v: unknown): string =>
      typeof v === 'string' ? v.trim()
        : Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ').trim()
        : '';
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim())
        : typeof v === 'string' && v.trim() ? [v.trim()]
        : [];

    const action = str(o.action);
    const environment = str(o.environment);

    // Both empty means the model gave us nothing better than the prose scene.
    if (!action && !environment) return undefined;

    return {
      characters_present: strArr(o.characters_present),
      subject: str(o.subject) || 'the hero',
      action: action || sceneFallback,
      environment: environment || 'the scene',
      camera: str(o.camera) || undefined,
      lighting: str(o.lighting) || undefined,
      mood: str(o.mood) || undefined,
      continuity: str(o.continuity) || undefined,
    };
  };

  // Helper to clean and validate beat response
  const cleanBeatResponse = (parsed: Record<string, unknown>, isDecisionPage: boolean, isFinalPage: boolean): Beat => {
    // Build result with defaults for required fields
    const result: Beat = {
      caption: parsed.caption as string | undefined,
      dialogue: parsed.dialogue as string | undefined,
      scene: (parsed.scene as string) || '',
      focus_char: (parsed.focus_char as 'hero' | 'friend' | 'other') || 'hero',
      choices: (parsed.choices as string[]) || [],
      art: cleanArtDirection(parsed.art, (parsed.scene as string) || ''),
    };

    if (result.dialogue) {
      result.dialogue = String(
        Array.isArray(result.dialogue) ? result.dialogue.join(' ') : result.dialogue
      ).replace(/^[\w\s\-]+:\s*/i, '').replace(/["']/g, '').trim();
    }

    if (result.caption) {
      result.caption = String(
        Array.isArray(result.caption) ? result.caption.join(' ') : result.caption
      ).replace(/^[\w\s\-]+:\s*/i, '').trim();
    }

    if (!isDecisionPage) {
      result.choices = [];
    }

    if (isDecisionPage && !isFinalPage && (!result.choices || result.choices.length < 2)) {
      // Generate contextual fallback choices instead of generic "Option A/B"
      console.warn('[Beat] No choices returned by AI, generating fallback choices');
      result.choices = [
        "Take the direct approach - confront the situation head-on",
        "Proceed cautiously - gather more information first"
      ];
    }

    if (!['hero', 'friend', 'other'].includes(result.focus_char)) {
      result.focus_char = 'hero';
    }

    /*
     * Soften the scene before it ever reaches the image model.
     *
     * The prompt asks the writer to keep scenes renderable, but it is not a
     * reliable judge of another model's safety filter, and a refused page costs
     * the user a full generation. Captions, dialogue, and choices are untouched:
     * they are lettered, not drawn, so they can carry the weight the picture
     * cannot.
     */
    if (looksRisky(result.scene)) {
      const softened = softenScene(result.scene);
      if (softened.changed) {
        console.warn('[safety] Softened scene wording before rendering:', softened.matched);
        result.scene = softened.text;
      }
    }
    if (result.art) {
      const action = softenScene(result.art.action);
      const environment = softenScene(result.art.environment);
      if (action.changed || environment.changed) {
        result.art = { ...result.art, action: action.text, environment: environment.text };
      }
    }

    return result;
  };

  /**
   * Generate a narrative beat for a comic page.
   * Uses Claude as primary, falls back to Gemini.
   */
  const generateBeat = async (params: GenerateBeatParams): Promise<Beat> => {
    const beatStartTime = Date.now();
    const {
      history,
      pageNum,
      isDecisionPage,
      instruction,
      previousChoices,
      storyContext,
      storyOutline,
      richMode,
      extraPages,
    } = params;

    // Read settings from store
    const settingsState = useSettingsStore.getState();
    const { selectedGenre, customPremise, selectedLanguage } = settingsState;

    const hero = getHero();
    if (!hero) throw new Error("No Hero");

    const friend = getFriend();
    const additionalChars = getAdditionalChars();

    // The user's chosen length lives on storyContext. It must match the page
    // loop in App, or the writer ends the story on the wrong page.
    const comicConfig = getComicConfig(storyContext.pageLength, extraPages);
    const isFinalPage = pageNum === comicConfig.MAX_STORY_PAGES;
    const langName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || "English";

    // Get relevant history and last focus to prevent repetition
    const relevantHistory = history
      .filter(p => p.type === 'story' && p.narrative && (p.pageIndex || 0) < pageNum)
      .sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

    const lastBeat = relevantHistory[relevantHistory.length - 1]?.narrative;
    const lastFocus = lastBeat?.focus_char || 'none';

    const historyText = relevantHistory.map(p =>
      `[Page ${p.pageIndex}] [Focus: ${p.narrative?.focus_char}] (Caption: "${p.narrative?.caption || ''}") (Dialogue: "${p.narrative?.dialogue || ''}") (Scene: ${p.narrative?.scene}) ${p.resolvedChoice ? `-> USER CHOICE: "${p.resolvedChoice}"` : ''}`
    ).join('\n');

    // Aggressive Co-Star Injection Logic
    let friendInstruction = "Not yet introduced.";
    if (friend) {
      friendInstruction = "ACTIVE and PRESENT (User Provided).";
      if (lastFocus !== 'friend' && Math.random() > 0.4) {
        friendInstruction += " MANDATORY: FOCUS ON THE CO-STAR FOR THIS PANEL.";
      } else {
        friendInstruction += " Ensure they are woven into the scene even if not the main focus.";
      }
    }

    // Determine Core Story Driver (Genre vs Custom Premise)
    // Shared with the outline writer so both work from the same brief.
    const coreDriver = formatStoryDriver(selectedGenre, customPremise, resolveTone(selectedGenre, storyContext.tone));

    /**
     * The writer and the artist are different models with different safety
     * policies, and the artist's is stricter. A scene the writer happily
     * produces ("blood pooling", "the blade enters his throat") comes back from
     * the image model as a refusal, and the user sees a failed page for a story
     * their own AI wrote. Keeping scene descriptions renderable is cheaper than
     * discovering the mismatch one page at a time.
     *
     * This constrains the SCENE field only. Captions and dialogue can still
     * carry weight and consequence — they are lettered, not drawn.
     */
    const renderableSceneRule = `
    SCENE DESCRIPTION LIMITS (applies to the "scene" and "art" fields only, not to captions or dialogue):
    - Describe what a comic panel SHOWS. Imply violence through aftermath, reaction, posture, and framing rather than depicting injury.
    - Do not describe blood, gore, wounds, corpses, mutilation, or dismemberment.
    - Do not describe a weapon making contact with a body. Show the moment before, or the reaction after.
    - Do not describe nudity, sexual content, or characters in states of undress.
    - Do not describe self-harm, suicide, or harm to children.
    - Real public figures, real brands, and real logos must not appear.
    These are rendering limits, not story limits: the stakes stay high, the camera looks elsewhere.
    `;

    // Guardrails to prevent everything becoming "Quantum Sci-Fi"
    const guardrails = `
    NEGATIVE CONSTRAINTS:
    1. UNLESS GENRE IS "Dark Sci-Fi" OR "Superhero Action" OR "Custom": DO NOT use technical jargon like "Quantum", "Timeline", "Portal", "Multiverse", or "Singularity".
    2. IF GENRE IS "Teen Drama" OR "Lighthearted Comedy": The "stakes" must be SOCIAL, EMOTIONAL, or PERSONAL (e.g., a rumor, a competition, a broken promise, being late, embarrassing oneself). Do NOT make it life-or-death. Keep it grounded.
    3. Avoid "The artifact" or "The device" unless established earlier.
    `;

    // Character Context
    const charContext = [
      `HERO: ${hero.name || 'Main Hero'}. Role: ${getRoleLabel(hero) || 'Hero'}. Backstory: ${hero.backstoryText?.trim() || 'Unknown'}.`,
      friend ? `CO-STAR: ${friend.name || 'Sidekick'}. Role: ${getRoleLabel(friend) || 'Sidekick'}. Backstory: ${friend.backstoryText?.trim() || 'Unknown'}.` : null,
      ...additionalChars.map(c => `${c.name}: Role: ${getRoleLabel(c) || 'Supporting'}. ${c.backstoryText?.trim() || 'Unknown'}.`)
    ].filter(Boolean).join('\n');

    // GAP-11 FIX: Visual Profile Context for Scene Writing
    // Inject compact visual summaries so beat generator writes scenes consistent
    // with character reference images (prevents hair/outfit contradictions in scene text).
    const profiles = useCharacterStore.getState().getProfilesArray();
    const buildVisualSummary = (persona: Persona, roleLabel: string): string | null => {
      const profile = profiles.find(p => p.id === persona.id || p.name === persona.name);
      if (!profile) return null;
      const ih = profile.identityHeader;
      const hairDesc = ih?.hair
        || (profile.hairDetails ? `${profile.hairDetails.color} ${profile.hairDetails.style} hair`.trim() : '')
        || '';
      const outfitDesc = profile.clothing ? profile.clothing.slice(0, 60) : '';
      const nevers = profile.hardNegatives?.slice(0, 3).join(', ') || '';
      const parts = [hairDesc, outfitDesc].filter(Boolean);
      if (parts.length === 0) return null;
      return `• ${roleLabel}: ${parts.join(' | ')}${nevers ? `. NEVER describe as: ${nevers}` : ''}`;
    };
    const visualSummaries: string[] = [];
    const heroVis = buildVisualSummary(hero, `HERO [${hero.name || 'Hero'}]`);
    if (heroVis) visualSummaries.push(heroVis);
    if (friend) {
      const friendVis = buildVisualSummary(friend, `CO-STAR [${friend.name || 'Co-Star'}]`);
      if (friendVis) visualSummaries.push(friendVis);
    }
    additionalChars.forEach(c => {
      const vis = buildVisualSummary(c, `[${c.name}]`);
      if (vis) visualSummaries.push(vis);
    });
    const visualRefBlock = visualSummaries.length > 0
      ? `\nVISUAL REFERENCE (match in scene descriptions — do not contradict reference images):\n${visualSummaries.join('\n')}`
      : '';

    // GAP-10: Inject lock visual constraints so beat generator doesn't write scenes
    // that contradict locked attributes (e.g., "removes helmet" when outfit is locked).
    const characterLocks = useCharacterStore.getState().characterLocks;
    const lockLines: string[] = [];
    characterLocks.forEach((lock, charId) => {
      const anyLocked = lock.lockFace || lock.lockOutfit || lock.lockWeapon || lock.lockEmblem;
      if (!anyLocked) return;
      const persona = ([hero, friend].filter(Boolean) as Persona[])
        .concat(additionalChars)
        .find(p => p.id === charId);
      if (!persona) return;
      const lockedParts: string[] = [];
      if (lock.lockFace) lockedParts.push('face');
      if (lock.lockOutfit) lockedParts.push('outfit/costume');
      if (lock.lockWeapon) lockedParts.push('weapon');
      if (lock.lockEmblem) lockedParts.push('emblem');
      lockLines.push(`[${persona.name.toUpperCase()}: ${lockedParts.join(', ')} locked — do not write scenes where these change or are removed]`);
    });
    const lockConstraintsBlock = lockLines.length > 0
      ? `\nVISUAL CONSTRAINTS (do not contradict in scene descriptions):\n${lockLines.join('\n')}`
      : '';

    // Story Context
    const storyInfo = `
    STORY TITLE: ${storyContext.title || 'Untitled Adventure'}
    STORY DESCRIPTION: ${storyContext.descriptionText || 'A new adventure begins.'}
    ${storyOutline.isReady ? `STORY OUTLINE: ${storyOutline.content}` : ''}
    ${formatAttachedText(storyContext.descriptionFiles, 'ATTACHED STORY DOCUMENT')}${[hero, friend, ...additionalChars]
      .filter(Boolean)
      .map(c => formatAttachedText(c!.backstoryFiles, `${c!.name.toUpperCase()} BACKSTORY DOCUMENT`))
      .join('')}
    `;

    // Batch-of-3 generation context for narrative continuity
    const batchPosition = ((pageNum - 1) % 3) + 1;
    const batchStart = pageNum - batchPosition + 1;
    const batchContext = `
=== BATCH GENERATION CONTEXT ===
This is page ${batchPosition} of a 3-page narrative batch (Pages ${batchStart}-${batchStart + 2}).
- Page 1 of batch: SETUP - Establish the scene, introduce the situation
- Page 2 of batch: DEVELOPMENT - Build tension, advance the conflict, character interactions
- Page 3 of batch: PAYOFF - Mini-climax, resolution of this beat, or cliffhanger for next batch
MAINTAIN STRONG CONTINUITY with the other pages in this batch. The 3 pages should feel like a cohesive mini-chapter.`;

    // Rolling story summary for narrative continuity (last 3 story pages)
    const storySummary = buildStorySummary(history);

    // Build base instruction
    let baseInstruction = `You are the Lead Writer for a mature comic book. Write ONE single, vivid, narrative beat for the NEXT page. ALL OUTPUT TEXT (Captions, Dialogue, Choices) MUST BE IN ${langName.toUpperCase()}. ${coreDriver} ${guardrails}${renderableSceneRule}`;
    baseInstruction += `\nCONTEXT: ${storyInfo}\nCHARACTERS:\n${charContext}${visualRefBlock}${lockConstraintsBlock}`;
    baseInstruction += batchContext;

    if (richMode) {
      baseInstruction += " RICH/NOVEL MODE ENABLED. Prioritize deeper character thoughts, descriptive captions, and meaningful dialogue exchanges over short punchlines.";
    }

    if (instruction) {
      baseInstruction += `\nUSER REROLL INSTRUCTION: "${instruction}". (YOU MUST FOLLOW THIS OVER THE NORMAL NARRATIVE FLOW!).`;
    }

    if (isFinalPage) {
      const resolvedChoices = history
        .map(f => f.resolvedChoice)
        .filter((c): c is string => Boolean(c && c.trim()));
      baseInstruction += getFinalePageInstruction(resolvedChoices);
    } else {
      // Arc position scaled to the issue length. Decision pages get it too:
      // in Novel Mode that is every other page, which used to receive no arc
      // guidance at all.
      baseInstruction += ` ${getArcGuidance(pageNum, comicConfig.MAX_STORY_PAGES)}`;
      if (isDecisionPage) {
        baseInstruction += " End with a PSYCHOLOGICAL choice about VALUES, RELATIONSHIPS, or RISK. (e.g., Truth vs. Safety, Forgive vs. Avenge). The choices MUST be a brief descriptive summary of the action the user is taking (e.g. 'Confront the suspect at the warehouse' vs 'Follow from a distance'). NEVER use generic 'Option A' or 'Option B'.";
        if (previousChoices && previousChoices.length > 0) {
          baseInstruction += ` REJECTED CHOICES (DO NOT REUSE): ${previousChoices.map(c => `"${c}"`).join(', ')}. Generate COMPLETELY DIFFERENT choices that explore alternative story directions.`;
        }
      }
    }

    // Comic Fundamentals context from page breakdown
    const pagePlan = storyOutline.pageBreakdown?.find(p => p.pageIndex === pageNum);
    if (pagePlan) {
      baseInstruction += `\n\n=== COMIC FUNDAMENTALS FOR PAGE ${pageNum} ===`;
      baseInstruction += `\n${getLayoutInstructions(pagePlan.panelLayout)}`;
      baseInstruction += `\n${getShotInstructions(pagePlan.suggestedShot)}`;

      if (pageNum > 1) {
        const prevScene = relevantHistory[relevantHistory.length - 1]?.narrative?.scene;
        baseInstruction += `\n${getTransitionContext(pagePlan.transitionType, prevScene)}`;
      }

      const beatGuidance: Record<EmotionalBeat, string> = {
        'establishing': 'BEAT: ESTABLISHING - Set the scene, introduce the location/mood.',
        'action': 'BEAT: ACTION - Focus on physical movement, dynamic poses, kinetic energy.',
        'dialogue': 'BEAT: DIALOGUE - Conversation focus, reaction shots, character interplay.',
        'reaction': 'BEAT: REACTION - Show emotional response to what just happened.',
        'climax': 'BEAT: CLIMAX - This is the PEAK MOMENT. Maximum drama and stakes!',
        'transition': 'BEAT: TRANSITION - Bridge scene, moving from one situation to next.',
        'reveal': 'BEAT: REVEAL - Important information disclosed. Dramatic impact moment.',
      };
      baseInstruction += `\n${beatGuidance[pagePlan.emotionalBeat]}`;

      const pacingGuidance: Record<PacingIntent, string> = {
        'slow': 'PACING: SLOW - Take time with this moment. Detailed descriptions, contemplative tone.',
        'medium': 'PACING: MEDIUM - Standard narrative flow. Balance action and reflection.',
        'fast': 'PACING: FAST - Quick, punchy beats. Short sentences, rapid progression.',
      };
      baseInstruction += `\n${pacingGuidance[pagePlan.pacingIntent]}`;

      if (pagePlan.isFlashback) {
        baseInstruction += `\nFLASHBACK: This scene takes place in the PAST. Use nostalgic/memory tone in narration.`;
      }

      if (pagePlan.primaryCharacters.length > 0) {
        baseInstruction += `\nPLANNED CHARACTERS: Focus on ${pagePlan.primaryCharacters.join(', ')}.`;
      }
      baseInstruction += `\n=== END COMIC FUNDAMENTALS ===\n`;
    }

    // Dynamic text limits based on richMode
    const capLimit = richMode ? "max 35 words. Detailed narration or internal monologue" : "max 15 words";
    const diaLimit = richMode ? "max 30 words. Rich, character-driven speech" : "max 12 words";

    const prompt = `
You are writing a comic book script. PAGE ${pageNum} of ${comicConfig.MAX_STORY_PAGES}.
TARGET LANGUAGE FOR TEXT: ${langName} (CRITICAL: CAPTIONS, DIALOGUE, CHOICES MUST BE IN THIS LANGUAGE).
${coreDriver}

CHARACTERS:
- HERO: Active.
- CO-STAR: ${friendInstruction}

${storySummary ? storySummary + '\n\n' : ''}PREVIOUS PANELS (READ CAREFULLY):
${historyText.length > 0 ? historyText : "Start the adventure."}

RULES:
1. NO REPETITION. Do not use the same captions or dialogue from previous pages.
2. IF CO-STAR IS ACTIVE, THEY MUST APPEAR FREQUENTLY.
3. VARIETY. If page ${pageNum - 1} was an action shot, make this one a reaction or wide shot.
4. LANGUAGE: All user-facing text MUST be in ${langName}.
5. Avoid saying "CO-star" and "hero" in the text captions. Use names if established, or generic descriptors.

INSTRUCTION: ${baseInstruction}

OUTPUT STRICT JSON ONLY (No markdown formatting):
{
  "caption": "Unique narrator text in ${langName}. (${capLimit}).",
  "dialogue": "Unique speech in ${langName}. (${diaLimit}). Optional.",
  "scene": "Vivid visual description (ALWAYS IN ENGLISH for the artist model). MUST explicitly name EVERY character present in the scene (Hero, Co-Star, or their exact given names).",
  "art": {
    "characters_present": ["hero" and/or "friend" and/or exact character names — ONLY those visible in this panel"],
    "subject": "Who or what the panel is centered on (a character name).",
    "action": "What the subject is DOING. Verb phrase only. NO location words. e.g. 'raises her blade overhead'",
    "environment": "WHERE this happens. Setting only. NO action. e.g. 'flooded cathedral ruins, ankle-deep water'",
    "camera": "Framing. e.g. 'low angle, medium shot'",
    "lighting": "Light source and quality. e.g. 'hard rim light from a broken stained-glass window'",
    "mood": "One or two words. e.g. 'defiant'",
    "continuity": "What must visually match the previous page (time of day, weather, palette, location)."
  },
  "focus_char": "hero" OR "friend" OR "other",
  "choices": ${isDecisionPage && !isFinalPage ? `["First choice: brief descriptive action in ${langName}", "Second choice: different action in ${langName}"] (REQUIRED - must be 2 distinct, descriptive actions the hero can take. NEVER use 'Option A' or 'Option B')` : `[] (empty array - not a decision page)`}
}
`;

    // Build Gemini parts (used as fallback)
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];

    // Image attachments only. Text files are already inlined into the prompt
    // (formatAttachedText), so sending them again would duplicate them.
    const pushImages = (files?: { base64: string; mimeType: string; name: string }[]) =>
      files?.filter(isImageFile).forEach(f => parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } }));
    pushImages(storyContext.descriptionFiles);
    pushImages(hero.backstoryFiles);
    pushImages(friend?.backstoryFiles);
    additionalChars.forEach(c => pushImages(c.backstoryFiles));

    // Try Claude first for text analysis
    const claude = getClaude();
    if (claude) {
      try {
        const claudeContent: ClaudeContentBlock[] = [createTextContent(prompt)];

        // Add Story Description Files (images only for Claude)
        storyContext.descriptionFiles.forEach(f => {
          if (f.mimeType.startsWith('image/')) {
            claudeContent.push(createImageContent(f.base64, f.mimeType));
          }
        });

        // Add Character Backstory Files
        if (hero.backstoryFiles) {
          hero.backstoryFiles.forEach(f => {
            if (f.mimeType.startsWith('image/')) {
              claudeContent.push(createImageContent(f.base64, f.mimeType));
            }
          });
        }
        if (friend?.backstoryFiles) {
          friend.backstoryFiles.forEach(f => {
            if (f.mimeType.startsWith('image/')) {
              claudeContent.push(createImageContent(f.base64, f.mimeType));
            }
          });
        }
        additionalChars.forEach(c => {
          c.backstoryFiles?.forEach(f => {
            if (f.mimeType.startsWith('image/')) {
              claudeContent.push(createImageContent(f.base64, f.mimeType));
            }
          });
        });

        const response = await claude.messages.create({
          model: MODEL_TEXT_NAME_CLAUDE,
          max_tokens: 1024,
          messages: [{ role: 'user', content: claudeContent }]
        });

        const responseText = getTextFromClaudeResponse(response.content);
        const rawText = extractJsonFromResponse(responseText);
        const parsed = JSON.parse(rawText);

        useMetricsStore.getState().recordGeneration('beat', true, Date.now() - beatStartTime, 'claude',
          response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : undefined
        );
        return cleanBeatResponse(parsed, isDecisionPage, isFinalPage);
      } catch (e) {
        console.error("Claude beat generation failed, falling back to Gemini", e);
        const errMsg = String(e).toLowerCase();
        const isAuthError = errMsg.includes('invalid_api_key') ||
          errMsg.includes('authentication_error') ||
          errMsg.includes('permission_denied');

        if (isAuthError) {
          onAnthropicError(e);
          return {
            caption: pageNum === 1 ? "It began..." : "...",
            scene: `Generic scene for page ${pageNum}.`,
            focus_char: 'hero',
            choices: []
          };
        }
        // Continue to Gemini fallback for other errors
      }
    }

    // Gemini fallback (or primary if no Claude key)
    try {
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: MODEL_TEXT_NAME,
        contents: { parts },
        config: { responseMimeType: 'application/json' }
      });
      let rawText = res.text || "{}";
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsed = JSON.parse(rawText);
      useMetricsStore.getState().recordGeneration('beat', true, Date.now() - beatStartTime, 'gemini');
      return cleanBeatResponse(parsed, isDecisionPage, isFinalPage);
    } catch (e) {
      console.error("Beat generation failed", e);
      onAPIError(e);
      useMetricsStore.getState().recordGeneration('beat', false, Date.now() - beatStartTime, 'gemini');
      return {
        caption: pageNum === 1 ? "It began..." : "...",
        scene: `Generic scene for page ${pageNum}.`,
        focus_char: 'hero',
        choices: []
      };
    }
  };

  return { generateBeat };
};

export default useGenerateBeat;
