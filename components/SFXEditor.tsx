/**
 * SFX Editor Component for Infinite Heroes Comic Creator
 *
 * A comprehensive editor for placing and manipulating comic-style sound effects
 * (SFX) on panel images. Provides drag-and-drop placement, resize, rotate,
 * and visual preview capabilities.
 *
 * Features:
 * - Grid of available SFX from library with category filtering
 * - Click on panel to place selected SFX
 * - Drag to reposition placed SFX
 * - Resize and rotate controls for each placed SFX
 * - Delete functionality
 * - Live preview of final result
 * - Export/save placed SFX positions
 */

import type { PlacedSFX } from '../types';
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  SFX_LIBRARY,
  SFXEntry,
  SFXStyle,
  SFX_STYLE_LABELS,
  SFX_STYLE_COLORS,
  getSFXStyles,
  getSFXById,
} from '../data/sfxLibrary';
import { SFXOverlay } from './SFXOverlay';
import {
  SFXElement,
  createSFXElement,
  mergeSFXWithImage,
} from '../utils/sfxRenderer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Represents a placed SFX on the panel
 */
// PlacedSFX lives in types.ts so ComicFace can hold it without types depending
// on the UI layer. Re-exported here for existing imports.
export type { PlacedSFX };

/**
 * Props for the SFXEditor component
 */
export interface SFXEditorProps {
  /** Panel image (base64 or URL) */
  panelImage: string;
  /** Initial SFX placements */
  initialSFX?: PlacedSFX[];
  /** Callback when SFX placements change */
  onSFXChange: (sfx: PlacedSFX[]) => void;
  /** Callback to close the editor */
  onClose: () => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert PlacedSFX to SFXElement for rendering
 */
export function placedSFXToElement(placed: PlacedSFX, isSelected: boolean = false): SFXElement | null {
  const sfxEntry = getSFXById(placed.sfxId);
  if (!sfxEntry) return null;

  return {
    id: placed.id,
    sfxId: placed.sfxId,
    text: sfxEntry.text,
    style: sfxEntry.style,
    position: placed.position,
    rotation: placed.rotation,
    scale: placed.scale,
    color: sfxEntry.color,
    outlineColor: sfxEntry.outlineColor,
    font: sfxEntry.font,
    opacity: 1,
    isSelected,
  };
}

/**
 * Generate unique ID for placed SFX
 */
function generatePlacedId(): string {
  return `placed-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * SFX Library Grid - displays available SFX organized by category
 */
const SFXLibraryGrid: React.FC<{
  selectedSFXId: string | null;
  onSelectSFX: (sfxId: string) => void;
  filterStyle: SFXStyle | 'all';
  onFilterChange: (style: SFXStyle | 'all') => void;
}> = ({ selectedSFXId, onSelectSFX, filterStyle, onFilterChange }) => {
  const filteredSFX = useMemo(() => {
    if (filterStyle === 'all') return SFX_LIBRARY;
    return SFX_LIBRARY.filter((sfx) => sfx.style === filterStyle);
  }, [filterStyle]);

  const styles = getSFXStyles();

  return (
    <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-3">
      {/* Category Filter */}
      <div className="mb-3">
        <label className="font-comic text-xs font-bold text-gray-700 uppercase block mb-2">
          Category
        </label>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => onFilterChange('all')}
            className={`px-2 py-1 text-xs font-comic font-bold rounded border-2 transition-colors ${
              filterStyle === 'all'
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
            }`}
          >
            All
          </button>
          {styles.map((style) => (
            <button
              key={style}
              onClick={() => onFilterChange(style)}
              className={`px-2 py-1 text-xs font-comic font-bold rounded border-2 transition-colors ${
                filterStyle === style
                  ? 'text-white border-black'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
              }`}
              style={{
                backgroundColor: filterStyle === style ? SFX_STYLE_COLORS[style] : undefined,
              }}
            >
              {SFX_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      </div>

      {/* SFX Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
        {filteredSFX.map((sfx) => (
          <button
            key={sfx.id}
            onClick={() => onSelectSFX(sfx.id)}
            className={`p-2 rounded border-2 transition-all transform hover:scale-105 ${
              selectedSFXId === sfx.id
                ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50'
                : 'border-gray-300 bg-white hover:border-gray-500'
            }`}
            title={sfx.description}
          >
            <span
              className="font-comic font-bold text-sm block truncate"
              style={{ color: sfx.color, textShadow: `1px 1px 0 ${sfx.outlineColor}` }}
            >
              {sfx.text}
            </span>
          </button>
        ))}
      </div>

      {/* Instructions */}
      <p className="text-xs text-gray-500 mt-2 font-comic">
        Select an SFX, then click on the panel to place it.
      </p>
    </div>
  );
};

/**
 * Controls for manipulating a selected SFX element
 */
const SFXControlPanel: React.FC<{
  selectedPlaced: PlacedSFX | null;
  onUpdate: (id: string, updates: Partial<PlacedSFX>) => void;
  onDelete: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
}> = ({ selectedPlaced, onUpdate, onDelete, onBringToFront, onSendToBack }) => {
  if (!selectedPlaced) {
    return (
      <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-3">
        <p className="text-sm text-gray-500 font-comic text-center">
          Select a placed SFX to edit its properties
        </p>
      </div>
    );
  }

  const sfxEntry = getSFXById(selectedPlaced.sfxId);

  return (
    <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3 space-y-3">
      <h4 className="font-comic font-bold text-blue-800 text-sm uppercase">
        Editing: {sfxEntry?.text ?? 'Unknown'}
      </h4>

      {/* Scale Slider */}
      <div>
        <label className="font-comic text-xs font-bold text-gray-700 block mb-1">
          Size: {(selectedPlaced.scale * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0.3"
          max="3"
          step="0.1"
          value={selectedPlaced.scale}
          onChange={(e) =>
            onUpdate(selectedPlaced.id, { scale: parseFloat(e.target.value) })
          }
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Rotation Slider */}
      <div>
        <label className="font-comic text-xs font-bold text-gray-700 block mb-1">
          Rotation: {selectedPlaced.rotation}deg
        </label>
        <input
          type="range"
          min="-45"
          max="45"
          step="1"
          value={selectedPlaced.rotation}
          onChange={(e) =>
            onUpdate(selectedPlaced.id, { rotation: parseFloat(e.target.value) })
          }
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Position Fine-tune */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-comic text-xs font-bold text-gray-700 block mb-1">
            X: {selectedPlaced.position.x.toFixed(1)}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={selectedPlaced.position.x}
            onChange={(e) =>
              onUpdate(selectedPlaced.id, {
                position: { ...selectedPlaced.position, x: parseFloat(e.target.value) },
              })
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        <div>
          <label className="font-comic text-xs font-bold text-gray-700 block mb-1">
            Y: {selectedPlaced.position.y.toFixed(1)}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={selectedPlaced.position.y}
            onChange={(e) =>
              onUpdate(selectedPlaced.id, {
                position: { ...selectedPlaced.position, y: parseFloat(e.target.value) },
              })
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* Layer Controls */}
      <div className="flex gap-2">
        <button
          onClick={() => onBringToFront(selectedPlaced.id)}
          className="flex-1 px-2 py-1 text-xs font-comic font-bold bg-gray-200 hover:bg-gray-300 border-2 border-gray-400 rounded transition-colors"
          title="Bring to front"
        >
          Front
        </button>
        <button
          onClick={() => onSendToBack(selectedPlaced.id)}
          className="flex-1 px-2 py-1 text-xs font-comic font-bold bg-gray-200 hover:bg-gray-300 border-2 border-gray-400 rounded transition-colors"
          title="Send to back"
        >
          Back
        </button>
      </div>

      {/* Delete Button */}
      <button
        onClick={() => onDelete(selectedPlaced.id)}
        className="w-full px-3 py-2 text-sm font-comic font-bold bg-red-500 hover:bg-red-600 text-white border-2 border-red-700 rounded transition-colors"
      >
        Delete SFX
      </button>
    </div>
  );
};

/**
 * List of placed SFX elements
 */
const PlacedSFXList: React.FC<{
  placedSFX: PlacedSFX[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ placedSFX, selectedId, onSelect, onDelete }) => {
  if (placedSFX.length === 0) {
    return (
      <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-3">
        <p className="text-sm text-gray-500 font-comic text-center">
          No SFX placed yet. Select one from the library above and click on the panel.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
      <div className="bg-gray-100 px-3 py-2 border-b-2 border-gray-300">
        <h4 className="font-comic font-bold text-gray-700 text-xs uppercase">
          Placed SFX ({placedSFX.length})
        </h4>
      </div>
      <div className="max-h-32 overflow-y-auto">
        {placedSFX.map((placed) => {
          const sfxEntry = getSFXById(placed.sfxId);
          return (
            <div
              key={placed.id}
              className={`flex items-center justify-between px-3 py-2 border-b border-gray-100 cursor-pointer transition-colors ${
                selectedId === placed.id
                  ? 'bg-blue-100'
                  : 'hover:bg-gray-50'
              }`}
              onClick={() => onSelect(placed.id)}
            >
              <span
                className="font-comic font-bold text-sm"
                style={{
                  color: sfxEntry?.color ?? '#000',
                  textShadow: `1px 1px 0 ${sfxEntry?.outlineColor ?? '#fff'}`,
                }}
              >
                {sfxEntry?.text ?? 'Unknown'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(placed.id);
                }}
                className="text-red-500 hover:text-red-700 text-lg font-bold px-2"
                title="Delete"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const SFXEditor: React.FC<SFXEditorProps> = ({
  panelImage,
  initialSFX = [],
  onSFXChange,
  onClose,
}) => {
  // State
  const [placedSFX, setPlacedSFX] = useState<PlacedSFX[]>(initialSFX);
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  const [selectedLibrarySFXId, setSelectedLibrarySFXId] = useState<string | null>(null);
  const [filterStyle, setFilterStyle] = useState<SFXStyle | 'all'>('all');
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // Refs
  const panelContainerRef = useRef<HTMLDivElement>(null);

  // Convert placed SFX to elements for rendering
  const sfxElements = useMemo(() => {
    return placedSFX
      .map((placed) => placedSFXToElement(placed, placed.id === selectedPlacedId))
      .filter((el): el is SFXElement => el !== null);
  }, [placedSFX, selectedPlacedId]);

  // Get selected placed SFX
  const selectedPlaced = useMemo(() => {
    return placedSFX.find((p) => p.id === selectedPlacedId) ?? null;
  }, [placedSFX, selectedPlacedId]);

  // Handle click on panel to place SFX
  const handlePanelClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!selectedLibrarySFXId) return;

      const container = panelContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      const sfxEntry = getSFXById(selectedLibrarySFXId);
      if (!sfxEntry) return;

      const newPlaced: PlacedSFX = {
        id: generatePlacedId(),
        sfxId: selectedLibrarySFXId,
        position: { x, y },
        scale: 1,
        rotation: sfxEntry.defaultRotation ?? 0,
      };

      setPlacedSFX((prev) => [...prev, newPlaced]);
      setSelectedPlacedId(newPlaced.id);
      setSelectedLibrarySFXId(null); // Clear selection after placing
    },
    [selectedLibrarySFXId]
  );

  // Handle element click (selection)
  const handleElementClick = useCallback((element: SFXElement) => {
    setSelectedPlacedId(element.id);
  }, []);

  // Handle element drag
  const handleElementDrag = useCallback(
    (element: SFXElement, _index: number, newPosition: { x: number; y: number }) => {
      setPlacedSFX((prev) =>
        prev.map((p) =>
          p.id === element.id ? { ...p, position: newPosition } : p
        )
      );
    },
    []
  );

  // Handle element drag end
  const handleElementDragEnd = useCallback(
    (element: SFXElement, _index: number, finalPosition: { x: number; y: number }) => {
      setPlacedSFX((prev) =>
        prev.map((p) =>
          p.id === element.id ? { ...p, position: finalPosition } : p
        )
      );
    },
    []
  );

  // Update a placed SFX
  const handleUpdatePlaced = useCallback(
    (id: string, updates: Partial<PlacedSFX>) => {
      setPlacedSFX((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );
    },
    []
  );

  // Delete a placed SFX
  const handleDeletePlaced = useCallback(
    (id: string) => {
      setPlacedSFX((prev) => prev.filter((p) => p.id !== id));
      if (selectedPlacedId === id) {
        setSelectedPlacedId(null);
      }
    },
    [selectedPlacedId]
  );

  // Bring to front
  const handleBringToFront = useCallback((id: string) => {
    setPlacedSFX((prev) => {
      const element = prev.find((p) => p.id === id);
      if (!element) return prev;
      return [...prev.filter((p) => p.id !== id), element];
    });
  }, []);

  // Send to back
  const handleSendToBack = useCallback((id: string) => {
    setPlacedSFX((prev) => {
      const element = prev.find((p) => p.id === id);
      if (!element) return prev;
      return [element, ...prev.filter((p) => p.id !== id)];
    });
  }, []);

  // Clear all SFX
  const handleClearAll = useCallback(() => {
    if (window.confirm('Remove all placed SFX?')) {
      setPlacedSFX([]);
      setSelectedPlacedId(null);
    }
  }, []);

  // Generate preview
  const handleGeneratePreview = useCallback(async () => {
    if (sfxElements.length === 0) {
      alert('No SFX to preview. Place some SFX first.');
      return;
    }

    setIsGeneratingPreview(true);
    try {
      const mergedImage = await mergeSFXWithImage(panelImage, sfxElements);
      setPreviewImage(mergedImage);
      setIsPreviewMode(true);
    } catch (error) {
      console.error('Failed to generate preview:', error);
      alert('Failed to generate preview. Please try again.');
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [panelImage, sfxElements]);

  // Save and close
  const handleSave = useCallback(() => {
    onSFXChange(placedSFX);
    onClose();
  }, [placedSFX, onSFXChange, onClose]);

  // Cancel without saving
  const handleCancel = useCallback(() => {
    if (placedSFX.length > 0 && placedSFX.length !== initialSFX.length) {
      if (!window.confirm('Discard unsaved changes?')) {
        return;
      }
    }
    onClose();
  }, [placedSFX, initialSFX, onClose]);

  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPreviewMode) {
          setIsPreviewMode(false);
        } else if (selectedPlacedId) {
          setSelectedPlacedId(null);
        } else if (selectedLibrarySFXId) {
          setSelectedLibrarySFXId(null);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPlacedId && !e.target) {
          handleDeletePlaced(selectedPlacedId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPreviewMode, selectedPlacedId, selectedLibrarySFXId, handleDeletePlaced]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[700] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-4 border-black bg-yellow-100">
          <h2 className="font-comic font-bold text-lg sm:text-xl uppercase text-yellow-900">
            SFX Editor
          </h2>
          <div className="flex items-center gap-2">
            {isPreviewMode && (
              <button
                onClick={() => setIsPreviewMode(false)}
                className="px-3 py-1 text-sm font-comic font-bold bg-gray-200 hover:bg-gray-300 border-2 border-gray-400 rounded transition-colors"
              >
                Back to Edit
              </button>
            )}
            <button
              onClick={handleCancel}
              className="p-2 min-w-[48px] min-h-[48px] text-2xl text-gray-600 hover:text-gray-900 hover:bg-yellow-200 rounded transition-colors"
              aria-label="Close editor"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Panel Preview Area */}
          <div className="flex-1 bg-gray-800 p-4 flex items-center justify-center overflow-auto">
            {isPreviewMode && previewImage ? (
              <img
                src={previewImage}
                alt="Preview with SFX"
                className="max-w-full max-h-full object-contain rounded shadow-lg"
              />
            ) : (
              <div
                ref={panelContainerRef}
                className={`relative max-w-full max-h-full ${
                  selectedLibrarySFXId ? 'cursor-crosshair' : 'cursor-default'
                }`}
                onClick={handlePanelClick}
              >
                <img
                  src={panelImage}
                  alt="Panel"
                  className="max-w-full max-h-[60vh] object-contain rounded shadow-lg"
                  draggable={false}
                />
                <SFXOverlay
                  elements={sfxElements}
                  interactive={true}
                  onElementClick={handleElementClick}
                  onElementDrag={handleElementDrag}
                  onElementDragEnd={handleElementDragEnd}
                />
                {/* Placement hint */}
                {selectedLibrarySFXId && (
                  <div className="absolute top-2 left-2 bg-blue-500 text-white px-3 py-1 rounded font-comic text-sm">
                    Click to place: {getSFXById(selectedLibrarySFXId)?.text}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar Controls */}
          {!isPreviewMode && (
            <div className="w-full lg:w-80 bg-gray-50 border-l-2 border-gray-200 overflow-y-auto p-4 space-y-4">
              {/* SFX Library */}
              <div>
                <h3 className="font-comic font-bold text-gray-800 text-sm uppercase mb-2">
                  SFX Library
                </h3>
                <SFXLibraryGrid
                  selectedSFXId={selectedLibrarySFXId}
                  onSelectSFX={setSelectedLibrarySFXId}
                  filterStyle={filterStyle}
                  onFilterChange={setFilterStyle}
                />
              </div>

              {/* Placed SFX List */}
              <div>
                <h3 className="font-comic font-bold text-gray-800 text-sm uppercase mb-2">
                  Placed SFX
                </h3>
                <PlacedSFXList
                  placedSFX={placedSFX}
                  selectedId={selectedPlacedId}
                  onSelect={setSelectedPlacedId}
                  onDelete={handleDeletePlaced}
                />
              </div>

              {/* Control Panel for Selected SFX */}
              <div>
                <h3 className="font-comic font-bold text-gray-800 text-sm uppercase mb-2">
                  Edit Selected
                </h3>
                <SFXControlPanel
                  selectedPlaced={selectedPlaced}
                  onUpdate={handleUpdatePlaced}
                  onDelete={handleDeletePlaced}
                  onBringToFront={handleBringToFront}
                  onSendToBack={handleSendToBack}
                />
              </div>

              {/* Clear All Button */}
              {placedSFX.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="w-full px-3 py-2 text-sm font-comic font-bold bg-gray-200 hover:bg-gray-300 text-gray-700 border-2 border-gray-400 rounded transition-colors"
                >
                  Clear All SFX
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t-4 border-black bg-yellow-50 flex flex-wrap gap-2 justify-end">
          <button
            onClick={handleGeneratePreview}
            disabled={isGeneratingPreview || placedSFX.length === 0}
            className="px-4 py-2 text-sm font-comic font-bold bg-purple-500 hover:bg-purple-600 text-white border-2 border-purple-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGeneratingPreview ? 'Generating...' : 'Preview'}
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-comic font-bold bg-gray-400 hover:bg-gray-500 text-white border-2 border-gray-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-comic font-bold bg-green-500 hover:bg-green-600 text-white border-2 border-green-700 rounded transition-colors"
          >
            Save SFX
          </button>
        </div>
      </div>
    </div>
  );
};

export default SFXEditor;
