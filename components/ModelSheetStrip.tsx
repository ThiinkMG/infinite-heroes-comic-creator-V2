/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The casting step: generate and approve a character model sheet before
 * committing to a full issue.
 *
 * This is the "fail fast" surface. Previously a user configured a cast, started
 * generation, and only learned what their hero actually looked like after the
 * whole issue had rendered — by which point the drift was baked into every page
 * and already paid for. Here they see the character's definitive look for the
 * price of one image, and can reroll it until it is right.
 *
 * Shown as a horizontal strip rather than per-character cards so the whole cast
 * can be compared side by side, which is how style mismatches become obvious.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Persona } from '../types';

export interface ModelSheetState {
  isGenerating: boolean;
  error?: string;
}

interface Props {
  characters: Persona[];
  /** Art style the sheets must match; sheets drawn in another style are stale. */
  artStyle: string;
  /** Per-character generation state, keyed by persona id. */
  states: Record<string, ModelSheetState>;
  onGenerate: (personaId: string) => void;
  onClear: (personaId: string) => void;
  /** Open a sheet full-size for inspecting or cropping individual poses. */
  onViewSheet?: (personaId: string) => void;
  /** Use an image the user already has as the canonical sheet. */
  onUpload?: (personaId: string, file: File) => void;
  /**
   * Awaitable confirm. Supplied by the host so this component does not depend on
   * window.confirm, which returns false when the browser suppresses it.
   */
  onConfirm?: (options: {
    title: string; message: string; confirmLabel?: string; destructive?: boolean;
  }) => Promise<boolean>;
  /** Generate sheets for every character that does not have a current one. */
  onGenerateAll: () => void;
}

const isCurrent = (p: Persona, artStyle: string): boolean =>
  Boolean(p.modelSheet) && p.modelSheetStyle === artStyle;

/** Filesystem-safe slug for download filenames. */
const slug = (s: string): string =>
  (s || 'character').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/**
 * Save a model sheet to disk at full resolution.
 *
 * The sheet is the reference art for the whole issue, so people reasonably
 * want it outside the app — to drop poses into a reroll as a reference image,
 * to hand to a human artist, or just to keep.
 */
const downloadSheet = (persona: Persona, artStyle: string) => {
  if (!persona.modelSheet) return;
  const a = document.createElement('a');
  a.href = persona.modelSheet;
  a.download = `${slug(persona.name)}-model-sheet-${slug(artStyle)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/**
 * Full-size viewer for a sheet.
 *
 * Sheets are rendered wide and shown as small thumbnails in the strip, so the
 * individual poses are unreadable there. This is where you actually look at
 * them — to judge whether the character is right, or to crop a pose out for
 * use as a reroll reference.
 */
const SheetLightbox: React.FC<{
  persona: Persona;
  artStyle: string;
  onClose: () => void;
  onDownload: () => void;
}> = ({ persona, artStyle, onClose, onDownload }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[600] bg-black/85 flex flex-col items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${persona.name || 'Character'} model sheet, full size`}
    >
      <img
        src={persona.modelSheet}
        alt={`Model sheet for ${persona.name || 'character'}`}
        className="max-w-full max-h-[80vh] object-contain border-2 border-white"
        onClick={e => e.stopPropagation()}
      />
      <div className="flex gap-2 mt-3" onClick={e => e.stopPropagation()}>
        <button
          onClick={onDownload}
          className="comic-btn bg-blue-600 text-white font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-blue-500"
        >
          ⬇ Download PNG
        </button>
        <button
          onClick={onClose}
          className="comic-btn bg-gray-200 text-black font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-gray-300"
        >
          Close
        </button>
      </div>
      <p className="font-ui text-xs text-gray-300 mt-2 text-center max-w-md">
        {persona.name} · {artStyle}. Download to crop an individual pose and reuse it
        as a reference image when rerolling a panel.
      </p>
    </div>
  );
};

export const ModelSheetStrip: React.FC<Props> = ({
  characters, artStyle, states, onGenerate, onClear, onGenerateAll, onViewSheet, onUpload, onConfirm,
}) => {
  const [viewingId, setViewingId] = useState<string | null>(null);
  // One input per character, so the file picker knows which card it belongs to.
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const viewing = characters.find(p => p.id === viewingId && p.modelSheet) ?? null;

  if (characters.length === 0) return null;

  const missing = characters.filter(p => !isCurrent(p, artStyle));
  const anyGenerating = Object.values(states).some((s: ModelSheetState) => s.isGenerating);

  return (
    <section
      className="border-[3px] border-black bg-indigo-50 p-3 mb-4"
      aria-labelledby="model-sheet-heading"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 id="model-sheet-heading" className="font-comic text-lg uppercase text-indigo-900">
            Character Model Sheets
          </h3>
          <p className="font-ui text-xs text-gray-700 max-w-prose">
            A model sheet redraws your character in <strong>{artStyle}</strong> from several
            angles, once. Every page then copies that sheet instead of re-interpreting your
            photo, which is what keeps faces consistent across the issue. Already have
            character art? Upload it instead — your own artwork is a better reference
            than anything generated from a photo.
          </p>
        </div>
        {characters.some(p => p.modelSheet) && (
          <button
            onClick={() => characters.filter(p => p.modelSheet).forEach(p => downloadSheet(p, artStyle))}
            className="comic-btn shrink-0 bg-blue-600 text-white font-comic px-3 py-1.5 border-[3px] border-black uppercase text-xs hover:bg-blue-500"
            title="Download every model sheet"
          >
            Save All
          </button>
        )}
        {missing.length > 0 && (
          <button
            onClick={onGenerateAll}
            disabled={anyGenerating}
            className="comic-btn shrink-0 bg-indigo-600 text-white font-comic px-3 py-1.5 border-[3px] border-black uppercase text-xs hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {anyGenerating ? 'Working…' : `Generate ${missing.length}`}
          </button>
        )}
      </div>

      <ul className="flex gap-3 overflow-x-auto pb-1" role="list">
        {characters.map(p => {
          const state = states[p.id] ?? { isGenerating: false };
          const current = isCurrent(p, artStyle);
          const stale = Boolean(p.modelSheet) && !current;

          return (
            <li key={p.id} className="shrink-0 w-48">
              <div className="border-2 border-black bg-white">
                <div className="relative aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                  {state.isGenerating ? (
                    <span className="font-ui text-xs text-gray-600 animate-pulse">
                      Drawing sheet…
                    </span>
                  ) : p.modelSheet ? (
                    <button
                      type="button"
                      onClick={() => (onViewSheet ? onViewSheet(p.id) : setViewingId(p.id))}
                      className="w-full h-full cursor-zoom-in"
                      title="View full size"
                      aria-label={`View ${p.name || 'character'} model sheet full size`}
                    >
                      <img
                        src={p.modelSheet}
                        alt={`Model sheet for ${p.name || 'character'}: front, three-quarter, and profile views with expression studies`}
                        className="w-full h-full object-contain"
                      />
                    </button>
                  ) : (
                    <span className="font-ui text-xs text-gray-500 px-2 text-center">
                      No sheet yet — generate one, upload your own, or pages will
                      use the raw portrait
                    </span>
                  )}

                  {p.modelSheetSource === 'uploaded' && !state.isGenerating && (
                    <span className="absolute top-1 right-1 bg-green-500 border border-black font-ui text-[10px] px-1 text-white">
                      Yours
                    </span>
                  )}
                  {stale && !state.isGenerating && (
                    <span className="absolute top-1 left-1 bg-amber-400 border border-black font-ui text-[10px] px-1">
                      {p.modelSheetStyle ? `${p.modelSheetStyle} sheet` : 'Different style'}
                    </span>
                  )}
                </div>

                <div className="p-2 border-t-2 border-black">
                  <p className="font-comic text-sm uppercase truncate" title={p.name}>
                    {p.name || 'Unnamed'}
                  </p>
                  {state.error && (
                    <p className="font-ui text-[11px] text-red-700 mb-1">{state.error}</p>
                  )}
                  <div className="flex gap-1">
                    <button
                      onClick={async () => {
                        // Regenerating over uploaded artwork is destructive and
                        // unrecoverable, so make the user mean it.
                        if (p.modelSheetSource === 'uploaded' && onConfirm) {
                          const ok = await onConfirm({
                            title: 'Replace your artwork?',
                            message: `${p.name || 'This character'} is using a sheet you uploaded. Generating a new one replaces it, and the app cannot recreate your original.`,
                            confirmLabel: 'Generate new sheet',
                            destructive: true,
                          });
                          if (!ok) return;
                        }
                        onGenerate(p.id);
                      }}
                      disabled={state.isGenerating}
                      className="comic-btn flex-1 bg-yellow-400 text-black font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-yellow-300 disabled:opacity-50"
                    >
                      {p.modelSheet ? 'Reroll' : 'Generate'}
                    </button>
                    {onUpload && (
                      <>
                        <input
                          ref={el => { fileInputs.current[p.id] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) onUpload(p.id, file);
                            // Reset so re-picking the same file fires onChange again.
                            e.target.value = '';
                          }}
                        />
                        <button
                          onClick={() => fileInputs.current[p.id]?.click()}
                          disabled={state.isGenerating}
                          title="Use your own artwork as this character's model sheet"
                          aria-label={`Upload a model sheet for ${p.name || 'character'}`}
                          className="comic-btn bg-green-600 text-white font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-green-500 disabled:opacity-50"
                        >
                          Up
                        </button>
                      </>
                    )}
                    {p.modelSheet && (
                      <button
                        onClick={() => downloadSheet(p, artStyle)}
                        disabled={state.isGenerating}
                        title="Download this model sheet"
                        aria-label={`Download ${p.name || 'character'} model sheet`}
                        className="comic-btn bg-blue-600 text-white font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-blue-500 disabled:opacity-50"
                      >
                        Save
                      </button>
                    )}
                    {p.modelSheet && (
                      <button
                        onClick={() => onClear(p.id)}
                        disabled={state.isGenerating}
                        aria-label={`Remove model sheet for ${p.name || 'character'}`}
                        className="comic-btn bg-gray-200 text-black font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-gray-300 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {viewing && (
        <SheetLightbox
          persona={viewing}
          artStyle={artStyle}
          onClose={() => setViewingId(null)}
          onDownload={() => downloadSheet(viewing, artStyle)}
        />
      )}
    </section>
  );
};

export default ModelSheetStrip;
