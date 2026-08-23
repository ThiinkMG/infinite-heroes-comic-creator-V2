/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { ComicFace, getComicConfig, StoryContext } from './types';
import { Panel } from './Panel';
import { useSwipeGesture } from './hooks/useSwipeGesture';

// ============================================================================
// TYPES
// ============================================================================

/** View mode for the comic reader */
export type ViewMode = 'spread' | 'single';

// ============================================================================
// CONSTANTS
// ============================================================================

/** localStorage key for swipe hint dismissal */
const SWIPE_HINT_DISMISSED_KEY = 'infiniteHeroes_swipeHintDismissed';

/** localStorage key for keyboard nav hint dismissal */
const NAV_HINT_DISMISSED_KEY = 'nav-hint-dismissed';

/** localStorage key for view mode preference */
const VIEW_MODE_PREFERENCE_KEY = 'infiniteHeroes_viewModePreference';

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to detect portrait orientation on mobile devices
 * Returns true when in portrait mode on a mobile-sized screen
 */
function useIsPortraitMobile(): boolean {
    const [isPortrait, setIsPortrait] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.innerHeight > window.innerWidth && window.innerWidth <= 768;
    });

    useEffect(() => {
        const checkOrientation = () => {
            const portrait = window.innerHeight > window.innerWidth && window.innerWidth <= 768;
            setIsPortrait(portrait);
        };

        // Check on resize
        window.addEventListener('resize', checkOrientation);

        // Also listen for orientation change event (mobile)
        const handleOrientationChange = () => {
            // Small delay to let the browser settle after orientation change
            setTimeout(checkOrientation, 100);
        };
        window.addEventListener('orientationchange', handleOrientationChange);

        // Check if matchMedia is available for orientation
        const mediaQuery = window.matchMedia('(orientation: portrait) and (max-width: 768px)');
        const handleMediaChange = (e: MediaQueryListEvent) => {
            setIsPortrait(e.matches);
        };

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleMediaChange);
        }

        return () => {
            window.removeEventListener('resize', checkOrientation);
            window.removeEventListener('orientationchange', handleOrientationChange);
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener('change', handleMediaChange);
            }
        };
    }, []);

    return isPortrait;
}

interface BookProps {
    /** Reports page-generation progress so the shell can display it. */
    onProgressChange?: (p: { isGenerating: boolean; done: number; total: number }) => void;
    comicFaces: ComicFace[];
    currentSheetIndex: number;
    /** Current single-page index for single-page mode (optional - will be calculated from sheetIndex if not provided) */
    currentPageIndex?: number;
    isStarted: boolean;
    isSetupVisible: boolean;
    storyContext: StoryContext;
    extraPages: number;
    generateFromOutline: boolean;
    onSheetClick: (index: number) => void;
    /** Callback for single-page navigation */
    onPageChange?: (pageIndex: number) => void;
    onChoice: (pageIndex: number, choice: string, isCustomAction?: boolean) => void;
    onReroll: (pageIndex: number) => void;
    onQuickRetry?: (pageIndex: number) => void;
    onAddPage: (instruction?: string) => void;
    onStop?: () => void;
    onStopHere?: () => void;
    onOpenBook: () => void;
    onDownload: () => void;
    onReset: () => void;
    /** External control for view mode (optional - auto-detects by default) */
    viewMode?: ViewMode;
    /** Callback when view mode changes */
    onViewModeChange?: (mode: ViewMode) => void;
}

/**
 * Check if device supports touch (for showing swipe hints)
 */
function isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export const Book: React.FC<BookProps> = (props) => {
    // Calculate total sheets and pages for navigation bounds
    const config = props.comicFaces.length > 0
        ? getComicConfig(props.storyContext.pageLength, props.extraPages)
        : null;
    const totalSheets = config ? Math.ceil((config.TOTAL_PAGES + 1) / 2) : 1;
    const totalPages = config ? config.TOTAL_PAGES + 2 : 1; // +2 for cover and back cover

    // Generation progress tracking
    const generatingCount = props.comicFaces.filter(f => f.isLoading).length;
    const doneCount = props.comicFaces.filter(f => !f.isLoading && !!f.imageUrl).length;
    const totalExpected = props.comicFaces.length;
    const isGenerating = generatingCount > 0;

    // Surface progress to the app shell, which renders it somewhere nothing can
    // cover. Effect rather than render-time call to avoid setting state during
    // another component's render.
    useEffect(() => {
        props.onProgressChange?.({ isGenerating, done: doneCount, total: totalExpected });
    }, [isGenerating, doneCount, totalExpected]);

    // Novel Mode: detect unresolved decision pages to lock navigation
    const unresolvedDecisionPage = useMemo(() => {
        if (props.generateFromOutline) return -1;
        const pages = props.comicFaces.filter(
            f => f.isDecisionPage && !f.resolvedChoice && f.choices && f.choices.length > 0
                 && !f.isLoading && f.pageIndex != null
        );
        return pages.length > 0 ? pages.reduce((max, f) => Math.max(max, f.pageIndex!), 0) : -1;
    }, [props.comicFaces, props.generateFromOutline]);
    const hasUnresolvedDecision = unresolvedDecisionPage !== -1;

    // Toast state for when user tries to navigate away from an unresolved decision
    const [showDecisionLockToast, setShowDecisionLockToast] = useState(false);
    const showDecisionToast = useCallback(() => {
        setShowDecisionLockToast(true);
        setTimeout(() => setShowDecisionLockToast(false), 2500);
    }, []);

    // Portrait mode detection
    const isPortraitMobile = useIsPortraitMobile();

    // View mode state - auto-switch based on orientation, but can be overridden
    const [internalViewMode, setInternalViewMode] = useState<ViewMode>(() => {
        // Check for saved preference (only if not on portrait mobile)
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(VIEW_MODE_PREFERENCE_KEY);
            if (saved === 'single' || saved === 'spread') {
                return saved;
            }
        }
        return 'spread';
    });

    // Use external viewMode if provided, otherwise use internal state
    const viewMode = props.viewMode ?? internalViewMode;
    // Force single-page mode in portrait mobile, otherwise use user preference
    const effectiveViewMode = isPortraitMobile ? 'single' : viewMode;

    // Single-page index tracking (used when in single-page mode)
    const [singlePageIndex, setSinglePageIndex] = useState(0);

    // Convert sheet index to page index when switching to single mode
    useEffect(() => {
        if (effectiveViewMode === 'single') {
            // When entering single mode, convert sheet index to page index
            // Sheet 0 = page 0 (cover)
            // Sheet 1 = pages 1-2, etc.
            const pageFromSheet = props.currentSheetIndex === 0
                ? 0
                : (props.currentSheetIndex - 1) * 2 + 1;
            setSinglePageIndex(pageFromSheet);
        }
    }, [effectiveViewMode, props.currentSheetIndex]);

    // Use provided pageIndex if available (for controlled mode)
    const currentSinglePage = props.currentPageIndex ?? singlePageIndex;

    // Handle view mode toggle
    const toggleViewMode = useCallback(() => {
        const newMode = viewMode === 'spread' ? 'single' : 'spread';
        setInternalViewMode(newMode);
        localStorage.setItem(VIEW_MODE_PREFERENCE_KEY, newMode);
        props.onViewModeChange?.(newMode);
    }, [viewMode, props.onViewModeChange]);

    // State for swipe hint visibility
    const [showSwipeHint, setShowSwipeHint] = useState<boolean>(false);

    // Check if swipe hint should be shown on mount
    useEffect(() => {
        // Only show on touch devices that haven't dismissed the hint
        if (isTouchDevice()) {
            const dismissed = localStorage.getItem(SWIPE_HINT_DISMISSED_KEY);
            if (!dismissed) {
                setShowSwipeHint(true);
                // Auto-dismiss after 5 seconds
                const timer = setTimeout(() => {
                    dismissSwipeHint();
                }, 5000);
                return () => clearTimeout(timer);
            }
        }
    }, []);

    // State for keyboard navigation hint (desktop only — shown on first ever visit)
    const [showNavHint, setShowNavHint] = useState<boolean>(() => {
        return localStorage.getItem(NAV_HINT_DISMISSED_KEY) !== 'true';
    });

    const dismissNavHint = useCallback(() => {
        setShowNavHint(false);
        localStorage.setItem(NAV_HINT_DISMISSED_KEY, 'true');
    }, []);

    // Auto-dismiss nav hint after 5 seconds
    useEffect(() => {
        if (!showNavHint) return;
        const timer = setTimeout(() => {
            dismissNavHint();
            console.debug('[Book] Nav hint auto-dismissed after 5s');
        }, 5000);
        return () => clearTimeout(timer);
    }, [showNavHint, dismissNavHint]);

    // Dismiss the swipe hint and remember in localStorage
    const dismissSwipeHint = useCallback(() => {
        setShowSwipeHint(false);
        localStorage.setItem(SWIPE_HINT_DISMISSED_KEY, 'true');
    }, []);

    // Navigation handlers for both modes
    const goToNextPage = useCallback(() => {
        if (props.isSetupVisible) return;
        if (hasUnresolvedDecision) { showDecisionToast(); return; }

        if (effectiveViewMode === 'single') {
            // Single-page mode: increment by 1
            if (currentSinglePage < totalPages - 1) {
                const newIndex = currentSinglePage + 1;
                setSinglePageIndex(newIndex);
                props.onPageChange?.(newIndex);
            }
        } else {
            // Spread mode: use sheet navigation
            if (props.currentSheetIndex < totalSheets - 1) {
                props.onSheetClick(props.currentSheetIndex + 1);
            }
        }

        // Dismiss hints on first successful navigation
        if (showSwipeHint) dismissSwipeHint();
        if (showNavHint) { dismissNavHint(); console.debug('[Book] Nav hint dismissed on navigation'); }
    }, [effectiveViewMode, currentSinglePage, totalPages, props, totalSheets, showSwipeHint, dismissSwipeHint, showNavHint, dismissNavHint, hasUnresolvedDecision, showDecisionToast]);

    const goToPreviousPage = useCallback(() => {
        if (props.isSetupVisible) return;
        if (hasUnresolvedDecision) { showDecisionToast(); return; }

        if (effectiveViewMode === 'single') {
            // Single-page mode: decrement by 1
            if (currentSinglePage > 0) {
                const newIndex = currentSinglePage - 1;
                setSinglePageIndex(newIndex);
                props.onPageChange?.(newIndex);
            }
        } else {
            // Spread mode: use sheet navigation
            if (props.currentSheetIndex > 0) {
                props.onSheetClick(props.currentSheetIndex - 1);
            }
        }

        // Dismiss hints on first successful navigation
        if (showSwipeHint) dismissSwipeHint();
        if (showNavHint) { dismissNavHint(); console.debug('[Book] Nav hint dismissed on navigation'); }
    }, [effectiveViewMode, currentSinglePage, props, showSwipeHint, dismissSwipeHint, showNavHint, dismissNavHint, hasUnresolvedDecision, showDecisionToast]);

    // Swipe gesture handlers for mobile navigation
    const { handlers: swipeHandlers, swipeOffset, isSwiping } = useSwipeGesture({
        onSwipeLeft: goToNextPage,
        onSwipeRight: goToPreviousPage,
        threshold: 50,
        enabled: !props.isSetupVisible && props.comicFaces.length > 0 && !hasUnresolvedDecision,
    });

    // Keyboard navigation handler
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // Skip if setup is visible (book is not in focus)
        if (props.isSetupVisible) return;

        // Skip if user is typing in an input field
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return;
        }

        switch (event.key) {
            case 'ArrowRight':
                event.preventDefault();
                goToNextPage();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                goToPreviousPage();
                break;
            case 'Home':
                event.preventDefault();
                if (effectiveViewMode === 'single') {
                    setSinglePageIndex(0);
                    props.onPageChange?.(0);
                } else {
                    props.onSheetClick(0);
                }
                break;
            case 'End':
                event.preventDefault();
                if (effectiveViewMode === 'single') {
                    setSinglePageIndex(totalPages - 1);
                    props.onPageChange?.(totalPages - 1);
                } else {
                    props.onSheetClick(totalSheets - 1);
                }
                break;
            case 'v':
            case 'V':
                // Toggle view mode with 'V' key (only when not forced by portrait)
                if (!isPortraitMobile) {
                    event.preventDefault();
                    toggleViewMode();
                }
                break;
        }
    }, [props.isSetupVisible, effectiveViewMode, totalPages, totalSheets, goToNextPage, goToPreviousPage, isPortraitMobile, toggleViewMode, props]);

    // Add/remove keyboard event listener
    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown]);

    // Debug: log generation progress whenever it changes
    useEffect(() => {
        if (isGenerating) {
            console.debug('[Book] Generation progress:', doneCount, '/', totalExpected, '- still loading:', generatingCount);
        }
    }, [doneCount, totalExpected, generatingCount, isGenerating]);

    // Build sheets to render (for spread mode)
    const sheetsToRender = useMemo(() => {
        const sheets: { front: ComicFace | undefined; back: ComicFace | undefined }[] = [];
        if (props.comicFaces.length > 0 && config) {
            sheets.push({ front: props.comicFaces[0], back: props.comicFaces.find(f => f.pageIndex === 1) });
            for (let i = 2; i <= config.TOTAL_PAGES; i += 2) {
                sheets.push({ front: props.comicFaces.find(f => f.pageIndex === i), back: props.comicFaces.find(f => f.pageIndex === i + 1) });
            }
        } else if (props.isSetupVisible) {
            // Placeholder sheet for initial render behind setup
            sheets.push({ front: undefined, back: undefined });
        }
        return sheets;
    }, [props.comicFaces, config, props.isSetupVisible]);

    // Get current page face for single-page mode
    const currentPageFace = useMemo(() => {
        return props.comicFaces.find(f => f.pageIndex === currentSinglePage);
    }, [props.comicFaces, currentSinglePage]);

    // Calculate subtle visual feedback during swipe (limited tilt effect)
    const swipeFeedbackStyle = isSwiping && !props.isSetupVisible
        ? { transform: `rotateY(${Math.min(Math.max(swipeOffset * 0.02, -5), 5)}deg)` }
        : {};

    // ============================================================================
    // SINGLE-PAGE MODE RENDER
    // ============================================================================
    if (effectiveViewMode === 'single' && !props.isSetupVisible && props.comicFaces.length > 0) {
        const isCover = currentSinglePage === 0;
        const isBackCover = currentPageFace?.type === 'back_cover';

        return (
            <>
                <div
                    className="book-single-page relative transition-all duration-300 ease-in-out"
                    {...swipeHandlers}
                    style={{
                        width: 'min(90vw, 500px)',
                        height: 'min(85vh, 750px)',
                        margin: '0 auto',
                        transform: isSwiping ? `translateX(${swipeOffset * 0.3}px)` : undefined,
                    }}
                >
                    {/* View mode toggle (only show when not forced by portrait) */}
                    {!isPortraitMobile && (
                        <button
                            onClick={toggleViewMode}
                            className="absolute -top-10 right-0 z-40 bg-black/70 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-black/90 transition-colors"
                            title="Switch to spread view (V)"
                            aria-label="Switch to spread view"
                        >
                            Spread View
                        </button>
                    )}

                    {/* Generation progress indicator */}
                    {isGenerating && (
                        <div className="absolute -top-10 left-0 z-40 hidden sm:flex items-center gap-1.5 text-xs font-comic text-purple-300 animate-pulse">
                            <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                            <span>Generating {doneCount}/{totalExpected} pages…</span>
                        </div>
                    )}

                    {/* Page indicator */}
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 z-40 bg-black/70 text-white px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap">
                        {isCover ? 'Cover' :
                         isBackCover ? 'Back Cover' :
                         `Page ${currentSinglePage} of ${totalPages - 2}`}
                    </div>

                    {/* Navigation arrows */}
                    {currentSinglePage > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); goToPreviousPage(); }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 z-30 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            aria-label="Previous page"
                        >
                            <span className="text-xl">&#9664;</span>
                        </button>
                    )}
                    {currentSinglePage < totalPages - 1 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); goToNextPage(); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 z-30 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            aria-label="Next page"
                        >
                            <span className="text-xl">&#9654;</span>
                        </button>
                    )}

                    {/* Single page panel */}
                    <div
                        className={`paper-single w-full h-full overflow-hidden ${isCover ? 'cover-page' : ''}`}
                        style={{
                            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                            borderRadius: '4px',
                        }}
                    >
                        <Panel
                            face={currentPageFace}
                            allFaces={props.comicFaces}
                            storyContext={props.storyContext}
                            generateFromOutline={props.generateFromOutline}
                            onChoice={props.onChoice}
                            onReroll={props.onReroll}
                            onQuickRetry={props.onQuickRetry}
                            onAddPage={props.onAddPage}
                            onStop={props.onStop}
                            onStopHere={props.onStopHere}
                            onOpenBook={props.onOpenBook}
                            onDownload={props.onDownload}
                            onReset={props.onReset}
                        />
                    </div>
                </div>

                {/* Keyboard/swipe nav hint — shown on first visit, hidden on touch devices via CSS */}
                {showNavHint && !isTouchDevice() && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white font-comic text-xs px-4 py-2 rounded-full z-50 pointer-events-none flex items-center gap-2 animate-pulse">
                        <span>← → Arrow keys to flip pages</span>
                    </div>
                )}

                {/* Swipe hint for single-page mode */}
                {showSwipeHint && (
                    <div
                        className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50"
                        style={{ animation: 'fadeInUp 0.3s ease-out' }}
                    >
                        <div
                            className="bg-black/80 text-white px-6 py-3 rounded-full flex items-center gap-3 shadow-lg backdrop-blur-sm"
                            onClick={dismissSwipeHint}
                            role="status"
                            aria-live="polite"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                            <span className="text-sm font-medium">Swipe to turn pages</span>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </div>
                    </div>
                )}

                {/* Decision lock toast for single-page mode */}
                {showDecisionLockToast && (
                    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                        <div className="bg-yellow-400 text-black font-comic font-bold text-sm px-5 py-2.5 rounded-full shadow-lg border-2 border-black flex items-center gap-2">
                            <span>⚡</span>
                            <span>Make your choice to continue!</span>
                        </div>
                    </div>
                )}

                {/* CSS for animations */}
                <style>{`
                    @keyframes fadeInUp {
                        from { opacity: 0; transform: translate(-50%, 20px); }
                        to { opacity: 1; transform: translate(-50%, 0); }
                    }
                    .paper-single {
                        background-color: #fff;
                    }
                    .paper-single.cover-page {
                        background-color: #0a0a0a;
                    }
                `}</style>
            </>
        );
    }

    // ============================================================================
    // SPREAD MODE RENDER (DEFAULT)
    // ============================================================================
    return (
        <>
            <div
                className={`book ${props.currentSheetIndex > 0 ? 'opened' : ''} transition-all duration-1000 ease-in-out`}
                style={{
                    ...(props.isSetupVisible
                        ? { transform: 'translateZ(-600px) translateY(-100px) rotateX(20deg) scale(0.9)', filter: 'blur(6px) brightness(0.7)', pointerEvents: 'none' }
                        : swipeFeedbackStyle),
                }}
                {...swipeHandlers}
            >
                {/* View mode toggle (only show when book is open and not in portrait) */}
                {!props.isSetupVisible && !isPortraitMobile && props.currentSheetIndex > 0 && (
                    <button
                        onClick={toggleViewMode}
                        className="absolute -top-10 right-0 z-40 bg-black/70 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-black/90 transition-colors"
                        title="Switch to single-page view (V)"
                        aria-label="Switch to single-page view"
                    >
                        Single Page
                    </button>
                )}

                {/*
                  The generation indicator used to live here, at `absolute -top-10
                  left-0 z-40`. The book is centred and transformed, so on common
                  viewports that placed it directly beneath the reader's top
                  navigation — which sits at z-[100] — leaving faint purple text
                  hidden behind the buttons. During Novel Mode it was the only
                  progress signal there was.

                  It now renders as a fixed status pill in App.tsx, where nothing
                  can cover it. Book reports the counts upward instead.
                */}

                {sheetsToRender.map((sheet, i) => (
                    <div
                        key={i}
                        className={`paper ${i < props.currentSheetIndex ? 'flipped' : ''}`}
                        style={{ zIndex: i < props.currentSheetIndex ? i : sheetsToRender.length - i }}
                        onClick={() => props.onSheetClick(i)}
                    >
                        <div className="front">
                            <Panel face={sheet.front} allFaces={props.comicFaces} storyContext={props.storyContext} generateFromOutline={props.generateFromOutline} onChoice={props.onChoice} onReroll={props.onReroll} onQuickRetry={props.onQuickRetry} onAddPage={props.onAddPage} onStop={props.onStop} onStopHere={props.onStopHere} onOpenBook={props.onOpenBook} onDownload={props.onDownload} onReset={props.onReset} />
                        </div>
                        <div className="back">
                            <Panel face={sheet.back} allFaces={props.comicFaces} storyContext={props.storyContext} generateFromOutline={props.generateFromOutline} onChoice={props.onChoice} onReroll={props.onReroll} onQuickRetry={props.onQuickRetry} onAddPage={props.onAddPage} onStop={props.onStop} onStopHere={props.onStopHere} onOpenBook={props.onOpenBook} onDownload={props.onDownload} onReset={props.onReset} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Keyboard navigation hint — desktop only, shown on first visit */}
            {showNavHint && !isTouchDevice() && !props.isSetupVisible && props.comicFaces.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white font-comic text-xs px-4 py-2 rounded-full z-50 pointer-events-none flex items-center gap-2 animate-pulse">
                    <span>← → Arrow keys to flip pages</span>
                </div>
            )}

            {/* Mobile swipe hint - shown on first visit for touch devices */}
            {showSwipeHint && !props.isSetupVisible && props.comicFaces.length > 0 && (
                <div
                    className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in"
                    style={{
                        animation: 'fadeInUp 0.3s ease-out',
                    }}
                >
                    <div
                        className="bg-black/80 text-white px-6 py-3 rounded-full flex items-center gap-3 shadow-lg backdrop-blur-sm"
                        onClick={dismissSwipeHint}
                        role="status"
                        aria-live="polite"
                    >
                        {/* Left arrow */}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        <span className="text-sm font-medium">Swipe to navigate</span>
                        {/* Right arrow */}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                </div>
            )}

            {/* Decision lock toast — shown when user tries to navigate away from an unresolved choice */}
            {showDecisionLockToast && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                    <div className="bg-yellow-400 text-black font-comic font-bold text-sm px-5 py-2.5 rounded-full shadow-lg border-2 border-black flex items-center gap-2">
                        <span>⚡</span>
                        <span>Make your choice to continue!</span>
                    </div>
                </div>
            )}

            {/* CSS for animation */}
            <style>{`
                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translate(-50%, 20px);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, 0);
                    }
                }
            `}</style>
        </>
    );
}
