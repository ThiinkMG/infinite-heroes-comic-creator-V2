/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-app replacement for window.confirm.
 *
 * window.confirm returns false when the browser suppresses it — after repeated
 * dialogs Chrome offers "prevent this page from creating additional dialogs",
 * and several embedded/webview contexts block it outright. Because every call
 * site was written as `if (window.confirm(...)) { ... }`, a suppressed dialog
 * is indistinguishable from the user clicking Cancel: the button silently does
 * nothing. That is exactly how the Home button came to look broken.
 *
 * This cannot be suppressed, matches the app's styling, traps focus, and closes
 * on Escape.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ConfirmOptions {
  title: string;
  /** Body copy. Keep it accurate about what is and is not lost. */
  message: string;
  /** Label for the affirmative action. Default "Continue". */
  confirmLabel?: string;
  /** Label for the dismissive action. Default "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Provides an awaitable confirm and the element that renders it.
 *
 * Usage:
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (await confirm({ title: '...', message: '...' })) { ... }
 *   return <>{confirmDialog}...</>;
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setPending(current => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const confirmDialog = pending
    ? <ConfirmDialog options={pending} onSettle={settle} />
    : null;

  return { confirm, confirmDialog };
}

const ConfirmDialog: React.FC<{
  options: ConfirmOptions;
  onSettle: (value: boolean) => void;
}> = ({ options, onSettle }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSettle(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button');
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
  }, [onSettle]);

  return (
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center bg-black/70 p-4"
      onClick={() => onSettle(false)}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="bg-white border-[4px] border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] max-w-md w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-comic text-2xl uppercase text-gray-900 mb-2">
          {options.title}
        </h2>
        <p id="confirm-message" className="font-ui text-sm text-gray-700 mb-4 whitespace-pre-line">
          {options.message}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onSettle(false)}
            className="comic-btn bg-gray-200 text-black font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-gray-300"
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            onClick={() => onSettle(true)}
            className={`comic-btn font-comic px-5 py-2 border-[3px] border-black uppercase text-sm ${
              options.destructive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-yellow-400 text-black hover:bg-yellow-300'
            }`}
          >
            {options.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
