/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pre-generation confirmation gate.
 *
 * Nothing previously stood between a click and a full multi-page run. A user
 * could start a 24-page issue — dozens of image calls against their own API
 * key — without ever being shown what it would cost or how long it would take.
 * This is the confirm step for that.
 *
 * It is also the last place to warn about settings that will visibly affect the
 * result, so surprises happen here rather than twenty pages in.
 */

import React, { useEffect, useRef } from 'react';
import { estimateGenerationCost, formatCost } from '../stores/useMetricsStore';
import { getEstimatedTimeRemaining, formatTimeRemaining, hasReliableEstimates } from '../utils/timeEstimation';

export interface GenerationPlan {
  pageCount: number;
  characterCount: number;
  isOutlineMode: boolean;
  /** Characters with no model sheet for the chosen art style. */
  missingModelSheets: string[];
  /** Whether the QA pass will add a vision call per page. */
  qaEnabled: boolean;
  artStyle: string;
}

interface Props {
  plan: GenerationPlan;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Generate the missing model sheets, then start. Offered as the primary
   * action when sheets are missing: Settings calls them the single biggest
   * factor for consistent faces, yet the run used to start without them unless
   * the user had gone back to the setup screen to make them first.
   */
  onConfirmWithSheets?: () => void;
}

/**
 * Wall-clock estimate.
 *
 * Uses timings recorded from this user's own past runs once enough have been
 * observed, since generation speed varies enormously by key tier and region;
 * falls back to built-in defaults on a first run.
 */
const estimateTime = (pageCount: number, qaEnabled: boolean): { label: string; learned: boolean } => {
  const base = getEstimatedTimeRemaining(0, pageCount, 'cover');
  // The QA pass adds a vision call per page on top of generation.
  const withQa = qaEnabled ? base * 1.4 : base;
  return { label: formatTimeRemaining(withQa), learned: hasReliableEstimates() };
};

export const GenerationConfirmDialog: React.FC<Props> = ({ plan, onConfirm, onCancel, onConfirmWithSheets }) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const cost = estimateGenerationCost(plan.pageCount, plan.characterCount, plan.isOutlineMode);
  const time = estimateTime(plan.pageCount, plan.qaEnabled);
  const totalImages = plan.pageCount + 2; // story pages plus front and back cover
  const offerSheets = Boolean(onConfirmWithSheets) && plan.missingModelSheets.length > 0;

  // Move focus into the dialog and trap it, so keyboard users are not left
  // tabbing around the page behind a modal they cannot see.
  useEffect(() => {
    confirmRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
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
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-confirm-title"
        aria-describedby="gen-confirm-desc"
        className="bg-white border-[4px] border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] max-w-md w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="gen-confirm-title" className="font-comic text-2xl uppercase text-gray-900 mb-1">
          Ready to generate?
        </h2>
        <p id="gen-confirm-desc" className="font-ui text-sm text-gray-600 mb-4">
          This will make {totalImages} image {totalImages === 1 ? 'call' : 'calls'} against your API key.
        </p>

        <dl className="font-ui text-sm border-2 border-black divide-y-2 divide-black mb-4">
          <div className="flex justify-between px-3 py-2">
            <dt className="text-gray-700">Pages</dt>
            <dd className="font-bold">{plan.pageCount} + cover &amp; back cover</dd>
          </div>
          <div className="flex justify-between px-3 py-2">
            <dt className="text-gray-700">Estimated cost</dt>
            <dd className="font-bold">~{formatCost(cost)}</dd>
          </div>
          <div className="flex justify-between px-3 py-2">
            <dt className="text-gray-700">Estimated time</dt>
            <dd className="font-bold">
              {time.label}
              {!time.learned && <span className="font-normal text-gray-500"> (rough)</span>}
            </dd>
          </div>
          <div className="flex justify-between px-3 py-2">
            <dt className="text-gray-700">Art style</dt>
            <dd className="font-bold">{plan.artStyle}</dd>
          </div>
        </dl>

        {plan.missingModelSheets.length > 0 && (
          <div className="border-2 border-amber-500 bg-amber-50 px-3 py-2 mb-4">
            <p className="font-ui text-xs text-amber-900">
              <strong>No model sheet for {plan.missingModelSheets.join(', ')}.</strong>{' '}
              Making one first locks in each character's look and markedly reduces
              face drift across the issue. It adds {plan.missingModelSheets.length} image
              {plan.missingModelSheets.length === 1 ? '' : 's'} to the run. Without it, the raw
              portraits are used instead.
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="comic-btn bg-gray-200 text-black font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-gray-300"
          >
            Back
          </button>
          {offerSheets ? (
            <>
              <button
                onClick={onConfirm}
                className="comic-btn bg-white text-black font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-gray-100"
              >
                Skip sheets
              </button>
              <button
                ref={confirmRef}
                onClick={onConfirmWithSheets}
                className="comic-btn bg-yellow-400 text-black font-comic px-5 py-2 border-[3px] border-black uppercase text-sm hover:bg-yellow-300"
              >
                Make sheets, then generate
              </button>
            </>
          ) : (
            <button
              ref={confirmRef}
              onClick={onConfirm}
              className="comic-btn bg-yellow-400 text-black font-comic px-5 py-2 border-[3px] border-black uppercase text-sm hover:bg-yellow-300"
            >
              Generate
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GenerationConfirmDialog;
