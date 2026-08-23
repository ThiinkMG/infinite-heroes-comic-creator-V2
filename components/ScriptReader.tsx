/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reading mode — the whole comic as text.
 *
 * This is the proper text alternative for an image-native medium. Per-panel alt
 * text tells a screen-reader user what one image contains; it does not let them
 * read the story. This does.
 *
 * It is also plainly useful to sighted users: proofreading dialogue, checking
 * pacing, spotting a page where the writer and the artist disagreed, or
 * exporting a script to work on elsewhere.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { ComicFace } from '../types';
import { buildScript, scriptToText, type CastRef } from '../utils/comicAccessibility';

interface Props {
  faces: ComicFace[];
  cast: CastRef;
  title?: string;
  onClose: () => void;
}

export const ScriptReader: React.FC<Props> = ({ faces, cast, title, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => buildScript(faces, cast), [faces, cast]);

  useEffect(() => {
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptToText(entries, title));
    } catch {
      console.warn('[ScriptReader] clipboard unavailable');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([scriptToText(entries, title)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'comic').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-script.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/80 p-4 flex items-center justify-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-reader-title"
        className="bg-white border-[4px] border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b-[3px] border-black shrink-0">
          <div>
            <h2 id="script-reader-title" className="font-comic text-2xl uppercase text-gray-900">
              Read as script
            </h2>
            <p className="font-ui text-xs text-gray-600">
              {entries.length} {entries.length === 1 ? 'page' : 'pages'}
              {title ? ` — ${title}` : ''}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleCopy}
              className="comic-btn bg-gray-200 text-black font-comic px-3 py-1.5 border-2 border-black uppercase text-xs hover:bg-gray-300"
            >
              Copy
            </button>
            <button
              onClick={handleDownload}
              className="comic-btn bg-blue-600 text-white font-comic px-3 py-1.5 border-2 border-black uppercase text-xs hover:bg-blue-500"
            >
              Download
            </button>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close reading mode"
              className="comic-btn bg-red-500 text-white font-comic px-3 py-1.5 border-2 border-black uppercase text-xs hover:bg-red-400"
            >
              Close
            </button>
          </div>
        </header>

        {/*
          Body copy uses the UI font, not Comic Neue: this is the surface people
          read at length, and it is the accessibility fallback for the artwork.
        */}
        <div className="overflow-y-auto p-5 font-ui text-[15px] leading-relaxed text-gray-900">
          {entries.length === 0 && (
            <p className="text-gray-500">Nothing generated yet.</p>
          )}
          {entries.map((e, i) => (
            <article key={i} className="mb-6 last:mb-0">
              <h3 className="font-comic text-lg uppercase text-blue-700 border-b-2 border-gray-200 mb-2">
                {e.pageLabel}
              </h3>
              <p className="italic text-gray-700 mb-2">{e.scene}</p>
              {e.caption && (
                <p className="mb-1">
                  <span className="font-bold uppercase text-xs text-gray-500 mr-2">Caption</span>
                  {e.caption}
                </p>
              )}
              {e.dialogue && (
                <p className="mb-1">
                  <span className="font-bold uppercase text-xs text-gray-500 mr-2">
                    {e.speaker}
                  </span>
                  “{e.dialogue}”
                </p>
              )}
              {e.choices && (
                <div className="mt-2 border-l-4 border-yellow-400 pl-3">
                  <p className="font-bold uppercase text-xs text-gray-500 mb-1">Choices</p>
                  <ul className="list-disc list-inside">
                    {e.choices.map((c, ci) => (
                      <li key={ci} className={c === e.resolvedChoice ? 'font-bold' : ''}>
                        {c}
                        {c === e.resolvedChoice && (
                          <span className="ml-2 text-xs uppercase text-green-700">chosen</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScriptReader;
