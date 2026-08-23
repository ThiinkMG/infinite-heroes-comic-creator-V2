/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * V2 image-prompt assembler.
 *
 * Design rule, and the whole reason this file exists: every visual fact about a
 * character is stated EXACTLY ONCE, immediately next to that character's
 * reference image. The legacy assembler restated the same face/hair/skin values
 * across 8-14 separate blocks in a single request (front summary, inline
 * identity, critical directives, compiled refs, identity blocks, color palettes,
 * consistency requirements, disambiguation, maximum-consistency, re-anchor,
 * face-anchor, final anchor). Each restatement was independently worded, so the
 * model spent attention reconciling near-duplicate instructions instead of
 * rendering the scene — and paraphrase drift let them quietly contradict.
 *
 * If you want to change what the model is told about a character, change
 * formatCanonicalCharacter() in types.ts. Do not add a second block here.
 */

import {
  Beat,
  BalloonShape,
  CharacterProfile,
  ComicFace,
  Persona,
  ShotType,
  StoryContext,
  formatArtDirection,
  formatCanonicalCharacter,
  formatCanonicalCharacterBrief,
  getShotInstructions,
} from '../types';
import type { CharacterLockState } from '../types';

/** One character as the assembler needs them: identity plus every image we hold. */
export interface V2Character {
  persona: Persona;
  profile?: CharacterProfile;
  /** Human-readable role for the header line, e.g. "hero", "villain". */
  roleLabel: string;
  /**
   * Canonical reference image (base64, with or without data: prefix).
   * A generated model sheet when available, otherwise the user's portrait.
   */
  referenceImage?: string;
  /** True when referenceImage is a generated model sheet rather than a raw portrait. */
  isModelSheet: boolean;
  /** Additional costume references. Capped at one — more dilutes the portrait signal. */
  outfitRefs: string[];
  emblem?: { image: string; placement: string };
  weapon?: { image: string; description: string };
  locks?: CharacterLockState;
  /** Copy this character verbatim from the existing panel instead of regenerating. */
  isPreserved: boolean;
}

export interface V2Input {
  beat: Beat;
  type: ComicFace['type'];
  storyContext: StoryContext;
  genre: string;
  /**
   * Page-scoped and pre-ordered: preserved characters first (lowest weight),
   * the focus character last (Gemini weights later images most heavily).
   */
  characters: V2Character[];
  /** Previous/adjacent pages, for background and lighting continuity only. */
  sceneContext?: Array<{ base64: string; label: string }>;
  /** Existing panel being partially regenerated. */
  preserveImage?: string;
  instruction?: string;
  shotType?: ShotType;
  isFlashback?: boolean;
  balloonShape?: BalloonShape;
  panelLayout?: string;
  location?: string;
  publisherLogo?: string;
  /** 0.3-1.0. Controls descriptor detail and how hard the match rule is worded. */
  consistencyStrength: number;
  compact: boolean;
}

export type PromptPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface V2Output {
  contents: PromptPart[];
  /** Concatenated text, for logging and for storing as the page's originalPrompt. */
  promptText: string;
}

const BALLOON_INSTRUCTIONS: Record<BalloonShape, string> = {
  oval: 'oval speech balloons',
  burst: 'spiky burst balloons (shouting)',
  wavy: 'wavy balloons (weak or distressed speech)',
  dashed: 'dashed-outline balloons (whispering)',
  cloud: 'cloud balloons (thoughts)',
  rectangle: 'rectangular boxes (robotic or synthetic voice)',
  jagged: 'jagged balloons (radio or transmission)',
  inverted: 'inverted balloons, white text on black (alien voice)',
};

/**
 * Build the full request body for one panel.
 *
 * @param mime Resolver for base64 image MIME types, injected so this module
 *             stays independent of the caller's helper imports.
 */
export function buildV2Prompt(
  input: V2Input,
  mime: (base64: string) => string,
): V2Output {
  const {
    beat, type, storyContext, genre, characters, sceneContext, preserveImage,
    instruction, shotType, isFlashback, balloonShape, panelLayout, location,
    publisherLogo, consistencyStrength, compact,
  } = input;

  const contents: PromptPart[] = [];
  const textLog: string[] = [];

  const push = (text: string) => {
    contents.push({ text });
    textLog.push(text);
  };
  const pushImage = (base64: string) => {
    const data = base64.includes(',') ? base64.split(',')[1] : base64;
    contents.push({ inlineData: { mimeType: mime(data), data } });
  };

  const artStyle = storyContext.artStyle || 'Modern American Comic';
  const brief = consistencyStrength < 0.5;

  // --------------------------------------------------------------------------
  // 1. Style contract. Stated once, at the top, never repeated.
  // --------------------------------------------------------------------------
  push(
    `Draw one ${type === 'cover' ? 'comic book cover' : 'vertical comic book page'}.\n` +
    `Art style: ${artStyle}. Genre: ${genre}.\n` +
    `Finished comic art: confident ink linework, flat vibrant color, dramatic lighting.`
  );

  // --------------------------------------------------------------------------
  // 2. Cast. One canonical description per character, each followed by its own
  //    images. This is the ONLY place character appearance is described.
  // --------------------------------------------------------------------------
  if (characters.length > 0) {
    const anySheet = characters.some(c => c.isModelSheet);
    push(
      `\nCAST — the characters on this page.\n` +
      `Each description below applies to the image or images that follow it. ` +
      (anySheet
        ? `Model sheets show each character from several angles; use them for face, hair, skin, and costume. `
        : `Reference images are neutral standing portraits; use them for face, hair, skin, and costume. `) +
      `Pose each character to fit the scene — do not copy the reference pose.`
    );

    for (const c of characters) {
      const name = c.persona.name || 'Character';

      // The one canonical descriptor.
      const descriptor = c.profile
        ? (brief
            ? formatCanonicalCharacterBrief(c.profile)
            : formatCanonicalCharacter(c.profile, c.roleLabel))
        : `${name.toUpperCase()} — ${c.roleLabel}`;

      push(`\n${descriptor}`);

      if (c.referenceImage) {
        push(c.isModelSheet ? `${name} model sheet:` : `${name} reference:`);
        pushImage(c.referenceImage);
      }
      // At most one costume ref: additional refs dilute the primary signal.
      c.outfitRefs.slice(0, 1).forEach(ref => {
        push(`${name} costume reference:`);
        pushImage(ref);
      });
      if (c.emblem) {
        push(`${name}'s emblem — reproduce exactly, on ${c.emblem.placement}:`);
        pushImage(c.emblem.image);
      }
      if (c.weapon) {
        push(`${name}'s ${c.weapon.description}:`);
        pushImage(c.weapon.image);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. Scene-continuity images. Explicitly scoped away from faces so they do not
  //    compete with the cast references above.
  // --------------------------------------------------------------------------
  if (sceneContext?.length) {
    push(
      `\nCONTINUITY REFERENCES — for background, palette, and lighting only. ` +
      `Do not take faces, hair, or skin from these; those come from the CAST references above.`
    );
    for (const ctx of sceneContext) {
      push(ctx.label);
      pushImage(ctx.base64);
    }
  }

  if (preserveImage) {
    push(`\nEXISTING PANEL — keep its background, lighting, and composition. Change only what the rules below specify:`);
    pushImage(preserveImage);
  }

  if (type === 'cover' && publisherLogo) {
    push(`Publisher logo:`);
    pushImage(publisherLogo);
  }

  // --------------------------------------------------------------------------
  // 4. The scene itself.
  // --------------------------------------------------------------------------
  if (type === 'cover') {
    if (storyContext.useOverlayLogo) {
      push(
        `\nCOVER: dynamic hero action shot. Leave clear space across the top third for a ` +
        `title overlay. Draw no text, letters, or logos anywhere.`
      );
    } else {
      push(
        `\nCOVER: dynamic hero action shot.\n` +
        `SERIES: "${storyContext.seriesTitle.toUpperCase()}"\n` +
        `TITLE: "${storyContext.title || 'Untitled'}"\n` +
        `PUBLISHER: "${storyContext.publisherName.toUpperCase()}"  ISSUE: #${storyContext.issueNumber || '1'}\n` +
        `Letter the series title and issue number prominently in comic cover style.`
      );
    }
  } else if (type === 'back_cover') {
    push(`\nBACK COVER: full-page dramatic teaser image. Include the text "NEXT ISSUE SOON".`);
  } else {
    // Structured art direction when the writer supplied it; prose scene otherwise.
    const sceneBlock = beat.art
      ? formatArtDirection(beat.art)
      : `SCENE: ${beat.scene}`;
    const where = location ? `\nLOCATION: ${location}` : '';
    push(`\n${sceneBlock}${where}`);

    const staging: string[] = [];
    if (shotType) {
      // getShotInstructions returns undefined for values outside ShotType (the
      // outline model occasionally invents its own, e.g. "low-angle"), which
      // would otherwise inject the literal string "undefined" into the prompt.
      const shotText = compact ? `Shot: ${shotType}.` : getShotInstructions(shotType);
      staging.push(shotText || `Shot: ${shotType}.`);
    }
    if (panelLayout === 'splash') staging.push('Full-page splash — maximum visual impact.');
    else if (panelLayout?.startsWith('grid')) staging.push('Multi-panel page — tighter framing.');
    else if (panelLayout === 'asymmetric') staging.push('Dynamic asymmetric layout.');
    if (isFlashback) staging.push('Flashback: desaturated sepia palette with soft vignette edges.');
    if (staging.length) push(staging.join(' '));
  }

  // --------------------------------------------------------------------------
  // 5. Lettering.
  // --------------------------------------------------------------------------
  if (type !== 'back_cover' && (beat.caption || beat.dialogue)) {
    const letters: string[] = ['\nTEXT ON PAGE — letter exactly as written, no other text:'];
    if (beat.caption) letters.push(`Caption box: "${beat.caption}"`);
    if (beat.dialogue) letters.push(`Speech: "${beat.dialogue}"`);
    if (balloonShape && !compact) letters.push(`Use ${BALLOON_INSTRUCTIONS[balloonShape]}.`);
    push(letters.join('\n'));
  }

  // --------------------------------------------------------------------------
  // 6. Rules. One block. Each rule appears once.
  // --------------------------------------------------------------------------
  const rules: string[] = [];

  if (characters.length > 0) {
    rules.push(
      consistencyStrength >= 0.8
        ? 'Every face must match its CAST reference exactly — same bone structure, same hair, same skin tone. This matters more than an interesting pose.'
        : 'Keep each face recognisably the same person as its CAST reference.'
    );
    rules.push('Costumes match their references: same colors, same emblems, same accessories, nothing simplified or invented.');
  }

  const preserved = characters.filter(c => c.isPreserved);
  const regenerated = characters.filter(c => !c.isPreserved);
  if (preserved.length > 0 && preserveImage) {
    rules.push(`Copy these characters unchanged from the existing panel: ${preserved.map(c => c.persona.name.toUpperCase()).join(', ')}.`);
    if (regenerated.length > 0) {
      rules.push(`Redraw these to match their CAST references: ${regenerated.map(c => c.persona.name.toUpperCase()).join(', ')}.`);
    }
  }

  // Locked attributes, collapsed to one line per character.
  for (const c of characters) {
    if (!c.locks) continue;
    const locked = [
      c.locks.lockFace && 'face',
      c.locks.lockOutfit && 'costume',
      c.locks.lockEmblem && 'emblem',
      c.locks.lockWeapon && 'weapon',
    ].filter(Boolean) as string[];
    if (locked.length) {
      rules.push(`${c.persona.name.toUpperCase()}'s ${locked.join(', ')} is locked — it cannot change or be removed in this panel.`);
    }
  }

  // Negatives, merged across the page's cast so each appears once.
  const negatives = [...new Set(
    characters.flatMap(c => c.profile?.hardNegatives ?? [])
  )];
  if (negatives.length) rules.push(`Never draw: ${negatives.join(', ')}.`);

  // Disambiguation only when it can actually help.
  if (characters.length > 1) {
    const contrasts = characters
      .map(c => {
        const cf = c.profile?.contrastFeatures?.slice(0, 2);
        if (cf?.length) return `${c.persona.name.toUpperCase()} — ${cf.join('; ')}`;
        const ec = c.profile?.extractedColors;
        const fallback = [ec?.hair, ec?.outfit?.[0]].filter(Boolean).join(', ');
        return fallback ? `${c.persona.name.toUpperCase()} — ${fallback}` : null;
      })
      .filter((x): x is string => x !== null);
    if (contrasts.length > 1) {
      rules.push(`Keep these characters distinct: ${contrasts.join(' / ')}.`);
    }
  }

  if (instruction) {
    rules.push(`User instruction, follow precisely: "${instruction}"`);
  }

  if (rules.length) {
    push('\nRULES:\n' + rules.map(r => `- ${r}`).join('\n'));
  }

  return { contents, promptText: textLog.join('\n') };
}

export default buildV2Prompt;
