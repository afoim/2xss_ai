'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { CreditsPanel } from '@/components/draw/credits-panel';
import { LlmConfigPanel } from '@/components/draw/llm-config-panel';
import { LimitsPanel } from '@/components/draw/limits-panel';
import { DebugPanel } from '@/components/draw/debug-panel';
import { StatsPanel } from '@/components/draw/stats-panel';
import { StoragePanel } from '@/components/draw/storage-panel';
import { LoraApprovalPanel } from '@/components/draw/lora-approval-panel';
import { LoraRepairPanel } from '@/components/draw/lora-repair-panel';
import {
  getAnnouncement, updateAnnouncement,
  getRecentImages, getImagesByUser, adminDeleteImage, adminDeleteImages, addFeatured,
  getFeatured, removeFeatured,
  getBannedUsers, banUser, unbanUser,
  getWallets, setWalletBalance, givePoints, getPlans, savePlan, deletePlan, savePointsConfig, fetchStats,
  fetchRecommendations, resolveRecommendation, resolveRecommendations,
  getImageUrl,
} from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { useWaterfallLayout } from '@/components/draw/use-waterfall-layout';
import { Spinner } from '@/components/ui/spinner';

export default function AdminPage() {
  const [tab, setTab] = useState('announcement');

  // Restore tab from hash on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const tabs = ['announcement', 'images', 'recommendations', 'featured', 'banned', 'credits', 'limits', 'llm', 'debug', 'stats', 'storage', 'lora-approval', 'lora-repair'];
    if (tabs.includes(hash)) setTab(hash);
  }, []);

  // Sync tab to hash
  const handleTabChange = (key: string) => {
    setTab(key);
    window.history.replaceState(null, '', `#${key}`);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-2 sm:px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon icon="mdi:shield-crown" className="size-6 text-primary" />
        <h1 className="text-xl font-bold">生图管理后台</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-1 overflow-x-auto">
        {[
          { key: 'announcement', label: '公告', icon: 'mdi:bullhorn-outline' },
          { key: 'images', label: '图片', icon: 'mdi:image-multiple-outline' },
          { key: 'recommendations', label: '自荐', icon: 'mdi:star-plus-outline' },
          { key: 'featured', label: '精选', icon: 'mdi:star-outline' },
          { key: 'banned', label: '封禁', icon: 'mdi:account-cancel-outline' },
          { key: 'credits', label: '额度', icon: 'mdi:wallet-outline' },
          { key: 'limits', label: '配置', icon: 'mdi:tune-vertical' },
          { key: 'llm', label: 'LLM', icon: 'mdi:brain' },
          { key: 'debug', label: '调试', icon: 'mdi:bug-outline' },
          { key: 'stats', label: '统计', icon: 'mdi:chart-timeline-variant' },
          { key: 'storage', label: '存储', icon: 'mdi:harddisk' },
          { key: 'lora-approval', label: 'Lora审批', icon: 'mdi:shape-plus-outline' },
          { key: 'lora-repair', label: 'Lora修复', icon: 'mdi:wrench-outline' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-lg transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-background hover:bg-foreground'
            }`}
          >
            <Icon icon={t.icon} className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'announcement' && <AnnouncementPanel />}
      {tab === 'images' && <ImagesPanel />}
      {tab === 'recommendations' && <RecommendationsPanel />}
      {tab === 'featured' && <FeaturedPanel />}
      {tab === 'banned' && <BannedPanel />}
      {tab === 'credits' && <CreditsPanel />}
      {tab === 'limits' && <LimitsPanel />}
      {tab === 'llm' && <LlmConfigPanel />}
      {tab === 'debug' && <DebugPanel />}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'storage' && <StoragePanel />}
      {tab === 'lora-approval' && <LoraApprovalPanel />}
      {tab === 'lora-repair' && <LoraRepairPanel />}
    </div>
  );
}

// ─── Announcement Panel ───

function AnnouncementPanel() {
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAnnouncement()
      .then((data) => {
        const a = data.announcement;
        setEnabled(a.enabled);
        setTitle(a.title);
        setContent(a.content);
      })
      .catch(() => toast.error('加载公告失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAnnouncement({ enabled, title, content });
      toast.success('公告已更新');
    } catch {
      toast.error('更新公告失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">启用公告</p>
            <p className="text-xs text-muted-foreground">开启后在所有生图页面顶部显示公告条</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{enabled ? '已开启' : '已关闭'}</span>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`inline-block size-3.5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">标题</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="公告标题" className="w-full h-9 px-3 rounded-lg border bg-background text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">内容</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="公告内容..." rows={4} className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Spinner className="size-4" /> : <Icon icon="mdi:content-save-outline" className="size-4" />}
          保存
        </Button>
      </div>
      <div className="rounded-lg border p-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">预览</p>
        {enabled && (title || content) ? (
          <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 space-y-1">
            {title && <p className="text-sm font-semibold">{title}</p>}
            {content && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{content}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">公告未启用或无内容</p>
        )}
      </div>
    </div>
  );
}

// ─── Images Panel ───

const LIMIT = 50;

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

interface AdminImage {
  path: string;
  user_id?: string;
  mtime?: number;
  deleted?: boolean;
  prompt?: string;
  negative_prompt?: string;
  image1?: string;
  image2?: string;
}

function getImgUrl(path: string): string {
  const baseUrl = typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com' : 'https://api-ai.acofork.com';
  const token = typeof window !== 'undefined' ? localStorage.getItem('forum-auth-token') : null;
  let url = `${baseUrl}/api/output/file?path=${encodeURIComponent(path)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  return url;
}

function getProxyUrl(path: string): string {
  const baseUrl = typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com' : 'https://api-ai.acofork.com';
  const token = typeof window !== 'undefined' ? localStorage.getItem('forum-auth-token') : null;
  let url = `${baseUrl}/api/image?filename=${encodeURIComponent(path)}&type=output`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  return url;
}

function ImagesPanel() {
  const [images, setImages] = useState<AdminImage[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchId, setSearchId] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [detailImg, setDetailImg] = useState<AdminImage | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Column count
  const [colCount, setColCount] = useState(4);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w >= 1400) setColCount(6);
      else if (w >= 1024) setColCount(5);
      else if (w >= 768) setColCount(4);
      else if (w >= 480) setColCount(3);
      else setColCount(2);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load initial images
  const loadImages = useCallback(async (reset = true) => {
    setLoading(true);
    setSearchId('');
    try {
      const data = await getRecentImages(LIMIT, reset ? 0 : offset);
      const items = (data.items || []) as unknown as AdminImage[];
      if (reset) {
        setImages(items);
        setOffset(items.length);
      } else {
        setImages((prev) => {
          const merged = [...prev, ...items];
          return merged.filter((img, i, arr) => arr.findIndex((x) => x.path === img.path) === i);
        });
        setOffset((prev) => prev + items.length);
      }
      setTotal(data.total || items.length);
      setHasMore(items.length >= LIMIT);
    } catch {
      toast.error('加载图片失败');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    loadImages(true);
  }, []);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore) {
        setLoadingMore(true);
        getRecentImages(LIMIT, offset)
          .then((data) => {
            const items = (data.items || []) as unknown as AdminImage[];
            setImages((prev) => {
              const merged = [...prev, ...items];
              return merged.filter((img, i, arr) => arr.findIndex((x) => x.path === img.path) === i);
            });
            setOffset((prev) => prev + items.length);
            setHasMore(items.length >= LIMIT);
          })
          .catch(() => {})
          .finally(() => setLoadingMore(false));
      }
    }, { rootMargin: '400px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, offset]);

  // Search by user
  const handleSearch = async () => {
    const id = searchId.trim();
    if (!id) return;
    setLoading(true);
    try {
      const data = await getImagesByUser(id);
      setImages((data.items || []) as unknown as AdminImage[]);
      setTotal(data.total || 0);
      setHasMore(false);
    } catch {
      toast.error('查询失败');
    } finally {
      setLoading(false);
    }
  };

  // Select mode
  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Delete single
  const handleDeleteOne = async (path: string) => {
    try {
      await adminDeleteImage(path);
      setImages((prev) => prev.filter((img) => img.path !== path));
      setSelectedPaths((prev) => { const next = new Set(prev); next.delete(path); return next; });
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    }
  };

  // Delete selected
  const handleDeleteSelected = async () => {
    const paths = [...selectedPaths];
    if (paths.length === 0) return;
    try {
      const result = await adminDeleteImages(paths);
      toast.success(`已删除 ${result.deleted} 张，失败 ${result.failed} 张`);
      setImages((prev) => prev.filter((img) => !selectedPaths.has(img.path)));
      setSelectedPaths(new Set());
      setSelectMode(false);
    } catch {
      toast.error('批量删除失败');
    }
  };

  // Add selected to featured
  const handleAddFeatured = async () => {
    for (const p of selectedPaths) {
      try { await addFeatured(p); } catch {}
    }
    toast.success(`已加入精选 ${selectedPaths.size} 张`);
    setSelectedPaths(new Set());
    setSelectMode(false);
  };

  // ── Waterfall layout ──
  const itemKeys = images.map((img) => img.path).filter(Boolean);
  const { containerRefCb, containerHeight, placements, handleImageLoad } = useWaterfallLayout({
    itemKeys,
    colCount,
    gap: 8,
  });

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">图片管理</p>
            <p className="text-xs text-muted-foreground">共 {total} 张图片</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadImages(true)} disabled={loading}>
            {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />}
            刷新
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" value={searchId} onChange={(e) => setSearchId(e.target.value)} placeholder="按用户 ID 查询" className="w-48 h-8 px-2 rounded-lg border bg-background text-xs" />
          <Button variant="secondary" onClick={handleSearch}>查询</Button>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 bg-background py-2 flex items-center gap-2 border-b">
        <Button size="sm" variant={selectMode ? 'default' : 'outline'} onClick={() => { setSelectMode(!selectMode); setSelectedPaths(new Set()); }}>
          {selectMode ? '取消选择' : '选择'}
        </Button>
        {selectedPaths.size > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={handleAddFeatured}>
              加入精选 ({selectedPaths.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDeleteSelected}>
              删除选中 ({selectedPaths.size})
            </Button>
          </>
        )}
      </div>

      {/* Image grid */}
      {loading && images.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : images.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">暂无图片</p>
      ) : (
        <div
          ref={containerRefCb}
          className="relative w-full"
          style={{ height: containerHeight }}
        >
          {placements.map((pl, i) => {
            const img = images.find((x) => x.path === pl.key);
            if (!img) return null;
            const selected = selectedPaths.has(img.path);
            return (
              <div
                key={pl.key}
                className={`absolute overflow-hidden rounded-md border bg-muted transition-all ${selected ? 'ring-2 ring-primary' : ''} ${img.deleted ? 'opacity-50' : ''}`}
                style={{
                  top: pl.top,
                  left: pl.left,
                  width: pl.width,
                  height: pl.loaded ? pl.renderedHeight : pl.placeholderHeight,
                }}
              >
                {!pl.loaded && (
                  <div className="size-full animate-pulse bg-muted-foreground/10" />
                )}
                <button className={`w-full block text-left ${pl.loaded ? '' : 'hidden'}`} onClick={() => (selectMode ? toggleSelect(img.path) : setDetailImg(img))}>
                  <img
                    src={getProxyUrl(img.path)}
                    alt={img.path}
                    className="w-full block"
                    onLoad={(e) => handleImageLoad(i, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                  />
                </button>

                {/* Deleted overlay */}
                {img.deleted && (
                  <div className="absolute inset-0 pointer-events-none">
                    <svg className="w-full h-full" viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100" stroke="red" strokeWidth="2" /></svg>
                  </div>
                )}

                {/* Select checkbox */}
                {selectMode && (
                  <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <input type="checkbox" checked={selected} onChange={() => toggleSelect(img.path)} className="size-4 accent-primary" />
                  </div>
                )}

                {/* Delete button */}
                {!selectMode && (
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteOne(img.path); }} className="absolute top-1 right-1 size-5 rounded-full bg-destructive/80 text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="删除">
                    <Icon icon="mdi:delete" className="size-3" />
                  </button>
                )}

                {/* Bottom bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                  <div className="flex items-center justify-between text-[10px] text-white/90">
                    <span>UID {img.user_id || '?'} | {img.mtime ? formatTime(img.mtime) : '-'}{img.deleted ? <span className="text-red-400"> - 已删</span> : ''}</span>
                    <button onClick={(e) => { e.stopPropagation(); setDetailImg(img); }} className="hover:underline">详情</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more sentinel */}
      {hasMore && <div ref={sentinelRef} className="h-4" />}
      {loadingMore && <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>}
      {!hasMore && images.length > 0 && <p className="text-xs text-center text-muted-foreground py-4">已加载全部</p>}

      {/* Detail Dialog */}
      {detailImg && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setDetailImg(null)}>
          <div className="bg-card rounded-lg border shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="text-sm font-medium truncate">{detailImg.path}</h3>
              <button onClick={() => setDetailImg(null)}><Icon icon="mdi:close" className="size-5" /></button>
            </div>
            <div className="p-3 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">原图 1</p>
                  {detailImg.image1 ? (
                    <img src={`${getBaseUrl()}/api/uploads/${detailImg.image1}`} alt="" className="w-full rounded border" />
                  ) : <div className="aspect-square bg-muted rounded" />}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">原图 2</p>
                  {detailImg.image2 ? (
                    <img src={`${getBaseUrl()}/api/uploads/${detailImg.image2}`} alt="" className="w-full rounded border" />
                  ) : <div className="aspect-square bg-muted rounded" />}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">结果图</p>
                  <img src={getProxyUrl(detailImg.path)} alt="" className="w-full rounded border" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span>生图者：{detailImg.user_id || '?'}</span>
                <span>时间：{detailImg.mtime ? formatTime(detailImg.mtime) : '-'}</span>
              </div>
              {detailImg.prompt && (
                <div>
                  <span className="font-medium">正向 Prompt:</span>
                  <div className="bg-muted rounded text-[11px] break-all p-2 mt-1">{detailImg.prompt}</div>
                </div>
              )}
              {detailImg.negative_prompt && (
                <div>
                  <span className="font-medium">反向 Prompt:</span>
                  <div className="bg-muted rounded text-[11px] break-all p-2 mt-1">{detailImg.negative_prompt}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://api-ai.acofork.com';
  return localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
}

// ─── Banned Panel ───

function fmtBanDate(ts: number): string {
  const d = new Date((ts || 0) * 1000);
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function BannedPanel() {
  const [banned, setBanned] = useState<Record<string, unknown>[]>([]);
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getBannedUsers();
      setBanned(Array.isArray(data.banned) ? data.banned.filter((b: unknown) => typeof b === 'object') : []);
    } catch {
      toast.error('加载封禁列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleBan = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await banUser(Number(userId), days || 7, reason || '违规行为');
      setBanned(Array.isArray(data.banned) ? data.banned.filter((b: unknown) => typeof b === 'object') : []);
      setUserId('');
      toast.success('已封禁');
    } catch {
      toast.error('封禁失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUnban = async (id: number) => {
    setLoading(true);
    try {
      const data = await unbanUser(id);
      setBanned(Array.isArray(data.banned) ? data.banned.filter((b: unknown) => typeof b === 'object') : []);
      toast.success('已解封');
    } catch {
      toast.error('解封失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-medium">封禁管理</h3>

      {/* Ban form */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 ID" className="w-20 h-9 px-2 rounded-lg border bg-background text-sm" />
        <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 7)} min={1} className="w-16 h-9 px-2 rounded-lg border bg-background text-sm" />
        <span className="text-xs text-muted-foreground">天</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因" className="w-36 h-9 px-2 rounded-lg border bg-background text-sm" />
        <Button size="lg" variant="destructive" onClick={handleBan} disabled={loading || !userId}>
          <Icon icon="mdi:account-cancel" className="size-4 mr-1" />封禁
        </Button>
      </div>

      {/* Refresh */}
      <Button size="sm" variant="outline" onClick={load} disabled={loading}>
        {loading ? <Spinner className="size-4 mr-1" /> : <Icon icon="mdi:refresh" className="size-4 mr-1" />}刷新
      </Button>

      {/* List */}
      {loading && banned.length === 0 ? (
        <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>
      ) : banned.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">无封禁用户</p>
      ) : (
        <div className="space-y-1.5">
          {banned.map((ban) => (
            <div key={ban.user_id as string} className="flex items-center justify-between border rounded-md px-3 py-2">
              <span className="text-sm font-mono">{String(ban.user_id)} - ({fmtBanDate(ban.banned_at as number)} - {fmtBanDate(ban.banned_until as number)})</span>
              <Button size="sm" variant="ghost" onClick={() => handleUnban(Number(ban.user_id))} disabled={loading}>
                <Icon icon="mdi:account-check" className="size-4 mr-1" />解封
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Featured Panel ───

function FeaturedPanel() {
  const [paths, setPaths] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colCount, setColCount] = useState(4);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w >= 1400) setColCount(5);
      else if (w >= 1024) setColCount(4);
      else if (w >= 768) setColCount(3);
      else setColCount(2);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFeatured();
      setPaths(data.items || []);
    } catch {
      toast.error('加载精选失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const p = newPath.trim();
    if (!p) return;
    setLoading(true);
    try {
      const data = await addFeatured(p);
      setPaths(data.items || []);
      setNewPath('');
      toast.success('已添加到精选');
    } catch {
      toast.error('添加失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (path: string) => {
    setLoading(true);
    try {
      const data = await removeFeatured(path);
      setPaths(data.items || []);
      toast.success('已移除');
    } catch {
      toast.error('移除失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchRemove = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      for (const p of selected) await removeFeatured(p);
      const data = await getFeatured();
      setPaths(data.items || []);
      setSelected(new Set());
      setSelectMode(false);
      toast.success(`已移除 ${selected.size} 张精选图片`);
    } catch {
      toast.error('操作失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  // ── Waterfall layout ──
  const itemKeys = paths.filter(Boolean);
  const { containerRefCb, containerHeight, placements, handleImageLoad } = useWaterfallLayout({
    itemKeys,
    colCount,
    gap: 8,
  });

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-medium">精选管理</h3>

      {/* Add */}
      <div className="flex gap-2">
        <input type="text" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="输入图片相对路径" className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm" />
        <Button size="lg" onClick={handleAdd} disabled={loading || !newPath.trim()}>
          <Icon icon="mdi:plus" className="size-4 mr-1" />添加
        </Button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner className="size-4 mr-1" /> : <Icon icon="mdi:refresh" className="size-4 mr-1" />}刷新
        </Button>
        <Button size="sm" variant={selectMode ? 'default' : 'outline'} onClick={() => { setSelectMode(!selectMode); if (!selectMode) setSelected(new Set()); }}>
          <Icon icon="mdi:select" className="size-4 mr-1" />{selectMode ? '取消选择' : '选择'}
        </Button>
        {selected.size > 0 && (
          <Button size="sm" variant="destructive" onClick={handleBatchRemove} disabled={loading}>
            <Icon icon="mdi:close" className="size-4 mr-1" />取消精选 ({selected.size})
          </Button>
        )}
      </div>

      {/* Content */}
      {paths.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">无精选图片</p>
      ) : (
        <div
          ref={containerRefCb}
          className="relative w-full"
          style={{ height: containerHeight }}
        >
          {placements.map((pl, i) => {
            const path = pl.key;
            const isSelected = selected.has(path);
            return (
              <div
                key={path}
                className={`absolute overflow-hidden rounded-md border bg-muted cursor-pointer transition-all ${isSelected ? 'ring-2 ring-primary' : ''}`}
                style={{
                  top: pl.top,
                  left: pl.left,
                  width: pl.width,
                  height: pl.loaded ? pl.renderedHeight : pl.placeholderHeight,
                }}
                onClick={() => { if (selectMode) toggleSelect(path); }}
              >
                {!pl.loaded && (
                  <div className="size-full animate-pulse bg-muted-foreground/10" />
                )}
                <img
                  src={getProxyUrl(path)}
                  alt={path}
                  className={`w-full block ${pl.loaded ? '' : 'hidden'}`}
                  onLoad={(e) => handleImageLoad(i, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                />
                {selectMode && (
                  <div className="absolute top-1 left-1" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(path)} className="size-4 accent-primary" />
                  </div>
                )}
                <button
                  className="absolute top-1 right-1 size-5 rounded bg-destructive/80 text-white hover:bg-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleRemove(path); }}
                  title="移除"
                >
                  <Icon icon="mdi:close" className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Recommendations Panel ───

function RecommendationsPanel() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogItem, setDialogItem] = useState<Record<string, unknown> | null>(null);
  const [colCount, setColCount] = useState(4);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w >= 1400) setColCount(5);
      else if (w >= 1024) setColCount(4);
      else if (w >= 768) setColCount(3);
      else setColCount(2);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchRecommendations();
      setItems(data.items || []);
    } catch {
      toast.error('加载自荐失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resolveOne = async (id: string, action: 'approve' | 'reject', imagePath?: string) => {
    try {
      await resolveRecommendation(id, action, undefined, imagePath);
      toast.success(action === 'approve' ? '已通过' : '已拒绝');
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('操作失败');
    }
  };

  const batchResolve = async (action: 'approve' | 'reject') => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      const ids = [...selected];
      await resolveRecommendations(ids, action);
      toast.success(`已${action === 'approve' ? '通过' : '拒绝'} ${ids.length} 个`);
      setItems((prev) => prev.filter((r) => !selected.has(r.id as string)));
      setSelected(new Set());
    } catch {
      toast.error('操作失败');
    } finally {
      setLoading(false);
    }
  };

  // ── Waterfall layout ──
  const itemKeys = items
    .map((rec) => rec.image_path as string)
    .filter(Boolean);
  const { containerRefCb, containerHeight, placements, handleImageLoad } = useWaterfallLayout({
    itemKeys,
    colCount,
    gap: 8,
  });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Icon icon="mdi:star-plus-outline" className="size-4" />
          自荐审核
          {items.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{items.length}</span>}
        </h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={selectMode ? 'default' : 'outline'} onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelected(new Set()); }}>
            <Icon icon="mdi:checkbox-multiple-marked-outline" className="size-3.5 mr-1" />{selectMode ? '取消' : '选择'}
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Batch actions */}
      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border bg-muted/30">
          <span className="text-xs text-muted-foreground">已选 {selected.size} 个</span>
          <Button size="sm" variant="outline" onClick={() => {
            if (selected.size === items.length) setSelected(new Set());
            else setSelected(new Set(items.map((r) => r.id as string)));
          }}>{selected.size === items.length ? '取消全选' : '全选'}</Button>
          <Button size="sm" variant="default" onClick={() => batchResolve('approve')} disabled={loading || selected.size === 0}>通过选中</Button>
          <Button size="sm" variant="destructive" onClick={() => batchResolve('reject')} disabled={loading || selected.size === 0}>拒绝选中</Button>
        </div>
      )}

      {/* Content */}
      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner className="size-6 text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">无待审核自荐</p>
      ) : (
        <div
          ref={containerRefCb}
          className="relative w-full"
          style={{ height: containerHeight }}
        >
          {placements.map((pl, i) => {
            const rec = items.find((r) => r.image_path === pl.key);
            if (!rec) return null;
            const imagePath = rec.image_path as string;
            const isSelected = selected.has(rec.id as string);
            return (
              <div
                key={rec.id as string}
                className={`absolute overflow-hidden rounded-lg border bg-muted hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer ${isSelected ? 'ring-2 ring-primary' : ''}`}
                style={{
                  top: pl.top,
                  left: pl.left,
                  width: pl.width,
                  height: pl.loaded ? pl.renderedHeight : pl.placeholderHeight,
                }}
                onClick={() => { if (selectMode) toggleSelect(rec.id as string); else setDialogItem(rec); }}
              >
                {!pl.loaded && (
                  <div className="size-full animate-pulse bg-muted-foreground/10" />
                )}
                <img
                  src={getProxyUrl(imagePath)}
                  alt=""
                  className={`w-full block ${pl.loaded ? '' : 'hidden'}`}
                  onLoad={(e) => handleImageLoad(i, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                />
                {selectMode && (
                  <div className="absolute top-1 left-1" onClick={(e) => { e.stopPropagation(); toggleSelect(rec.id as string); }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(rec.id as string)} className="size-4 accent-primary" />
                  </div>
                )}
                {!selectMode && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 text-[10px] text-white/80">
                    UID: {String(rec.user_id ?? '?')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      {dialogItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setDialogItem(null)}>
          <div className="relative flex flex-col items-center w-[95vw] sm:max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-2 right-2 z-10 text-white/80 hover:text-white" onClick={() => setDialogItem(null)}>
              <Icon icon="mdi:close" className="size-8" />
            </button>
            <img src={getProxyUrl(dialogItem.image_path as string)} alt="" className="max-w-full max-h-[60vh] sm:max-h-[75vh] object-contain rounded-lg" />
            <div className="flex flex-wrap items-center gap-2 mt-3 bg-background/80 backdrop-blur rounded-lg px-3 py-2 w-full sm:w-auto">
              <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px] shrink-0">
                UID: {String(dialogItem.user_id ?? '?')}
              </span>
              <Button size="sm" variant="default" onClick={() => { resolveOne(dialogItem.id as string, 'approve', dialogItem.image_path as string); setDialogItem(null); }} disabled={loading}>
                通过
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { resolveOne(dialogItem.id as string, 'reject', dialogItem.image_path as string); setDialogItem(null); }} disabled={loading}>
                拒绝
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
