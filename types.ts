/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { ensureString } from './claudeHelpers';

// Novel Mode batch size: pages generated per "act" before a decision point.
// 2 = one spread (left + right) before each choice — feels natural in spread view.
export const NOVEL_MODE_BATCH_SIZE = 2;

// Z-Index Constants for consistent modal stacking
export const Z_INDEX = {
    OVERLAY: 400,
    MODAL: 500,
    MODAL_IMPORTANT: 600,
    ALERT: 700,
    LOADING: 800,
} as const;

// Core Configuration Factory
export const getComicConfig = (storyLength: number, extraPages: number = 0, isNovelMode: boolean = false) => {
    // Defensive clamp: guard against 0/negative values from malformed drafts or programmatic calls
    storyLength = Math.max(1, Math.min(20, storyLength || 1));
    // Decision pages: In Novel Mode, EVERY story page is a decision page
    // In Outline Mode, fixed intervals based on story length
    const getDecisionPages = (pages: number, novelMode: boolean): number[] => {
        if (novelMode) {
            // Novel Mode: decision every NOVEL_MODE_BATCH_SIZE pages.
            // e.g. with batch=2: pages 2, 4, 6, 8... — the right page of each spread.
            const decisions: number[] = [];
            for (let p = NOVEL_MODE_BATCH_SIZE; p <= pages; p += NOVEL_MODE_BATCH_SIZE) {
                decisions.push(p);
            }
            // Ensure the last story page is always a decision (wrap-up prompt)
            if (pages > 0 && !decisions.includes(pages)) decisions.push(pages);
            return decisions;
        }
        // Outline Mode: Fixed intervals, filtered to valid range
        let decisionPages: number[];
        if (pages <= 3) decisionPages = [2];           // Quick Shot: 1 decision
        else if (pages <= 6) decisionPages = [2, 4];   // Short Story: 2 decisions
        else decisionPages = [3, 5, 7];                // Standard Issue: 3 decisions

        // Filter out pages that exceed total page count
        return decisionPages.filter(p => p <= pages);
    };

    return {
        MAX_STORY_PAGES: storyLength + extraPages,
        BACK_COVER_PAGE: storyLength + extraPages + 1,
        TOTAL_PAGES: storyLength + extraPages + 1,
        // Novel Mode: pre-generate one full spread before any decision is shown
        INITIAL_PAGES: isNovelMode ? NOVEL_MODE_BATCH_SIZE : 1,
        GATE_PAGE: 1,
        BATCH_SIZE: isNovelMode ? NOVEL_MODE_BATCH_SIZE : 3,
        DECISION_PAGES: getDecisionPages(storyLength + extraPages, isNovelMode)
    };
};

export const ART_STYLES = [
  "Modern American Comic",
  "Classic 90s Marvel",
  "Black & White Manga",
  "Gritty Noir Horror",
  "Watercolor Fantasy",
  "Cinematic 3D Render"
];

export const PAGE_LENGTHS = [
  { label: "Quick Shot (3 Pages)", value: 3 },
  { label: "Short Story (6 Pages)", value: 6 },
  { label: "Standard Issue (9 Pages)", value: 9 }
];
export const GENRES = ["Classic Horror", "Superhero Action", "Dark Sci-Fi", "High Fantasy", "Neon Noir Detective", "Wasteland Apocalypse", "Lighthearted Comedy", "Teen Drama / Slice of Life", "Custom"];
export const TONES = [
    "ACTION-HEAVY (Short, punchy dialogue. Focus on kinetics.)",
    "INNER-MONOLOGUE (Heavy captions revealing thoughts.)",
    "QUIPPY (Characters use humor as a defense mechanism.)",
    "OPERATIC (Grand, dramatic declarations and high stakes.)",
    "CASUAL (Natural dialogue, focus on relationships/gossip.)",
    "WHOLESOME (Warm, gentle, optimistic.)"
];

export const LANGUAGES = [
    { code: 'en-US', name: 'English (US)' },
    { code: 'ar-EG', name: 'Arabic (Egypt)' },
    { code: 'de-DE', name: 'German (Germany)' },
    { code: 'es-MX', name: 'Spanish (Mexico)' },
    { code: 'fr-FR', name: 'French (France)' },
    { code: 'hi-IN', name: 'Hindi (India)' },
    { code: 'id-ID', name: 'Indonesian (Indonesia)' },
    { code: 'it-IT', name: 'Italian (Italy)' },
    { code: 'ja-JP', name: 'Japanese (Japan)' },
    { code: 'ko-KR', name: 'Korean (South Korea)' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'ru-RU', name: 'Russian (Russia)' },
    { code: 'ua-UA', name: 'Ukrainian (Ukraine)' },
    { code: 'vi-VN', name: 'Vietnamese (Vietnam)' },
    { code: 'zh-CN', name: 'Chinese (China)' }
];

export const CHARACTER_ROLES = [
  'Hero',
  'Anti-Hero',
  'Sidekick',
  'Antagonist',
  'Villain',
  'Family/Friend',
  'Custom'
] as const;

export type CharacterRole = typeof CHARACTER_ROLES[number];

// Emblem/Logo Placement Options
export type EmblemPlacement =
  | 'chest-top-right'
  | 'chest-top-left'
  | 'chest-center'
  | 'back'
  | 'face'
  | 'hair'
  | 'shoulder'
  | 'weapon'
  | 'other';

export const EMBLEM_PLACEMENTS: { value: EmblemPlacement; label: string }[] = [
  { value: 'chest-top-right', label: 'Chest (Top Right)' },
  { value: 'chest-top-left', label: 'Chest (Top Left)' },
  { value: 'chest-center', label: 'Chest (Center)' },
  { value: 'back', label: 'Back' },
  { value: 'face', label: 'Face' },
  { value: 'hair', label: 'Hair' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'weapon', label: 'Weapon' },
  { value: 'other', label: 'Other (Manual Entry)' }
];

// ============================================================================
// 4-LAYER CONSISTENCY SYSTEM TYPES
// ============================================================================

/**
 * Structured visual identity description for a character (Layer 2).
 * Each field should be detailed enough to uniquely identify the character.
 */
export interface IdentityHeader {
  /** Face shape and distinctive features. E.g., "Oval shape, high cheekbones, small chin" */
  face: string;
  /** Eye color, shape, spacing. E.g., "Emerald green, almond-shaped, wide-set" */
  eyes: string;
  /** Hair color, style, length. E.g., "Curly auburn, shoulder-length, loose" */
  hair: string;
  /** Skin tone, marks, texture. E.g., "Light olive, scar above left eyebrow" */
  skin: string;
  /** Body type, height, posture. E.g., "Athletic, medium height, confident posture" */
  build: string;
  /** Items/features that should ALWAYS be present. E.g., ["silver pendant", "leather jacket"] */
  signature: string[];
}

/**
 * Regeneration modes for the reroll system
 */
export type RegenerationMode =
  | 'full'              // Regenerate entire panel from scratch
  | 'characters_only'   // Keep scene/background, regenerate all characters
  | 'expression_only'   // Keep everything, only change facial expression
  | 'outfit_only'       // Keep everything, only change clothing
  | 'emblem_only'       // Keep everything, update emblem/logo based on refs or instructions
  | 'weapon_only';      // Keep everything, update weapon based on refs or instructions

/**
 * Reroll options with comic fundamentals overrides
 * These allow users to override the default page plan settings during reroll
 */
export interface RerollOptions {
  /** Regeneration modes (can select multiple: full, characters_only, etc.) - undefined means default/auto */
  regenerationModes?: RegenerationMode[];

  /** User instruction text */
  instruction: string;

  /** Negative prompt - things to EXCLUDE from generation (e.g., "no mask, no cape, no helmet") */
  negativePrompt?: string;

  /** Selected reference images (base64) */
  selectedRefImages: string[];

  /** Selected character profile IDs to enforce */
  selectedProfileIds: string[];

  // === Comic Fundamentals Overrides ===

  /** Override the shot type from page plan */
  shotTypeOverride?: ShotType;

  /** Override the balloon shape for dialogue */
  balloonShapeOverride?: BalloonShape;

  /** Apply flashback styling (sepia, soft edges) */
  applyFlashbackStyle?: boolean;

  /** Reinforce instruction with selected reference images (adds explicit AI directive) */
  reinforceWithReferenceImages?: boolean;

  /** Use ONLY selected reference images (skip default character refs) - Batch 1.3 */
  useSelectedRefsOnly?: boolean;

  /** Previous page image URL for scene continuity reference (optional) */
  prevPageImageUrl?: string;
  /** Next page image URL for scene continuity reference (optional) */
  nextPageImageUrl?: string;

  /** When true, locked character attributes are automatically prepended as hard constraints */
  consistencyMode?: boolean;

  /** Character IDs to preserve from the current panel (others will be regenerated) */
  preserveCharacterIds?: string[];
  /** Base64 image of the current panel — auto-included when preserveCharacterIds is non-empty */
  currentPageImageUrl?: string;
}

export interface Persona {
  id: string;
  name: string;
  base64: string; // The generated or uploaded portrait
  desc: string;
  referenceImage?: string; // Legacy single reference image base64
  referenceImages?: string[]; // Multiple reference images
  role?: CharacterRole;
  customRole?: string; // Used when role is 'Family/Friend' or 'Custom'
  backstoryText?: string;
  backstoryFiles?: { base64: string; mimeType: string; name: string }[];
  // === Emblem/Logo Support ===
  /** Emblem/logo reference image (base64) */
  emblemImage?: string;
  /** Where the emblem should be placed on the character */
  emblemPlacement?: EmblemPlacement;
  /** Custom placement description when emblemPlacement is 'other' */
  emblemPlacementCustom?: string;
  // === Weapon Reference Support ===
  /** Weapon reference image (base64) */
  weaponImage?: string;
  /** Description of the weapon for AI consistency */
  weaponDescriptionText?: string;
  // === Mid-Project Addition Support ===
  /** Timestamp when character was added (for tracking mid-project additions) */
  addedAt?: number;
  /** Whether character has appeared in the comic yet */
  isIntroduced?: boolean;
  /** Which page the character first appears on */
  firstAppearancePage?: number;
  /** All pages where this character appears */
  appearancePages?: number[];

  // === Model Sheet (canonical reference) ===
  /**
   * Generated character model sheet (base64): a turnaround with several angles
   * and expressions, rendered in the target art style.
   *
   * When present this replaces `base64` as the reference sent to the image model.
   * It exists because generating from a raw user photo forces the image model to
   * solve style transfer, re-posing, and scene composition simultaneously on every
   * page — and it re-solves style transfer independently each time, which is the
   * dominant source of face drift across an issue. Solving it once, up front,
   * turns every later page into the much easier "pose this known character".
   */
  modelSheet?: string;
  /** Art style the model sheet was rendered in. Stale sheets are regenerated. */
  modelSheetStyle?: string;
  /** When the model sheet was generated or uploaded. */
  modelSheetAt?: number;
  /**
   * Where the sheet came from. Uploaded sheets are the user's own artwork, so
   * the UI must not imply they were AI-generated, and a reroll would destroy
   * something the app cannot recreate.
   */
  modelSheetSource?: 'generated' | 'uploaded';
}

export interface StoryContext {
  title: string;
  descriptionText: string;
  descriptionFiles: { base64: string; mimeType: string; name: string }[];
  publisherName: string;
  publisherLogo?: string;
  seriesTitle: string;
  issueNumber: string;
  useOverlayLogo: boolean;
  artStyle: string;
  pageLength: number;
  publisherLogoBgColor?: string;
  publisherLogoFit?: 'cover' | 'contain';
  /**
   * A cover the user already has, supplied instead of generating one.
   *
   * The cover is the single most expensive page — it is generated first, before
   * the user has seen anything, and it is the page most often rerolled. Anyone
   * arriving with existing key art should not pay to have it reinvented.
   * Stored as a full data URL so it can be rendered and exported unchanged.
   */
  preGeneratedCover?: string;
  /**
   * How a supplied cover is fitted to the 2:3 page.
   *
   * Generated covers are always 2:3, so the reader could safely force
   * object-fit: cover on them. A supplied cover is whatever shape the user has,
   * and filling crops it — usually taking the title off the top. Defaults to
   * 'contain' so nothing is lost; 'cover' is available for anyone who would
   * rather fill the page and accept the crop.
   */
  preGeneratedCoverFit?: 'contain' | 'cover';
}

/**
 * Reusable comic preset/template for quick story configuration
 * Allows users to start from pre-configured story settings with optional character and plot suggestions
 */
export interface ComicPreset {
  /** Unique identifier for the preset */
  id: string;

  /** Display name of the preset (e.g., "Superhero Origin", "Mystery Thriller") */
  name: string;

  /** Detailed description of what this preset includes and when to use it */
  description: string;

  /** Primary genre of this preset (should match GENRES constant) */
  genre: string;

  /** Recommended art style for this preset (should match ART_STYLES constant) */
  artStyle: string;

  /** Suggested page length for stories using this preset (should match PAGE_LENGTHS values) */
  suggestedPageLength: number;

  /** Optional starting plot outline that users can edit and refine */
  samplePlotOutline?: string;

  /** Optional suggested character templates with roles and AI prompts for generation */
  characterTemplates?: Array<{
    /** Character role (e.g., 'hero', 'costar') */
    role: 'hero' | 'costar' | 'additional';

    /** Suggestion prompt for AI character generation (e.g., "A wise mentor figure with mysterious powers") */
    suggestionPrompt: string;
  }>;

  /** Optional tone suggestion (should match TONES constant) */
  suggestedTone?: string;

  /** Optional thematic keywords to guide AI generation */
  themeKeywords?: string[];

  /** Timestamp when this preset was created */
  createdAt?: number;

  /** Whether this is a built-in system preset or user-created */
  isBuiltIn?: boolean;
}

export interface StoryOutline {
  content: string;
  isReady: boolean;
  isGenerating: boolean;
  /** Per-page breakdown with comic fundamentals (optional for backward compatibility) */
  pageBreakdown?: PageCharacterPlan[];
  /** Timestamp of last edit */
  lastEditedAt?: number;
  /** Version number for conflict detection */
  version?: number;
  /** Whether the outline has been enhanced with comic fundamentals */
  isEnhanced?: boolean;
}

export interface ComicFace {
    id: string;
    type: 'cover' | 'story' | 'back_cover';
    imageUrl?: string;
    isLoading?: boolean;
    hasFailed?: boolean;
    /** Reason for generation failure (safety filter, rate limit, etc.) */
    failureReason?: 'safety' | 'rate_limit' | 'quota' | 'content_policy' | 'timeout' | 'unknown' | string;
    choices: string[];
    isDecisionPage?: boolean;
    resolvedChoice?: string;
    pageIndex?: number;
    narrative?: Beat;
    /** Original prompt used to generate this panel (for debugging/reroll reference) */
    originalPrompt?: string;
    /** Previous choices that were rejected (for reroll to generate different options) */
    previousChoices?: string[];
    /** Original AI-generated choices preserved for reroll (Novel Mode) */
    originalChoices?: string[];
    /** Whether this page is beyond the original target length (Novel Mode) */
    isExtraPage?: boolean;
    /** Custom action that led to this page generation (for drift detection) */
    customActionUsed?: string;
}

/** Novel Mode state for page-by-page interactive flow */
export interface NovelModeState {
    /** Whether user has requested to wrap up the story */
    isWrappingUp: boolean;
    /** Target page count when user started (for tracking "target reached") */
    originalTargetPages: number;
    /** Whether the story has exceeded original target */
    hasExceededTarget: boolean;
    /** History of custom actions for drift detection */
    customActionHistory: { pageIndex: number; action: string; timestamp: number }[];
    /** Whether outline drift has been detected and not yet resolved */
    outlineDriftDetected: boolean;
    /** Summary of detected drift for user prompt */
    driftSummary?: string;
}

/**
 * Structured art direction emitted by the writer model.
 *
 * Replaces prose-parsing of `Beat.scene`. The writer knows what it meant;
 * making it say so directly removes an entire class of parsing bugs and
 * lets the image prompt be assembled from clean fields.
 */
/**
 * What a saved draft is for.
 *
 * 'setup' reopens the welcome screen with the cast and story settings loaded,
 * for editing. 'comic' reopens the rendered pages. Drafts written before this
 * existed carry no kind and are classified by whether they contain finished art.
 */
export type DraftKind = 'setup' | 'comic';

export interface ArtDirection {
  /** Characters physically visible in this panel — role keys ('hero','friend') or exact names. */
  characters_present: string[];
  /** Main subject of the panel (character name, or an object for establishing shots). */
  subject: string;
  /** What is happening — verb phrase only, no location. e.g. "raises her blade overhead" */
  action: string;
  /** Where it happens — setting only, no action. e.g. "flooded cathedral ruins, ankle-deep water" */
  environment: string;
  /** Camera framing. e.g. "low angle, medium shot" */
  camera?: string;
  /** Light source and quality. e.g. "hard rim light from a broken stained-glass window" */
  lighting?: string;
  /** Emotional register. e.g. "defiant" */
  mood?: string;
  /** Explicit tie to the previous panel, for visual continuity. */
  continuity?: string;
}

export interface Beat {
  caption?: string;
  dialogue?: string;
  scene: string;
  choices: string[];
  focus_char: 'hero' | 'friend' | 'other' | string;
  /**
   * Structured art direction. Preferred over parsing `scene`.
   * Optional so beats restored from older drafts still load.
   */
  art?: ArtDirection;
}

export interface CharacterProfile {
  id: string;
  name: string;
  faceDescription: string;
  bodyType: string;
  clothing: string;
  colorPalette: string;
  distinguishingFeatures: string;
  /** Description of emblem/logo and its placement if provided */
  emblemDescription?: string;
  /** User's selected emblem placement (from Persona) */
  emblemPlacement?: string;
  /** Detailed mask description if character wears a mask */
  maskDescription?: string;
  /** Detailed hair information */
  hairDetails?: {
    length: string;
    type: string;
    color: string;
    style: string;
  };
  /** Weapon description if character has a signature weapon */
  weaponDescription?: string;

  // === 4-Layer Consistency System Fields ===
  /** Structured identity header for Layer 2 prompt injection */
  identityHeader?: IdentityHeader;
  /** Features to explicitly EXCLUDE from generation (prevents AI drift) */
  hardNegatives?: string[];
  /** What makes this character visually distinct from others */
  contrastFeatures?: string[];

  // === AI Character Analysis (Feature B) ===
  /** Structured color palette extracted during AI analysis pass */
  extractedColors?: {
    skin: string;
    hair: string;
    eyes: string;
    outfit: string[];
    emblem: string[];
  };
}

// ============================================================================
// CHARACTER CONSISTENCY SYSTEM TYPES (Features A, D)
// ============================================================================

/**
 * Per-character attribute lock state.
 * Locked attributes are injected as immutable hard constraints in every generation prompt.
 * Session-only — not persisted to localStorage.
 */
export interface CharacterLockState {
  characterId: string;
  lockFace: boolean;
  lockOutfit: boolean;
  lockWeapon: boolean;
  lockEmblem: boolean;
}

/**
 * Compiled, frozen character reference object assembled once at session start.
 * Built from Persona + CharacterProfile and passed into every image generation call.
 */
export interface CharacterReferenceObject {
  characterId: string;
  characterName: string;
  /** Full compiled descriptor string for prompt injection */
  compiledDescriptor: string;
  /** Primary colors array for drift detection */
  primaryColors: string[];
  outfitSummary: string;
  weaponSummary: string;
  emblemSummary: string;
  /** Timestamp when this reference was compiled */
  compiledAt: number;
}

// ============================================================================
// VISUAL DRIFT DETECTION TYPES (Feature G)
// ============================================================================

/**
 * Non-blocking warning surfaced when visual drift is detected between consecutive pages.
 */
export interface VisualDriftWarning {
  pageIndex: number;
  characterId: string;
  characterName: string;
  driftType: 'color' | 'composition' | 'unknown';
  severity: 'low' | 'high';
  /** Timestamp when this warning was dismissed by the user */
  dismissedAt?: number;
}

export interface RerollPayload {
  pageIndex: number;
  instruction: string;
  selectedRefImages: string[];  // base64 strings of toggled-on images
  useCharacterProfiles?: boolean;
  regenerationMode?: RegenerationMode;
  // === Comic Fundamentals Overrides ===
  shotTypeOverride?: ShotType;
  balloonShapeOverride?: BalloonShape;
  applyFlashbackStyle?: boolean;
}

// ============================================================================
// 4-LAYER CONSISTENCY HELPER FUNCTIONS
// ============================================================================

/**
 * Analysis context for determining default negatives.
 * Used when identity data may be incomplete but we know certain features exist.
 */
export interface HardNegativesAnalysisContext {
  hasGlasses?: boolean;
  hasMask?: boolean;
  hasBeard?: boolean;
  hasBangs?: boolean;
}

/**
 * Generate hard negatives based on a character's identity header.
 * Prevents common AI drift patterns (adding glasses, changing hair, etc.)
 *
 * @param identity - The character's structured visual identity
 * @param analysisContext - Optional context from profile analysis (overrides identity-based detection)
 * @returns Array of hard negative strings (always includes defaults even if identity is empty)
 */
export function generateHardNegatives(
  identity: IdentityHeader,
  analysisContext?: HardNegativesAnalysisContext
): string[] {
  const negatives: string[] = [];

  // ============================================================================
  // DEFAULT NEGATIVES - Always apply unless explicitly present in analysisContext
  // These prevent the most common AI drift patterns
  // ============================================================================

  // Check glasses - use analysisContext if provided, otherwise check identity
  const allText = JSON.stringify(identity).toLowerCase();
  const hasGlasses = analysisContext?.hasGlasses ?? allText.includes('glass');
  if (!hasGlasses) {
    negatives.push('no glasses');
  }

  // Check beard/facial hair - use analysisContext if provided, otherwise check identity
  const skinLower = identity.skin?.toLowerCase() || '';
  const hasBeard = analysisContext?.hasBeard ??
    (skinLower.includes('beard') || skinLower.includes('facial hair') || allText.includes('beard'));
  if (!hasBeard) {
    negatives.push('no beard', 'no facial hair');
  }

  // Helmet - always exclude (no analysisContext option for this)
  negatives.push('no helmet');

  // Check mask - use analysisContext if provided, otherwise check identity
  const hasMask = analysisContext?.hasMask ?? allText.includes('mask');
  if (!hasMask) {
    negatives.push('no mask');
  }

  // Check bangs - use analysisContext if provided, otherwise check identity
  const hairLower = identity.hair?.toLowerCase() || '';
  const hasBangs = analysisContext?.hasBangs ?? hairLower.includes('bangs');
  if (!hasBangs) {
    negatives.push('no bangs');
  }

  // Earrings - always exclude unless present in identity
  if (!allText.includes('earring')) {
    negatives.push('no earrings');
  }

  // ============================================================================
  // IDENTITY-BASED NEGATIVES - Derived from character's specific features
  // ============================================================================

  // Hair-based negatives (only if hair data exists)
  if (hairLower) {
    if (hairLower.includes('curly')) negatives.push('no straight hair');
    else if (hairLower.includes('straight')) negatives.push('no curly hair');

    if (hairLower.includes('short')) negatives.push('no long hair');
    else if (hairLower.includes('long')) negatives.push('no short hair');
  }

  // Eye color negatives (only if eye data exists)
  const eyeLower = identity.eyes?.toLowerCase() || '';
  if (eyeLower) {
    if (eyeLower.includes('green')) negatives.push('no blue eyes', 'no brown eyes');
    else if (eyeLower.includes('blue')) negatives.push('no green eyes', 'no brown eyes');
    else if (eyeLower.includes('brown')) negatives.push('no blue eyes', 'no green eyes');
  }

  // Freckles negative (only if skin data exists)
  if (skinLower && !skinLower.includes('freckle')) {
    negatives.push('no freckles');
  }

  return negatives;
}

/**
 * The single canonical description of a character, for the v2 prompt assembler.
 *
 * Design rule: every visual fact about a character is stated EXACTLY ONCE, here.
 * The legacy assembler restated the same face/hair/skin values in 8-14 separate
 * blocks per request, each phrased slightly differently — which spends the image
 * model's limited instruction budget reconciling near-duplicates instead of
 * rendering the scene, and lets paraphrase drift introduce contradictions.
 *
 * Keep this compact (target <= 80 words). If you are tempted to add a second
 * place that repeats one of these fields, change this function instead.
 */
/**
 * Strip artefacts that the profile analyser leaves in its own output.
 *
 * Two problems observed in real profiles:
 *  - The JSON template's instruction text gets copied into the value. One stored
 *    emblemDescription literally ended "Include this in EVERY panel featuring
 *    this character." — which then reached the image model as if it described
 *    part of the artwork.
 *  - Proper nouns get invented for emblems ("the Solari emblem: a fractured
 *    eight-pointed star"). Image models letter names they are given: a generated
 *    page came back with the word "SOLARI" written across the character's chest.
 */
export function sanitizeProfileText(text: string): string {
  if (!text) return '';
  let out = ensureString(text);

  // Instructions leaked from the analyser's own prompt template.
  out = out.replace(/\bInclude this in EVERY panel[^.]*\.?/gi, '');
  out = out.replace(/\bIf (?:no|NO)\b[^.]*leave empty string\.?/gi, '');
  out = out.replace(/\bIf (?:an? )?[A-Z/]+ (?:image )?is provided[^.]*\.?/gi, '');

  // "the Solari emblem:" / "her Solari emblem —" → drop the naming, keep the description.
  out = out.replace(/\b(?:the|his|her|their)\s+[A-Z][\w'-]*\s+emblem\s*[:—-]\s*/g, '');
  out = out.replace(/\b(?:known as|called)\s+(?:the\s+)?["“']?[A-Z][\w'-]*["”']?/g, '');

  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Physical traits that are part of the character's body rather than their
 * costume, pulled from `distinguishingFeatures`.
 *
 * This field was previously dead: formatCanonicalCharacter only consulted it
 * when `identityHeader.signature` was absent, and the analyser always populates
 * signature. So for a character described as having "pointed elven ears and a
 * long prehensile tail ending in an arrow-like spade", neither trait ever
 * reached the image model — and neither appeared in any generated page.
 */
export function extractAnatomy(profile: CharacterProfile): string {
  const raw = sanitizeProfileText(ensureString(profile.distinguishingFeatures));
  if (!raw) return '';

  // Keep clauses describing the body; drop ones that are really about costume,
  // which is already covered by `clothing`.
  const COSTUME_WORDS = /\b(suit|armor|armour|outfit|costume|cape|cloak|jacket|boots|gloves|belt|emblem|logo|uniform)\b/i;
  const clauses = raw.split(/[,.;]\s*/).map(c => c.trim()).filter(Boolean);
  const anatomy = clauses.filter(c => !COSTUME_WORDS.test(c));

  return (anatomy.length ? anatomy : clauses).join(', ');
}

export function formatCanonicalCharacter(
  profile: CharacterProfile,
  roleLabel?: string,
): string {
  const ih = profile.identityHeader;
  const lines: string[] = [];

  const header = roleLabel
    ? `${profile.name.toUpperCase()} — ${roleLabel}`
    : profile.name.toUpperCase();
  lines.push(header);

  if (ih) {
    lines.push(`Face: ${ih.face}`);
    const traits = [
      ih.eyes && `eyes ${ih.eyes}`,
      ih.hair && `hair ${ih.hair}`,
      ih.skin && `skin ${ih.skin}`,
      ih.build && `build ${ih.build}`,
    ].filter(Boolean);
    if (traits.length) lines.push(traits.join(' | '));
  } else {
    const face = ensureString(profile.faceDescription);
    if (face) lines.push(`Face: ${face}`);
    const hair = profile.hairDetails
      ? `hair ${[profile.hairDetails.length, profile.hairDetails.color, profile.hairDetails.type, profile.hairDetails.style].filter(Boolean).join(' ')}`
      : '';
    const traits = [hair, profile.bodyType && `build ${ensureString(profile.bodyType)}`].filter(Boolean);
    if (traits.length) lines.push(traits.join(' | '));
  }

  // Non-human anatomy must be stated explicitly. A negative alone ("no rounded
  // ears") does not produce pointed ones; the model needs the positive fact.
  const anatomy = extractAnatomy(profile);
  if (anatomy) lines.push(`Anatomy — always draw: ${anatomy}`);

  const clothing = sanitizeProfileText(profile.clothing);
  if (clothing) lines.push(`Wears: ${clothing}`);

  const mask = sanitizeProfileText(profile.maskDescription ?? '');
  if (mask) lines.push(`Mask (always worn): ${mask}`);

  const emblem = sanitizeProfileText(profile.emblemDescription ?? '');
  if (emblem) {
    const placement = profile.emblemPlacement
      ? `, on ${profile.emblemPlacement.replace(/-/g, ' ')}`
      : '';
    // "no text" is not decoration: a generated page came back with the emblem's
    // invented name lettered across the character's chest.
    lines.push(`Emblem (shape only, no text or letters): ${emblem}${placement}`);
  }

  const weapon = sanitizeProfileText(profile.weaponDescription ?? '');
  if (weapon) lines.push(`Carries: ${weapon}`);

  // Every signature element, not the first three. The old slice(0, 3) silently
  // dropped whatever the analyser happened to list fourth — in one real profile
  // that was "prehensile tail with spade tip", and the tail appeared on no page
  // of the finished issue.
  const signature = (ih?.signature ?? [])
    .map(x => sanitizeProfileText(x))
    .filter(Boolean);
  if (signature.length) lines.push(`Always visible: ${signature.join(', ')}`);

  if (profile.hardNegatives?.length) {
    lines.push(`Never: ${profile.hardNegatives.slice(0, 6).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Compact one-line variant used when many characters share a page and the full
 * block for each would crowd out the scene description.
 */
export function formatCanonicalCharacterBrief(profile: CharacterProfile): string {
  const ih = profile.identityHeader;
  const bits = ih
    ? [ih.face, ih.hair, ih.skin].filter(Boolean)
    : [ensureString(profile.faceDescription), ensureString(profile.colorPalette)].filter(Boolean);
  const never = profile.hardNegatives?.length ? ` | never: ${profile.hardNegatives.slice(0, 2).join(', ')}` : '';
  return `${profile.name.toUpperCase()}: ${bits.join(', ')}${never}`;
}

/**
 * Render structured art direction into the SCENE section of an image prompt.
 *
 * Replaces the old approach of regex-splitting the writer's prose scene on
 * prepositions, which mis-parsed any sentence containing more than one
 * preposition ("stands in the rain, thinking in silence") and silently
 * collapsed action to the literal string "poses" when the scene began with
 * a location clause.
 */
export function formatArtDirection(art: ArtDirection): string {
  const lines: string[] = [];
  lines.push(`SUBJECT: ${art.subject}`);
  lines.push(`ACTION: ${art.action}`);
  lines.push(`SETTING: ${art.environment}`);
  if (art.camera) lines.push(`CAMERA: ${art.camera}`);
  if (art.lighting) lines.push(`LIGHTING: ${art.lighting}`);
  if (art.mood) lines.push(`MOOD: ${art.mood}`);
  if (art.continuity) lines.push(`CONTINUITY: ${art.continuity}`);
  return lines.join('\n');
}

/**
 * Format an identity header block for prompt injection (Layer 2)
 */
export function formatIdentityHeader(profile: CharacterProfile): string {
  if (!profile.identityHeader) {
    // Fallback for profiles without structured identity header
    let result = `
CHARACTER: ${profile.name}
- Face: ${profile.faceDescription}
- Build: ${profile.bodyType}
- Clothing: ${profile.clothing}
- Colors: ${profile.colorPalette}
- Distinguishing: ${profile.distinguishingFeatures}`;
    if (profile.emblemDescription) {
      const placementStr = profile.emblemPlacement ? ` at ${profile.emblemPlacement}` : '';
      result += `\n- EMBLEM/LOGO: ${profile.emblemDescription}${placementStr} [MUST BE VISIBLE AND MATCH REFERENCE EXACTLY]`;
    }
    if (profile.maskDescription) {
      result += `\n- MASK: ${profile.maskDescription} [MUST ALWAYS WEAR THIS MASK]`;
    }
    if (profile.hairDetails) {
      result += `\n- HAIR: ${profile.hairDetails.length} ${profile.hairDetails.color} ${profile.hairDetails.type} hair, ${profile.hairDetails.style}`;
    }
    if (profile.weaponDescription) {
      result += `\n- WEAPON: ${profile.weaponDescription} [SIGNATURE WEAPON]`;
    }
    return result.trim();
  }

  const { identityHeader, hardNegatives, name, emblemDescription, emblemPlacement, maskDescription, hairDetails, weaponDescription } = profile;
  const negativesStr = hardNegatives?.length ? hardNegatives.join(', ') : 'none specified';
  const placementStr = emblemPlacement ? ` PLACEMENT: ${emblemPlacement}.` : '';
  const emblemStr = emblemDescription ? `\n- EMBLEM/LOGO: ${emblemDescription}${placementStr} [MUST ALWAYS BE VISIBLE AND MATCH REFERENCE IMAGE EXACTLY]` : '';
  const maskStr = maskDescription ? `\n- MASK: ${maskDescription} [CHARACTER MUST ALWAYS WEAR THIS MASK]` : '';
  const hairStr = hairDetails ? `\n- HAIR DETAILS: ${hairDetails.length} ${hairDetails.color} ${hairDetails.type} hair, worn ${hairDetails.style}` : '';
  const weaponStr = weaponDescription ? `\n- SIGNATURE WEAPON: ${weaponDescription}` : '';

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHARACTER IDENTITY - ${name.toUpperCase()}:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MUST-MATCH VISUALS:
- Face: ${identityHeader.face}
- Eyes: ${identityHeader.eyes}
- Hair: ${identityHeader.hair}
- Skin: ${identityHeader.skin}
- Build: ${identityHeader.build}
- Signature elements: ${identityHeader.signature.join(', ')}${emblemStr}${maskStr}${hairStr}${weaponStr}

HARD NEGATIVES (never include): ${negativesStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}


/**
 * Generate scene description with character reinforcement (Layer 3)
 */
export function formatReinforcedScene(
  profile: CharacterProfile,
  action: string,
  environment: string
): string {
  const keyFeatures: string[] = [];

  if (profile.identityHeader) {
    // Use structured data
    const firstHairPart = profile.identityHeader.hair.split(',')[0];
    if (firstHairPart) keyFeatures.push(firstHairPart);
    if (profile.identityHeader.signature[0]) keyFeatures.push(profile.identityHeader.signature[0]);
  } else {
    // Fallback to legacy fields - use ensureString to handle object values
    const colorStr = ensureString(profile.colorPalette);
    const featuresStr = ensureString(profile.distinguishingFeatures);
    if (colorStr) keyFeatures.push(colorStr.split(',')[0]);
    if (featuresStr) keyFeatures.push(featuresStr.split(',')[0]);
  }

  const featuresText = keyFeatures.length > 0
    ? `recognizable by their ${keyFeatures.join(' and ')}, `
    : '';

  return `${profile.name}, ${featuresText}${action} in ${environment}.`;
}

/**
 * Generate consistency instruction (Layer 4)
 */
export function formatConsistencyInstruction(
  profile: CharacterProfile,
  artStyle: string
): string {
  const mustBeVisible: string[] = [];

  if (profile.identityHeader?.signature) {
    mustBeVisible.push(...profile.identityHeader.signature.slice(0, 2));
  }
  if (profile.distinguishingFeatures) {
    // Use ensureString to handle object values from AI
    const featuresStr = ensureString(profile.distinguishingFeatures);
    if (featuresStr) mustBeVisible.push(featuresStr.split(',')[0].trim());
  }

  const visibleText = mustBeVisible.length > 0
    ? `The following MUST be visible: ${mustBeVisible.join(', ')}.`
    : '';

  // Build emblem reinforcement
  let emblemReinforcement = '';
  if (profile.emblemDescription) {
    const placement = profile.emblemPlacement ? ` at ${profile.emblemPlacement}` : '';
    emblemReinforcement = `\nEMBLEM/LOGO REQUIREMENT: ${profile.name} MUST have their emblem (${profile.emblemDescription})${placement}. Copy the exact design from the reference image - same shape, colors, and proportions.`;
  } else {
    // No emblem description - instruct AI to rely on reference images if uploaded
    emblemReinforcement = `\nEMBLEM/LOGO FALLBACK: No emblem description available for ${profile.name}. If an EMBLEM reference image was uploaded for this character, you MUST study it carefully and reproduce the exact emblem design, shape, colors, and placement from that reference image.`;
  }

  // Build clothing/armor reinforcement
  let clothingReinforcement = '';
  if (profile.clothing) {
    const clothingStr = ensureString(profile.clothing);
    clothingReinforcement = `\nCLOTHING/ARMOR REQUIREMENT: ${profile.name} MUST wear their signature outfit as shown in reference: ${clothingStr}. Do not change, simplify, or modify the costume design.`;
  } else {
    // No clothing description - instruct AI to rely on reference images if uploaded
    clothingReinforcement = `\nCLOTHING/ARMOR FALLBACK: No suit/clothing description available for ${profile.name}. You MUST rely HEAVILY on the uploaded portrait and character reference images to accurately reproduce their costume, suit, armor, and accessories. Copy every visible detail from the reference images exactly.`;
  }

  return `
CONSISTENCY REQUIREMENT: Maintain ${profile.name}'s exact appearance from the reference image.
${visibleText}${emblemReinforcement}${clothingReinforcement}
Art style: ${artStyle} (maintain consistently throughout).
Do not alter facial structure, eye color, hair style, clothing design, or distinguishing features.
`.trim();
}

// ============================================================================
// COMIC FUNDAMENTALS TYPES (Based on McCloud's Understanding Comics)
// ============================================================================

/**
 * McCloud's 6 Panel Transition Types
 * These define how panels relate to each other temporally and spatially.
 */
export type TransitionType =
  | 'moment-to-moment'    // Tiny time gap, slow-motion effect (rare: ~2%)
  | 'action-to-action'    // Single subject progressing through action (most common: ~65%)
  | 'subject-to-subject'  // Same scene, different subject (dialogue scenes: ~20%)
  | 'scene-to-scene'      // Time/location jump (narrative advancement: ~10%)
  | 'aspect-to-aspect'    // Different aspects of same place/mood (atmospheric: ~2%)
  | 'non-sequitur';       // No logical connection (surreal/experimental: ~1%)

/**
 * Camera/Shot Types for Panel Composition
 * Controls how characters are framed in the panel.
 */
export type ShotType =
  | 'extreme-close-up'    // Eyes/detail only - maximum emotional impact
  | 'close-up'            // Face fills frame - emotion focus
  | 'medium'              // Waist-up - balance of character and context
  | 'full'                // Complete figure - body language emphasis
  | 'wide'                // Environment prominent with characters
  | 'extreme-wide';       // Establishing shot - vast environment, small figures

/**
 * Panel Layout Options for Page Composition
 * Determines how panels are arranged on a page.
 */
export type PanelLayout =
  | 'splash'              // Full page single panel (dramatic moments, reveals)
  | 'horizontal-split'    // 2 wide panels stacked (landscapes, calm moments)
  | 'vertical-split'      // 2 tall panels side-by-side (simultaneous events)
  | 'grid-2x2'            // 4 panels (fast pacing, quick moments)
  | 'grid-2x3'            // 6 panels (standard narrative, dialogue - MOST COMMON)
  | 'grid-3x3'            // 9 panels (dense, tension building, detailed)
  | 'asymmetric';         // Mixed sizes (dynamic action, small-small-small-LARGE)

/**
 * Emotional Beat Types for Narrative Flow
 * Helps AI understand the purpose of each page in the story.
 */
export type EmotionalBeat =
  | 'establishing'        // Scene setup, introduce setting
  | 'action'              // Physical activity, movement
  | 'dialogue'            // Conversation focus
  | 'reaction'            // Character response to events
  | 'climax'              // Peak dramatic moment
  | 'transition'          // Scene change, time passage
  | 'reveal';             // Surprise, twist, important information

/**
 * Balloon Shape Types for Dialogue
 * Different shapes convey different voice qualities.
 */
export type BalloonShape =
  | 'oval'                // Normal speech (default)
  | 'burst'               // Shouting, excitement, anger
  | 'wavy'                // Weak, distressed, injured
  | 'dashed'              // Whisper, quiet
  | 'cloud'               // Thought (deprecated but available)
  | 'rectangle'           // Robotic, electronic, AI
  | 'jagged'              // Radio, phone, broadcast
  | 'inverted';           // Alien, otherworldly (black bg, white text)

/**
 * Caption Box Types for Narration
 */
export type CaptionType =
  | 'narration'           // Third-person storytelling (yellow default)
  | 'internal-monologue'  // Character thoughts (character-colored)
  | 'location-time'       // Setting info ("Meanwhile...", "Later that night...")
  | 'flashback'           // Past events (sepia styling)
  | 'editorial';          // Writer/editor notes

/**
 * Pacing Intent for Reading Speed Control
 */
export type PacingIntent = 'slow' | 'medium' | 'fast';

// ============================================================================
// ENHANCED OUTLINE & PAGE PLANNING TYPES
// ============================================================================

/**
 * Per-page plan that includes comic fundamentals.
 * Generated as part of the enhanced outline.
 */
export interface PageCharacterPlan {
  /** Page number (1-indexed) */
  pageIndex: number;

  /** Characters who appear on this page (IDs: 'hero', 'friend', or additionalCharacter.id) */
  primaryCharacters: string[];

  /** Characters who may appear but aren't focus */
  secondaryCharacters?: string[];

  /** The main focus character for this page */
  focusCharacter: string;

  /** Brief scene description from outline */
  sceneDescription?: string;

  /** Extracted setting/environment from sceneDescription */
  location?: string;

  /** Whether this is a decision/choice page (Novel Mode) */
  isDecisionPage: boolean;

  // === Comic Fundamentals ===

  /** How the page panels should be arranged */
  panelLayout: PanelLayout;

  /** Override panel count for asymmetric layouts */
  panelCount?: number;

  /** How this page transitions to the next */
  transitionType: TransitionType;

  /** Suggested camera framing */
  suggestedShot: ShotType;

  /** Type of story beat */
  emotionalBeat: EmotionalBeat;

  /** Reading speed intent */
  pacingIntent: PacingIntent;

  /** Caption styling type */
  captionType?: CaptionType;

  /** Whether to apply flashback visual styling (sepia, soft edges) */
  isFlashback?: boolean;

  /** Dialogue volume hint for balloon shape */
  dialogueVolume?: 'whisper' | 'normal' | 'loud' | 'shouting';
}

/**
 * Enhanced story outline with per-page breakdown.
 */
export interface EnhancedStoryOutline {
  /** Full narrative text */
  content: string;

  /** Per-page character and comic fundamentals plans */
  pageBreakdown: PageCharacterPlan[];

  /** Whether outline is ready for generation */
  isReady: boolean;

  /** Whether outline is currently being generated */
  isGenerating: boolean;

  /** Timestamp of last edit */
  lastEditedAt?: number;

  /** Version number for conflict detection */
  version?: number;

  /** Whether the outline has been enhanced with comic fundamentals */
  isEnhanced?: boolean;
}

/**
 * Enhanced persona with mid-project addition support
 */
export interface EnhancedPersona extends Persona {
  /** Timestamp when character was added */
  addedAt?: number;

  /** Whether character has appeared in the comic yet */
  isIntroduced?: boolean;

  /** Which page the character first appears on */
  firstAppearancePage?: number;

  /** All pages where this character appears */
  appearancePages?: number[];
}

// ============================================================================
// VILLAIN GENERATOR TYPES
// ============================================================================

/**
 * Villain relationship to the hero - defines the narrative dynamic
 */
export type VillainRelationship =
  | 'rival'         // Competitive relationship, similar goals/methods, different approach
  | 'nemesis'       // Arch-enemy, personal vendetta, opposite sides of a conflict
  | 'former-ally'   // Once friends/partners, now enemies due to betrayal or ideology
  | 'mirror'        // Dark reflection of the hero, same powers/origin but different choices
  | 'oppressor';    // Powerful tyrant/system that the hero fights against

/**
 * Threat level determines the villain's role in the story hierarchy
 */
export type ThreatLevel =
  | 'minion'        // Low-level threat, easily defeated, serves a greater villain
  | 'lieutenant'    // Mid-tier threat, commands minions, answers to the big bad
  | 'boss'          // Major threat for a story arc, significant challenge for the hero
  | 'arch-nemesis'; // Ultimate enemy, recurring threat across multiple stories

/**
 * Extended Persona interface for villains with additional antagonist-specific fields
 */
export interface VillainPersona extends Persona {
  /** How this villain relates to the hero narratively */
  relationshipToHero: VillainRelationship;

  /** What drives this villain - their core motivation */
  motivation: string;

  /** The villain's vulnerability or fatal flaw */
  weakness: string;

  /** Where this villain fits in the threat hierarchy */
  threatLevel: ThreatLevel;

  /** Optional: The villain's primary power or method of operation */
  primaryPower?: string;

  /** Optional: A memorable catchphrase or signature line */
  catchphrase?: string;
}

// ============================================================================
// COMIC FUNDAMENTALS HELPER FUNCTIONS
// ============================================================================

/**
 * Get balloon shape based on dialogue context
 */
export function selectBalloonShape(
  volume?: 'whisper' | 'normal' | 'loud' | 'shouting',
  emotion?: 'calm' | 'angry' | 'sad' | 'weak' | 'frightened',
  medium?: 'phone' | 'radio' | 'telepathy' | 'robotic'
): BalloonShape {
  if (medium === 'phone' || medium === 'radio') return 'jagged';
  if (medium === 'robotic') return 'rectangle';
  if (medium === 'telepathy') return 'cloud';
  if (volume === 'shouting') return 'burst';
  if (volume === 'whisper') return 'dashed';
  if (emotion === 'weak' || emotion === 'frightened') return 'wavy';
  return 'oval';
}

/**
 * Get caption color based on type and character
 */
export interface CaptionColorScheme {
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
  fontStyle?: 'normal' | 'italic';
}

export const CAPTION_COLORS: Record<CaptionType, CaptionColorScheme> = {
  'narration': { backgroundColor: '#F5E050', textColor: '#000', fontStyle: 'italic' },
  'internal-monologue': { backgroundColor: '#FFE4B5', textColor: '#000', fontStyle: 'italic' },
  'location-time': { backgroundColor: '#333', textColor: '#FFF', fontStyle: 'normal' },
  'flashback': { backgroundColor: '#D4A574', textColor: '#3D2914', fontStyle: 'italic' },
  'editorial': { backgroundColor: '#E0E0E0', textColor: '#333', fontStyle: 'italic' },
};

/**
 * Get layout prompt instructions based on panel layout type
 */
export function getLayoutInstructions(layout: PanelLayout): string {
  const instructions: Record<PanelLayout, string> = {
    'splash': 'FULL PAGE SPLASH: Single dramatic image filling the entire page. This is a KEY MOMENT - maximum visual impact. Leave space at top for title/credits if needed.',
    'horizontal-split': 'TWO HORIZONTAL PANELS: Two wide panels stacked vertically. Good for panoramic scenes or showing cause-and-effect.',
    'vertical-split': 'TWO VERTICAL PANELS: Two tall panels side-by-side. Good for showing simultaneous events or character comparison.',
    'grid-2x2': 'FOUR-PANEL GRID (2×2): Quick, punchy pacing. Each panel should be a distinct beat in a rapid sequence.',
    'grid-2x3': 'SIX-PANEL GRID (2×3): Standard comic layout. Balanced pacing for dialogue and narrative progression.',
    'grid-3x3': 'NINE-PANEL GRID (3×3): Dense, controlled pacing. Each small panel builds tension. Used for suspense or detailed sequences.',
    'asymmetric': 'ASYMMETRIC LAYOUT: Mix of panel sizes. Use the "small-small-small-LARGE" pattern: buildup panels leading to a dramatic payoff panel.',
  };
  return instructions[layout];
}

/**
 * Get shot framing instructions based on shot type
 */
export function getShotInstructions(shot: ShotType): string {
  const instructions: Record<ShotType, string> = {
    'extreme-close-up': 'EXTREME CLOSE-UP: Show only eyes or a single detail. Maximum emotional intensity. Fill frame with the subject.',
    'close-up': 'CLOSE-UP: Face fills most of the frame. Capture subtle emotions clearly. Minimal background visible.',
    'medium': 'MEDIUM SHOT: Waist-up framing. Balance between character expression and environmental context.',
    'full': 'FULL SHOT: Complete figure visible head to toe. Emphasize body language and posture. Some environment context.',
    'wide': 'WIDE SHOT: Environment prominent with characters clearly visible. Establish spatial relationships.',
    'extreme-wide': 'ESTABLISHING SHOT: Vast environment dominates. Characters may be small or silhouetted. Set the scene\'s scope.',
  };
  return instructions[shot];
}

/**
 * Get transition context for narrative flow
 */
export function getTransitionContext(
  transitionType: TransitionType,
  previousScene?: string
): string {
  const prevContext = previousScene ? ` Previous scene: "${previousScene}"` : '';

  const contexts: Record<TransitionType, string> = {
    'moment-to-moment': `SLOW MOTION: This panel shows the very next moment. Minimal time has passed.${prevContext} Keep camera angle similar, show subtle change.`,
    'action-to-action': `ACTION CONTINUATION: This follows the action sequence.${prevContext} Show the next beat in the physical movement.`,
    'subject-to-subject': `SAME SCENE, NEW FOCUS: Same time and place, different subject.${prevContext} Shift attention to another character or element.`,
    'scene-to-scene': `NEW SCENE: Time and/or location has changed.${prevContext} This is a fresh moment - establish the new context.`,
    'aspect-to-aspect': `ATMOSPHERIC: Same location, different aspect.${prevContext} Focus on environmental detail to set mood.`,
    'non-sequitur': `SURREAL CUT: No logical connection required.${prevContext} Abstract or dreamlike transition.`,
  };

  return contexts[transitionType];
}

/**
 * Get flashback styling instructions
 */
export function getFlashbackInstructions(): string {
  return `
FLASHBACK STYLING:
- Apply SEPIA/WARM BROWN color palette
- Add SOFT VIGNETTE around panel edges
- Slightly DESATURATED colors (except sepia tones)
- SOFTER LIGHTING than present-day scenes
- Consider FILM GRAIN or AGED PAPER texture effect
- Memory/nostalgic quality throughout
`.trim();
}
