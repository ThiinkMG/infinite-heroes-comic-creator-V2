/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StoryContext } from '../types';
import { Tooltip } from './Tooltip';

/**
 * Props for the CoverConfigSection component.
 */
export interface CoverConfigSectionProps {
    /** Supply an existing cover instead of generating one. */
    onCoverUpload?: (file: File) => Promise<void>;
    /** Drop a supplied cover so the next run generates one. */
    onCoverRemove?: () => void;
    /** Choose whether a supplied cover is letterboxed or cropped to fill. */
    onCoverFitChange?: (fit: 'contain' | 'cover') => void;
    /** Current story context object */
    storyContext: StoryContext;
    /** Handler for story context updates */
    onStoryContextUpdate: (updates: Partial<StoryContext>) => void;
}

/**
 * CoverConfigSection component for configuring comic cover settings.
 * Includes series title, publisher name, issue number, and logo/branding options.
 */
export const CoverConfigSection: React.FC<CoverConfigSectionProps> = ({
    onCoverUpload,
    onCoverRemove,
    onCoverFitChange,
    storyContext,
    onStoryContextUpdate
}) => {
    // Measured from the uploaded image so the warning reflects the real file,
    // not a guess from its filename.
    const [coverAspect, setCoverAspect] = React.useState<number | null>(null);
    const handleLogoUpload = async (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            onStoryContextUpdate({ publisherLogo: base64 });
        };
        reader.readAsDataURL(file);
    };

    return (
        <>
            <div className="font-comic text-xl text-black border-b-4 border-black mb-2 mt-2">3. COVER CONFIG</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <div className="col-span-2">
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">Series Title</p>
                    <input
                        type="text"
                        value={storyContext.seriesTitle}
                        onChange={(e) => onStoryContextUpdate({ seriesTitle: e.target.value })}
                        className="w-full p-1 border-2 border-black font-comic text-sm"
                        aria-label="Series title"
                    />
                </div>
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">Publisher Name</p>
                    <input
                        type="text"
                        value={storyContext.publisherName}
                        onChange={(e) => onStoryContextUpdate({ publisherName: e.target.value })}
                        className="w-full p-1 border-2 border-black font-comic text-sm"
                        aria-label="Publisher name"
                    />
                </div>
                <div>
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">Issue #</p>
                    <input
                        type="text"
                        value={storyContext.issueNumber}
                        onChange={(e) => onStoryContextUpdate({ issueNumber: e.target.value })}
                        placeholder="1"
                        className="w-full p-1 border-2 border-black font-comic text-sm"
                        aria-label="Issue number"
                    />
                </div>
                <div className="col-span-2 flex flex-col gap-2">
                    <p className="font-comic text-xs mb-1 font-bold text-gray-800 uppercase">Publisher Logo / Branding</p>
                    {onCoverUpload && (
                        <div className="w-full mb-2 border-2 border-black bg-emerald-50 p-2">
                            <p className="font-comic text-[11px] uppercase text-emerald-900 mb-1">
                                Cover art (optional)
                            </p>
                            {storyContext.preGeneratedCover ? (
                                <div>
                                    <div className="flex items-center gap-2">
                                        <img
                                            src={storyContext.preGeneratedCover}
                                            alt="Your supplied cover art"
                                            className="h-16 w-auto border-2 border-black object-contain"
                                            onLoad={(e) => {
                                                const img = e.currentTarget;
                                                setCoverAspect(img.naturalWidth / img.naturalHeight);
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-ui text-[11px] text-gray-700">
                                                Using your cover. The cover page will not be generated.
                                            </p>
                                        </div>
                                        <button
                                            onClick={onCoverRemove}
                                            aria-label="Remove supplied cover art"
                                            className="comic-btn bg-gray-200 text-black font-comic px-2 py-1 border-2 border-black uppercase text-[11px] hover:bg-gray-300"
                                        >
                                            Remove
                                        </button>
                                    </div>

                                    {/* Comic pages are 2:3. Anything else has to be letterboxed or cropped. */}
                                    {coverAspect !== null && Math.abs(coverAspect - 2 / 3) > 0.04 && (
                                        <p className="font-ui text-[11px] text-amber-900 bg-amber-100 border border-amber-500 px-2 py-1 mt-1">
                                            Your cover is {coverAspect > 2 / 3 ? 'wider' : 'taller'} than a comic page (2:3).
                                            Choose how it should sit on the page.
                                        </p>
                                    )}

                                    {onCoverFitChange && (
                                        <fieldset className="mt-1">
                                            <legend className="font-comic text-[10px] uppercase text-gray-600">Page fit</legend>
                                            <div className="flex gap-2">
                                                {([
                                                    ['contain', 'Fit whole image'],
                                                    ['cover', 'Fill page (crops)'],
                                                ] as const).map(([value, label]) => (
                                                    <label key={value} className="flex items-center gap-1 font-ui text-[11px] cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            name="cover-fit"
                                                            checked={(storyContext.preGeneratedCoverFit ?? 'contain') === value}
                                                            onChange={() => onCoverFitChange(value)}
                                                        />
                                                        {label}
                                                    </label>
                                                ))}
                                            </div>
                                        </fieldset>
                                    )}
                                </div>
                            ) : (
                                <label className="comic-btn bg-emerald-600 text-white text-xs px-2 py-1.5 hover:bg-emerald-500 cursor-pointer border-2 border-black flex items-center justify-center w-full">
                                    <span>Upload Cover — skips generating one</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        aria-label="Upload cover art"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) onCoverUpload(file);
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                            )}
                        </div>
                    )}

                    <label className="comic-btn bg-gray-200 text-black text-xs px-2 py-1 hover:bg-gray-300 cursor-pointer border-2 border-black flex items-center justify-center gap-2">
                        {storyContext.publisherLogo ? (
                            <img src={`data:image/jpeg;base64,${storyContext.publisherLogo}`} className="max-h-6" alt="Publisher logo" />
                        ) : null}
                        <span>{storyContext.publisherLogo ? 'REPLACE LOGO' : 'UPLOAD LOGO (OPTIONAL)'}</span>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            aria-label="Upload publisher logo"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleLogoUpload(file);
                            }}
                        />
                    </label>
                    <div className="flex gap-2 w-full mt-1">
                        <div className="flex items-center gap-1">
                            <input
                                type="color"
                                value={storyContext.publisherLogoBgColor || '#DC2626'}
                                onChange={(e) => onStoryContextUpdate({ publisherLogoBgColor: e.target.value })}
                                className="h-6 w-6 p-0 border-2 border-black cursor-pointer align-middle"
                                title="Logo Background Color"
                                aria-label="Logo background color"
                            />
                            <span className="text-[10px] font-comic font-bold uppercase text-gray-700">BG Color</span>
                        </div>
                        <select
                            value={storyContext.publisherLogoFit || 'contain'}
                            onChange={(e) => onStoryContextUpdate({ publisherLogoFit: e.target.value as 'cover' | 'contain' })}
                            className="font-comic text-[10px] border-2 border-black p-1 flex-1 bg-white cursor-pointer uppercase font-bold"
                            aria-label="Logo fit mode"
                        >
                            <option value="contain">Fill (Contain)</option>
                            <option value="cover">Crop (Cover)</option>
                        </select>
                    </div>
                    <label className="flex items-center gap-1 font-comic text-xs cursor-pointer text-black hover:text-blue-600 transition-colors mt-1">
                        <input
                            type="checkbox"
                            checked={storyContext.useOverlayLogo}
                            onChange={(e) => onStoryContextUpdate({ useOverlayLogo: e.target.checked })}
                            className="w-4 h-4 accent-black"
                            aria-label="Use classic comic cover overlay"
                        />
                        <span>USE CLASSIC COMIC COVER OVERLAY</span>
                        <Tooltip text="When ON, the app enforces a clean logo and issue box overlay. When OFF, the AI will attempt to draw the logo natively into the image pixels (often messy)." />
                    </label>
                </div>
            </div>
        </>
    );
};

export default CoverConfigSection;
