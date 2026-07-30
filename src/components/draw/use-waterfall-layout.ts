'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ── Types ──

export interface WaterfallPlacement {
  key: string;
  col: number;
  top: number;
  left: number;
  width: number;
  loaded: boolean;
  renderedHeight: number;
  placeholderHeight: number;
}

interface UseWaterfallLayoutOptions {
  itemKeys: string[];
  colCount: number;
  gap?: number;
}

interface UseWaterfallLayoutResult {
  containerRefCb: (el: HTMLDivElement | null) => void;
  containerHeight: number;
  placements: WaterfallPlacement[];
  handleImageLoad: (index: number, naturalWidth: number, naturalHeight: number) => void;
}

// ── Hook ──

/**
 * Absolute-positioned waterfall layout.
 *
 * - Items are assigned to the shortest column (not round-robin),
 *   so the layout stays balanced regardless of image aspect ratios.
 * - Each gets a square placeholder (width × width).
 * - When an image loads (call handleImageLoad with its natural dims),
 *   the rendered height is computed from aspect ratio and subsequent
 *   items in the same column are shifted.
 * - Loaded state is preserved across recalculation via a ref, so
 *   infinite-scroll appends don't lose already-loaded images.
 */
export function useWaterfallLayout({
  itemKeys,
  colCount,
  gap = 12,
}: UseWaterfallLayoutOptions): UseWaterfallLayoutResult {
  // ── Container width ──
  const [containerWidth, setContainerWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  const containerRefCb = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (el) {
      setContainerWidth(el.clientWidth);
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  useEffect(() => {
    return () => { if (roRef.current) roRef.current.disconnect(); };
  }, []);

  // ── Persist loaded states across recalculation ──
  const loadedMapRef = useRef<Record<string, { loaded: boolean; renderedHeight: number }>>({});

  // ── Placements ──
  const [placements, setPlacements] = useState<WaterfallPlacement[]>([]);
  const keysDep = itemKeys.join(','); // stable string deps to avoid infinite loop

  useEffect(() => {
    if (!itemKeys.length || !containerWidth) {
      if (!itemKeys.length) setPlacements([]);
      return;
    }

    const columnWidth = (containerWidth - (colCount - 1) * gap) / colCount;
    const ph = columnWidth; // square

    const colHeights = new Array(colCount).fill(0);
    const newPlacements: WaterfallPlacement[] = [];

    for (const key of itemKeys) {
      // Assign to the shortest column for balanced layout
      let colIndex = 0;
      let minHeight = colHeights[0];
      for (let c = 1; c < colCount; c++) {
        if (colHeights[c] < minHeight) {
          minHeight = colHeights[c];
          colIndex = c;
        }
      }
      const existing = loadedMapRef.current[key];

      const loaded = existing?.loaded ?? false;
      const renderedHeight = existing?.renderedHeight ?? ph;

      // If loaded, use real height for column tracking
      const itemHeight = loaded ? renderedHeight : ph;

      newPlacements.push({
        key,
        col: colIndex,
        top: colHeights[colIndex],
        left: colIndex * (columnWidth + gap),
        width: columnWidth,
        loaded,
        renderedHeight,
        placeholderHeight: ph,
      });
      colHeights[colIndex] += itemHeight + gap;
    }

    setPlacements(newPlacements);
  }, [keysDep, colCount, containerWidth, gap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image load handler ──
  const handleImageLoad = useCallback((index: number, naturalWidth: number, naturalHeight: number) => {
    setPlacements((prev) => {
      const next = [...prev];
      const p = next[index];
      if (!p || p.loaded) return prev;

      const rh = p.width * (naturalHeight / naturalWidth);
      const diff = rh - p.placeholderHeight;

      // Persist loaded state
      loadedMapRef.current[p.key] = { loaded: true, renderedHeight: rh };

      next[index] = { ...p, loaded: true, renderedHeight: rh };
      for (let j = index + 1; j < next.length; j++) {
        if (next[j].col === p.col) {
          next[j] = { ...next[j], top: next[j].top + diff };
        }
      }
      return next;
    });
  }, []);

  // ── Container height ──
  const containerHeight = (() => {
    if (!placements.length) return 0;
    const colBottoms = new Array(colCount).fill(0);
    for (const p of placements) {
      const bottom = p.top + (p.loaded ? p.renderedHeight : p.placeholderHeight) + gap;
      if (bottom > colBottoms[p.col]) colBottoms[p.col] = bottom;
    }
    return Math.max(...colBottoms);
  })();

  return { containerRefCb, containerHeight, placements, handleImageLoad };
}
