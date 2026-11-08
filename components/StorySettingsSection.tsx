/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GENRES, LANGUAGES, ART_STYLES, PAGE_LENGTHS, StoryContext } from '../types';

/**
 * Props for the StorySettingsSection component.
 */
export interface StorySettingsSectionProps {
    /** Currently selected genre */
    selectedGenre: string;
    /** Currently selected language code */
    selectedLanguage: string;
    /** Current story context object */
    storyContext: StoryContext;
    /** Custom premise text (for Custom genre) */
    customPremise: string;
    /** Validation error for custom premise */
    customPremiseError?: string;
    /** Handler for genre changes */
    onGenreChange: (genre: string) => void;
    /** Handler for language changes */
    onLanguageChange: (language: string) => void;
    /** Handler for story context updates */
    onStoryContextUpdate: (updates: Partial<StoryContext>) => void;
    /** Handler for premise changes */
    onPremiseChange: (premise: string) => void;
    /** Handler called when custom premise field loses focus */
    onCustomPremiseBlur?: () => void;
}

/**
 * StorySettingsSection component for configuring genre, art style, issue length, and language.
 * Also handles custom premise input when "Custom" genre is selected.
 */
export const StorySettingsSection: React.FC<StorySettingsSectionProps> = ({
    selectedGenre,
    selectedLanguage,
    storyContext,
    customPremise,
    customPremiseError,
    onGenreChange,
    onLanguageChange,
    onStoryContextUpdate,
    onPremiseChange,
    onCustomPremiseBlur
}) => {
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">GENRE</p>
                    <select
                        value={selectedGenre}
                        onChange={(e) => onGenreChange(e.target.value)}
                        className="w-full font-comic text-sm p-1 border-2 border-black uppercase bg-white text-black cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
                        aria-label="Genre"
                    >
                        {GENRES.map(g => <option key={g} value={g} className="text-black">{g}</option>)}
                    </select>
                </div>
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">ART STYLE</p>
                    <select
                        value={storyContext.artStyle}
                        onChange={(e) => onStoryContextUpdate({ artStyle: e.target.value })}
                        className="w-full font-comic text-sm p-1 border-2 border-black uppercase bg-white text-black cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
                        aria-label="Art style"
                    >
                        {ART_STYLES.map(a => <option key={a} value={a} className="text-black">{a}</option>)}
                    </select>
                </div>
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">ISSUE LENGTH</p>
                    <select
                        value={storyContext.pageLength}
                        onChange={(e) => onStoryContextUpdate({ pageLength: Number(e.target.value) })}
                        className="w-full font-comic text-sm p-1 border-2 border-black uppercase bg-white text-black cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
                        aria-label="Issue length"
                    >
                        {PAGE_LENGTHS.map(l => <option key={l.value} value={l.value} className="text-black">{l.label}</option>)}
                        {/* A loaded draft can carry a length the list doesn't offer (older
                            builds defaulted to 10). Show it as it is: otherwise the select
                            displays "3 Pages" while 10 are generated. */}
                        {!PAGE_LENGTHS.some(l => l.value === storyContext.pageLength) && (
                            <option value={storyContext.pageLength} className="text-black">
                                {`Custom (${storyContext.pageLength} Pages)`}
                            </option>
                        )}
                    </select>
                </div>
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">LANGUAGE</p>
                    <select
                        value={selectedLanguage}
                        onChange={(e) => onLanguageChange(e.target.value)}
                        className="w-full font-comic text-sm p-1 border-2 border-black uppercase bg-white text-black cursor-pointer shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
                        aria-label="Language"
                    >
                        {LANGUAGES.map(l => <option key={l.code} value={l.code} className="text-black">{l.name}</option>)}
                    </select>
                </div>
            </div>

            {selectedGenre === 'Custom' && (
                <div className="mb-3">
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">
                        PREMISE<span className="text-red-600 ml-0.5">*</span>
                    </p>
                    <textarea
                        value={customPremise}
                        onChange={(e) => onPremiseChange(e.target.value)}
                        onBlur={onCustomPremiseBlur}
                        placeholder="Enter your story premise..."
                        className={`w-full p-1 font-comic text-sm h-16 resize-none shadow-[2px_2px_0px_rgba(0,0,0,0.1)] ${customPremiseError ? 'border-[3px] border-red-600' : 'border-2 border-black'}`}
                        aria-label="Custom story premise"
                        aria-invalid={!!customPremiseError}
                    />
                    {customPremiseError && (
                        <p className="font-comic text-xs text-red-600 mt-1 flex items-center gap-1">
                            <span className="font-bold">!</span> {customPremiseError}
                        </p>
                    )}
                </div>
            )}
        </>
    );
};

export default StorySettingsSection;
