/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Accessibility helpers for comic content.
 *
 * A comic is an image-native medium, so without these the entire substance of
 * the app is invisible to screen readers: panels previously carried alt text
 * reading only "Comic panel page 3", while the scene description, caption, and
 * dialogue that describe exactly what is in the image sat unused in state.
 *
 * Two things live here:
 *  - describeFace(): real alt text, built from the narrative the writer produced.
 *  - buildScript():  the whole issue as readable text, which is both the proper
 *                    text alternative for the artwork and a genuinely useful
 *                    feature (proofreading, sharing, exporting a script).
 */

import type { ComicFace, Persona } from '../types';

/** Trim trailing punctuation so generated sentences do not double up. */
const clean = (s: string): string => s.trim().replace(/[.\s]+$/, '');

/**
 * Resolve a beat's focus_char to a display name.
 * Falls back to the role word when no persona matches, rather than leaking
 * the internal key ('friend') into user-facing text.
 */
const speakerName = (
  focus: string | undefined,
  cast: { hero?: Persona | null; friend?: Persona | null; others?: Persona[] },
): string => {
  if (!focus) return 'A character';
  if (focus === 'hero') return cast.hero?.name || 'The hero';
  if (focus === 'friend') return cast.friend?.name || 'The co-star';
  const match = cast.others?.find(c => c.id === focus || c.name === focus);
  return match?.name || focus;
};

export interface CastRef {
  hero?: Persona | null;
  friend?: Persona | null;
  others?: Persona[];
}

/**
 * Build descriptive alt text for one page.
 *
 * Screen-reader users get the scene, then the caption, then who says what —
 * the same information a sighted reader takes from the panel.
 */
export function describeFace(face: ComicFace, cast: CastRef = {}): string {
  const parts: string[] = [];

  const label =
    face.type === 'cover' ? 'Comic cover'
    : face.type === 'back_cover' ? 'Back cover'
    : `Page ${face.pageIndex ?? ''}`.trim();
  parts.push(label);

  if (face.isLoading) return `${label}, still generating.`;
  if (face.hasFailed) return `${label} could not be generated.`;

  const n = face.narrative;
  if (n) {
    // Structured art direction, when present, is cleaner than the prose scene.
    if (n.art) {
      const bits = [n.art.subject, n.art.action].filter(Boolean).join(' ');
      const where = n.art.environment ? ` in ${clean(n.art.environment)}` : '';
      if (bits) parts.push(`${clean(bits)}${where}`);
    } else if (n.scene) {
      parts.push(clean(n.scene));
    }

    if (n.caption) parts.push(`Caption: ${clean(n.caption)}`);
    if (n.dialogue) parts.push(`${speakerName(n.focus_char, cast)} says: ${clean(n.dialogue)}`);
  }

  if (face.choices?.length) {
    parts.push(`Choices: ${face.choices.map(clean).join('; or ')}`);
  }

  return parts.join('. ') + '.';
}

export interface ScriptEntry {
  pageLabel: string;
  scene: string;
  caption?: string;
  speaker?: string;
  dialogue?: string;
  choices?: string[];
  resolvedChoice?: string;
}

/**
 * Render the whole comic as a readable script.
 *
 * Doubles as the text alternative for the artwork and as an export the user can
 * proofread or share. Pages that never rendered are included and marked, so the
 * script never silently misrepresents what the issue contains.
 */
export function buildScript(faces: ComicFace[], cast: CastRef = {}): ScriptEntry[] {
  return faces
    .slice()
    .sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0))
    .map(face => {
      const n = face.narrative;
      const label =
        face.type === 'cover' ? 'COVER'
        : face.type === 'back_cover' ? 'BACK COVER'
        : `PAGE ${face.pageIndex ?? '?'}`;

      const scene = n?.art
        ? [n.art.subject, n.art.action, n.art.environment ? `in ${n.art.environment}` : '']
            .filter(Boolean).join(' ')
        : n?.scene || (face.hasFailed ? '[art failed to generate]' : '[no scene recorded]');

      return {
        pageLabel: label,
        scene: clean(scene),
        caption: n?.caption ? clean(n.caption) : undefined,
        speaker: n?.dialogue ? speakerName(n.focus_char, cast) : undefined,
        dialogue: n?.dialogue ? clean(n.dialogue) : undefined,
        choices: face.choices?.length ? face.choices.map(clean) : undefined,
        resolvedChoice: face.resolvedChoice ? clean(face.resolvedChoice) : undefined,
      };
    });
}

/** Flatten a script to plain text, for copying or downloading. */
export function scriptToText(entries: ScriptEntry[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(title.toUpperCase(), '='.repeat(title.length), '');

  for (const e of entries) {
    lines.push(e.pageLabel);
    lines.push('-'.repeat(e.pageLabel.length));
    lines.push(e.scene);
    if (e.caption) lines.push(`CAPTION: ${e.caption}`);
    if (e.dialogue) lines.push(`${(e.speaker || 'VOICE').toUpperCase()}: "${e.dialogue}"`);
    if (e.choices?.length) {
      lines.push('CHOICES:');
      e.choices.forEach(c => lines.push(`  - ${c}`));
      if (e.resolvedChoice) lines.push(`  > chosen: ${e.resolvedChoice}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Status text for an aria-live region during generation.
 * Multi-minute silent operations are disorienting without this.
 */
export function generationAnnouncement(
  progress: { current: number; total: number } | null,
  isGenerating: boolean,
): string {
  if (!isGenerating && !progress) return '';
  if (!progress) return 'Generating your comic.';
  if (progress.current >= progress.total) return 'Comic generation complete.';
  return `Generating page ${progress.current + 1} of ${progress.total}.`;
}
