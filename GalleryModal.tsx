import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { downloadAsZip } from './utils/zipDownload';
import { ComicFace } from './types';
import { downloadComicPages, ImageForDownload, formatFileSize } from './utils/downloadHelpers';

interface GalleryModalProps {
    faces: ComicFace[];
    title: string;
    onClose: () => void;
    onReplaceImage?: (faceId: string, newImageUrl: string) => void;
    onGenerateCoverVariants?: () => void;
    onBatchRegenerate?: (faceIds: string[]) => void;
    onBatchDownload?: (pageIndices: number[]) => void;
}

type SortOption = 'page-order' | 'generation-time';
type FilterOption = 'all' | 'cover' | 'story' | 'back_cover';

export const GalleryModal: React.FC<GalleryModalProps> = ({ faces, title, onClose, onReplaceImage, onGenerateCoverVariants, onBatchRegenerate, onBatchDownload }) => {
    const validFaces = faces.filter(f => f.imageUrl && !f.isLoading);

    // State for selection and view modes
    const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
    const [expandedFaceId, setExpandedFaceId] = useState<string | null>(null);
    const [replacingFaceId, setReplacingFaceId] = useState<string | null>(null);
    const [isZipping, setIsZipping] = useState(false);
    const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null);
    const [zoomLevel, setZoomLevel] = useState<number>(1);

    // Multi-select state for batch operations
    const [multiSelectMode, setMultiSelectMode] = useState(false);
    const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set());
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

    // Sorting and filtering state
    const [sortBy, setSortBy] = useState<SortOption>('page-order');
    const [filterBy, setFilterBy] = useState<FilterOption>('all');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const lastClickTime = useRef<number>(0);
    const lastClickId = useRef<string | null>(null);

    // Filter faces based on current filter
    const filteredFaces = useMemo(() => {
        if (filterBy === 'all') return validFaces;
        return validFaces.filter(f => f.type === filterBy);
    }, [validFaces, filterBy]);

    // Sort faces based on current sort option
    const sortedFaces = useMemo(() => {
        const sorted = [...filteredFaces];
        if (sortBy === 'page-order') {
            // Sort by type priority (cover first, then story pages, then back cover)
            sorted.sort((a, b) => {
                const typeOrder = { cover: 0, story: 1, back_cover: 2 };
                const orderDiff = typeOrder[a.type] - typeOrder[b.type];
                if (orderDiff !== 0) return orderDiff;
                // Within same type, sort by page index
                return (a.pageIndex || 0) - (b.pageIndex || 0);
            });
        } else if (sortBy === 'generation-time') {
            // Sort by ID (which typically includes timestamp)
            sorted.sort((a, b) => a.id.localeCompare(b.id));
        }
        return sorted;
    }, [filteredFaces, sortBy]);

    const expandedIndex = expandedFaceId ? sortedFaces.findIndex(f => f.id === expandedFaceId) : -1;
    const selectedIndex = selectedFaceId ? sortedFaces.findIndex(f => f.id === selectedFaceId) : -1;

    // Handle click with double-click detection and multi-select support
    const handleThumbnailClick = useCallback((faceId: string, event?: React.MouseEvent) => {
        const now = Date.now();
        const timeDiff = now - lastClickTime.current;
        const sameTarget = lastClickId.current === faceId;

        // Multi-select mode: toggle selection
        if (multiSelectMode) {
            setSelectedFaceIds(prev => {
                const next = new Set(prev);
                if (next.has(faceId)) {
                    next.delete(faceId);
                } else {
                    next.add(faceId);
                }
                return next;
            });
            lastClickTime.current = now;
            lastClickId.current = faceId;
            return;
        }

        // Ctrl/Cmd + click for multi-select toggle
        if (event && (event.ctrlKey || event.metaKey)) {
            setSelectedFaceIds(prev => {
                const next = new Set(prev);
                if (next.has(faceId)) {
                    next.delete(faceId);
                } else {
                    next.add(faceId);
                }
                return next;
            });
            lastClickTime.current = now;
            lastClickId.current = faceId;
            return;
        }

        if (timeDiff < 300 && sameTarget) {
            // Double click - expand
            setExpandedFaceId(faceId);
            setSelectedFaceId(null);
        } else {
            // Single click - select
            setSelectedFaceId(faceId);
            // Clear multi-selection on regular click
            if (selectedFaceIds.size > 0) {
                setSelectedFaceIds(new Set());
            }
        }

        lastClickTime.current = now;
        lastClickId.current = faceId;
    }, [multiSelectMode, selectedFaceIds.size]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // If expanded view is open, handle expanded navigation
            if (expandedFaceId !== null && expandedIndex >= 0) {
                switch (e.key) {
                    case 'ArrowLeft':
                        e.preventDefault();
                        if (expandedIndex > 0) {
                            setExpandedFaceId(sortedFaces[expandedIndex - 1].id);
                        }
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        if (expandedIndex < sortedFaces.length - 1) {
                            setExpandedFaceId(sortedFaces[expandedIndex + 1].id);
                        }
                        break;
                    case 'Escape':
                        e.preventDefault();
                        setExpandedFaceId(null);
                        setZoomLevel(1);
                        break;
                    case '+':
                    case '=':
                        e.preventDefault();
                        setZoomLevel(z => Math.min(z + 0.25, 3));
                        break;
                    case '-':
                        e.preventDefault();
                        setZoomLevel(z => Math.max(z - 0.25, 0.5));
                        break;
                    case '0':
                        e.preventDefault();
                        setZoomLevel(1);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        // Download current image
                        const currentFace = sortedFaces[expandedIndex];
                        if (currentFace.imageUrl) {
                            downloadImage(currentFace.imageUrl, `Comic-${currentFace.id}.png`);
                        }
                        break;
                }
                return;
            }

            // Grid navigation when not expanded
            if (sortedFaces.length === 0) return;

            const gridCols = getGridColumns();
            let newIndex = selectedIndex;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    newIndex = selectedIndex <= 0 ? sortedFaces.length - 1 : selectedIndex - 1;
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    newIndex = selectedIndex >= sortedFaces.length - 1 ? 0 : selectedIndex + 1;
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    newIndex = selectedIndex - gridCols;
                    if (newIndex < 0) newIndex = selectedIndex;
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    newIndex = selectedIndex + gridCols;
                    if (newIndex >= sortedFaces.length) newIndex = selectedIndex;
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (selectedFaceId) {
                        setExpandedFaceId(selectedFaceId);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
                case 'Home':
                    e.preventDefault();
                    newIndex = 0;
                    break;
                case 'End':
                    e.preventDefault();
                    newIndex = sortedFaces.length - 1;
                    break;
            }

            if (newIndex !== selectedIndex && newIndex >= 0 && newIndex < sortedFaces.length) {
                setSelectedFaceId(sortedFaces[newIndex].id);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [expandedFaceId, expandedIndex, selectedFaceId, selectedIndex, sortedFaces, onClose]);

    // Get number of grid columns based on screen width
    const getGridColumns = useCallback(() => {
        if (typeof window === 'undefined') return 3;
        const width = window.innerWidth;
        if (width < 640) return 2;      // Mobile
        if (width < 1024) return 3;     // Tablet
        if (width < 1280) return 4;     // Desktop
        return 4;                        // Large desktop
    }, []);

    // Auto-select first item when filter changes
    useEffect(() => {
        if (sortedFaces.length > 0 && !selectedFaceId) {
            setSelectedFaceId(sortedFaces[0].id);
        } else if (sortedFaces.length > 0 && selectedFaceId && !sortedFaces.find(f => f.id === selectedFaceId)) {
            setSelectedFaceId(sortedFaces[0].id);
        }
    }, [sortedFaces, selectedFaceId]);

    const downloadImage = (url: string, filename: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    };

    /**
     * Bundle every page into a single .zip.
     *
     * This used to fire one download per page with a 500ms gap. Browsers treat a
     * burst of programmatic downloads as abusive — Chrome asks once and drops the
     * rest if declined, Safari usually delivers only the first — so "Download All"
     * returned an unpredictable subset of the issue.
     */
    const downloadAll = async () => {
        if (isZipping) return;
        const safeTitle = (title || 'Comic').replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-');
        const entries = sortedFaces
            .filter(face => face.imageUrl)
            .map(face => {
                const pName = face.type === 'cover' ? '00-Cover'
                    : face.type === 'back_cover' ? '99-BackCover'
                    : `Page-${String(face.pageIndex).padStart(2, '0')}`;
                return { name: `${safeTitle}-${pName}.png`, data: face.imageUrl! };
            });

        if (entries.length === 0) return;

        setIsZipping(true);
        setZipProgress({ current: 0, total: entries.length });
        try {
            await downloadAsZip(entries, `${safeTitle}.zip`, p =>
                setZipProgress({ current: p.current, total: p.total }));
        } catch (e) {
            console.error('[gallery] zip failed', e);
        } finally {
            setIsZipping(false);
            setZipProgress(null);
        }
    };

    const handleReplaceClick = (faceId: string) => {
        setReplacingFaceId(faceId);
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !replacingFaceId || !onReplaceImage) {
            setReplacingFaceId(null);
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            console.warn('Please select an image file (PNG, JPG, etc.)');
            setReplacingFaceId(null);
            e.target.value = '';
            return;
        }

        // Convert to base64 data URL
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            onReplaceImage(replacingFaceId, dataUrl);
            setReplacingFaceId(null);
        };
        reader.onerror = () => {
            console.error('Failed to read image file.');
            setReplacingFaceId(null);
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset input
    };

    const handleViewFullSize = () => {
        if (selectedFaceId) {
            setExpandedFaceId(selectedFaceId);
            setZoomLevel(1);
        }
    };

    const getPageLabel = (face: ComicFace): string => {
        if (face.type === 'cover') return 'COVER';
        if (face.type === 'back_cover') return 'BACK COVER';
        return `PAGE ${face.pageIndex || '?'}`;
    };

    const getPageTypeColor = (type: ComicFace['type']): string => {
        switch (type) {
            case 'cover': return 'bg-purple-500';
            case 'back_cover': return 'bg-indigo-500';
            case 'story': return 'bg-yellow-400 text-black';
            default: return 'bg-gray-500';
        }
    };

    const filterCounts = useMemo(() => ({
        all: validFaces.length,
        cover: validFaces.filter(f => f.type === 'cover').length,
        story: validFaces.filter(f => f.type === 'story').length,
        back_cover: validFaces.filter(f => f.type === 'back_cover').length,
    }), [validFaces]);

    // Select All pages in current filter view
    const handleSelectAll = useCallback(() => {
        setSelectedFaceIds(new Set(sortedFaces.map(f => f.id)));
    }, [sortedFaces]);

    // Deselect all pages
    const handleSelectNone = useCallback(() => {
        setSelectedFaceIds(new Set());
    }, []);

    // Get page indices from selected face IDs
    const getSelectedPageIndices = useCallback((): number[] => {
        return sortedFaces
            .filter(f => selectedFaceIds.has(f.id))
            .map(f => f.pageIndex || 0);
    }, [sortedFaces, selectedFaceIds]);

    // Handle batch download of selected pages
    const handleBatchDownload = useCallback(async () => {
        if (selectedFaceIds.size === 0) return;

        // If external handler is provided, use it
        if (onBatchDownload) {
            onBatchDownload(getSelectedPageIndices());
            return;
        }

        // Otherwise, use internal download logic
        setIsDownloading(true);
        setDownloadStatus('Preparing download...');

        try {
            const selectedFacesArray = sortedFaces.filter(f => selectedFaceIds.has(f.id));
            const safeTitle = (title || 'Comic').replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-');

            // Prepare images for download
            const images: ImageForDownload[] = selectedFacesArray.map((face, idx) => {
                const pName = face.type === 'cover'
                    ? '00-Cover'
                    : face.type === 'back_cover'
                        ? '99-BackCover'
                        : `Page-${String(face.pageIndex).padStart(2, '0')}`;
                return {
                    base64: face.imageUrl!,
                    pageNumber: idx + 1,
                    customName: `${safeTitle}-${pName}`,
                };
            });

            setDownloadStatus(`Downloading ${images.length} page${images.length > 1 ? 's' : ''}...`);
            const result = await downloadComicPages(images, safeTitle, { format: 'png' });

            if (result.success) {
                setDownloadStatus(`Downloaded ${result.fileCount} page${result.fileCount > 1 ? 's' : ''} (${formatFileSize(result.totalSize || 0)})`);
                setTimeout(() => setDownloadStatus(null), 3000);
            } else {
                setDownloadStatus(`Error: ${result.error || 'Download failed'}`);
                setTimeout(() => setDownloadStatus(null), 5000);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setDownloadStatus(`Error: ${message}`);
            setTimeout(() => setDownloadStatus(null), 5000);
        } finally {
            setIsDownloading(false);
        }
    }, [selectedFaceIds, sortedFaces, title, onBatchDownload, getSelectedPageIndices]);

    // Handle batch regeneration
    const handleBatchRegenerate = useCallback(() => {
        if (selectedFaceIds.size === 0 || !onBatchRegenerate) return;
        onBatchRegenerate(Array.from(selectedFaceIds));
        setSelectedFaceIds(new Set());
        setMultiSelectMode(false);
    }, [selectedFaceIds, onBatchRegenerate]);

    // Clear selection and exit selection mode
    const handleClearSelection = useCallback(() => {
        setSelectedFaceIds(new Set());
    }, []);

    // Exit selection mode
    const exitSelectionMode = useCallback(() => {
        setMultiSelectMode(false);
        setSelectedFaceIds(new Set());
    }, []);

    return (
        <div
            className="fixed inset-0 z-[500] flex flex-col items-center justify-start bg-black/95 backdrop-blur-md overflow-hidden"
            onClick={onClose}
            role="dialog"
            aria-label="Image Gallery"
            aria-modal="true"
        >
            {/* Hidden file input for image replacement */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                aria-hidden="true"
            />

            {/* Header */}
            <div
                className="w-full bg-indigo-900 border-b-[4px] border-black px-4 md:px-6 py-4 flex flex-wrap gap-3 justify-between items-center shrink-0 shadow-[0_8px_0_rgba(0,0,0,1)] z-10"
                onClick={e => e.stopPropagation()}
            >
                <h2 className="font-comic text-xl md:text-2xl lg:text-3xl font-bold uppercase tracking-wider text-white flex items-center gap-3">
                    Image Gallery
                    <span className="text-xs md:text-sm bg-black/50 px-3 py-1 rounded-full text-indigo-300 border-[2px] border-indigo-500">
                        {sortedFaces.length} / {validFaces.length} Images
                    </span>
                </h2>

                {/* Filter and Sort Controls */}
                <div className="flex flex-wrap gap-2 items-center">
                    {/* Filter Dropdown */}
                    <div className="flex items-center gap-2">
                        <label htmlFor="gallery-filter" className="text-white text-sm font-comic hidden sm:inline">Filter:</label>
                        <select
                            id="gallery-filter"
                            value={filterBy}
                            onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                            className="bg-indigo-800 text-white border-2 border-black rounded px-2 py-1 text-sm font-comic focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            aria-label="Filter pages"
                        >
                            <option value="all">All ({filterCounts.all})</option>
                            <option value="cover">Cover ({filterCounts.cover})</option>
                            <option value="story">Story ({filterCounts.story})</option>
                            <option value="back_cover">Back Cover ({filterCounts.back_cover})</option>
                        </select>
                    </div>

                    {/* Sort Dropdown */}
                    <div className="flex items-center gap-2">
                        <label htmlFor="gallery-sort" className="text-white text-sm font-comic hidden sm:inline">Sort:</label>
                        <select
                            id="gallery-sort"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="bg-indigo-800 text-white border-2 border-black rounded px-2 py-1 text-sm font-comic focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            aria-label="Sort pages"
                        >
                            <option value="page-order">Page Order</option>
                            <option value="generation-time">Generation Time</option>
                        </select>
                    </div>
                </div>

                <div className="flex gap-2 md:gap-4">
                    {selectedFaceId && !expandedFaceId && !multiSelectMode && (
                        <button
                            onClick={handleViewFullSize}
                            className="comic-btn bg-green-500 text-white px-3 md:px-6 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-green-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
                            aria-label="View selected image full size"
                        >
                            View Full Size
                        </button>
                    )}
                    {onGenerateCoverVariants && !multiSelectMode && (
                        <button
                            onClick={onGenerateCoverVariants}
                            className="comic-btn bg-purple-500 text-white px-3 md:px-6 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-purple-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
                            aria-label="Generate cover variants"
                            title="Generate multiple cover options to choose from"
                        >
                            Cover Variants
                        </button>
                    )}
                    {/* Multi-Select Toggle Button */}
                    <button
                        onClick={() => {
                            if (multiSelectMode) {
                                exitSelectionMode();
                            } else {
                                setMultiSelectMode(true);
                            }
                        }}
                        className={`comic-btn ${multiSelectMode ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'} px-3 md:px-6 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black`}
                        aria-label={multiSelectMode ? 'Exit selection mode' : 'Enter selection mode'}
                        aria-pressed={multiSelectMode}
                        title={multiSelectMode ? 'Exit batch selection mode' : 'Select multiple pages for batch operations'}
                    >
                        {multiSelectMode ? 'Exit Select' : 'Select Pages'}
                    </button>
                    {!multiSelectMode && (
                        <button
                            onClick={downloadAll}
                            disabled={isZipping}
                            className="comic-btn bg-blue-500 text-white px-3 md:px-6 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
                            aria-label="Download all images"
                        >
                            {isZipping
                                ? (zipProgress ? `Zipping ${zipProgress.current}/${zipProgress.total}…` : 'Zipping…')
                                : 'Download All'}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="comic-btn bg-red-600 text-white w-10 h-10 md:w-12 md:h-12 flex items-center justify-center font-bold text-xl md:text-2xl border-[3px] border-black hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
                        aria-label="Close gallery"
                    >
                        X
                    </button>
                </div>
            </div>

            {/* Batch Actions Bar - visible when in selection mode */}
            {multiSelectMode && (
                <div
                    className="w-full bg-yellow-500 border-b-[4px] border-black px-4 md:px-6 py-3 flex flex-wrap gap-3 justify-between items-center shrink-0 shadow-[0_4px_0_rgba(0,0,0,0.5)] z-10"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Selection Counter and Quick Actions */}
                    <div className="flex items-center gap-3">
                        <span className="font-comic text-sm md:text-base font-bold text-black bg-white px-3 py-1 rounded-full border-2 border-black shadow-[2px_2px_0_rgba(0,0,0,1)]">
                            {selectedFaceIds.size} page{selectedFaceIds.size !== 1 ? 's' : ''} selected
                        </span>
                        <button
                            onClick={handleSelectAll}
                            className="comic-btn bg-white text-black px-3 py-1 border-2 border-black font-bold uppercase tracking-wider text-xs hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-[2px_2px_0_rgba(0,0,0,1)]"
                            aria-label="Select all pages"
                            title={`Select all ${sortedFaces.length} pages in current view`}
                        >
                            Select All
                        </button>
                        <button
                            onClick={handleSelectNone}
                            className="comic-btn bg-white text-black px-3 py-1 border-2 border-black font-bold uppercase tracking-wider text-xs hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-[2px_2px_0_rgba(0,0,0,1)]"
                            aria-label="Deselect all pages"
                            disabled={selectedFaceIds.size === 0}
                        >
                            Select None
                        </button>
                    </div>

                    {/* Batch Action Buttons */}
                    <div className="flex items-center gap-2 md:gap-3">
                        {/* Download Status */}
                        {downloadStatus && (
                            <span className="font-comic text-xs md:text-sm text-black bg-white/80 px-3 py-1 rounded border border-black">
                                {downloadStatus}
                            </span>
                        )}

                        {/* Download Selected Button */}
                        <button
                            onClick={handleBatchDownload}
                            disabled={selectedFaceIds.size === 0 || isDownloading}
                            className="comic-btn bg-blue-600 text-white px-3 md:px-5 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-50 disabled:cursor-not-allowed shadow-[3px_3px_0_rgba(0,0,0,1)]"
                            aria-label={`Download ${selectedFaceIds.size} selected pages`}
                            title="Download selected pages as a ZIP file"
                        >
                            {isDownloading ? 'Downloading...' : `Download (${selectedFaceIds.size})`}
                        </button>

                        {/* Regenerate Selected Button */}
                        {onBatchRegenerate && (
                            <button
                                onClick={handleBatchRegenerate}
                                disabled={selectedFaceIds.size === 0}
                                className="comic-btn bg-orange-600 text-white px-3 md:px-5 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-50 disabled:cursor-not-allowed shadow-[3px_3px_0_rgba(0,0,0,1)]"
                                aria-label={`Regenerate ${selectedFaceIds.size} selected pages`}
                                title="Regenerate selected pages with AI"
                            >
                                Regenerate ({selectedFaceIds.size})
                            </button>
                        )}

                        {/* Clear Selection Button */}
                        <button
                            onClick={handleClearSelection}
                            disabled={selectedFaceIds.size === 0}
                            className="comic-btn bg-gray-700 text-white px-3 md:px-5 py-2 border-[3px] border-black font-bold uppercase tracking-wider text-xs md:text-sm hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-50 disabled:cursor-not-allowed shadow-[3px_3px_0_rgba(0,0,0,1)]"
                            aria-label="Clear selection"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            {/* Keyboard shortcuts hint */}
            {!expandedFaceId && sortedFaces.length > 0 && (
                <div className="w-full bg-black/50 px-4 py-2 text-center text-gray-400 text-xs font-comic" onClick={e => e.stopPropagation()}>
                    Arrow keys to navigate | Enter to view full size | Esc to close | Click to select, double-click to expand
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 w-full overflow-y-auto p-4 md:p-8" onClick={e => e.stopPropagation()}>
                {expandedFaceId !== null && expandedIndex >= 0 ? (
                    // EXPANDED VIEW (LIGHTBOX)
                    <div className="relative w-full h-full flex flex-col items-center justify-center">
                        {/* Zoom controls */}
                        <div className="absolute top-0 left-0 lg:left-10 flex gap-2 bg-black/70 rounded-lg p-2 z-20">
                            <button
                                onClick={() => setZoomLevel(z => Math.max(z - 0.25, 0.5))}
                                className="bg-gray-700 text-white w-10 h-10 flex items-center justify-center rounded border-2 border-gray-500 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 font-bold text-xl"
                                aria-label="Zoom out"
                                disabled={zoomLevel <= 0.5}
                            >
                                -
                            </button>
                            <span className="bg-gray-800 text-white px-3 py-2 rounded border-2 border-gray-500 font-comic text-sm min-w-[60px] text-center">
                                {Math.round(zoomLevel * 100)}%
                            </span>
                            <button
                                onClick={() => setZoomLevel(z => Math.min(z + 0.25, 3))}
                                className="bg-gray-700 text-white w-10 h-10 flex items-center justify-center rounded border-2 border-gray-500 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 font-bold text-xl"
                                aria-label="Zoom in"
                                disabled={zoomLevel >= 3}
                            >
                                +
                            </button>
                            <button
                                onClick={() => setZoomLevel(1)}
                                className="bg-gray-700 text-white px-3 py-2 rounded border-2 border-gray-500 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 font-comic text-sm"
                                aria-label="Reset zoom"
                            >
                                Reset
                            </button>
                        </div>

                        {/* Page indicator */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-black/70 rounded-lg px-4 py-2 z-20">
                            <span className="text-white font-comic text-sm">
                                {getPageLabel(sortedFaces[expandedIndex])} ({expandedIndex + 1} of {sortedFaces.length})
                            </span>
                        </div>

                        {/* Image container with zoom */}
                        <div className="relative max-h-full max-w-full flex overflow-auto">
                            <img
                                key={sortedFaces[expandedIndex].imageUrl?.slice(-20)}
                                src={sortedFaces[expandedIndex].imageUrl}
                                alt={`${getPageLabel(sortedFaces[expandedIndex])} - expanded view`}
                                className="max-h-[75vh] object-contain border-[6px] border-white shadow-[12px_12px_0_rgba(0,0,0,1)] bg-gray-900 transition-transform duration-200"
                                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                            />
                        </div>

                        <div className="mt-8 flex flex-wrap gap-3 w-full max-w-2xl justify-center relative z-10">
                            <button
                                onClick={() => {
                                    if (expandedIndex > 0) {
                                        setExpandedFaceId(sortedFaces[expandedIndex - 1].id);
                                        setZoomLevel(1);
                                    }
                                }}
                                disabled={expandedIndex === 0}
                                className="comic-btn bg-gray-200 px-4 md:px-6 py-3 border-[3px] border-black font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 uppercase focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                aria-label="Previous image"
                            >
                                Prev
                            </button>
                            <button
                                onClick={() => downloadImage(sortedFaces[expandedIndex].imageUrl!, `Comic-${sortedFaces[expandedIndex].id}.png`)}
                                className="comic-btn bg-green-500 text-white px-4 md:px-6 py-3 border-[3px] border-black font-bold hover:bg-green-400 uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                aria-label="Download this image"
                            >
                                Download
                            </button>
                            {onReplaceImage && (
                                <button
                                    onClick={() => handleReplaceClick(sortedFaces[expandedIndex].id)}
                                    className="comic-btn bg-orange-500 text-white px-4 md:px-6 py-3 border-[3px] border-black font-bold hover:bg-orange-400 uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                    aria-label="Replace this image"
                                >
                                    Replace
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (expandedIndex < sortedFaces.length - 1) {
                                        setExpandedFaceId(sortedFaces[expandedIndex + 1].id);
                                        setZoomLevel(1);
                                    }
                                }}
                                disabled={expandedIndex === sortedFaces.length - 1}
                                className="comic-btn bg-gray-200 px-4 md:px-6 py-3 border-[3px] border-black font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 uppercase focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                aria-label="Next image"
                            >
                                Next
                            </button>
                        </div>

                        {/* Keyboard hints for expanded view */}
                        <div className="mt-4 text-gray-400 text-xs font-comic text-center">
                            Left/Right arrows to navigate | +/- to zoom | 0 to reset zoom | Enter to download | Esc to close
                        </div>

                        <button
                            onClick={() => {
                                setExpandedFaceId(null);
                                setZoomLevel(1);
                                // Re-select the face that was expanded
                                if (sortedFaces[expandedIndex]) {
                                    setSelectedFaceId(sortedFaces[expandedIndex].id);
                                }
                            }}
                            className="absolute top-0 right-0 lg:right-10 bg-black text-white px-4 py-2 border-2 border-white font-comic hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            aria-label="Back to grid view"
                        >
                            Back to Grid
                        </button>
                    </div>
                ) : (
                    // GRID VIEW with larger thumbnails
                    <div
                        ref={gridRef}
                        className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 lg:gap-8 max-w-7xl mx-auto pb-20"
                        role="grid"
                        aria-label="Image gallery grid"
                    >
                        {sortedFaces.map((face, index) => {
                            const isSelected = selectedFaceId === face.id;
                            const isMultiSelected = selectedFaceIds.has(face.id);
                            const showSelected = isSelected || isMultiSelected;
                            return (
                                <div
                                    key={face.id}
                                    className={`relative group flex flex-col items-center transition-all duration-200 ${showSelected ? 'scale-105' : ''}`}
                                    role="gridcell"
                                    aria-selected={showSelected}
                                >
                                    <div
                                        className={`relative cursor-pointer transition-all duration-200 w-full border-[4px] shadow-[6px_6px_0_rgba(0,0,0,1)] overflow-hidden bg-gray-900 rounded-sm
                                            ${isMultiSelected
                                                ? 'border-orange-400 ring-4 ring-orange-400/50 shadow-[0_0_20px_rgba(251,146,60,0.5)]'
                                                : isSelected
                                                    ? 'border-yellow-400 ring-4 ring-yellow-400/50 shadow-[0_0_20px_rgba(250,204,21,0.5)]'
                                                    : 'border-white hover:border-indigo-400'
                                            }`}
                                        style={{ minHeight: '200px', aspectRatio: '2/3' }}
                                        onClick={(e) => handleThumbnailClick(face.id, e)}
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleThumbnailClick(face.id);
                                            }
                                        }}
                                        aria-label={`${getPageLabel(face)}${showSelected ? ' (selected)' : ''}${multiSelectMode ? ' - click to toggle selection' : ''}`}
                                        role="button"
                                    >
                                        <img
                                            key={face.imageUrl?.slice(-20)}
                                            src={face.imageUrl}
                                            className="w-full h-full object-cover"
                                            alt={`${getPageLabel(face)} thumbnail`}
                                            loading="lazy"
                                        />

                                        {/* Multi-select checkbox indicator */}
                                        {multiSelectMode && (
                                            <div className={`absolute top-2 right-2 w-7 h-7 rounded border-3 flex items-center justify-center font-bold text-sm z-10
                                                ${isMultiSelected
                                                    ? 'bg-orange-500 border-white text-white'
                                                    : 'bg-black/50 border-white/70 text-white/70'}`}
                                            >
                                                {isMultiSelected ? '✓' : ''}
                                            </div>
                                        )}

                                        {/* Hover/Selection overlay */}
                                        <div className={`absolute inset-0 transition-colors flex items-center justify-center
                                            ${isMultiSelected ? 'bg-orange-400/20' : isSelected ? 'bg-yellow-400/20' : 'bg-black/0 group-hover:bg-black/20'}`}>
                                            <span className={`bg-black/80 text-white font-bold px-4 py-2 rounded-full font-comic tracking-wider border-2 border-white transition-all
                                                ${showSelected ? 'opacity-100 scale-100' : 'opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100'}`}>
                                                {isMultiSelected ? 'BATCH' : isSelected ? 'SELECTED' : multiSelectMode ? 'SELECT' : 'VIEW'}
                                            </span>
                                        </div>

                                        {/* Page type badge */}
                                        <div className={`absolute top-2 left-2 ${getPageTypeColor(face.type)} text-white px-2 py-1 font-bold border-2 border-black text-xs font-comic shadow-[2px_2px_0_rgba(0,0,0,1)] uppercase`}>
                                            {face.type === 'cover' ? 'Cover' : face.type === 'back_cover' ? 'Back' : 'Story'}
                                        </div>

                                        {/* Page number badge */}
                                        <div className="absolute bottom-2 left-2 bg-yellow-400 text-black px-3 py-1 flex items-center justify-center font-bold border-2 border-black text-sm font-comic shadow-[2px_2px_0_rgba(0,0,0,1)]">
                                            {getPageLabel(face)}
                                        </div>

                                        {/* Index number (small, corner) */}
                                        <div className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 font-comic text-xs rounded">
                                            #{index + 1}
                                        </div>
                                    </div>

                                    {/* Action buttons below thumbnail */}
                                    <div className="mt-3 w-full flex gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const safeTitle = (title || 'Comic').replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-');
                                                const pName = face.type === 'cover' ? '00-Cover' : face.type === 'back_cover' ? '99-BackCover' : `Page-${String(face.pageIndex).padStart(2, '0')}`;
                                                downloadImage(face.imageUrl!, `${safeTitle}-${pName}.png`);
                                            }}
                                            className="flex-1 bg-blue-600 text-white py-2 font-comic text-xs uppercase font-bold tracking-wider hover:bg-blue-500 border-2 border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-transform focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                            aria-label={`Download ${getPageLabel(face)}`}
                                        >
                                            Save
                                        </button>
                                        {onReplaceImage && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleReplaceClick(face.id); }}
                                                className="flex-1 bg-orange-500 text-white py-2 font-comic text-xs uppercase font-bold tracking-wider hover:bg-orange-400 border-2 border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-transform focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                                title="Replace this image with your own"
                                                aria-label={`Replace ${getPageLabel(face)}`}
                                            >
                                                Replace
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {sortedFaces.length === 0 && (
                            <div className="col-span-full py-20 text-center">
                                <p className="font-comic text-2xl text-gray-400">
                                    {filterBy === 'all'
                                        ? 'No images generated yet.'
                                        : `No ${filterBy === 'back_cover' ? 'back cover' : filterBy} images found.`
                                    }
                                </p>
                                {filterBy !== 'all' && (
                                    <button
                                        onClick={() => setFilterBy('all')}
                                        className="mt-4 comic-btn bg-indigo-600 text-white px-6 py-2 border-[3px] border-black font-bold hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                    >
                                        Show All Images
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
