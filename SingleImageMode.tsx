/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { ART_STYLES, GENRES } from './types';

// ============================================================================
// TYPES
// ============================================================================

export type SingleImageTab = 'main' | 'emblem' | 'weapon' | 'reference';

export type ReferencePose =
    | 'Front view'
    | 'Side view'
    | 'Back view'
    | '3/4 Right view'
    | '3/4 Left view'
    | 'Iconic Pose';

export interface GeneratedSingleImage {
    imageUrl: string;
    tab: SingleImageTab;
    prompt: string;
    artStyle: string;
    genre?: string;
}

export interface SingleImageModeProps {
    onClose: () => void;
    onGenerate: (params: SingleImageGenerateParams) => Promise<string>;
    onSaveToGallery?: (imageUrl: string, params: SingleImageGenerateParams) => void;
    onImproveDescription?: (description: string, tab: SingleImageTab, artStyle: string, refImages: string[], subContext?: { genre?: string; pose?: ReferencePose; whiteBackground?: boolean }) => Promise<string>;
}

export interface SingleImageGenerateParams {
    tab: SingleImageTab;
    description: string;
    artStyle: string;
    genre?: string;
    pose?: ReferencePose;
    whiteBackground?: boolean;
    useMainAsRef?: boolean;
    mainImageUrl?: string;
    /** Base64-encoded reference images to send to the AI */
    refImages?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TABS: { id: SingleImageTab; label: string; icon: string; description: string }[] = [
    { id: 'main', label: 'Main Image', icon: '🎨', description: 'A standalone character or scene image' },
    { id: 'emblem', label: 'Emblem', icon: '🛡️', description: 'A logo or emblem design' },
    { id: 'weapon', label: 'Weapon', icon: '⚔️', description: 'A weapon or equipment asset' },
    { id: 'reference', label: 'Reference Sheet', icon: '📋', description: 'Character reference with multiple poses' }
];

const POSES: ReferencePose[] = [
    'Front view', 'Side view', 'Back view', '3/4 Right view', '3/4 Left view', 'Iconic Pose'
];

// ============================================================================
// COMPONENT
// ============================================================================

export const SingleImageMode: React.FC<SingleImageModeProps> = ({ onClose, onGenerate, onSaveToGallery, onImproveDescription }) => {
    const [activeTab, setActiveTab] = useState<SingleImageTab>('main');
    const [description, setDescription] = useState('');
    const [artStyle, setArtStyle] = useState(ART_STYLES[0]);
    const [genre, setGenre] = useState(GENRES[0]);
    const [pose, setPose] = useState<ReferencePose>('Front view');
    const [whiteBackground, setWhiteBackground] = useState(true);
    const [useMainAsRef, setUseMainAsRef] = useState(false);

    const [refImages, setRefImages] = useState<string[]>([]);
    const refInputRef = useRef<HTMLInputElement>(null);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isImprovingDescription, setIsImprovingDescription] = useState(false);
    const [generatedImages, setGeneratedImages] = useState<GeneratedSingleImage[]>([]);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleRefUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = ev => {
                const result = ev.target?.result as string;
                const base64 = result.split(',')[1];
                if (base64) setRefImages(prev => prev.length < 5 ? [...prev, base64] : prev);
            };
            reader.readAsDataURL(file as Blob);
        });
        // Reset so same file can be re-uploaded if removed
        if (refInputRef.current) refInputRef.current.value = '';
    }, []);

    const removeRefImage = useCallback((idx: number) => {
        setRefImages(prev => prev.filter((_, i) => i !== idx));
    }, []);

    const handleGenerate = useCallback(async () => {
        if (!description.trim()) return;
        setIsGenerating(true);
        setError(null);
        try {
            const params: SingleImageGenerateParams = {
                tab: activeTab,
                description: description.trim(),
                artStyle,
                genre: genre !== 'Custom' ? genre : undefined,
                pose: activeTab === 'reference' ? pose : undefined,
                whiteBackground: activeTab === 'reference' ? whiteBackground : undefined,
                useMainAsRef: (activeTab === 'emblem' || activeTab === 'weapon') ? useMainAsRef : undefined,
                mainImageUrl: useMainAsRef ? generatedImages.find(i => i.tab === 'main')?.imageUrl : undefined,
                refImages: refImages.length > 0 ? refImages : undefined,
            };

            const imageUrl = await onGenerate(params);
            const newImg: GeneratedSingleImage = {
                imageUrl,
                tab: activeTab,
                prompt: description,
                artStyle,
                genre: genre !== 'Custom' ? genre : undefined
            };
            setGeneratedImages(prev => [newImg, ...prev]);
            if (onSaveToGallery) onSaveToGallery(imageUrl, params);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsGenerating(false);
        }
    }, [activeTab, description, artStyle, genre, pose, whiteBackground, useMainAsRef, generatedImages, onGenerate, onSaveToGallery]);

    const handleImproveDescription = useCallback(async () => {
        if (!onImproveDescription || isImprovingDescription) return;
        setIsImprovingDescription(true);
        try {
            const subContext = {
                genre: activeTab === 'main' ? genre : undefined,
                pose: activeTab === 'reference' ? pose : undefined,
                whiteBackground: activeTab === 'reference' ? whiteBackground : undefined,
            };
            const improved = await onImproveDescription(description, activeTab, artStyle, refImages, subContext);
            setDescription(improved);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsImprovingDescription(false);
        }
    }, [onImproveDescription, description, activeTab, artStyle, refImages, isImprovingDescription, genre, pose, whiteBackground]);

    const downloadImage = (url: string, name: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.png`;
        a.click();
    };

    const tabImages = generatedImages.filter(i => i.tab === activeTab);
    const hasMainImage = generatedImages.some(i => i.tab === 'main');

    return (
        <div
            className="fixed inset-0 z-[580] bg-black/90 backdrop-blur-sm flex items-start justify-center overflow-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Single Image Generator"
        >
            <div className="w-full max-w-5xl min-h-screen bg-white border-x-4 border-black flex flex-col">

                {/* Header */}
                <div className="bg-black text-white px-4 py-3 flex items-center justify-between border-b-4 border-black">
                    <div>
                        <h2 className="font-comic text-xl md:text-2xl font-bold uppercase tracking-tight">
                            🎨 Single Image Generator
                        </h2>
                        <p className="font-comic text-gray-400 text-xs mt-0.5">
                            Generate standalone images — all saved to your Global Gallery
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="comic-btn bg-gray-700 text-white px-3 py-1.5 text-sm border-2 border-gray-500 hover:bg-gray-600 font-bold"
                    >
                        ✕ Close
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b-4 border-black bg-gray-100">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 px-3 py-3 font-comic text-xs sm:text-sm font-bold uppercase border-r-2 border-black transition-all ${
                                activeTab === tab.id
                                    ? 'bg-yellow-400 text-black border-b-4 border-b-yellow-600 -mb-1'
                                    : 'text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <span className="block text-lg">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex flex-col md:flex-row flex-1">
                    {/* Left panel: controls */}
                    <div className="w-full md:w-96 flex-shrink-0 border-r-4 border-black p-4 flex flex-col gap-3 bg-yellow-50">
                        <p className="font-comic text-xs text-gray-500 italic">
                            {TABS.find(t => t.id === activeTab)?.description}
                        </p>

                        {/* Art Style */}
                        <div>
                            <label className="font-comic text-xs font-bold text-gray-700 uppercase block mb-1">Art Style</label>
                            <select
                                value={artStyle}
                                onChange={e => setArtStyle(e.target.value)}
                                className="w-full p-2 border-2 border-black font-comic text-sm"
                            >
                                {ART_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>

                        {/* Genre (for main image) */}
                        {activeTab === 'main' && (
                            <div>
                                <label className="font-comic text-xs font-bold text-gray-700 uppercase block mb-1">Genre / Tone</label>
                                <select
                                    value={genre}
                                    onChange={e => setGenre(e.target.value)}
                                    className="w-full p-2 border-2 border-black font-comic text-sm"
                                >
                                    {GENRES.filter(g => g !== 'Custom').map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                        )}

                        {/* Pose picker (reference tab) */}
                        {activeTab === 'reference' && (
                            <>
                                <div>
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase block mb-1">Pose</label>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {POSES.map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setPose(p)}
                                                className={`py-1.5 px-2 font-comic text-xs border-2 border-black font-bold transition-all ${
                                                    pose === p ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-blue-50'
                                                }`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={whiteBackground}
                                        onChange={e => setWhiteBackground(e.target.checked)}
                                        className="w-4 h-4 accent-blue-600"
                                    />
                                    <span className="font-comic text-sm">Solid white background</span>
                                </label>
                            </>
                        )}

                        {/* Use main image as reference (emblem/weapon tabs) */}
                        {(activeTab === 'emblem' || activeTab === 'weapon') && hasMainImage && (
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useMainAsRef}
                                    onChange={e => setUseMainAsRef(e.target.checked)}
                                    className="w-4 h-4 accent-purple-600"
                                />
                                <span className="font-comic text-sm">Use Main Image as reference</span>
                            </label>
                        )}

                        {/* Reference Images */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="font-comic text-xs font-bold text-gray-700 uppercase">
                                    Reference Images <span className="text-gray-400 font-normal normal-case">({refImages.length}/5)</span>
                                </label>
                                <button
                                    onClick={() => refInputRef.current?.click()}
                                    disabled={refImages.length >= 5}
                                    className="comic-btn bg-blue-600 text-white text-xs px-2 py-1 border border-black hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-comic font-bold"
                                >
                                    + Add
                                </button>
                            </div>
                            <input
                                ref={refInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleRefUpload}
                                className="hidden"
                            />
                            {refImages.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {refImages.map((img, idx) => (
                                        <div key={idx} className="relative w-14 h-14 border-2 border-black rounded overflow-hidden group">
                                            <img
                                                src={`data:image/jpeg;base64,${img}`}
                                                alt={`Ref ${idx + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                            <button
                                                onClick={() => removeRefImage(idx)}
                                                className="absolute inset-0 bg-black/60 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                                aria-label={`Remove reference image ${idx + 1}`}
                                            >✕</button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="font-comic text-xs text-gray-400 italic">
                                    Upload images for the AI to use as visual references
                                </p>
                            )}
                        </div>

                        {/* Description */}
                        <div className="flex-1 flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                                <label className="font-comic text-xs font-bold text-gray-700 uppercase">
                                    Description <span className="text-red-600">*</span>
                                </label>
                                {onImproveDescription && (
                                    <button
                                        onClick={handleImproveDescription}
                                        disabled={isImprovingDescription}
                                        className="comic-btn bg-purple-600 text-white text-xs px-2 py-1 border border-black hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed font-comic font-bold flex items-center gap-1"
                                        title={refImages.length > 0 ? 'AI analyzes your reference images and improves the description' : 'AI generates or improves description for this mode'}
                                    >
                                        {isImprovingDescription ? '⏳' : '✨'} {isImprovingDescription ? 'Thinking...' : 'AI Expand'}
                                    </button>
                                )}
                            </div>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder={
                                    activeTab === 'main' ? 'Describe the character or scene...' :
                                    activeTab === 'emblem' ? 'Describe the emblem or logo design...' :
                                    activeTab === 'weapon' ? 'Describe the weapon or equipment...' :
                                    'Describe the character for the reference sheet...'
                                }
                                className="w-full flex-1 min-h-[120px] p-2 border-2 border-black font-comic text-sm resize-none"
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <p className="text-red-600 text-xs font-comic bg-red-50 border border-red-200 p-2 rounded">
                                {error}
                            </p>
                        )}

                        {/* Generate button */}
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || !description.trim()}
                            className="comic-btn bg-green-600 text-white px-4 py-3 text-base font-bold border-[3px] border-black hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed uppercase font-comic shadow-[4px_4px_0_rgba(0,0,0,0.5)] active:translate-y-0.5"
                        >
                            {isGenerating ? '⏳ Generating...' : '🎨 Generate Image'}
                        </button>
                    </div>

                    {/* Right panel: results */}
                    <div className="flex-1 p-4 overflow-auto">
                        {tabImages.length === 0 && !isGenerating ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-gray-400 font-comic gap-3">
                                <span className="text-6xl">{TABS.find(t => t.id === activeTab)?.icon}</span>
                                <p className="text-base text-center">
                                    Fill in the description and click Generate Image
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {isGenerating && (
                                    <div className="aspect-[2/3] bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2">
                                        <div className="text-3xl animate-spin" style={{ animationDuration: '2s' }}>⏳</div>
                                        <span className="font-comic text-xs text-gray-500">Generating...</span>
                                    </div>
                                )}
                                {tabImages.map((img, idx) => (
                                    <div key={idx} className="relative group rounded-lg overflow-hidden border-2 border-gray-300 hover:border-gray-500 transition-all">
                                        <img
                                            src={img.imageUrl}
                                            alt={`Generated ${activeTab} ${idx + 1}`}
                                            className="w-full aspect-[2/3] object-cover block cursor-pointer"
                                            onClick={() => setExpandedIdx(idx)}
                                        />
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => downloadImage(img.imageUrl, `${activeTab}_${idx + 1}`)}
                                                className="flex-1 bg-blue-600/90 text-white text-xs py-1 rounded font-comic font-bold hover:bg-blue-500"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                onClick={() => setExpandedIdx(idx)}
                                                className="flex-1 bg-gray-700/90 text-white text-xs py-1 rounded font-comic font-bold hover:bg-gray-600"
                                            >
                                                ⤢
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded image lightbox */}
            {expandedIdx !== null && tabImages[expandedIdx] && (
                <div
                    className="fixed inset-0 z-[400] bg-black/95 flex items-center justify-center p-4"
                    onClick={() => setExpandedIdx(null)}
                >
                    <div className="relative max-w-xl w-full" onClick={e => e.stopPropagation()}>
                        <img
                            src={tabImages[expandedIdx].imageUrl}
                            alt="Expanded"
                            className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
                        />
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={() => downloadImage(tabImages[expandedIdx].imageUrl, `${activeTab}_${expandedIdx + 1}`)}
                                className="flex-1 comic-btn bg-blue-600 text-white text-sm px-4 py-2 border-2 border-black hover:bg-blue-500 font-bold"
                            >
                                ↓ Download
                            </button>
                            <button
                                onClick={() => setExpandedIdx(null)}
                                className="comic-btn bg-gray-600 text-white text-sm px-4 py-2 border-2 border-black hover:bg-gray-500 font-bold"
                            >
                                ✕ Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SingleImageMode;
