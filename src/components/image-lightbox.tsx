'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';

type Pt = { x: number; y: number };
const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// 图片以 flex 居中于全屏遮罩，transform-origin 为其中心 == 视口中心
const center = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

export function ImageLightbox({
  onrecommend,
  onFork,
  forking,
}: {
  onrecommend?: (path: string) => void;
  /** 传入即显示「复刻」按钮：把这张图的生成参数填回生图页。返回 true 表示回填成功，此时自动关闭灯箱 */
  onFork?: (path: string) => Promise<boolean>;
  forking?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState('');
  const [path, setPath] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // 仅离散操作（按钮/键盘）加过渡；连续手势（拖动/捏合/滚轮）不加，保证跟手平滑
  const [animate, setAnimate] = useState(false);

  // 当前活跃指针（支持多点触控）：pointerId -> 屏幕坐标
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // 本次手势基线（按下/抬起改变指针数时重建）
  const gesture = useRef<
    | { mode: 'pan'; startPos: { x: number; y: number }; startOffset: { x: number; y: number } }
    | { mode: 'pinch'; startDist: number; startMid: { x: number; y: number }; startScale: number; startOffset: { x: number; y: number } }
    | null
  >(null);
  // 实时 transform，避免闭包读到过期的 state
  const view = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  // 用于区分「点击关闭」与「手势结束」：发生过移动则吞掉随后的 click
  const movedRef = useRef(false);

  // 保持 view ref 与渲染 state 同步（按钮/键盘/滚轮改动后回写）
  useEffect(() => { view.current = { scale, offset }; }, [scale, offset]);

  const close = useCallback(() => {
    setOpen(false);
    setSrc('');
    setPath('');
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setAnimate(false);
    pointers.current.clear();
    gesture.current = null;
  }, []);

  // 以屏幕焦点 (fx,fy) 为不动点，从 (s,o) 缩放到 ns
  const applyFocalZoom = useCallback((s: number, o: Pt, ns: number, fx: number, fy: number) => {
    const C0 = center();
    const px = (fx - C0.x - o.x) / s;
    const py = (fy - C0.y - o.y) / s;
    const no = { x: fx - C0.x - ns * px, y: fy - C0.y - ns * py };
    view.current = { scale: ns, offset: no };
    setScale(ns);
    setOffset(no);
  }, []);

  // 依据当前活跃指针数重建手势基线
  const resetGesture = useCallback(() => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      gesture.current = {
        mode: 'pinch',
        startDist: dist(pts[0], pts[1]) || 1,
        startMid: mid(pts[0], pts[1]),
        startScale: view.current.scale,
        startOffset: { ...view.current.offset },
      };
    } else if (pts.length === 1) {
      gesture.current = { mode: 'pan', startPos: { ...pts[0] }, startOffset: { ...view.current.offset } };
    } else {
      gesture.current = null;
    }
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'IMG') return;
      if (!target.closest('.prose') && !target.closest('[data-lightbox]')) return;

      // Don't open lightbox if the image has data-no-lightbox attribute
      if (target.closest('[data-no-lightbox]')) return;

      const realSrc = (target as HTMLImageElement).src || (target as HTMLImageElement).getAttribute('src');
      if (!realSrc) return;
      const realPath = (target as HTMLElement).getAttribute('data-path') || '';
      setSrc(realSrc);
      setPath(realPath);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setOpen(true);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === '+' || e.key === '=') { setAnimate(true); setScale((s) => clampScale(s + 0.25)); }
      if (e.key === '-') { setAnimate(true); setScale((s) => clampScale(s - 0.25)); }
      if (e.key === '0') { setAnimate(true); setScale(1); setOffset({ x: 0, y: 0 }); }
    };
    // 滚轮 / 触控板双指缩放：以光标为焦点缩放，无过渡
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setAnimate(false);
      const s = view.current.scale;
      const ns = clampScale(s - e.deltaY * 0.01);
      applyFocalZoom(s, view.current.offset, ns, e.clientX, e.clientY);
    };
    // 阻止 iOS Safari 的整页捏合缩放（touch-action 之外的兜底）
    const preventGesture = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
    };
  }, [open, close]);

  // 缩放回到原始大小（或更小）且无手势进行时，平移位移归零，回到视口中心
  useEffect(() => {
    if (scale <= 1 && pointers.current.size === 0) setOffset({ x: 0, y: 0 });
  }, [scale]);

  // 指针手势（单指平移 + 双指捏合缩放），在 window 上跟踪，支持多点触控
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (!g) return;
      if (g.mode === 'pan') {
        if (view.current.scale <= 1) return; // 未放大不平移，留给点击关闭
        const dx = e.clientX - g.startPos.x;
        const dy = e.clientY - g.startPos.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
        const o = { x: g.startOffset.x + dx, y: g.startOffset.y + dy };
        view.current = { ...view.current, offset: o };
        setOffset(o);
      } else {
        const pts = [...pointers.current.values()];
        if (pts.length < 2) return;
        movedRef.current = true;
        const d = dist(pts[0], pts[1]);
        const m = mid(pts[0], pts[1]);
        const ns = clampScale(g.startScale * (d / g.startDist));
        // 保持起始捏合中点下的图像点不动，同时跟随双指中点平移
        const C0 = center();
        const px = (g.startMid.x - C0.x - g.startOffset.x) / g.startScale;
        const py = (g.startMid.y - C0.y - g.startOffset.y) / g.startScale;
        const o = { x: m.x - C0.x - ns * px, y: m.y - C0.y - ns * py };
        view.current = { scale: ns, offset: o };
        setScale(ns);
        setOffset(o);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) {
        setDragging(false);
        gesture.current = null;
        // 捏合结束若已缩回原始大小或更小，位移归零回到中心
        if (view.current.scale <= 1 && (view.current.offset.x !== 0 || view.current.offset.y !== 0)) {
          setAnimate(true);
          view.current = { ...view.current, offset: { x: 0, y: 0 } };
          setOffset({ x: 0, y: 0 });
        }
      } else {
        resetGesture(); // 例如双指抬起一指，继续单指平移
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDownload = useCallback(() => {
    if (!path) return;
    const baseUrl = typeof window !== 'undefined'
      ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com'
      : 'https://api-ai.acofork.com';
    const token = typeof window !== 'undefined' ? localStorage.getItem('forum-auth-token') : null;
    let downloadUrl = `${baseUrl}/api/output/file?path=${encodeURIComponent(path)}&raw=1`;
    if (token) downloadUrl += `&token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [path]);

  const filename = path.split('/').pop() || '';

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 select-none touch-none overscroll-none"
      style={{ touchAction: 'none' }}
      onClick={() => {
        // 手势（平移/捏合）结束时的收尾 click 不触发关闭
        if (movedRef.current) { movedRef.current = false; return; }
        close();
      }}
      onPointerDown={(e) => {
        // 忽略工具栏/关闭按钮上的指针（它们各自 stopPropagation，这里做兜底）
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        movedRef.current = false;
        setAnimate(false);
        resetGesture();
        if (pointers.current.size === 1) setDragging(view.current.scale > 1);
      }}
    >
      <button
        onClick={close}
        className="fixed top-4 right-4 z-[60] text-white/70 hover:text-white transition-colors"
        aria-label="关闭"
      >
        <Icon icon="mdi:close" className="size-6" />
      </button>

      {/* Image */}
      <img
        src={src}
        alt=""
        draggable={false}
        className={`max-w-[90vw] max-h-[90vh] object-contain touch-none ${animate ? 'transition-transform duration-150' : ''} ${scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-out'}`}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, touchAction: 'none', willChange: 'transform' }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Bottom toolbar */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 text-white/70 text-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Zoom controls */}
        <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
          <button onClick={(e) => { e.stopPropagation(); setAnimate(true); setScale((s) => clampScale(s - 0.25)); }} className="hover:text-white"><Icon icon="mdi:minus" className="size-5" /></button>
          <span className="min-w-[4ch] text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={(e) => { e.stopPropagation(); setAnimate(true); setScale((s) => clampScale(s + 0.25)); }} className="hover:text-white"><Icon icon="mdi:plus" className="size-5" /></button>
          <span className="w-px h-4 bg-white/20" />
          <button onClick={(e) => { e.stopPropagation(); setAnimate(true); setScale(1); setOffset({ x: 0, y: 0 }); }} className="hover:text-white">重置</button>
        </div>

        {path && (
          <>
            <span className="w-px h-4 bg-white/20" />
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
              {filename && (
                <span className="text-white/50 text-xs hidden sm:inline max-w-[180px] truncate" title={filename}>{filename}</span>
              )}
              {onFork && (
                <>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // 成功回填才关闭；失败时留在原位，让用户看得到 toast 里的原因
                      if (await onFork(path)) close();
                    }}
                    disabled={forking}
                    className="hover:text-sky-400 flex items-center gap-1 transition-colors disabled:opacity-50"
                    title="用这张图的参数生成"
                  >
                    {forking ? <Spinner className="size-4" /> : <Icon icon="mdi:source-fork" className="size-4" />}
                    <span className="hidden sm:inline">复刻</span>
                  </button>
                  <span className="w-px h-4 bg-white/20" />
                </>
              )}
              {onrecommend && (
                <button
                  onClick={(e) => { e.stopPropagation(); onrecommend(path); }}
                  className="hover:text-yellow-400 flex items-center gap-1 transition-colors"
                  title="自荐到精选"
                >
                  <Icon icon="mdi:star-plus-outline" className="size-4" />
                  <span className="hidden sm:inline">自荐</span>
                </button>
              )}
              <span className="w-px h-4 bg-white/20" />
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="hover:text-white flex items-center gap-1"
                title="下载原图（不经过 Webp 转换）"
              >
                <Icon icon="mdi:download" className="size-4" />
                <span className="hidden sm:inline">下载原图</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
