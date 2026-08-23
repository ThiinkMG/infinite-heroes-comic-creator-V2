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

import React from 'react';
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
  /** Generate sheets for every character that does not have a current one. */
  onGenerateAll: () => void;
}

const isCurrent = (p: Persona, artStyle: string): boolean =>
  Boolean(p.modelSheet) && p.modelSheetStyle === artStyle;

export const ModelSheetStrip: React.FC<Props> = ({
  characters, artStyle, states, onGenerate, onClear, onGenerateAll,
}) => {
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
            photo, which is what keeps faces consistent across the issue.
          </p>
        </div>
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
                    <img
                      src={p.modelSheet}
                      alt={`Model sheet for ${p.name || 'character'}: front, three-quarter, and profile views with expression studies`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="font-ui text-xs text-gray-500 px-2 text-center">
                      No sheet yet — pages will use the raw portrait
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
                      onClick={() => onGenerate(p.id)}
                      disabled={state.isGenerating}
                      className="comic-btn flex-1 bg-yellow-400 text-black font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-yellow-300 disabled:opacity-50"
                    >
                      {p.modelSheet ? 'Reroll' : 'Generate'}
                    </button>
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
    </section>
  );
};

export default ModelSheetStrip;
