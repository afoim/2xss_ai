'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { LoraApplyForm } from '@/components/draw/lora-apply-dialog';

const API_BASE = 'https://api-ai.acofork.com';
const PAGE_SIZE = 200;

interface LibraryItem {
  /** 后端分配的全局唯一 id（tag_/style_/external_ 前缀）。勾选以它为准，避免重名冲突 */
  id?: string;
  name: string;
  tags?: string;
  thumbnail?: string;
  url?: string;
  lora_path?: string;
  kind?: string;
  type?: string;
  category?: string;
}

// Export so parent can store selected items for restoration
export type { LibraryItem };

// 勾选去重的键：优先用后端唯一 id；缺 id（极旧的本地缓存项）才退回 name。
// 这是本文件的核心修复点——过去用 name 做键，两个不同角色/画风重名时会「点一个选两个」。
const keyOf = (i: LibraryItem): string => i.id ?? i.name;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode?: string;
  onConfirm: (items: { tags: string; names: string; styleTags?: string; styleName?: string; charItems: LibraryItem[]; styleItems: LibraryItem[] }) => void;
  /** Previously selected items to restore when dialog reopens */
  initialCharItems?: LibraryItem[];
  initialStyleItems?: LibraryItem[];
}

export function LibrarySelector({ open, onOpenChange, mode = 'WAI', onConfirm, initialCharItems = [], initialStyleItems = [] }: Props) {
  const [tab, setTab] = useState<'character' | 'style'>('character');
  // Categories
  const [charCategories, setCharCategories] = useState<{ name: string; count: number }[]>([]);
  const [styleCategories, setStyleCategories] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);

  // Navigation: 'categories' | 'items' | 'lora-apply'
  const [view, setView] = useState<'categories' | 'items' | 'lora-apply'>('categories');
  const [activeCat, setActiveCat] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);

  // Search
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'category' | 'character'>('category');
  // 搜索框引用：点「×」清空后把焦点还给输入框，方便接着打字
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchResults, setSearchResults] = useState<{ characters: LibraryItem[]; styles: LibraryItem[] }>({ characters: [], styles: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Selected items (store full item data, keyed by name)
  const [selectedCharMap, setSelectedCharMap] = useState<Map<string, LibraryItem>>(new Map());
  const [selectedStyleMap, setSelectedStyleMap] = useState<Map<string, LibraryItem>>(new Map());
  // 分类名称展开状态
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const toggleExpandCat = (name: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // Track whether initial selections have been applied for the current dialog open
  const initialAppliedRef = useRef(false);

  // Auth token — stable across renders via ref
  const headersRef = useRef<Record<string, string>>({ 'Content-Type': 'application/json' });

  useEffect(() => {
    const token = localStorage.getItem('forum-auth-token');
    headersRef.current = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  // Load categories on open
  useEffect(() => {
    if (!open || dataLoaded) return;
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/library/categories?mode=${mode}`, { headers: headersRef.current })
      .then((r) => r.json())
      .then((data) => {
        setCharCategories(data.characters || []);
        setStyleCategories(data.styles || []);
        setDataLoaded(true);
      })
      .catch(() => setError('加载分类失败'))
      .finally(() => setLoading(false));
  }, [open, mode, dataLoaded]);

  // Restore previously selected items when dialog opens and data is loaded
  useEffect(() => {
    if (!open) {
      initialAppliedRef.current = false;
      return;
    }
    if (!dataLoaded || initialAppliedRef.current) return;
    if (initialCharItems.length > 0) {
      setSelectedCharMap(new Map(initialCharItems.map((i) => [keyOf(i), i])));
    }
    if (initialStyleItems.length > 0) {
      setSelectedStyleMap(new Map(initialStyleItems.map((i) => [keyOf(i), i])));
    }
    initialAppliedRef.current = true;
  }, [open, dataLoaded, initialCharItems, initialStyleItems]);

  // Reset on close — but preserve selected items so reopen restores them
  useEffect(() => {
    if (!open) {
      setView('categories');
      setActiveCat('');
      setPage(0);
      setItems([]);
      setSearch('');
      setSearchResults({ characters: [], styles: [] });
      setDataLoaded(false);
      setSelectedCharMap(new Map());
      setSelectedStyleMap(new Map());
    }
  }, [open]);

  // Search with debounce — only runs in 'character' mode (API search)
  useEffect(() => {
    if (searchMode !== 'character') {
      setSearchResults({ characters: [], styles: [] });
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!q) { setSearchResults({ characters: [], styles: [] }); return; }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/library?mode=${mode}&search=${encodeURIComponent(q)}&limit=500`, { headers: headersRef.current });
        const data = await r.json();
        setSearchResults({ characters: data.characters || [], styles: data.styles || [] });
      } catch {} finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, mode, searchMode]);

  const loadPage = useCallback(async (cat: string, pg: number) => {
    setPageLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/library?mode=${mode}&category=${encodeURIComponent(cat)}&limit=${PAGE_SIZE}&offset=${pg * PAGE_SIZE}`, { headers: headersRef.current });
      const data = await r.json();
      const typeItems: LibraryItem[] = tab === 'character' ? data.characters || [] : data.styles || [];
      setItems(typeItems);
      const totalKey = tab === 'character' ? 'characters' : 'styles';
      setTotal(data.total?.[totalKey] || typeItems.length);
    } catch {} finally {
      setPageLoading(false);
    }
  }, [mode, tab]);

  const openCategory = (cat: string) => {
    setActiveCat(cat);
    setPage(0);
    setView('items');
    if (searchMode === 'category') setSearch('');
    loadPage(cat, 0);
  };

  const goBack = () => {
    setView('categories');
    setActiveCat('');
    setItems([]);
  };

  const toggleSelected = (item: LibraryItem, type: 'character' | 'style') => {
    const k = keyOf(item);
    if (type === 'character') {
      setSelectedCharMap((prev) => {
        const next = new Map(prev);
        if (next.has(k)) next.delete(k); else next.set(k, item);
        return next;
      });
    } else {
      setSelectedStyleMap((prev) => {
        const next = new Map(prev);
        if (next.has(k)) next.delete(k); else next.set(k, item);
        return next;
      });
    }
  };

  const allItems = tab === 'character' ? charCategories : styleCategories;
  const isSearching = search.trim().length > 0;
  const isCategorySearch = searchMode === 'category' && isSearching;
  const isCharacterSearch = searchMode === 'character' && isSearching;
  // In 'category' search mode, filter categories client-side instead of searching items
  const filteredCategories = isCategorySearch
    ? allItems.filter((cat) => cat.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allItems;

  const confirm = () => {
    const charItems = [...selectedCharMap.values()];
    const styleItems = [...selectedStyleMap.values()];
    const charTags = charItems.map((i) => i.tags || i.name).join(' BREAK\n');
    const charNames = charItems.map((i) => i.name).join(', ');
    const styleTags = styleItems.map((i) => i.tags || i.name).join(', ');
    const styleName = styleItems.map((i) => i.name).join(', ');
    onConfirm({ tags: charTags, names: charNames, styleTags, styleName, charItems, styleItems });
    onOpenChange(false);
  };

  const isNormalView = view !== 'lora-apply';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-full max-w-full w-dvw h-dvh max-h-dvh m-0 rounded-none p-4 flex flex-col" showCloseButton={false}>
        {view === 'lora-apply' ? (
          // ── Lora Apply view (embedded, no nested dialog) ──
          <div className="flex flex-col h-full max-w-lg mx-auto w-full">
            <div className="flex items-center gap-2 pb-3 border-b shrink-0">
              <button onClick={() => setView('categories')} className="p-1 transition-colors duration-75 hover:bg-foreground hover:text-background">
                <Icon icon="mdi:arrow-left" className="size-5" />
              </button>
              <span className="text-sm font-medium">提交您的 Lora</span>
              <div className="flex-1" />
              <button onClick={() => setView('categories')} className="p-1 transition-colors duration-75 hover:bg-foreground hover:text-background">
                <Icon icon="mdi:close" className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <LoraApplyForm onClose={() => setView('categories')} defaultType={tab} showHeader={false} />
            </div>
          </div>
        ) : (
          <>
            <span className="sr-only"><DialogTitle>选择角色 & 画风</DialogTitle></span>

            {/* Header */}
            <div className="flex items-center gap-2 pb-3 border-b shrink-0">
              {view === 'items' && (
                <button onClick={goBack} className="p-1 transition-colors duration-75 hover:bg-foreground hover:text-background">
                  <Icon icon="mdi:arrow-left" className="size-5" />
                </button>
              )}
              <div className="flex gap-1">
                <Button variant={tab === 'character' ? 'default' : 'ghost'} size="sm" onClick={() => { setTab('character'); if (view === 'items') goBack(); }}>
                  角色 ({charCategories.reduce((s, c) => s + c.count, 0)})
                </Button>
                <Button variant={tab === 'style' ? 'default' : 'ghost'} size="sm" onClick={() => { setTab('style'); if (view === 'items') goBack(); }}>
                  画风 ({styleCategories.reduce((s, c) => s + c.count, 0)})
                </Button>
              </div>
              <div className="flex-1" />
              <button onClick={() => onOpenChange(false)} className="p-1 transition-colors duration-75 hover:bg-foreground hover:text-background">
                <Icon icon="mdi:close" className="size-5" />
              </button>
            </div>

            {/* Search */}
            <div className="py-2 shrink-0 flex gap-2">
              {/* 分段切换：divide-x 保证相邻白块（选中+悬停）之间始终有分隔线 */}
              <div className="flex shrink-0 divide-x divide-border border border-border font-mono">
                <button onClick={() => { setSearchMode('category'); if (view === 'items') goBack(); }}
                  className={`h-9 px-3 text-xs transition-colors duration-75 ${searchMode === 'category' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-foreground hover:text-background'}`}
                >分类</button>
                <button onClick={() => setSearchMode('character')}
                  className={`h-9 px-3 text-xs transition-colors duration-75 ${searchMode === 'character' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-foreground hover:text-background'}`}
                >角色</button>
              </div>
              <div className="relative flex-1">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchMode === 'category' ? '搜索分类…' : '搜索角色或画风…'}
                  className="w-full h-9 pl-3 pr-9 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {/* 一键清除搜索：只在有内容时显示，点「×」清空并让焦点回到输入框 */}
                {search && (
                  <button
                    onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1 transition-colors duration-75 text-muted-foreground hover:bg-foreground hover:text-background"
                    title="清除搜索"
                    aria-label="清除搜索"
                  >
                    <Icon icon="mdi:close" className="size-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 p-1">
                  {Array.from({ length: 24 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : error ? (
                <p className="text-sm text-destructive text-center py-8">{error}</p>
              ) : (view === 'items' || isCharacterSearch) && !isCategorySearch ? (
                <ItemGrid
                  items={isCharacterSearch ? (tab === 'character' ? searchResults.characters : searchResults.styles) : items}
                  selectedSet={tab === 'character' ? new Set(selectedCharMap.keys()) : new Set(selectedStyleMap.keys())}
                  onToggle={(item) => toggleSelected(item, tab)}
                  loading={isCharacterSearch ? searchLoading : pageLoading}
                />
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1.5 p-1">
                  {filteredCategories.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8 col-span-full">无匹配分类</p>
                  ) : (
                    filteredCategories.map((cat) => {
                      const catExpanded = expandedCats.has(cat.name);
                      return (
                      <button key={cat.name} onClick={() => openCategory(cat.name)}
                        className="group flex items-center gap-1.5 px-2 border border-border transition-colors duration-75 hover:border-foreground hover:bg-foreground hover:text-background text-left overflow-hidden"
                        style={{ minHeight: catExpanded ? 'auto' : '2.5rem' }}
                      >
                        <span className={`text-xs flex-1 min-w-0 ${catExpanded ? 'break-all' : 'truncate'}`}>{cat.name}</span>
                        <span className="text-[10px] text-muted-foreground group-hover:text-background/60 shrink-0">{cat.count}</span>
                        {/* 展开按钮：始终可见，不触发 openCategory */}
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleExpandCat(cat.name); }}
                          className="shrink-0 inline-flex items-center justify-center size-3 text-muted-foreground/40 hover:text-foreground cursor-pointer"
                          title={catExpanded ? '收起' : '展开全名'}
                          role="button" tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleExpandCat(cat.name); } }}
                        >
                          <Icon icon={catExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="size-2" />
                        </span>
                      </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {view === 'items' && !isSearching && (
              <div className="flex items-center justify-between pt-3 border-t shrink-0">
                <span className="text-xs text-muted-foreground">共 {total} 项 · 第 {page + 1}/{Math.ceil(total / PAGE_SIZE)} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 0 || pageLoading} onClick={() => { const p = page - 1; setPage(p); loadPage(activeCat, p); }}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total || pageLoading} onClick={() => { const p = page + 1; setPage(p); loadPage(activeCat, p); }}>下一页</Button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t shrink-0">
              <span className="text-xs text-muted-foreground mr-auto">
                已选: 角色 {selectedCharMap.size} · 画风 {selectedStyleMap.size}
              </span>
              <button onClick={() => setView('lora-apply')}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icon icon="mdi:plus-circle-outline" className="size-3.5" />
                没找到你想要的 Lora？告诉我们
              </button>
              <Button size="sm" variant="outline" onClick={() => { setSelectedCharMap(new Map()); setSelectedStyleMap(new Map()); }}>清除</Button>
              <Button size="sm" onClick={confirm}>确认 ({selectedCharMap.size + selectedStyleMap.size})</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function fixUrl(path: string | undefined): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** 延迟 src 的图片：先渲染 Skeleton 占位，等卡片布局完成后才挂载 src。避免 200 张图同步下载阻塞首帧渲染。 */
function LazyImg({ src, alt, selected }: { src: string; alt: string; selected: boolean }) {
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 等浏览器完成当前帧绘制后再设 src——骨架屏先出现，图片渐进加载
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [src]);

  return (
    <div className="w-full aspect-[3/4] relative overflow-hidden bg-muted">
      {/* 骨架屏：src 未就绪 或 图片未加载完 */}
      {(!ready || !loaded) && <Skeleton className="absolute inset-0" />}
      {ready && (
        <img
          src={src}
          alt={alt}
          className={`relative w-full h-full object-cover transition-[filter] duration-75 ${
            selected ? 'brightness-[.55]' : 'group-hover:brightness-[.55]'
          }`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.15s' }}
        />
      )}
    </div>
  );
}

function ItemGrid({ items, selectedSet, onToggle, loading }: {
  items: LibraryItem[];
  selectedSet: Set<string>;
  onToggle: (item: LibraryItem) => void;
  loading: boolean;
}) {
  const [copiedId, setCopiedId] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = (k: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-1.5 p-1">
        {Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">无结果</p>;
  }
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-1.5 p-1">
      {items.map((item) => {
        const isSelected = selectedSet.has(keyOf(item));
        const imgSrc = fixUrl(item.thumbnail);
        const k = keyOf(item);
        const expanded = expandedKeys.has(k);
        return (
          <button key={k} onClick={() => onToggle(item)}
            className={`relative border text-center transition-colors duration-75 group ${
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-foreground hover:bg-foreground hover:text-background'
            }`}
          >
            {/* Selected badge */}
            {isSelected && (
              <span className="absolute top-0.5 left-0.5 z-10 bg-background px-1 font-mono text-[9px] leading-4 text-foreground">
                ✓
              </span>
            )}
            {/* Image — LazyImg：先骨架屏占位，rAF 后再设 src，不阻塞卡片文字首帧渲染 */}
            {imgSrc ? (
              <LazyImg src={imgSrc} alt={item.name} selected={isSelected} />
            ) : (
              <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center">
                <Icon icon="mdi:image-off-outline" className="size-3 text-muted-foreground/20" />
              </div>
            )}

            {/* Name */}
            <div className="relative px-0.5 pb-0.5">
              <p className={`text-[8px] leading-tight break-all text-center w-full ${expanded ? '' : 'truncate'}`}>{item.name}</p>
              {item.category && (
                <p className={`text-[7px] text-center w-full leading-tight ${expanded ? 'break-all' : 'truncate'} ${isSelected ? 'text-background/60' : 'text-muted-foreground/60 group-hover:text-background/60'}`}>{item.category}</p>
              )}
              {/* 展开/收起：始终可见 */}
              <span
                onClick={(e) => toggleExpand(k, e)}
                className="inline-flex items-center justify-center w-full h-3 text-muted-foreground hover:text-foreground cursor-pointer mt-0.5"
                title={expanded ? '收起全名' : '展开全名'}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(k, e as unknown as React.MouseEvent); }}
              >
                <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="size-2" />
              </span>
            </div>

            {/* Action buttons - visible on hover only */}
            <div className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-sm px-0.5">
              {item.url && (
                <span onClick={(e) => { e.stopPropagation(); window.open(item.url, '_blank'); }}
                  className="shrink-0 text-muted-foreground/50 hover:text-sky-500 cursor-pointer p-0.5"
                  title="查看来源" role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); window.open(item.url, '_blank'); } }}
                >
                  <Icon icon="mdi:open-in-new" className="size-2.5" />
                </span>
              )}
              {item.tags && (
                <span onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(item.tags || '');
                  setCopiedId(keyOf(item));
                  setTimeout(() => setCopiedId(''), 1500);
                }}
                  className="shrink-0 text-muted-foreground/50 hover:text-primary cursor-pointer p-0.5"
                  title={copiedId === keyOf(item) ? '已复制' : '复制 tag'} role="button" tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      navigator.clipboard.writeText(item.tags || '');
                      setCopiedId(keyOf(item));
                      setTimeout(() => setCopiedId(''), 1500);
                    }
                  }}
                >
                  <Icon icon={copiedId === keyOf(item) ? 'mdi:check-circle' : 'mdi:content-copy'} className="size-2.5" style={copiedId === keyOf(item) ? { color: '#22c55e' } : {}} />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
