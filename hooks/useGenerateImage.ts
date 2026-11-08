/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for generating comic panel images.
 * Extracted from App.tsx as part of Batch 2.2 decomposition.
 */

import { GoogleGenAI } from '@google/genai';
import {
  Beat,
  ComicFace,
  Persona,
  StoryContext,
  StoryOutline,
  CharacterProfile,
  ShotType,
  BalloonShape,
  LANGUAGES,
  formatIdentityHeader,
  formatReinforcedScene,
  formatConsistencyInstruction,
  getShotInstructions,
  getFlashbackInstructions,
  isCastMember,
} from '../types';
import { detectImageMimeType } from '../claudeHelpers';
import { buildV2Prompt, type V2Character } from './promptAssemblerV2';
import { hasValidModelSheet } from './useGenerateModelSheet';
import { recordGenerationTime } from '../utils/timeEstimation';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMetricsStore } from '../stores/useMetricsStore';
import type { CharacterLockState, CharacterReferenceObject } from '../types';
import { IMAGE_MODEL } from '../config/models';

// ============================================================================
// TYPES
// ============================================================================

const MODEL_IMAGE_GEN_NAME = IMAGE_MODEL;

/** Configuration for the useGenerateImage hook */
export interface GenerateImageConfig {
  /** Get GoogleGenAI client */
  getAI: () => GoogleGenAI;
  /** Handle API errors */
  onAPIError: (e: unknown) => void;
}

/** Comic fundamentals override options */
export interface ComicOverrides {
  shotTypeOverride?: ShotType;
  balloonShapeOverride?: BalloonShape;
  applyFlashbackStyle?: boolean;
}

/** Parameters for the generateImage function */
export interface GenerateImageParams {
  /** Narrative beat to visualize */
  beat: Beat;
  /** Type of page (cover, story, back_cover) */
  type: ComicFace['type'];
  /** Story context */
  storyContext: StoryContext;
  /** Story outline state */
  storyOutline: StoryOutline;
  /** Optional user instruction for reroll */
  instruction?: string;
  /** Extra reference images to include */
  extraRefImages?: string[];
  /** Previous page image for context */
  prevImage?: string;
  /** Previous page beat for context */
  prevBeat?: Beat;
  /** Current page index */
  pageIndex?: number;
  /** Comic fundamentals overrides */
  comicOverrides?: ComicOverrides;
  /** Use only selected refs (skip default character refs) */
  useOnlySelectedRefs?: boolean;
  /** Current image to preserve (for non-full regeneration) */
  currentImageToPreserve?: string;
  /** Use compact prompt mode (shorter prompts, less text before images) */
  compactMode?: boolean;
  /** Adjacent page images for scene/outfit continuity (placed before character portraits) */
  adjacentPageImages?: Array<{ base64: string; label: string }>;
  /** Feature F: Reroll consistency mode — forces maximum strength for this call */
  consistencyMode?: boolean;
  /** Override profiles for this call only — avoids mutating the global store (DISCONNECT-6 fix) */
  profileOverrides?: CharacterProfile[];
  /** Character IDs to preserve from currentImageToPreserve reference */
  preserveCharacterIds?: string[];
  /** The issue's cover, used as a style anchor when the setting is enabled. */
  coverImage?: string;
}

/** Result from image generation */
export interface GenerateImageResult {
  imageUrl: string;
  originalPrompt: string;
  /** Failure reason if image generation failed */
  failureReason?: 'safety' | 'rate_limit' | 'quota' | 'content_policy' | 'timeout' | 'unknown' | string;
}

// ============================================================================
// PROFILE LOOKUP HELPER (Task 5.3.3 - Partial name match fallback)
// ============================================================================

/**
 * Find profile by name with fallback to partial matching.
 * Tries: exact match -> case-insensitive -> partial match -> first name only
 */
const findProfileByName = (name: string, profiles: CharacterProfile[]): CharacterProfile | undefined => {
  if (!name) return undefined;
  const nameLower = name.toLowerCase().trim();

  // Strategy 1: Exact match
  const exact = profiles.find(p => p.name === name);
  if (exact) return exact;

  // Strategy 2: Case-insensitive match
  const caseInsensitive = profiles.find(p => p.name.toLowerCase() === nameLower);
  if (caseInsensitive) {
    console.log(`[Profile Lookup] Fuzzy matched "${name}" to "${caseInsensitive.name}" (case-insensitive)`);
    return caseInsensitive;
  }

  // Strategy 3: Partial match (profile name contains search or vice versa)
  const partial = profiles.find(p =>
    p.name.toLowerCase().includes(nameLower) ||
    nameLower.includes(p.name.toLowerCase())
  );
  if (partial) {
    console.log(`[Profile Lookup] Fuzzy matched "${name}" to "${partial.name}" (partial match)`);
    return partial;
  }

  // Strategy 4: First name only match
  const firstName = nameLower.split(' ')[0];
  const firstNameMatch = profiles.find(p =>
    p.name.toLowerCase().split(' ')[0] === firstName
  );
  if (firstNameMatch) {
    console.log(`[Profile Lookup] Fuzzy matched "${name}" to "${firstNameMatch.name}" (first name match)`);
    return firstNameMatch;
  }

  return undefined;
};

// ============================================================================
// CRITICAL DIRECTIVES V2 - Focused and concise (Task 5.2.2)
// ============================================================================

/**
 * Generate per-character critical directives with specific face anchors.
 * More targeted than generic "copy EXACT" — gives the model the actual values to lock onto.
 */
const buildCriticalDirectivesV2 = (profiles: CharacterProfile[]): string => {
  // Collect all hardNegatives from all profiles
  const allNegatives: string[] = [];
  profiles.forEach(p => {
    if (p.hardNegatives?.length) allNegatives.push(...p.hardNegatives);
  });
  const uniqueNegatives = [...new Set(allNegatives)];
  const negativesList = uniqueNegatives.length > 0 ? uniqueNegatives.join(', ') : 'nothing specific';

  let result = '\nCharacter consistency — critical:\n';

  // Per-character face anchor: specific values give the model something concrete to lock onto
  profiles.forEach(p => {
    const ih = p.identityHeader;
    if (ih) {
      result += `• ${p.name.toUpperCase()}: ${ih.face} | eyes: ${ih.eyes} | hair: ${ih.hair} | skin: ${ih.skin} → copy from PORTRAIT above.\n`;
    } else if (p.faceDescription) {
      result += `• ${p.name.toUpperCase()}: ${p.faceDescription} → copy from PORTRAIT above.\n`;
    }
  });

  result += `• COSTUME: Match reference images exactly — same colors, emblems, accessories, no simplification.\n`;
  result += `\nNEVER DRAW: ${negativesList}\n`;

  return result;
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides image generation functionality.
 * Reads character and settings data from Zustand stores.
 */
export const useGenerateImage = (config: GenerateImageConfig) => {
  const { getAI, onAPIError } = config;

  // Store getters (for use in async callbacks)
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters.filter(isCastMember);
  const getProfilesArray = () => useCharacterStore.getState().getProfilesArray();
  const getCharacterLocks = () => useCharacterStore.getState().characterLocks;
  const getReferencesArray = () => useCharacterStore.getState().getReferencesArray();

  /**
   * Generate a comic panel image.
   * Uses Gemini image generation model.
   */
  const generateImage = async (params: GenerateImageParams): Promise<GenerateImageResult> => {
    const {
      beat,
      type,
      storyContext,
      storyOutline,
      instruction,
      extraRefImages,
      prevImage,
      prevBeat,
      pageIndex,
      comicOverrides,
      useOnlySelectedRefs,
      currentImageToPreserve,
      compactMode = false,
      adjacentPageImages,
      consistencyMode = false,
      profileOverrides,
    } = params;

    const startTime = Date.now();
    console.log(`[generateImage] Starting - Type: ${type}, Page: ${pageIndex ?? 'N/A'}, Instruction: ${instruction ? 'Yes' : 'No'}`);

    // Read settings from store (including consistency settings)
    const {
      selectedGenre,
      selectedLanguage,
      reAnchorEveryN = 2,
      referenceImagePriority = true,
      promptMode = 'v2',
      imageResolution = '1k',
      useModelSheets = true,
      sceneContinuityImages = false,
      useCoverAsStyleReference = false,
    } = useSettingsStore.getState();
    // Feature F: consistencyMode forces maximum strength for this generation call
    const consistencyStrength = consistencyMode ? 1.0 : (useSettingsStore.getState().consistencyStrength ?? 1.0);

    const hero = getHero();
    const friend = getFriend();
    const additionalChars = getAdditionalChars();
    // Use profileOverrides when provided (e.g. reroll with filtered characters) to avoid global store mutation
    const profiles = profileOverrides ?? getProfilesArray();

    // DISCONNECT-4 FIX: Filter profiles to only characters appearing on this page
    // when PageCharacterPlan data is available. This reduces prompt tokens and
    // prevents absent characters from appearing in generated images.
    const pagePlanForFilter = storyOutline.pageBreakdown?.find(p => p.pageIndex === pageIndex);
    // Phase 1.3 FIX: Resolve role strings ('hero', 'friend') to actual persona UUIDs before filtering.
    // pageBreakdown.primaryCharacters stores role strings from outline parsing, but
    // CharacterProfile.id stores the Persona's UUID — they must be reconciled for the filter to work.
    const resolvePageCharIds = (roleIds: string[]): string[] =>
      roleIds.map(id => {
        if (id === 'hero') return hero?.id ?? '';
        if (id === 'friend') return friend?.id ?? '';
        return id; // additional character UUID — used as-is
      }).filter(Boolean);
    const activeProfiles = (pagePlanForFilter && (pagePlanForFilter.primaryCharacters.length > 0 || (pagePlanForFilter.secondaryCharacters?.length ?? 0) > 0))
      ? profiles.filter(p => {
          const resolvedPrimary = resolvePageCharIds(pagePlanForFilter.primaryCharacters);
          const resolvedSecondary = resolvePageCharIds(pagePlanForFilter.secondaryCharacters ?? []);
          return resolvedPrimary.includes(p.id) || resolvedSecondary.includes(p.id);
        })
      : profiles;

    // Costume-change drift detection
    const COSTUME_CHANGE_KEYWORDS = ['removes', 'changes into', 'transforms', 'reveals new', 'tears off', 'replaces outfit', 'new costume'];
    const sceneTextLower = (beat?.scene ?? '').toLowerCase();
    const hasCostumeChange = COSTUME_CHANGE_KEYWORDS.some(kw => sceneTextLower.includes(kw));
    if (hasCostumeChange) {
      const characterLocks = useCharacterStore.getState().characterLocks;
      const allProfiles = useCharacterStore.getState().getProfilesArray();
      const lockedOutfitNames = Array.from(characterLocks.entries())
        .filter(([_, lock]) => lock.lockOutfit)
        .map(([id]) => allProfiles.find(p => p.id === id)?.name)
        .filter(Boolean) as string[];
      if (lockedOutfitNames.length > 0) {
        console.warn(`[DriftWarning] Page ${pageIndex ?? 0}: Scene describes a costume change but outfit is locked for: ${lockedOutfitNames.join(', ')}`);
      }
    }

    // Feature A: compiled reference objects (built once after profile generation)
    const compiledRefs = getReferencesArray();

    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Helper functions
    const getAllRefs = (p: Persona) => p.referenceImages || (p.referenceImage ? [p.referenceImage] : []);

    const createInlineImage = (base64Data: string) => ({
      inlineData: { mimeType: detectImageMimeType(base64Data), data: base64Data }
    });

    const getEmblemDesc = (p: Persona) => {
      if (!p.emblemImage) return null;
      const placement = p.emblemPlacement === 'other'
        ? p.emblemPlacementCustom || 'custom location'
        : p.emblemPlacement?.replace('-', ' ') || 'visible';
      return { image: p.emblemImage, placement };
    };

    const getWeaponDesc = (p: Persona) => {
      if (!p.weaponImage) return null;
      return { image: p.weaponImage, description: p.weaponDescriptionText || 'signature weapon' };
    };

    // Max costume ref images per character — more than 1 dilutes the portrait signal.
    // Users can upload many refs for profile analysis (more = better profile),
    // but for image generation fewer focused refs work better than many.
    const MAX_COSTUME_REFS = 1;

    // Helper to get character's actual role label (Villain, Sidekick, etc.) from Persona
    const getRoleLabel = (p: { role?: string; customRole?: string }): string => {
      if (!p.role) return '';
      if (p.role === 'Family/Friend' || p.role === 'Custom') return p.customRole || p.role;
      return p.role;
    };

    // ==========================================================================
    // V2 PROMPT PATH (default). Builds the request with each character fact
    // stated exactly once. Legacy multi-block path follows below, kept so the
    // eval harness can A/B the two assemblers.
    // ==========================================================================
    if (promptMode === 'v2') {
      const locks = getCharacterLocks();
      const preserveSet = new Set(params.preserveCharacterIds ?? []);

      const focusKey = beat.focus_char;
      const focusPersona: Persona | null =
        focusKey === 'hero' ? (hero ?? null) :
        focusKey === 'friend' ? (friend ?? null) :
        focusKey ? (additionalChars.find(c => c.name === focusKey || c.id === focusKey) ?? null) :
        null;

      const roster: Array<{ persona: Persona; role: string }> = [
        ...(hero ? [{ persona: hero, role: 'hero' }] : []),
        ...(friend ? [{ persona: friend, role: 'co-star' }] : []),
        ...additionalChars.map(c => ({ persona: c, role: (getRoleLabel(c) || 'supporting').toLowerCase() })),
      ];

      // Page-scope the cast.
      //
      // beat.art.characters_present is preferred over the outline's page plan:
      // it is derived from the scene the writer actually wrote, whereas the
      // plan is a forecast made before the page existed. When the two disagree,
      // a character in the scene but absent from the plan would otherwise be
      // drawn with no reference at all — a reliable source of drift.
      const presentKeys = beat.art?.characters_present ?? [];
      const matchesPresent = (persona: Persona): boolean =>
        presentKeys.some(key => {
          if (key === 'hero') return persona.id === hero?.id;
          if (key === 'friend') return persona.id === friend?.id;
          const k = key.toLowerCase().trim();
          const n = (persona.name || '').toLowerCase().trim();
          return persona.id === key || (Boolean(n) && (n === k || n.split(' ')[0] === k.split(' ')[0]));
        });

      const onPage = presentKeys.length > 0
        ? roster.filter(r => matchesPresent(r.persona))
        : roster.filter(({ persona }) =>
            activeProfiles.length === 0 ||
            activeProfiles.some(p => p.id === persona.id || p.name === persona.name)
          );

      // Never send an empty cast: a page with no character references drifts
      // completely. If scoping matched nobody, fall back to the full roster.
      const scopedRoster = onPage.length > 0 ? onPage : roster;

      const toV2 = ({ persona, role }: { persona: Persona; role: string }): V2Character => {
        const emb = getEmblemDesc(persona);
        const wpn = getWeaponDesc(persona);
        // A model sheet already rendered in the target style beats a raw photo:
        // style transfer is solved once instead of re-solved on every page.
        const sheet = useModelSheets && hasValidModelSheet(persona, storyContext.artStyle)
          ? persona.modelSheet
          : undefined;
        return {
          persona,
          profile: findProfileByName(persona.name, profiles),
          roleLabel: role,
          referenceImage: sheet || persona.base64 || undefined,
          isModelSheet: Boolean(sheet),
          // Paired with the sheet so facial detail survives downsampling.
          facePortrait: sheet ? (persona.base64 || undefined) : undefined,
          outfitRefs: getAllRefs(persona),
          emblem: emb ? { image: emb.image, placement: emb.placement } : undefined,
          weapon: wpn ? { image: wpn.image, description: wpn.description } : undefined,
          locks: locks.get(persona.id),
          isPreserved: preserveSet.has(persona.id),
        };
      };

      // Gemini weights later images most heavily: preserved first, focus last.
      const ordered = [
        ...scopedRoster.filter(r => preserveSet.has(r.persona.id)),
        ...scopedRoster.filter(r => !preserveSet.has(r.persona.id) && r.persona !== focusPersona),
        ...scopedRoster.filter(r => !preserveSet.has(r.persona.id) && r.persona === focusPersona),
      ];

      // Feeding the previous page's art back in compounds drift: one page renders
      // a character slightly off, every later page copies it. Continuity now
      // travels as text (ArtDirection.continuity) unless explicitly re-enabled.
      const sceneCtx: Array<{ base64: string; label: string }> = [];
      if (sceneContinuityImages) {
        if (prevImage && prevBeat) sceneCtx.push({ base64: prevImage, label: 'Previous page:' });
        (adjacentPageImages ?? []).forEach(a => sceneCtx.push({ base64: a.base64, label: a.label }));
      } else if (adjacentPageImages?.length) {
        // Adjacent pages are only ever passed by an explicit reroll request, so
        // the user asked for them directly.
        adjacentPageImages.forEach(a => sceneCtx.push({ base64: a.base64, label: a.label }));
      }

      const v2PagePlan = pageIndex !== undefined
        ? storyOutline.pageBreakdown?.find(p => p.pageIndex === pageIndex)
        : undefined;

      const v2 = buildV2Prompt({
        beat,
        type,
        storyContext,
        genre: selectedGenre,
        // "Use only selected refs" swaps the pictures, not the identities:
        // dropping the cast entirely left rerolls with no idea who they were
        // drawing, which is the opposite of a consistency feature.
        characters: ordered.map(toV2),
        suppressCastImages: Boolean(useOnlySelectedRefs && extraRefImages?.length),
        sceneContext: sceneCtx.length ? sceneCtx : undefined,
        // The cover is approved and never changes, so unlike an adjacent page it
        // cannot drag later pages off-model.
        styleReference: useCoverAsStyleReference ? params.coverImage : undefined,
        preserveImage: currentImageToPreserve,
        instruction,
        shotType: comicOverrides?.shotTypeOverride || v2PagePlan?.suggestedShot,
        isFlashback: comicOverrides?.applyFlashbackStyle ?? v2PagePlan?.isFlashback,
        balloonShape: comicOverrides?.balloonShapeOverride,
        panelLayout: v2PagePlan?.panelLayout,
        location: v2PagePlan?.location,
        publisherLogo: (type === 'cover' && !storyContext.useOverlayLogo) ? storyContext.publisherLogo : undefined,
        consistencyStrength,
        compact: compactMode,
      }, detectImageMimeType);

      if (extraRefImages?.length) {
        const label = useOnlySelectedRefs
          ? 'Selected reference — match this character exactly:'
          : 'Additional reference:';
        extraRefImages.forEach(ref => {
          v2.contents.push({ text: label });
          v2.contents.push(createInlineImage(ref.includes(',') ? ref.split(',')[1] : ref));
        });
      }

      return executeGeneration(v2.contents, v2.promptText);
    }

    // Helper to get inline identity from profile — all 5 fields to minimize guessing
    // characterRoleDesc: actual Persona role (Villain, Sidekick, etc.) for visual context
    const getInlineIdentity = (name: string, role: 'HERO' | 'CO-STAR' | 'CHARACTER' = 'CHARACTER', characterRoleDesc?: string): string => {
      const profile = findProfileByName(name, profiles);
      const roleTag = characterRoleDesc ? ` — ${characterRoleDesc}` : '';
      if (profile) {
        const ih = profile.identityHeader;
        if (ih) {
          const sigStr = ih.signature?.length ? `\nSignature: ${ih.signature.slice(0, 2).join(', ')}` : '';
          return `${profile.name.toUpperCase()} (${role.toLowerCase()}${roleTag}) — face and outfit reference:\nFace: ${ih.face} | Eyes: ${ih.eyes} | Hair: ${ih.hair} | Skin: ${ih.skin} | Build: ${ih.build}${sigStr}\nMatch face, hair, skin, and outfit from this portrait. Draw in a scene-appropriate pose — do NOT copy the standing pose:`;
        }
        const hairInfo = profile.hairDetails
          ? `${profile.hairDetails.style} ${profile.hairDetails.color} hair`
          : 'match portrait';
        return `${profile.name.toUpperCase()} (${role.toLowerCase()}${roleTag}) — face and outfit reference:\nFace: ${profile.faceDescription || 'match portrait'} | Hair: ${hairInfo} | Skin: match portrait\nMatch face, hair, skin, and outfit. Draw in a scene-appropriate pose — do NOT copy the standing pose:`;
      }
      return `${name.toUpperCase()} (${role.toLowerCase()}${roleTag}) — face and outfit reference. Match face and outfit. Draw in a scene-appropriate pose — do NOT copy the standing pose:`;
    };

    // Push character references with inline identity headers (Task 5.2.3 - identity immediately before each image)
    // Phase 3.2: Focus-character portrait ordering — Gemini weights later images most heavily,
    // so the focus character's portraits appear LAST for maximum face/costume accuracy.
    const pushCharacterReferences = () => {
      contents.push({ text: "\nCharacter visual references — match exactly:\nReference images show characters in neutral standing poses. Draw all characters in natural poses fitting the scene — do NOT replicate the standing pose from portraits." });

      // Unified helper: push one character's full reference block
      const pushCharBlock = (persona: Persona, role: 'HERO' | 'CO-STAR' | 'CHARACTER', requirePortrait = false) => {
        if (requirePortrait && !persona.base64) return;
        if (persona.base64) {
          contents.push({ text: `\n${getInlineIdentity(persona.name, role, getRoleLabel(persona) || undefined)}` });
          contents.push(createInlineImage(persona.base64));
        }
        getAllRefs(persona).slice(0, MAX_COSTUME_REFS).forEach((ref, i) => {
          contents.push({ text: `${persona.name} outfit reference ${i + 1}:` });
          contents.push(createInlineImage(ref));
        });
        const emb = getEmblemDesc(persona);
        if (emb) {
          contents.push({ text: `${persona.name}'s emblem (place on ${emb.placement}):` });
          contents.push(createInlineImage(emb.image));
        }
        const wpn = getWeaponDesc(persona);
        if (wpn) {
          contents.push({ text: `${persona.name}'s weapon (${wpn.description}):` });
          contents.push(createInlineImage(wpn.image));
        }
      };

      // Determine focus character persona (hero, friend, or additional char by name)
      const focusKey = beat.focus_char;
      const focusPersona: Persona | null =
        focusKey === 'hero' ? (hero ?? null) :
        focusKey === 'friend' ? (friend ?? null) :
        focusKey ? (additionalChars.find(c => c.name === focusKey || c.id === focusKey) ?? null) :
        null;

      // Build ordered character list: preserve chars first (lowest weight), focus/fix chars last (highest weight)
      const preserveSet = new Set(params.preserveCharacterIds ?? []);

      const allChars: Array<{ persona: Persona; role: 'HERO' | 'CO-STAR' | 'CHARACTER'; requirePortrait: boolean }> = [
        ...(hero ? [{ persona: hero, role: 'HERO' as const, requirePortrait: true }] : []),
        ...(friend ? [{ persona: friend, role: 'CO-STAR' as const, requirePortrait: true }] : []),
        ...additionalChars.map(c => ({ persona: c, role: 'CHARACTER' as const, requirePortrait: false })),
      ];

      // 1. Preserve characters first (lowest Gemini weight — reference panel is source of truth for them)
      allChars.filter(c => preserveSet.has(c.persona.id))
        .forEach(c => pushCharBlock(c.persona, c.role, c.requirePortrait));

      // 2. Non-preserve, non-focus characters in middle
      allChars.filter(c => !preserveSet.has(c.persona.id) && c.persona !== focusPersona)
        .forEach(c => pushCharBlock(c.persona, c.role, c.requirePortrait));

      // 3. Focus/fix character last (highest Gemini weight) — only if not preserved
      if (focusPersona && !preserveSet.has(focusPersona.id)) {
        const focusRole: 'HERO' | 'CO-STAR' | 'CHARACTER' =
          focusPersona === hero ? 'HERO' :
          focusPersona === friend ? 'CO-STAR' : 'CHARACTER';
        const requirePortrait = focusPersona === hero || focusPersona === friend;
        pushCharBlock(focusPersona, focusRole, requirePortrait);
      }
    };

    // ==========================================================================
    // OPTIMIZED PROMPT STRUCTURE (Tasks 5.2.1-5.2.4)
    // ==========================================================================
    // NEW ORDER:
    // 1. Character Summary (compact)
    // 2. CHARACTER IMAGES WITH INLINE IDENTITY (moved up!)
    // 3. Style/Genre tags (short)
    // 4. Scene description
    // 5. CRITICAL DIRECTIVES V2 (2 focused)
    // 6. Caption/dialogue
    // 7. Previous page context
    // ==========================================================================

    const styleEra = selectedGenre === 'Custom' ? "Modern American" : selectedGenre;
    const artStyleTag = storyContext.artStyle ? `, ${storyContext.artStyle}` : '';

    // Build compact character identity summary for front-loading (most critical info first).
    // Include all 5 identity fields so the model has specific values to lock onto before seeing images.
    // Phase 1.1 FIX: Use activeProfiles (page-scoped) not all profiles — avoids injecting absent characters.
    const buildCharacterSummary = (): string => {
      const summaries: string[] = [];
      activeProfiles.forEach(profile => {
        const ih = profile.identityHeader;
        if (ih) {
          const negatives = profile.hardNegatives?.length ? ` | NEVER: ${profile.hardNegatives.slice(0, 3).join(', ')}` : '';
          summaries.push(`${profile.name.toUpperCase()}: face: ${ih.face} | eyes: ${ih.eyes} | hair: ${ih.hair} | skin: ${ih.skin} | build: ${ih.build}${negatives}`);
        } else {
          summaries.push(`${profile.name.toUpperCase()}: ${profile.faceDescription || 'standard'}, ${profile.colorPalette || 'standard colors'}`);
        }
      });
      return summaries.length > 0
        ? `Character identities — memorize before drawing:\n${summaries.join('\n')}\n`
        : '';
    };

    // STEP 1: Character Summary (compact, text-only header)
    const preImageText = buildCharacterSummary();
    contents.push({ text: preImageText });

    // -------------------------------------------------------------------------
    // Feature D: Build locked-attribute constraints to prepend as hard rules.
    // Read from useCharacterStore.characterLocks and matching profiles.
    // -------------------------------------------------------------------------
    const buildLockedConstraints = (): string => {
      const locks = getCharacterLocks();
      if (locks.size === 0) return '';

      const lines: string[] = [];
      locks.forEach((lock: CharacterLockState, charId: string) => {
        const anyLocked = lock.lockFace || lock.lockOutfit || lock.lockWeapon || lock.lockEmblem;
        if (!anyLocked) return;

        const profile = profiles.find(p => p.id === charId);
        const charName = profile?.name ?? charId;

        if (lock.lockFace && profile?.identityHeader) {
          const ih = profile.identityHeader;
          lines.push(`${charName}'s face is locked — must not change: Face: ${ih.face} | Eyes: ${ih.eyes} | Hair: ${ih.hair} | Skin: ${ih.skin}.`);
        }
        if (lock.lockOutfit && profile?.clothing) {
          lines.push(`${charName}'s outfit is locked — must not change: ${profile.clothing}. Same colors, materials, and accessories as reference.`);
        }
        if (lock.lockEmblem && profile?.emblemDescription) {
          const placement = profile.emblemPlacement ? ` at ${profile.emblemPlacement}` : '';
          lines.push(`${charName}'s emblem is locked — must remain visible: ${profile.emblemDescription}${placement}.`);
        }
        if (lock.lockWeapon && profile?.weaponDescription) {
          lines.push(`${charName}'s weapon is locked — must remain visible: ${profile.weaponDescription}.`);
        }
      });

      if (lines.length === 0) return '';
      return `\nLocked character attributes — do not change:\n${lines.join('\n')}\n`;
    };

    // When referenceImagePriority=true (default): portraits appear LAST (highest weight).
    // When false: scene context images appear last (prioritize scene continuity over face accuracy).
    if (!referenceImagePriority) {
      // Scene-first order: portraits go before context images
      if (useOnlySelectedRefs && extraRefImages && extraRefImages.length > 0) {
        contents.push({ text: "\nSelected character references — use only these:" });
        extraRefImages.forEach((ref, i) => {
          contents.push({ text: `Reference ${i + 1}:` });
          contents.push(createInlineImage(ref));
        });
      } else {
        pushCharacterReferences();
        if (extraRefImages && extraRefImages.length > 0) {
          extraRefImages.forEach((ref, i) => {
            contents.push({ text: `Additional reference ${i + 1}:` });
            contents.push(createInlineImage(ref));
          });
        }
      }
    }

    // STEP 2: Previous page image — scene context only, placed before portraits when referenceImagePriority=true.
    if (prevImage && prevBeat) {
      contents.push({ text: "\nPrevious page — use for background, lighting, and pose continuity only. Do NOT copy face, hair, or skin from this. Faces come from character portraits below." });
      contents.push(createInlineImage(prevImage.split(',')[1] || prevImage));
    }

    // STEP 2b: Adjacent page images (prev/next) for scene/outfit continuity.
    if (adjacentPageImages && adjacentPageImages.length > 0) {
      for (const adj of adjacentPageImages) {
        contents.push({ text: `\n${adj.label} — scene and outfit continuity reference. Do not copy faces, hair, or skin. Faces come from character portraits below.` });
        contents.push(createInlineImage(adj.base64));
      }
    }

    // STEP 3: CHARACTER PORTRAITS (last images when referenceImagePriority=true — highest weight)
    if (referenceImagePriority) {
      if (useOnlySelectedRefs && extraRefImages && extraRefImages.length > 0) {
        contents.push({ text: "\nSelected character references — use only these:" });
        extraRefImages.forEach((ref, i) => {
          contents.push({ text: `Reference ${i + 1}:` });
          contents.push(createInlineImage(ref));
        });
      } else {
        pushCharacterReferences();

        // Configurable re-anchor interval (Feature E): uses reAnchorEveryN from settings
        if (pageIndex !== undefined && pageIndex >= reAnchorEveryN && pageIndex % reAnchorEveryN === 0) {
          const charList = activeProfiles.map(p => p.name.toUpperCase()).join(', ');
          contents.push({ text: `\nPage ${pageIndex} re-anchor: faces must match the portrait images above for ${charList}.` });
        }

        if (extraRefImages && extraRefImages.length > 0) {
          extraRefImages.forEach((ref, i) => {
            contents.push({ text: `Additional reference ${i + 1}:` });
            contents.push(createInlineImage(ref));
          });
        }
      }
    } else {
      // Scene-first: re-anchor still fires but after scene images
      if (!useOnlySelectedRefs && pageIndex !== undefined && pageIndex >= reAnchorEveryN && pageIndex % reAnchorEveryN === 0) {
        const charList = activeProfiles.map(p => p.name.toUpperCase()).join(', ');
        contents.push({ text: `\nPage ${pageIndex} re-anchor: faces must match the portrait images above for ${charList}.` });
      }
    }

    // Current image to preserve (for partial regeneration)
    if (currentImageToPreserve) {
      const preserveData = currentImageToPreserve.includes(',')
        ? currentImageToPreserve.split(',')[1]
        : currentImageToPreserve;
      contents.push({ text: "\nExisting panel — modify as specified:" });
      contents.push({ text: "Keep the background, lighting, and composition unchanged. Only modify what is specified below." });
      contents.push(createInlineImage(preserveData));
    }

    // Character-targeted preservation: explicit directives for which characters to copy vs regenerate
    if (params.preserveCharacterIds && params.preserveCharacterIds.length > 0) {
      const preservedProfiles = activeProfiles.filter(p =>
        params.preserveCharacterIds!.includes(p.id)
      );
      const fixProfiles = activeProfiles.filter(p =>
        !params.preserveCharacterIds!.includes(p.id)
      );

      const lines: string[] = ['\nCharacter modification instructions:'];

      if (preservedProfiles.length > 0) {
        lines.push('PRESERVE exactly from the reference panel above — do NOT change these characters:');
        preservedProfiles.forEach(p => lines.push(`  • ${p.name.toUpperCase()} — copy face, outfit, and colors exactly`));
      }

      if (fixProfiles.length > 0) {
        lines.push('REGENERATE these characters to match their portrait images below:');
        fixProfiles.forEach(p => lines.push(`  • ${p.name.toUpperCase()} — fix face, outfit, and colors to match portrait`));
      }

      contents.push({ text: lines.join('\n') });
    }

    // Publisher logo for cover (if applicable, add near other images)
    let publisherLogoAdded = false;
    if (type === 'cover' && !storyContext.useOverlayLogo && storyContext.publisherLogo) {
      contents.push({ text: "Publisher logo:" });
      contents.push(createInlineImage(storyContext.publisherLogo));
      publisherLogoAdded = true;
    }

    // ==========================================================================
    // STEP 3-7: POST-IMAGE TEXT (Style, Scene, Directives, Caption, Context)
    // ==========================================================================

    let promptText = '';

    // STEP 3: Style/Genre tags (SHORT - Task 5.2.4 compact mode uses minimal)
    if (compactMode) {
      promptText += `\nStyle: ${styleEra}${artStyleTag}.\n`;
    } else {
      promptText += `\nGenre: ${selectedGenre}. Style: ${storyContext.artStyle || 'Comic Book'}.\n`;
      promptText += `${styleEra} comic art${artStyleTag}, detailed ink, vibrant colors.\n`;
    }

    // Feature D: Inject locked attribute constraints immediately after style tag.
    // These are the highest-priority rules — prepended before any scene description.
    const lockedConstraints = buildLockedConstraints();
    if (lockedConstraints) {
      promptText += lockedConstraints;
    }

    // STEP 4: Scene description (varies by page type)
    if (type === 'cover') {
      if (storyContext.useOverlayLogo) {
        promptText += `TYPE: Comic Cover Art. Dynamic action shot of HERO. LEAVE ROOM AT TOP FOR LOGO OVERLAY. DO NOT DRAW TEXT/LOGOS.`;
      } else {
        promptText += `TYPE: Comic Cover. SERIES: "${storyContext.seriesTitle.toUpperCase()}". TITLE: "${storyContext.title || 'Untitled'}". ${storyContext.publisherName?.trim() ? `PUBLISHER: "${storyContext.publisherName.trim().toUpperCase()}". ` : ''}ISSUE: #${storyContext.issueNumber || '1'}. Draw titles prominently. Dynamic action shot of HERO.`;
      }
    } else if (type === 'back_cover') {
      promptText += `TYPE: Back Cover. FULL PAGE ART. Dramatic teaser. Text: "NEXT ISSUE SOON".`;
    } else {
      // Story page - Scene Reinforcement
      let sceneText = beat.scene;
      // Use fuzzy matching for focus character lookup (Task 5.3.3)
      let focusProfile: CharacterProfile | undefined;
      if (beat.focus_char === 'hero' && hero?.name) {
        focusProfile = findProfileByName(hero.name, profiles);
      } else if (beat.focus_char === 'friend' && friend?.name) {
        focusProfile = findProfileByName(friend.name, profiles);
      } else if (beat.focus_char) {
        focusProfile = findProfileByName(beat.focus_char, profiles);
      }

      if (focusProfile) {
        const envMatch = sceneText.match(/\b(in|at|on|near|inside|outside|within)\b.*/i);
        const environment = envMatch ? envMatch[0] : 'the scene';
        const action = sceneText.replace(environment, '').trim() || 'poses';
        sceneText = formatReinforcedScene(focusProfile, action, environment);
      }

      const settingInfix = pagePlanForFilter?.location ? ` (${pagePlanForFilter.location})` : '';
      promptText += `TYPE: Vertical comic panel.\nSCENE${settingInfix}: ${sceneText}\n`;

      // Comic fundamentals (Task 5.2.4 - minimal in compact mode)
      const pagePlan = pageIndex !== undefined
        ? storyOutline.pageBreakdown?.find(p => p.pageIndex === pageIndex)
        : undefined;

      const effectiveShotType = comicOverrides?.shotTypeOverride || pagePlan?.suggestedShot;
      const effectiveFlashback = comicOverrides?.applyFlashbackStyle ?? pagePlan?.isFlashback;
      const effectiveBalloonShape = comicOverrides?.balloonShapeOverride;

      if (effectiveShotType) {
        if (compactMode) {
          promptText += `Shot type: ${effectiveShotType}. `;
        } else {
          promptText += `${getShotInstructions(effectiveShotType)} `;
        }
      }

      if (!compactMode && pagePlan) {
        if (pagePlan.panelLayout === 'splash') {
          promptText += `SPLASH PAGE - maximum visual impact. `;
        } else if (pagePlan.panelLayout === 'grid-2x3' || pagePlan.panelLayout === 'grid-3x3') {
          promptText += `Multi-panel page - tighter framing. `;
        } else if (pagePlan.panelLayout === 'asymmetric') {
          promptText += `Dynamic layout. `;
        }
      }

      if (effectiveFlashback) {
        if (compactMode) {
          promptText += `[FLASHBACK: sepia/faded edges] `;
        } else {
          promptText += `${getFlashbackInstructions()} `;
        }
      }

      if (effectiveBalloonShape && !compactMode) {
        const balloonInstructions: Record<BalloonShape, string> = {
          'oval': 'Oval speech bubbles.',
          'burst': 'BURST bubbles - spiky edges for shouting!',
          'wavy': 'WAVY bubbles - weak/distressed speech.',
          'dashed': 'DASHED bubbles - whispered speech.',
          'cloud': 'CLOUD bubbles for thoughts.',
          'rectangle': 'RECTANGLE boxes for robotic/AI voices.',
          'jagged': 'JAGGED bubbles for radio/transmissions.',
          'inverted': 'INVERTED (black bg, white text) for alien voices.',
        };
        promptText += `[DIALOGUE: ${balloonInstructions[effectiveBalloonShape]}] `;
      }

      // STEP 6: Caption/dialogue
      if (beat.caption) promptText += `\nCAPTION: "${beat.caption}"`;
      if (beat.dialogue) promptText += `\nSPEECH: "${beat.dialogue}"`;

      // User reroll instruction
      if (instruction) {
        promptText += `\n[USER INSTRUCTION]: "${instruction}" - Follow this precisely!`;
        if (!compactMode) {
          promptText += ` Maintain visual consistency with all character references.`;
        }
      }
    }

    // STEP 5: CRITICAL DIRECTIVES V2 (Task 5.2.2 - 2 focused directives, not 4 verbose)
    // Phase 1.2 FIX: Use activeProfiles (page-scoped) — absent characters' hardNegatives should not bleed in.
    if (type !== 'back_cover') {
      promptText += buildCriticalDirectivesV2(activeProfiles);

      // Face drift prevention reminder (reinforces the scene-context warning already in the image block)
      if (prevImage && pageIndex !== undefined && pageIndex >= 2) {
        promptText += `\n[FACE ANCHOR — Page ${pageIndex}] The scene-context image shown at the start is for background/pose ONLY. All character faces MUST match the portrait images shown last in the reference block above.\n`;
      }

      // Feature A: Inject compiled reference descriptors (outfit, weapon, emblem, colors).
      // These are pre-compiled at session start from persona + profile — injected at every page.
      if (compiledRefs.length > 0 && consistencyStrength >= 0.5) {
        promptText += '\n--- COMPILED CHARACTER REFERENCES ---\n';
        compiledRefs.forEach((ref: CharacterReferenceObject) => {
          promptText += ref.compiledDescriptor + '\n';
        });
        promptText += '--- END COMPILED REFERENCES ---\n';
      }

      // Layer 2/4 blocks in non-compact mode, gated by consistencyStrength (Feature E).
      // strength >= 0.5: include full identity blocks. strength < 0.5: skip verbose layers.
      // Uses activeProfiles (page-scoped) to reduce tokens and avoid absent character bleed.
      if (!compactMode && activeProfiles.length > 0 && consistencyStrength >= 0.5) {
        promptText += '\n--- CHARACTER IDENTITY BLOCKS ---\n';
        activeProfiles.forEach(cp => {
          promptText += formatIdentityHeader(cp) + '\n';
        });
        promptText += '--- END IDENTITY BLOCKS ---\n';

        // GAP-17 FIX: Inject extractedColors as a dedicated color enforcement block.
        // Color drift is a common failure — explicit palette reinforcement anchors the model.
        const colorBlocks = activeProfiles
          .filter(cp => cp.extractedColors && (
            cp.extractedColors.skin || cp.extractedColors.hair || cp.extractedColors.eyes ||
            cp.extractedColors.outfit.length > 0 || cp.extractedColors.emblem.length > 0
          ))
          .map(cp => {
            const c = cp.extractedColors!;
            const outfitStr = c.outfit.length > 0 ? c.outfit.join(', ') : '—';
            const emblemStr = c.emblem.length > 0 ? c.emblem.join(', ') : '—';
            return `COLOR PALETTE — ${cp.name.toUpperCase()}: Skin: ${c.skin || '—'} | Hair: ${c.hair || '—'} | Eyes: ${c.eyes || '—'} | Outfit: ${outfitStr} | Emblem: ${emblemStr}`;
          });
        if (colorBlocks.length > 0) {
          promptText += '\n--- CHARACTER COLOR PALETTES (match exactly) ---\n';
          promptText += colorBlocks.join('\n') + '\n';
          promptText += '--- END COLOR PALETTES ---\n';
        }

        promptText += '\n--- CONSISTENCY REQUIREMENTS ---\n';
        activeProfiles.forEach(cp => {
          promptText += formatConsistencyInstruction(cp, storyContext.artStyle || 'Comic Book') + '\n';
        });
        promptText += '---\n';

        // GAP-13: CHARACTER DISAMBIGUATION — inject contrastFeatures when multiple profiles present.
        // Phase 3.3 FIX: Fall back to extractedColors when contrastFeatures is empty,
        // ensuring SOME visual distinction info is always present for multi-character pages.
        if (activeProfiles.length > 1) {
          const disambigLines = activeProfiles.map(p => {
            if (p.contrastFeatures && p.contrastFeatures.length > 0) {
              return `• ${p.name.toUpperCase()}: ${p.contrastFeatures.slice(0, 2).join('; ')}`;
            }
            if (p.extractedColors) {
              const c = p.extractedColors;
              const fallback = [c.hair, c.outfit?.[0]].filter(Boolean).join(', ');
              if (fallback) return `• ${p.name.toUpperCase()}: ${fallback}`;
            }
            return null;
          }).filter((line): line is string => line !== null);
          if (disambigLines.length > 0) {
            promptText += `\n[CHARACTER DISAMBIGUATION]\n${disambigLines.join('\n')}\nDo not mix up these characters.\n`;
          }
        }
      }

      // Maximum consistency: add extra face-lock reinforcement line (Feature E, strength = 1.0)
      if (consistencyStrength >= 1.0 && activeProfiles.length > 0) {
        const faceList = activeProfiles.map(p => {
          const ih = p.identityHeader;
          return ih ? `${p.name.toUpperCase()} (${ih.face}, ${ih.hair})` : p.name.toUpperCase();
        }).join('; ');
        promptText += `\n[MAXIMUM CONSISTENCY] Every character's face MUST be an EXACT visual match to their portrait reference: ${faceList}. No exceptions.\n`;
      }

      // Final anchor (shortened)
      promptText += `\n[ANCHOR: ${selectedGenre.toUpperCase()} comic, ${storyContext.artStyle.toUpperCase()} style]`;
    }

    // STEP 7: Previous page context (text reference)
    if (prevImage && prevBeat) {
      promptText += `\n[CONTINUITY]: Previous scene: "${prevBeat.scene}". Maintain background, lighting, positions.`;
    }

    // Push the post-image prompt text
    contents.push({ text: promptText });

    return executeGeneration(contents, promptText);

    /**
     * Send an assembled request to the image model and normalise the result.
     *
     * Declared as a hoisted function so the v2 branch earlier in this body can
     * call it, while both paths share one copy of the timeout, failure-reason,
     * and metrics handling.
     */
    async function executeGeneration(
      parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
      finalPrompt: string,
    ): Promise<GenerateImageResult> {
    const imageCount = parts.filter(c => 'inlineData' in c).length;
    const textCount = parts.filter(c => 'text' in c).length;
    console.log(`[generateImage] Preparing API call - Mode: ${promptMode}, Images: ${imageCount}, Text blocks: ${textCount}, Prompt length: ${finalPrompt.length} chars`);

    try {
      const ai = getAI();
      console.log(`[generateImage] Calling Gemini API (model: ${MODEL_IMAGE_GEN_NAME})...`);
      const apiStartTime = Date.now();

      // 2-minute timeout guard — Gemini can hang on complex prompts
      const TIMEOUT_MS = 120_000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GENERATION_TIMEOUT')), TIMEOUT_MS)
      );

      const res = await Promise.race([
        ai.models.generateContent({
          model: MODEL_IMAGE_GEN_NAME,
          contents: parts,
          config: {
            imageConfig: {
              aspectRatio: '2:3',
              // 1k at 2:3 is only ~130 DPI at comic trim size — too low for print.
              imageSize: imageResolution.toUpperCase(),
            },
          },
        }),
        timeoutPromise,
      ]);

      const apiDuration = Date.now() - apiStartTime;
      const totalDuration = Date.now() - startTime;

      const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const imageUrl = part?.inlineData?.data
        ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        : '';

      console.log(`[generateImage] Complete - API: ${apiDuration}ms, Total: ${totalDuration}ms, Success: ${imageUrl ? 'Yes' : 'No (empty)'}`);

      if (!imageUrl) {
        const candidate = res.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const safetyRatings = candidate?.safetyRatings;

        console.warn(`[generateImage] Empty image response:`, {
          candidateCount: res.candidates?.length ?? 0,
          finishReason,
          safetyRatings,
          contentParts: candidate?.content?.parts?.map(p => 'text' in p ? 'text' : 'inlineData' in p ? 'image' : 'unknown'),
        });

        // Determine failure reason from API response
        let failureReason: GenerateImageResult['failureReason'] = 'unknown';

        if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST') {
          failureReason = 'safety';
        } else if (finishReason === 'PROHIBITED_CONTENT') {
          failureReason = 'content_policy';
        } else if (safetyRatings?.some(r => r.blocked)) {
          failureReason = 'safety';
        }
        // 'OTHER' was previously reported as a content-policy block. It is a
        // catch-all — recitation checks, internal errors, truncation — and
        // labelling it a policy violation sent users hunting for offensive
        // content that was never there.

        useMetricsStore.getState().recordGeneration('image', false, Date.now() - startTime, 'gemini');
        return { imageUrl: '', originalPrompt: finalPrompt, failureReason };
      }

      useMetricsStore.getState().recordGeneration('image', true, Date.now() - startTime, 'gemini');
      // Feeds the adaptive ETA so later runs estimate from this user's real speed.
      recordGenerationTime(type === 'cover' ? 'cover' : 'image', Date.now() - startTime);
      return { imageUrl, originalPrompt: finalPrompt };
    } catch (e) {
      const totalDuration = Date.now() - startTime;
      console.error(`[generateImage] FAILED after ${totalDuration}ms:`, e);
      onAPIError(e);

      // Determine failure reason from error message
      const errorMsg = String(e).toLowerCase();
      let failureReason: GenerateImageResult['failureReason'] = 'unknown';

      if (errorMsg.includes('generation_timeout')) {
        console.warn(`[generateImage] Timed out after 120s`);
        failureReason = 'timeout';
      } else if (errorMsg.includes('rate') || errorMsg.includes('429') || errorMsg.includes('too many')) {
        failureReason = 'rate_limit';
      } else if (errorMsg.includes('quota') || errorMsg.includes('resource exhausted')) {
        failureReason = 'quota';
      } else if (errorMsg.includes('safety') || errorMsg.includes('blocked')) {
        failureReason = 'safety';
      } else if (errorMsg.includes('permission') || errorMsg.includes('invalid')) {
        failureReason = 'api_key';
      }

      useMetricsStore.getState().recordGeneration('image', false, totalDuration, 'gemini');
      return { imageUrl: '', originalPrompt: finalPrompt, failureReason };
    }
    }
  };

  return { generateImage };
};

export default useGenerateImage;
