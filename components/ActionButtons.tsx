/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Props for the ActionButtons component.
 */
export interface ActionButtonsProps {
    /** Whether the setup is currently transitioning */
    isTransitioning: boolean;
    /** Whether profiles are currently being generated */
    isGeneratingProfiles: boolean;
    /** Handler for opening the help/tutorial modal */
    onHelp: () => void;
    /** Handler for exporting the draft */
    onExportDraft: () => void;
    /** Handler for importing a draft file */
    onImportDraft: (file: File) => void;
    /** Handler for clearing all setup data */
    onClearSetup: () => void;
    /** Handler for launching the adventure */
    onLaunch: () => void;
}

/**
 * ActionButtons component containing the main action buttons at the bottom of the setup screen.
 * Includes Help, Save, Load, Clear, and Start Adventure buttons.
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
    isTransitioning,
    isGeneratingProfiles,
    onHelp,
    onExportDraft,
    onImportDraft,
    onClearSetup,
    onLaunch
}) => {
    return (
        <div className="flex flex-col gap-2 w-full mt-2">
            {/* Utility Buttons: 2x2 grid on mobile, row on tablet+ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                <button
                    onClick={onHelp}
                    className="comic-btn bg-blue-600 text-white text-base sm:text-lg lg:text-xl px-3 py-2.5 sm:py-3 hover:bg-blue-500 uppercase tracking-wider border-[3px] border-black font-bold touch-manipulation min-h-[48px]"
                    aria-label="Open help tutorial"
                >
                    📖 HELP
                </button>
                <button
                    onClick={onExportDraft}
                    className="comic-btn bg-indigo-600 text-white text-base sm:text-lg lg:text-xl px-3 py-2.5 sm:py-3 hover:bg-indigo-500 uppercase tracking-wider border-[3px] border-black font-bold touch-manipulation min-h-[48px]"
                    aria-label="Save setup: cast and story settings"
                    title="Download your cast and story settings. Reopening it returns here."
                >
                    💾 SAVE SETUP
                </button>
                <label className="comic-btn text-center bg-gray-600 text-white text-base sm:text-lg lg:text-xl px-3 py-2.5 sm:py-3 hover:bg-gray-500 uppercase tracking-wider cursor-pointer border-[3px] border-black font-bold touch-manipulation min-h-[48px] flex items-center justify-center">
                    📂 LOAD
                    <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files?.[0]) {
                                onImportDraft(e.target.files[0]);
                                e.target.value = '';
                            }
                        }}
                        aria-label="Load saved draft"
                    />
                </label>
                <button
                    onClick={onClearSetup}
                    className="comic-btn bg-orange-500 text-white text-base sm:text-lg lg:text-xl px-3 py-2.5 sm:py-3 hover:bg-orange-400 uppercase tracking-wider border-[3px] border-black font-bold touch-manipulation min-h-[48px]"
                    aria-label="Clear all setup data"
                >
                    🗑️ CLEAR
                </button>
            </div>
            {/* Start Adventure Button - Always Full Width */}
            <button
                onClick={onLaunch}
                disabled={isTransitioning || isGeneratingProfiles}
                className="comic-btn bg-red-600 text-white text-xl sm:text-2xl md:text-3xl px-4 sm:px-6 py-3 sm:py-4 w-full hover:bg-red-500 disabled:bg-gray-400 disabled:cursor-not-allowed uppercase tracking-wider font-bold border-[3px] border-black flex items-center justify-center gap-2 sm:gap-3 touch-manipulation min-h-[56px]"
                aria-label="Start adventure"
            >
                {isGeneratingProfiles ? (
                    <>
                        <div className="animate-spin w-8 h-8 border-[4px] border-white border-t-transparent rounded-full"></div>
                        <span className="animate-pulse text-xl sm:text-2xl">ANALYZING PORTRAITS...</span>
                    </>
                ) : isTransitioning ? 'LAUNCHING...' : '🚀 START ADVENTURE!'}
            </button>
        </div>
    );
};

export default ActionButtons;
