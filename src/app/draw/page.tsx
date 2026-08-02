'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import * as Dialog from '@/components/ui/dialog';
import { PromptForm } from '@/components/draw/prompt-form';
import { EnvironmentSwitcher } from '@/components/environment-switcher';
import { LibrarySelector, type LibraryItem } from '@/components/draw/library-selector';
import { RealPromptForm } from '@/components/draw/real-prompt-form';
import { Img2imgForm } from '@/components/draw/img2img-form';
import { SaloonTab } from '@/components/draw/saloon-tab';
import { TtsTab } from '@/components/draw/tts-tab';
import { UpscaleTab } from '@/components/draw/upscale-tab';
import { AiAssistantTab } from '@/components/draw/ai-assistant-tab';
import { ImageLightbox } from '@/components/image-lightbox';
import { GalleryGate, useRefreshKey } from '@/components/draw/lazy-load-image';
import { useWaterfallLayout } from '@/components/draw/use-waterfall-layout';
import { fetchMyQueue, fetchWalletBalance, fetchMyImages, deleteMyImage, fetchFeatured, fetchPlans, fetchPointsConfig, giftPoints, recommendImage, fetchMyRecommendations, addToQueue, fetchForkParams, skipQueueItem, type ForkParams } from '@/lib/draw/api/client';
import { getCurrentUser, logout as forumLogout } from '@/lib/forum-account';
import { goAuthorize } from '@/lib/auth-bridge';
import { withBase } from '@/lib/base-path';
import { mediaTokenParam, useMediaToken } from '@/lib/draw/media-token';
import { Spinner } from '@/components/ui/spinner';

type Tab = 'generate' | 'mine' | 'featured';
type NavKey = 'txt2img-assistant' | 'txt2img-wai' | 'txt2img-anima' | 'txt2img-ernie' | 'txt2img-real' | 'img2img-flux2' | 'saloon' | 'tts' | 'upscale';

const NAV_ITEMS: { key: NavKey; label: string; group: string; icon: string }[] = [
  { key: 'txt2img-assistant', label: 'AI 助手', group: '文生图', icon: 'mdi:robot-outline' },
  { key: 'txt2img-wai', label: '二次元动漫 WAI', group: '文生图', icon: 'mdi:palette' },
  { key: 'txt2img-anima', label: '二次元动漫 Anima', group: '文生图', icon: 'mdi:palette' },
  { key: 'txt2img-ernie', label: '真人写实 Ernie', group: '文生图', icon: 'mdi:image-filter-hdr' },
  { key: 'txt2img-real', label: '真人写实 RedZI', group: '文生图', icon: 'mdi:image-filter-hdr' },
  { key: 'img2img-flux2', label: 'Flux2（最强）', group: '图生图', icon: 'mdi:image-edit' },
  { key: 'saloon', label: '酒馆', group: '其他', icon: 'mdi:glass-mug' },
  { key: 'tts', label: 'TTS', group: '其他', icon: 'mdi:waveform' },
  { key: 'upscale', label: '超分辨率', group: '其他', icon: 'mdi:aspect-ratio' },
];

const NAV_LABELS: Record<string, string> = {
  'txt2img-assistant': '文生图 - AI 助手',
  'txt2img-wai': '文生图 - 二次元动漫 WAI',
  'txt2img-anima': '文生图 - 二次元动漫 Anima',
  'txt2img-ernie': '文生图 - 真人写实 Ernie',
  'txt2img-real': '文生图 - 真人写实 RedZI',
  'img2img-flux2': '图生图 - Flux2',
  'saloon': '酒馆',
  'tts': 'TTS',
  'upscale': '超分辨率',
};

function DrawContentInner() {
  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [navKey, setNavKey] = useState<NavKey>(() => {
    const parts = window.location.hash.slice(1).split('/');
    if (parts[0] === 'generate' && parts[1] && NAV_ITEMS.some((i) => i.key === parts[1])) return parts[1] as NavKey;
    try {
      const saved = localStorage.getItem('draw-nav-key');
      if (saved && NAV_ITEMS.some((i) => i.key === saved)) return saved as NavKey;
    } catch {}
    return 'txt2img-assistant';
  });
  // navKey 变化时持久化——保证切 tab 后回来还在同一生成模式
  useEffect(() => {
    try { localStorage.setItem('draw-nav-key', navKey); } catch {}
  }, [navKey]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [skipVouchers, setSkipVouchers] = useState(0);
  // 插队券商品配置（来自 points-config 的 pay_categories.voucher）；未启用时保持 null，前端不渲染购买入口
  const [voucherCfg, setVoucherCfg] = useState<Record<string, unknown> | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  // 插队按钮二次确认（仿退出登录的两步确认）
  const [skipConfirmId, setSkipConfirmId] = useState<number | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [myImages, setMyImages] = useState<Record<string, unknown>[]>([]);
  const [queueItems, setQueueItems] = useState<Record<string, unknown>[]>([]);
  const [queueErrors, setQueueErrors] = useState<Record<string, string>>({});
  // 已点 ✕ 忽略的错误 id——持久化，刷新/轮询不再弹
  const [dismissedErrorIds, setDismissedErrorIds] = useState<Set<string>>(new Set());
  const dismissedErrorIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { dismissedErrorIdsRef.current = dismissedErrorIds; }, [dismissedErrorIds]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Load persisted queue errors + dismissed ids
  useEffect(() => {
    try {
      const saved = localStorage.getItem('draw-queue-errors');
      if (saved) setQueueErrors(JSON.parse(saved));
    } catch {}
    try {
      const saved = localStorage.getItem('draw-dismissed-errors');
      if (saved) setDismissedErrorIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('draw-queue-errors', JSON.stringify(queueErrors)); }
    catch {}
  }, [queueErrors]);

  useEffect(() => {
    try { localStorage.setItem('draw-dismissed-errors', JSON.stringify([...dismissedErrorIds])); }
    catch {}
  }, [dismissedErrorIds]);

  // Wallet dialog
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<'recharge' | 'gift'>('recharge');
  const [giftRecipientId, setGiftRecipientId] = useState('');
  const [giftPointsStr, setGiftPointsStr] = useState('');
  const [gifting, setGifting] = useState(false);
  const [recharging, setRecharging] = useState(false);
  const [giftConfirm, setGiftConfirm] = useState(false);

  // Recommend state (for ImageLightbox single recommend)
  const [recommendDialogOpen, setRecommendDialogOpen] = useState(false);
  const [recommendPending, setRecommendPending] = useState(false);
  const [recommendCallback, setRecommendCallback] = useState<(() => Promise<void>) | null>(null);
  const [recommendCount, setRecommendCount] = useState(0);

  const handleLightboxRecommend = useCallback((path: string) => {
    setRecommendCount(1);
    setRecommendCallback(() => async () => {
      setRecommendPending(true);
      try {
        await recommendImage(path);
        toast.success('自荐成功', { description: '等待管理员审核' });
        setRecommendDialogOpen(false);
      } catch (e: unknown) {
        toast.error('自荐失败', { description: e instanceof Error ? e.message : '' });
      } finally {
        setRecommendPending(false);
      }
    });
    setRecommendDialogOpen(true);
  }, []);

  // Queue polling — adaptive: 1s when active, 10s when idle
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevQueueIdsRef = useRef<Set<number>>(new Set());
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const loadQueue = useCallback(async () => {
    try {
      const raw = await fetchMyQueue();
      const items = (Array.isArray(raw) ? raw : (raw as Record<string, unknown>).items || []) as Record<string, unknown>[];
      setQueueItems(items);

      const activeIds = new Set(
        items
          .filter((it) => it.status === 'pending' || it.status === 'waiting' || it.status === 'running')
          .map((it) => Number(it.id)),
      );

      // 通知：新完成/消失的任务
      const newlyDone = items.filter(
        (it) =>
          (it.status === 'done' || it.status === 'failed') &&
          !notifiedIdsRef.current.has(String(it.id)) &&
          prevQueueIdsRef.current.has(Number(it.id)),
      );
      const prevIds = prevQueueIdsRef.current;
      const currentIds = new Set(items.map((it) => Number(it.id)));
      const disappeared = [...prevIds].filter(
        (id) => !currentIds.has(id) && !notifiedIdsRef.current.has('disp_' + id),
      );
      for (const id of disappeared) {
        notifiedIdsRef.current.add('disp_' + id);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('生图完成', { body: '你的图片已生成完成。', icon: '/favicon.ico' });
        }
      }
      for (const item of newlyDone) {
        notifiedIdsRef.current.add(String(item.id));
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(
            item.status === 'done' ? '生图完成' : '生图失败',
            { body: item.status === 'done' ? '你的图片已生成完成。' : String(item.error || '生图失败'), icon: '/favicon.ico' },
          );
        }
      }
      prevQueueIdsRef.current = activeIds;

      // 每次轮询/刷新都全量拉图片
      try {
        const data = await fetchMyImages('default');
        setMyImages((data as { items: Record<string, unknown>[] }).items || []);
      } catch {}

      // Persist failed errors, remove resolved ones (skip dismissed)
      setQueueErrors((prev) => {
        const next = { ...prev };
        let changed = false;
        const dismissed = dismissedErrorIdsRef.current;
        for (const item of items) {
          const key = String(item.id);
          if (item.status === 'failed' && item.error && !dismissed.has(key)) {
            if (!next[key]) { next[key] = String(item.error); changed = true; }
          }
          if ((item.status === 'done' || dismissed.has(key)) && next[key]) { delete next[key]; changed = true; }
        }
        return changed ? next : prev;
      });

      // Adaptive: 1s when active, 10s when idle
      const hasActive = items.some(
        (it) => it.status === 'pending' || it.status === 'waiting' || it.status === 'running',
      );
      return hasActive ? 1000 : 10000;
    } catch {
      return 10000;
    }
  }, []);

  // Debounced poll: 保证同一时刻只有一个在跑，但不会丢弃新的触发
  const pollingRef = useRef(false);
  const scheduleNext = useCallback((intervalMs: number = 10000) => {
    pollTimerRef.current = setTimeout(async () => {
      if (pollingRef.current) { scheduleNext(intervalMs); return; }
      pollingRef.current = true;
      try { const next = await loadQueue(); scheduleNext(next ?? 10000); }
      catch { scheduleNext(10000); }
      finally { pollingRef.current = false; }
    }, intervalMs);
  }, [loadQueue]);

  useEffect(() => {
    const token = localStorage.getItem('forum-auth-token');
    setIsLoggedIn(!!token);

    // Health check (runs regardless of login)
    const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
    fetch(`${baseUrl}/health?_t=${Date.now()}`, { method: 'GET', signal: AbortSignal.timeout(15000) })
      .then((r) => { setApiStatus(r.ok ? 'online' : 'offline'); })
      .catch(() => setApiStatus('offline'));

    if (token) {
      fetchWalletBalance().then((r) => { setWalletBalance(r.balance); setSkipVouchers(r.skip_vouchers || 0); }).catch(() => {});
      getCurrentUser().then((u) => setIsAdmin(u.role === 'admin')).catch(() => {});
      // 插队券商品配置：启用且配置了 voucher 分类才展示购买入口
      fetchPointsConfig().then((cfg) => {
        const c = cfg as Record<string, unknown>;
        const sv = (c.skip_voucher || {}) as Record<string, unknown>;
        const pc = (c.pay_categories || {}) as Record<string, Record<string, unknown>>;
        if (sv.enabled === true && pc.voucher) setVoucherCfg(pc.voucher);
      }).catch(() => {});
      loadQueue().then((interval) => {
        // Request notification permission on first load
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        scheduleNext(interval ?? 10000);
      });
    }
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [loadQueue, scheduleNext]);

  useEffect(() => {
    const handler = () => {
      const parts = window.location.hash.slice(1).split('/');
      if (parts[0] === 'generate' || parts[0] === 'mine' || parts[0] === 'featured') {
        setActiveTab(parts[0] as Tab);
        if (parts[1] && NAV_ITEMS.some((i) => i.key === parts[1])) setNavKey(parts[1] as NavKey);
      }
    };
    // Parse hash on initial load
    handler();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const syncHash = (tab: Tab, nav?: NavKey) => {
    const h = nav ? `#${tab}/${nav}` : `#${tab}`;
    if (window.location.hash !== h) window.history.replaceState(null, '', h);
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    syncHash(tab, tab === 'generate' ? navKey : undefined);
  };

  // 切换到"我的"标签时拉最新图片
  useEffect(() => {
    if (activeTab === 'mine') loadQueue();
  }, [activeTab]);

  const handleNavChange = (key: NavKey) => {
    setNavKey(key);
    syncHash('generate', key);
    setSheetOpen(false);
  };

  // ── Fork：把一张图的生成参数回填到生图表单 ──
  // 参数经 props 交给 GenerateContent，而不是写 localStorage：后者在组件重挂载时
  // 会被卸载 cleanup 里的 saveRef 覆盖掉（见 GenerateContent 的持久化注释）。
  const [forkPayload, setForkPayload] = useState<ForkParams | null>(null);
  const [forking, setForking] = useState(false);

  const handleFork = async (path: string): Promise<boolean> => {
    setForking(true);
    try {
      const params = await fetchForkParams(path);
      if (!params.supported) {
        toast.error('无法复刻这张图', { description: params.reason || '缺少生成参数' });
        return false;
      }
      const nav = (params.nav_key as NavKey) || 'txt2img-wai';
      setNavKey(nav);
      setActiveTab('generate');
      syncHash('generate', nav);
      setForkPayload(params);

      const missing = params.unmatched_loras?.length ?? 0;
      toast.success('已填入生成参数', {
        description: missing
          ? `有 ${missing} 个 Lora 已不在库中，仅保留了它的提示词。确认后点「开始生成」`
          : '确认后点「开始生成」即可',
      });
      return true;
    } catch (e: unknown) {
      toast.error('读取参数失败', { description: e instanceof Error ? e.message : '请稍后重试' });
      return false;
    } finally {
      setForking(false);
    }
  };

  const [logoutConfirm, setLogoutConfirm] = useState(false);

  const handleLogout = async () => {
    setIsLoggedIn(false);
    await forumLogout();
    setLogoutConfirm(false);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-2 sm:px-4 py-3 sm:py-6 space-y-4">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
          <Icon icon="mdi:palette" className="size-5" />
          <button onClick={() => setSettingsOpen(true)} className="text-sm font-semibold hover:text-primary transition-colors">AI 生图</button>
          {apiStatus === 'checking' ? (
            <span className="text-[10px] px-2 py-0.5 rounded border text-muted-foreground">API 检测中</span>
          ) : apiStatus === 'offline' ? (
            <a href="https://2x.nz/q" target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors no-underline">API离线 - 加群反馈</a>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded border border-green-500 text-green-500">API 在线</span>
          )}
          {!isLoggedIn && (
            <button
              onClick={() => goAuthorize()}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-xs font-medium border border-primary/40 bg-primary/10 hover:bg-primary/20 transition-colors shrink-0"
            >
              <Icon icon="mdi:login" className="size-3.5" />
              用论坛账号登录
            </button>
          )}
          {isLoggedIn && walletBalance !== null && (
            <button onClick={() => { setWalletOpen(true); setWalletTab('recharge'); }} className="inline-flex items-center gap-0.5 px-2 h-6 rounded-full text-xs font-medium border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors shrink-0">
              <span className="inline-flex items-center"><Icon icon="mdi:lightning-bolt" className="size-3" />{walletBalance}</span><span className="ml-1 text-[10px] opacity-70">点我充值</span>
            </button>
          )}
          {isLoggedIn && skipVouchers > 0 && (
            <button onClick={() => { setWalletOpen(true); setWalletTab('recharge'); }} className="inline-flex items-center gap-0.5 px-2 h-6 rounded-full text-xs font-medium border border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors shrink-0" title="插队券：位置 N 用 N 张券插到队首">
              <span className="inline-flex items-center"><Icon icon="mdi:ticket-confirmation-outline" className="size-3" />x{skipVouchers}</span>
            </button>
          )}
          {isLoggedIn && !logoutConfirm && (
            <button onClick={() => setLogoutConfirm(true)} className="size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0" title="退出登录">
              <Icon icon="mdi:logout" className="size-4" />
            </button>
          )}
          {logoutConfirm && (
            <div className="inline-flex items-center gap-1 shrink-0 border border-red-500/30 bg-red-500/5 rounded-md px-2 h-6">
              <span className="text-[10px] text-red-500">确认退出？</span>
              <button onClick={handleLogout} className="text-[10px] text-red-500 hover:text-white hover:bg-red-500 px-1 rounded transition-colors">是</button>
              <button onClick={() => setLogoutConfirm(false)} className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded transition-colors">否</button>
            </div>
          )}
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex w-full">
        {([
          { key: 'generate', icon: 'mdi:sparkles', label: '生成' },
          { key: 'mine', icon: 'mdi:account-outline', label: '我的' },
          { key: 'featured', icon: 'mdi:star-outline', label: '精选' },
        ] as const).map((t) => (
          <Button key={t.key} variant={activeTab === t.key ? 'default' : 'outline'} className="flex-1" onClick={() => handleTabChange(t.key)}>
            <Icon icon={t.icon} className="size-4 mr-1" />
            {t.label}
          </Button>
        ))}
      </div>

      {/* Generate sub-nav */}
      {activeTab === 'generate' && (
        <div className="flex items-start gap-2">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger className="group inline-flex items-center justify-between gap-2 h-10 px-3 border border-foreground/60 bg-background text-sm min-w-0 flex-1 cursor-pointer transition-colors hover:border-primary hover:text-primary">
              <span className="flex items-center gap-2 min-w-0">
                <Icon icon={NAV_ITEMS.find((i) => i.key === navKey)?.icon || 'mdi:apps'} className="size-4 shrink-0 text-foreground/70 group-hover:text-primary" />
                <span className="truncate">{NAV_LABELS[navKey] || navKey}</span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 pl-2 border-l border-border/70 font-mono text-xs text-muted-foreground transition-colors group-hover:text-primary">
                切换
                <Icon icon="mdi:chevron-down" className="size-5 transition-transform group-hover:translate-y-0.5" />
              </span>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>选择生图模式</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {NAV_ITEMS.map((item, i, arr) => (
                  <div key={item.key}>
                    {i === 0 || arr[i - 1].group !== item.group ? (
                      <p className="text-xs text-muted-foreground px-2 pt-3 pb-1">{item.group}</p>
                    ) : null}
                    <button
                      onClick={() => { handleNavChange(item.key); }}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${navKey === item.key ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-foreground hover:text-background'}`}
                    >
                      <Icon icon={item.icon} className="size-4 shrink-0" />
                      {item.label}
                    </button>
                    {i < arr.length - 1 && arr[i + 1].group !== item.group && <div className="border-t my-1" />}
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* Content */}
      {activeTab === 'generate' && (
        <GenerateContent
          navKey={navKey}
          queueItems={queueItems}
          onQueueUpdate={loadQueue}
          forkPayload={forkPayload}
          onForkApplied={() => setForkPayload(null)}
        />
      )}
      {activeTab === 'mine' && <MineContent images={myImages} setImages={setMyImages} queueItems={queueItems} queueErrors={queueErrors} onDismissError={(id) => { setDismissedErrorIds((prev) => new Set(prev).add(String(id))); setQueueErrors((prev) => { const n = {...prev}; delete n[String(id)]; return n; }); }} onRefresh={loadQueue} skipVouchers={skipVouchers} onSkipDone={() => { fetchWalletBalance().then((r) => { setWalletBalance(r.balance); setSkipVouchers(r.skip_vouchers || 0); }).catch(() => {}); }} />}
      {activeTab === 'featured' && <FeaturedContent />}

      {/* Lightbox — shared by Mine + Featured；两处都可复刻（自己的图和精选图都在 fork 的访问白名单里） */}
      <ImageLightbox
        onrecommend={activeTab === 'mine' ? handleLightboxRecommend : undefined}
        onFork={activeTab === 'mine' || activeTab === 'featured' ? handleFork : undefined}
        forking={forking}
      />

      {/* Recommend confirmation dialog */}
      <Dialog.Dialog open={recommendDialogOpen} onOpenChange={setRecommendDialogOpen}>
        <Dialog.DialogContent className="max-w-md">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
              <Icon icon="mdi:alert-circle" className="size-5" />
              自荐确认警告
            </Dialog.DialogTitle>
            <Dialog.DialogDescription className="text-sm leading-relaxed space-y-3 pt-2 text-foreground">
              <div className="font-medium text-red-600 dark:text-red-400">
                您确认该图片适合被公开浏览吗？若您执意自荐违规图片，可能会被封号。
              </div>
              {recommendCount > 1 && (
                <div className="text-muted-foreground text-xs">您当前选择了 {recommendCount} 张图片进行批量自荐。</div>
              )}
            </Dialog.DialogDescription>
          </Dialog.DialogHeader>
          <div className="flex justify-end gap-2 px-6 pb-4">
            <Button variant="outline" size="sm" onClick={() => setRecommendDialogOpen(false)} disabled={recommendPending}>取消</Button>
            <Button variant="destructive" size="sm" onClick={() => recommendCallback?.()} disabled={recommendPending}>
              {recommendPending && <Spinner className="size-4" />}
              确认自荐
            </Button>
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>

      {/* Settings Dialog */}
      <Dialog.Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.DialogContent className="max-w-sm">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle className="text-base">设置</Dialog.DialogTitle>
          </Dialog.DialogHeader>
          <EnvironmentSwitcher type="draw" onClose={() => setSettingsOpen(false)} />
          {isAdmin && (
            <a href={withBase("/admin")} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium hover:bg-foreground hover:text-background transition-colors">
              <Icon icon="mdi:shield-crown" className="size-4" />
              管理员面板
            </a>
          )}
        </Dialog.DialogContent>
      </Dialog.Dialog>

      {/* Recharge / Gift Dialog */}
      <Dialog.Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <Dialog.DialogContent className="max-w-sm w-[calc(100%-2rem)] sm:w-full">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle className="text-base">
              {walletTab === 'recharge' ? '充值' : '赠送'}
            </Dialog.DialogTitle>
          </Dialog.DialogHeader>
          <div className="px-6 pb-4">
            <div className="flex border-b mb-4">
              <button
                onClick={() => setWalletTab('recharge')}
                className={`flex-1 py-2 text-sm font-medium text-center border-b-2 transition-colors ${walletTab === 'recharge' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
              >
                充值
              </button>
              <button
                onClick={() => setWalletTab('gift')}
                className={`flex-1 py-2 text-sm font-medium text-center border-b-2 transition-colors ${walletTab === 'gift' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
              >
                赠送
              </button>
            </div>

            {walletTab === 'recharge' && (
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    if (recharging) return;
                    setRecharging(true);
                    try {
                      const r = await fetchPlans() as unknown as { items: { url: string }[] };
                      const planUrl = r.items?.[0]?.url;
                      if (!planUrl) throw new Error('no plan');
                      // 解码 JWT 获取用户论坛 ID，替换 remark 占位符
                      const token = localStorage.getItem('forum-auth-token');
                      let finalUrl = planUrl;
                      if (token) {
                        try {
                          const payload = JSON.parse(atob(token.split('.')[1]));
                          if (payload.id) finalUrl = planUrl.replace('remark=1', `remark=${payload.id}`);
                        } catch {}
                      }
                      window.open(finalUrl, '_blank');
                      setWalletOpen(false);
                    } catch {} finally { setRecharging(false); }
                  }}
                  disabled={recharging}
                  className="flex w-full items-center justify-between rounded-full border border-amber-500/30 bg-amber-500/5 px-4 py-3 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                >
                  <div className="text-left">
                    <div className="text-sm font-medium">6000 生图点</div>
                    <div className="text-xs text-muted-foreground inline-flex items-center"><Icon icon="mdi:lightning-bolt" className="size-3" />6元</div>
                  </div>
                  {recharging ? (
                    <Spinner className="size-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">立即充值 →</span>
                  )}
                </button>
                {voucherCfg && (
                  <button
                    onClick={async () => {
                      if (voucherLoading) return;
                      setVoucherLoading(true);
                      try {
                        const planUrl = String((voucherCfg as { url?: string }).url || '');
                        if (!planUrl) throw new Error('no voucher plan');
                        const token = localStorage.getItem('forum-auth-token');
                        let finalUrl = planUrl;
                        if (token) {
                          try {
                            const payload = JSON.parse(atob(token.split('.')[1]));
                            if (payload.id) finalUrl = planUrl.replace('remark=1', `remark=${payload.id}`);
                          } catch {}
                        }
                        window.open(finalUrl, '_blank');
                        setWalletOpen(false);
                      } catch {} finally { setVoucherLoading(false); }
                    }}
                    disabled={voucherLoading}
                    className="flex w-full items-center justify-between rounded-full border border-sky-500/30 bg-sky-500/5 px-4 py-3 transition-colors hover:bg-sky-500/10 disabled:opacity-50"
                  >
                    <div className="text-left">
                      <div className="text-sm font-medium inline-flex items-center gap-1">
                        <Icon icon="mdi:ticket-confirmation-outline" className="size-4" />
                        插队券 x{Number((voucherCfg as { per_sku?: number }).per_sku) || 10}
                      </div>
                      <div className="text-xs text-muted-foreground">排第 N 位用 N 张券，立即插到队首</div>
                    </div>
                    {voucherLoading ? (
                      <Spinner className="size-4 text-sky-600 dark:text-sky-400" />
                    ) : (
                      <span className="text-sm font-medium text-sky-600 dark:text-sky-400">立即购买 →</span>
                    )}
                  </button>
                )}
                <p className="text-center text-[10px] text-muted-foreground pt-1">适度娱乐，理性消费</p>
              </div>
            )}

            {walletTab === 'gift' && !giftConfirm && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">将你的点数转赠给其他用户</p>
                <div>
                  <label className="text-xs font-medium mb-1.5 block">接收人ID</label>
                  <input
                    type="text"
                    value={giftRecipientId}
                    onChange={(e) => setGiftRecipientId(e.target.value)}
                    placeholder="输入用户ID"
                    disabled={gifting}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block">赠送点数</label>
                  <input
                    type="number"
                    value={giftPointsStr}
                    onChange={(e) => setGiftPointsStr(e.target.value)}
                    placeholder="输入点数"
                    disabled={gifting}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground inline-flex items-center">当前余额：<Icon icon="mdi:lightning-bolt" className="size-3" />{walletBalance ?? 0}</span>
                </div>
                <Button
                  className="w-full gap-1.5"
                  disabled={gifting || !giftRecipientId.trim() || !(parseInt(giftPointsStr, 10) > 0)}
                  onClick={() => {
                    const pts = parseInt(giftPointsStr, 10);
                    if (!giftRecipientId.trim()) return;
                    if (!pts || pts < 1) return;
                    if (walletBalance !== null && pts > walletBalance) return;
                    setGiftConfirm(true);
                  }}
                >
                  {gifting && <Spinner className="size-4" />}
                  确认赠送
                </Button>
              </div>
            )}

            {walletTab === 'gift' && giftConfirm && (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium">确认赠送</p>
                  <p className="text-xs text-muted-foreground">
                    确定要转赠 <strong>{parseInt(giftPointsStr, 10) || 0}</strong> 点数给用户 <strong>{giftRecipientId.trim()}</strong>？此操作不可撤销。
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setGiftConfirm(false)} disabled={gifting}>
                    取消
                  </Button>
                  <Button className="flex-1 gap-1.5" disabled={gifting} onClick={async () => {
                    setGifting(true);
                    try {
                      const r = await giftPoints(giftRecipientId.trim(), parseInt(giftPointsStr, 10));
                      setWalletBalance(r.balance);
                      setGiftRecipientId('');
                      setGiftPointsStr('');
                      setGiftConfirm(false);
                      setWalletOpen(false);
                    } catch {} finally { setGifting(false); }
                  }}>
                    {gifting && <Spinner className="size-4" />}
                    确认赠送
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>
    </div>
  );
}

// ─── Generate Content ───

// Nav modes that persist form state to localStorage
const GENERATE_PERSIST_KEYS: NavKey[] = ['txt2img-wai', 'txt2img-anima'];

function generateStateKey(key: NavKey) {
  return `draw-generate-${key}`;
}

function loadGenerateState(key: NavKey) {
  if (!GENERATE_PERSIST_KEYS.includes(key)) return null;
  try {
    const s = localStorage.getItem(generateStateKey(key));
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function GenerateContent({
  navKey, queueItems, onQueueUpdate, forkPayload, onForkApplied,
}: {
  navKey: NavKey;
  queueItems: Record<string, unknown>[];
  onQueueUpdate: () => void;
  /** 复刻一张图时传入的参数，应用后由 onForkApplied 清空 */
  forkPayload?: ForkParams | null;
  onForkApplied?: () => void;
}) {
  // Restore saved state on mount (per-navKey)
  const initialSaved = loadGenerateState(navKey);
  const [prompt, setPrompt] = useState(initialSaved?.prompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(initialSaved?.negativePrompt ?? '');
  const [nlPrompt, setNlPrompt] = useState(initialSaved?.nlPrompt ?? '');
  const [width, setWidth] = useState(initialSaved?.width ?? 0);
  const [height, setHeight] = useState(initialSaved?.height ?? 0);
  const [generating, setGenerating] = useState(false);
  const [pointsCost, setPointsCost] = useState(0);
  const [llmTokenPerPoint, setLlmTokenPerPoint] = useState(0);

  // Library selector
  const [libOpen, setLibOpen] = useState(false);
  const [selectedChars, setSelectedChars] = useState(initialSaved?.selectedChars ?? '');
  const [styleTags, setStyleTags] = useState(initialSaved?.styleTags ?? '');
  // Raw selected library items — stored so LibrarySelector can restore them on reopen
  const [selectedCharItems, setSelectedCharItems] = useState<LibraryItem[]>(initialSaved?.selectedCharItems ?? []);
  const [selectedStyleItems, setSelectedStyleItems] = useState<LibraryItem[]>(initialSaved?.selectedStyleItems ?? []);

  // workflowPrompt tracks the "default" prompt (base + library tags), so 恢复默认 restores to it
  const baseWorkflowPrompt = 'masterpiece, best quality, highly detailed';
  const baseWorkflowNegative = 'worst quality, low quality, bad anatomy, bad hands';
  const [workflowPrompt, setWorkflowPrompt] = useState(initialSaved?.workflowPrompt ?? baseWorkflowPrompt);

  // Fetch points config for cost display
  useEffect(() => {
    const mode = navKey === 'txt2img-anima' || navKey === 'txt2img-ernie' ? 'text_to_image_anima' : navKey === 'txt2img-real' ? 'text_to_image_real' : navKey === 'img2img-flux2' ? 'image_to_image' : 'text_to_image';
    fetchPointsConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const cost = c[mode];
      if (typeof cost === 'number') setPointsCost(cost);
      const llmToken = c.llm_token_per_point;
      if (typeof llmToken === 'number') setLlmTokenPerPoint(llmToken);
    }).catch(() => {});
  }, [navKey]);

  // === Persistence for generate form state ===
  // Key insight: we ONLY save on cleanup (unmount or navKey change), NOT on mount.
  // During SSR/hydration, React uses the server state (empty) and ignores the
  // useState lazy initializer, so an auto-save effect would overwrite localStorage
  // with empty state before the nav-switch effect has a chance to restore it.

  // Ref holding the latest state values — updated every render, read at cleanup time.
  const saveRef = useRef({ prompt, negativePrompt, nlPrompt, width, height, selectedChars, workflowPrompt, styleTags, selectedCharItems, selectedStyleItems });
  saveRef.current = { prompt, negativePrompt, nlPrompt, width, height, selectedChars, workflowPrompt, styleTags, selectedCharItems, selectedStyleItems };

  // Save on unmount or navKey change — reads saveRef at cleanup time, so it
  // always has the latest values regardless of when the effect was registered.
  useEffect(() => {
    return () => {
      const key = navKey;
      if (GENERATE_PERSIST_KEYS.includes(key)) {
        try {
          localStorage.setItem(generateStateKey(key), JSON.stringify(saveRef.current));
        } catch {}
      }
    };
  }, [navKey]);  

  // Load saved state for the current mode on mount or navKey change.
  // On navKey switch with no saved data → reset to defaults so modes don't share React state.
  const prevNavKeyRef = useRef(navKey);

  useEffect(() => {
    const isNavChange = prevNavKeyRef.current !== navKey;
    prevNavKeyRef.current = navKey;

    if (GENERATE_PERSIST_KEYS.includes(navKey)) {
      const data = loadGenerateState(navKey);
      if (data) {
        setPrompt(data.prompt ?? '');
        setNegativePrompt(data.negativePrompt ?? '');
        setNlPrompt(data.nlPrompt ?? '');
        setWidth(data.width ?? 0);
        setHeight(data.height ?? 0);
        setSelectedChars(data.selectedChars ?? '');
        setWorkflowPrompt(data.workflowPrompt ?? baseWorkflowPrompt);
        setStyleTags(data.styleTags ?? '');
        setSelectedCharItems(data.selectedCharItems ?? []);
        setSelectedStyleItems(data.selectedStyleItems ?? []);
      } else if (isNavChange) {
        // Switching to a mode with no saved state → reset to defaults
        setPrompt('');
        setNegativePrompt('');
        setNlPrompt('');
        setWidth(0);
        setHeight(0);
        setSelectedChars('');
        setWorkflowPrompt(baseWorkflowPrompt);
        setStyleTags('');
        setSelectedCharItems([]);
        setSelectedStyleItems([]);
      }
    }
  }, [navKey]);  

  // 应用复刻参数。必须声明在上面那个 navKey effect 之后 —— 复刻时 navKey 和 forkPayload
  // 往往同时变化，两个 effect 都会跑，后声明的后执行，这样才不会被 loadGenerateState 的旧值盖掉。
  useEffect(() => {
    if (!forkPayload?.supported) return;
    const chars = (forkPayload.characters ?? []) as unknown as LibraryItem[];
    const styleItems = (forkPayload.styles ?? []) as unknown as LibraryItem[];

    setPrompt(forkPayload.prompt ?? '');
    setNegativePrompt(forkPayload.negative_prompt || baseWorkflowNegative);
    setNlPrompt('');
    setWidth(forkPayload.width ?? 0);
    setHeight(forkPayload.height ?? 0);
    setSelectedCharItems(chars);
    setSelectedStyleItems(styleItems);
    // 与 LibrarySelector.onConfirm 的产出保持一致，否则再打开选择器确认一次会前后不一
    setSelectedChars(
      [chars.map((i) => i.name).join(', '), styleItems.map((i) => i.name).join(', ')].filter(Boolean).join(' | '),
    );
    setStyleTags(styleItems.map((i) => i.tags || i.name).join(', '));
    // 「恢复默认」回到被复刻的那张图的提示词
    setWorkflowPrompt(forkPayload.prompt || baseWorkflowPrompt);
    onForkApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forkPayload]);

  const handleGenerate = async (mode: string) => {
    if (!prompt.trim()) return;
    const hasLoras = selectedCharItems.length > 0 || selectedStyleItems.length > 0;
    setGenerating(true);
    try {
      if (hasLoras) {
        // LoRA mode — match AI Assistant behavior: send loras, no workflow_path
        const loras = [
          ...selectedCharItems.map((i) => ({ kind: i.kind, type: i.type || 'character', tags: i.tags || i.name, lora_path: i.lora_path })),
          ...selectedStyleItems.map((i) => ({ kind: i.kind, type: i.type || 'style', tags: i.tags || i.name, lora_path: i.lora_path })),
        ];
        await addToQueue({
          direct_prompt: prompt,
          negative_prompt: negativePrompt || 'worst quality, low quality',
          width: width > 0 ? width : undefined,
          height: height > 0 ? height : undefined,
          mode: mode.toUpperCase(),
          loras,
        });
      } else {
        // Workflow mode — current behavior (no loras selected)
        const workflowPaths: Record<string, string> = {
          wai: 'WAI/通用/无Lora.json',
          anima: 'ANIMA/通用/无Lora.json',
        };
        await addToQueue({
          direct_prompt: prompt,
          negative_prompt: negativePrompt || 'worst quality, low quality',
          width: width > 0 ? width : undefined,
          height: height > 0 ? height : undefined,
          mode,
          ...(navKey.startsWith('txt2img-') && workflowPaths[mode]
            ? { workflow_path: workflowPaths[mode] }
            : {}),
        });
      }
      toast.success('已加入队列', { description: '等待生图中，前往"我的"页面查看详情。' });
      if (onQueueUpdate) onQueueUpdate();
    } catch (e: unknown) {
      toast.error('加入队列失败', { description: e instanceof Error ? e.message : '生成失败' });
    } finally {
      setGenerating(false);
    }
  };

  // Render mode-specific content
  if (navKey === 'txt2img-assistant') {
    return (
      <AiAssistantTab onQueueUpdate={onQueueUpdate} />
    );
  }

  if (navKey === 'img2img-flux2') {
    return (
      <div className="space-y-4">
        <Img2imgForm
          pointsCost={pointsCost}
          onQueueUpdate={onQueueUpdate}
        />
      </div>
    );
  }

  if (navKey === 'saloon') {
    return (
      <SaloonTab onQueueUpdate={onQueueUpdate} />
    );
  }

  if (navKey === 'tts') {
    return (
      <TtsTab />
    );
  }

  if (navKey === 'upscale') {
    return (
      <UpscaleTab onQueueUpdate={onQueueUpdate} />
    );
  }

  // Ernie / Real — no library selector, simple CN→EN→submit flow
  if (navKey === 'txt2img-ernie') {
    return (
      <div className="space-y-4">
        <RealPromptForm
          storageKey={navKey}
          pointsCost={pointsCost}
          workflowPath="Ernie/Ernie.json"
          onQueueUpdate={onQueueUpdate}
        />
      </div>
    );
  }

  if (navKey === 'txt2img-real') {
    return (
      <div className="space-y-4">
        <RealPromptForm
          storageKey={navKey}
          pointsCost={pointsCost}
          workflowPath="ZImage/RedAIO.json"
          onQueueUpdate={onQueueUpdate}
        />
      </div>
    );
  }

  // WAI / Anima — show PromptForm + LibrarySelector
  const modeMap: Record<string, string> = {
    'txt2img-wai': 'wai',
    'txt2img-anima': 'anima',
    'txt2img-ernie': 'ERNIE',
    'txt2img-real': 'REAL',
  };

  return (
    <div className="space-y-4">
      {/* Library selector */}
      <Button variant="outline" className="w-full justify-start text-xs" onClick={() => setLibOpen(true)}>
        {selectedChars || '选择角色 & 画风'}
      </Button>
      <LibrarySelector
        open={libOpen}
        onOpenChange={setLibOpen}
        mode={navKey === 'txt2img-anima' ? 'ANIMA' : 'WAI'}
        initialCharItems={selectedCharItems}
        initialStyleItems={selectedStyleItems}
        onConfirm={({ tags, names, styleTags, styleName, charItems, styleItems }) => {
          const parts: string[] = [];
          if (tags) parts.push(tags);
          if (styleTags) parts.push(styleTags);
          const libPrompt = parts.join(', ');
          // 把库选的 tag 设为 workflowPrompt，让「恢复默认」能还原到角色+画风
          setWorkflowPrompt(libPrompt || baseWorkflowPrompt);
          setPrompt(libPrompt);
          // 重置反向提示词和 NL 描述，覆盖为当前选择的配方
          setNegativePrompt(baseWorkflowNegative);
          setNlPrompt('');
          setSelectedChars([names, styleName].filter(Boolean).join(' | '));
          // 单独存 styleTags，发送 API 时作为独立字段传给后端工作流
          setStyleTags(styleTags || '');
          // 保存原始选中项，下次打开 LibrarySelector 时恢复选中状态
          setSelectedCharItems(charItems ?? []);
          setSelectedStyleItems(styleItems ?? []);
        }}
      />

      <PromptForm
        directPrompt={prompt}
        onDirectPromptChange={setPrompt}
        negativePrompt={negativePrompt}
        onNegativePromptChange={setNegativePrompt}
        nlPrompt={nlPrompt}
        onNlPromptChange={setNlPrompt}
        workflowPrompt={workflowPrompt}
        workflowNegativePrompt={baseWorkflowNegative}
        width={width}
        onWidthChange={setWidth}
        height={height}
        onHeightChange={setHeight}
        onSubmit={() => handleGenerate(modeMap[navKey] || 'WAI')}
        disabled={!prompt.trim()}
        busy={generating}
        pointsCost={pointsCost}
        llmMode={navKey === 'txt2img-anima' ? 'anima' : ''}
        llmTokenPerPoint={llmTokenPerPoint}
      />

    </div>
  );
}

// ─── Mine Content ───
function MineContent({
  images, setImages, queueItems, queueErrors, onDismissError, onRefresh, skipVouchers, onSkipDone,
}: {
  images: Record<string, unknown>[];
  setImages: (v: Record<string, unknown>[]) => void;
  queueItems: Record<string, unknown>[];
  queueErrors: Record<string, string>;
  onDismissError: (id: number) => void;
  // loadQueue 返回下次轮询间隔（number），此处所有消费方都丢弃返回值，
  // 声明成 Promise<void> 会把实参判成不兼容。
  onRefresh: () => Promise<unknown>;
  skipVouchers: number;
  onSkipDone: () => void;
}) {
  // 订阅媒体令牌：换到手时重渲染，把 <img src> 上的 mt 补齐
  useMediaToken();
  const [skipConfirmId, setSkipConfirmId] = useState<number | null>(null);
  const [category, setCategory] = useState<'all' | 'saloon'>('all');
  const [loading, setLoading] = useState(false);
  const [saloonImages, setSaloonImages] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [displayLimit, setDisplayLimit] = useState(30);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Recommend state
  const [myRecommendations, setMyRecommendations] = useState<Record<string, unknown>[]>([]);
  const [myRecsLoaded, setMyRecsLoaded] = useState(false);
  const [myRecsOpen, setMyRecsOpen] = useState(false);
  const [batchRecommendOpen, setBatchRecommendOpen] = useState(false);
  const [batchRecommendPending, setBatchRecommendPending] = useState(false);
  const [deletingPaths, setDeletingPaths] = useState<Set<string>>(new Set());
  const [queueRefreshing, setQueueRefreshing] = useState(false);

  const displayImages = category === 'all' ? images : saloonImages;

  // Column count based on width
  const getColumnCount = () => {
    if (typeof window === 'undefined') return 4;
    const w = window.innerWidth;
    if (w >= 1400) return 6;
    if (w >= 1024) return 5;
    if (w >= 768) return 4;
    if (w >= 480) return 3;
    return 2;
  };
  const [colCount, setColCount] = useState(getColumnCount);

  useEffect(() => {
    const onResize = () => setColCount(getColumnCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Visible items (paged)
  const visible = displayImages.slice(0, displayLimit);
  const hasMore = visible.length < displayImages.length;

  // ── Waterfall layout ──
  const itemKeys = visible
    .map((img) => String(img.path || ''))
    .filter(Boolean);
  const { containerRefCb, containerHeight, placements, handleImageLoad } = useWaterfallLayout({
    itemKeys,
    colCount,
    gap: 12,
  });


  const loadCategory = useCallback(async (cat: 'all' | 'saloon') => {
    setLoading(true);
    setCategory(cat);
    setDisplayLimit(30);
    setSelectMode(false);
    setSelectedPaths(new Set());
    try {
      const source = cat === 'saloon' ? 'saloon' : 'default';
      const data = await fetchMyImages(source);
      const items = (data.items || []) as Record<string, unknown>[];
      setTotal(data.total || items.length);
      if (cat === 'saloon') setSaloonImages(items);
      else setImages(items);
    } catch {} finally {
      setLoading(false);
    }
  }, [setImages]);

  // Initial load
  useEffect(() => {
    loadCategory('all');
  }, [loadCategory]);

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleDelete = async (path: string) => {
    setDeletingPaths((prev) => new Set(prev).add(path));
    try {
      await deleteMyImage(path);
      const filtered = images.filter((img) => String(img.path || '') !== path);
      setImages(filtered);
      if (category === 'saloon') {
        setSaloonImages((prev) => prev.filter((img) => String(img.path || '') !== path));
      }
    } catch {
      toast.error('删除失败，请检查权限或稍后重试');
    } finally {
      setDeletingPaths((prev) => { const next = new Set(prev); next.delete(path); return next; });
    }
  };

  const handleBatchDelete = async () => {
    const paths = [...selectedPaths];
    setDeletingPaths((prev) => new Set([...prev, ...paths]));
    const results = await Promise.allSettled(paths.map((p) => deleteMyImage(p)));
    const succeeded: string[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') succeeded.push(paths[i]);
      else failed.push(paths[i]);
    });
    if (succeeded.length > 0) {
      const pathSet = new Set(succeeded);
      const filtered = images.filter((img) => !pathSet.has(String(img.path || '')));
      setImages(filtered);
      if (category === 'saloon') {
        setSaloonImages((prev) => prev.filter((img) => !pathSet.has(String(img.path || ''))));
      }
    }
    if (failed.length > 0) {
      toast.error(`删除了 ${succeeded.length} 张，${failed.length} 张删除失败`);
    } else {
      toast.success(`已删除 ${succeeded.length} 张图片`);
    }
    setDeletingPaths((prev) => { const next = new Set(prev); paths.forEach((p) => next.delete(p)); return next; });
    setSelectedPaths(new Set());
    setSelectMode(false);
  };

  const loadMyRecommendations = useCallback(async () => {
    try {
      const res = await fetchMyRecommendations();
      setMyRecommendations(res.items);
      setMyRecsLoaded(true);
    } catch {
      setMyRecommendations([]);
    }
  }, []);

  const isVideo = (path: string) => /\.(mp4|webm)$/i.test(path);
  const isAudio = (path: string) => /\.(wav|flac|mp3)$/i.test(path);
  const isImageOnly = (path: string) => !isVideo(path) && !isAudio(path);

  const imageSelectedPaths = useMemo(() => new Set([...selectedPaths].filter(isImageOnly)), [selectedPaths]);

  const handleBatchRecommend = useCallback(() => {
    if (imageSelectedPaths.size === 0) return;
    setBatchRecommendOpen(true);
  }, [imageSelectedPaths]);

  const executeBatchRecommend = useCallback(async () => {
    setBatchRecommendPending(true);
    try {
      await Promise.all(Array.from(imageSelectedPaths).map((p) => recommendImage(p)));
      toast.success('自荐成功', { description: '等待管理员审核' });
      setBatchRecommendOpen(false);
      setSelectMode(false);
      setSelectedPaths(new Set());
      loadMyRecommendations();
    } catch (e: unknown) {
      toast.error('批量自荐失败', { description: e instanceof Error ? e.message : '' });
    } finally {
      setBatchRecommendPending(false);
    }
  }, [imageSelectedPaths, loadMyRecommendations]);

  const recStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return '⏳ 待审核';
      case 'approved': return '✓ 已通过';
      case 'rejected': return '✗ 已拒绝';
      default: return status;
    }
  };

  const getImageUrl = (path: string) => {
    const baseUrl = typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com' : 'https://api-ai.acofork.com';
    // 用 15 分钟的媒体令牌，不再把论坛会话令牌拼进 URL
    return `${baseUrl}/api/output/file?path=${encodeURIComponent(path)}${mediaTokenParam()}`;
  };


  const activeItems = queueItems.filter(
    (it) => !it.status || it.status === 'pending' || it.status === 'waiting' || it.status === 'running',
  );

  // Cache busting key for image refresh
  const refreshKey = useRefreshKey();

  return (
    <div className={"space-y-4" + (selectMode ? " pb-16" : "")}>
      {/* Category tabs */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant={category === 'all' ? 'default' : 'outline'} onClick={() => loadCategory('all')}>
          默认 ({images.length})
        </Button>
        <Button size="sm" variant={category === 'saloon' ? 'default' : 'outline'} onClick={() => loadCategory('saloon')}>
          酒馆 ({saloonImages.length})
        </Button>
        <div className="flex-1" />
        {!selectMode ? (
          <>
            <Button size="sm" variant="outline" onClick={() => { if (!myRecsLoaded) loadMyRecommendations(); setMyRecsOpen(true); }} disabled={displayImages.length === 0}>
              <Icon icon="mdi:history" className="size-3.5 mr-1" />自荐记录
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setSelectMode(true); setSelectedPaths(new Set()); }} disabled={displayImages.length === 0}>选择</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => { setSelectMode(false); setSelectedPaths(new Set()); }}>取消</Button>
        )}
      </div>

      {/* Floating action bar — visible in select mode */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border px-4 py-3 flex items-center justify-center gap-3 shadow-lg">
          <span className="text-sm text-muted-foreground shrink-0 min-w-[6ch]">已选 {selectedPaths.size}</span>
          <Button size="sm" variant="outline" onClick={handleBatchRecommend} disabled={imageSelectedPaths.size === 0}>
            <Icon icon="mdi:star-plus-outline" className="size-4 mr-1" />{imageSelectedPaths.size > 0 ? `自荐 (${imageSelectedPaths.size})` : '仅图片可荐'}
          </Button>
          <Button size="sm" variant="destructive" onClick={handleBatchDelete} disabled={selectedPaths.size === 0 || deletingPaths.size > 0}>
            {deletingPaths.size > 0 ? (
              <><Spinner className="size-4 mr-1" />删除中</>
            ) : (
              <><Icon icon="mdi:delete-outline" className="size-4 mr-1" />删除 ({selectedPaths.size})</>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setSelectMode(false); setSelectedPaths(new Set()); }}>取消</Button>
        </div>
      )}

      {/* Queue — only active items (pending/waiting/running), done=fade away */}
      <div className="border rounded-lg p-3 space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Icon icon="mdi:playlist-play" className="size-4" />
            队列状态
          </h3>
          <button
            type="button"
            className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-background hover:bg-foreground transition-colors"
            title="刷新队列"
            disabled={queueRefreshing}
            onClick={async () => { setQueueRefreshing(true); try { await onRefresh(); } finally { setQueueRefreshing(false); } }}
          >
            {queueRefreshing ? <Spinner className="size-3.5" /> : <Icon icon="mdi:refresh" className="size-4" />}
          </button>
        </div>
        {activeItems.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">暂无排队任务</p>
        ) : (
          <div className="space-y-1">
            {activeItems.map((item, i) => (
              <div key={String(item.id || i)} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2">
                {item.status === 'running' && <><Spinner className="size-4 text-primary shrink-0" /><span>正在生图中</span></>}
                {(!item.status || item.status === 'pending' || item.status === 'waiting') && (
                  <>
                    <Icon icon="mdi:clock-outline" className="size-4 text-muted-foreground shrink-0" />
                    <span className="flex-1">等待中，前面还有 {item.waiting_ahead != null ? Number(item.waiting_ahead) : 0} 位</span>
                    {Number(item.waiting_ahead) > 0 && skipVouchers >= Number(item.waiting_ahead) && (
                      <button
                        type="button"
                        className={`shrink-0 ${skipConfirmId === Number(item.id) ? 'text-red-500 hover:text-red-400' : 'text-sky-600 dark:text-sky-400 hover:underline'}`}
                        onClick={async () => {
                          if (skipConfirmId !== Number(item.id)) {
                            setSkipConfirmId(Number(item.id));
                            setTimeout(() => setSkipConfirmId((cur) => (cur === Number(item.id) ? null : cur)), 3000);
                            return;
                          }
                          setSkipConfirmId(null);
                          try {
                            await skipQueueItem(Number(item.id));
                            toast.success('已插到队首，当前任务完成后立即生成');
                            onRefresh();
                            onSkipDone();
                          } catch (e: any) {
                            toast.error(e?.message || '插队失败');
                            onRefresh();
                            onSkipDone();
                          }
                        }}
                      >
                        {skipConfirmId === Number(item.id) ? '确认插队？' : `用 ${Number(item.waiting_ahead)} 张券插队`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-red-500 hover:text-red-400 shrink-0"
                      onClick={async () => {
                        try {
                          const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
                          const token = localStorage.getItem('forum-auth-token');
                          await fetch(`${baseUrl}/api/draw/my-queue/${item.id}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          onRefresh();
                        } catch {}
                      }}
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Failed queue errors */}
      {Object.entries(queueErrors).map(([id, err]) => (
        <div key={id} className="flex items-start gap-2 text-xs border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 rounded-lg px-3 py-2">
          <Icon icon="mdi:alert-circle" className="size-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 leading-tight">
            <div className="font-medium text-red-600 dark:text-red-400">#{id} 生图失败</div>
            <div className="text-[10px] text-red-500/70 break-words">{err}</div>
          </div>
          <button onClick={() => onDismissError(Number(id))} className="size-5 flex items-center justify-center rounded-full text-muted-foreground hover:text-red-500 shrink-0" title="忽略">
            <Icon icon="mdi:close" className="size-3.5" />
          </button>
        </div>
      ))}

      <GalleryGate onRefreshData={onRefresh}>
        {/* Images */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : displayImages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">暂无图片</p>
        ) : (
          <div
            ref={containerRefCb}
            className="relative w-full"
            style={{ height: containerHeight }}
          >
            {placements.map((pl, i) => {
              const img = visible.find((v) => String(v.path || '') === pl.key);
              if (!img) return null;
              const path = String(img.path || '');
              const url = getImageUrl(path);
              const selected = selectedPaths.has(path);
              return (
                <div
                  key={pl.key}
                  className={`absolute overflow-hidden rounded-lg border bg-muted ${selected ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-primary/50'} transition-all`}
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
                  {selectMode && (
                    <div className={`absolute top-2 left-2 z-10 ${pl.loaded ? '' : 'hidden'}`} onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected} onCheckedChange={() => toggleSelect(path)} className="size-4" />
                    </div>
                  )}
                  {isVideo(path) ? (
                    <video
                      src={url}
                      autoPlay loop muted playsInline
                      className="w-full block"
                      onLoadedMetadata={(e) => handleImageLoad(i, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
                    />
                  ) : isAudio(path) ? (
                    <div className="bg-muted flex items-center justify-center" style={{ aspectRatio: '1 / 1' }}>
                      <audio
                        controls
                        src={url}
                        className="w-4/5 h-10"
                        onLoadedMetadata={() => handleImageLoad(i, 1, 1)}
                      />
                    </div>
                  ) : (
                    <img
                      src={`${url}&_t=${refreshKey}`}
                      alt=""
                      className={`w-full block cursor-pointer ${pl.loaded ? '' : 'hidden'}`}
                      data-lightbox
                      data-path={path}
                      data-no-lightbox={selectMode ? 'true' : undefined}
                      onClick={(e) => { if (selectMode) { e.stopPropagation(); toggleSelect(path); } }}
                      onLoad={(e) => handleImageLoad(i, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                    />
                  )}
                  {!selectMode && (
                    <button
                      onClick={() => handleDelete(path)}
                      disabled={deletingPaths.has(path)}
                      className={`absolute top-1.5 right-1.5 size-5 rounded-full flex items-center justify-center transition-opacity ${
                        deletingPaths.has(path)
                          ? 'bg-muted-foreground/50 text-muted-foreground cursor-not-allowed'
                          : 'bg-destructive/80 text-destructive-foreground opacity-0 hover:opacity-100'
                      }`}
                      title="删除"
                    >
                      {deletingPaths.has(path) ? (
                        <Spinner className="size-3" />
                      ) : (
                        <Icon icon="mdi:close" className="size-3" />
                      )}
                    </button>
                  )}
                  {deletingPaths.has(path) && (
                    <div className="absolute inset-0 bg-black/40 z-10 rounded-lg flex items-center justify-center">
                      <span className="text-[10px] text-white/80 bg-black/50 px-2 py-0.5 rounded-full">删除中</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button size="sm" variant="outline" onClick={() => setDisplayLimit((p) => p + 20)}>
              加载更多 ({visible.length}/{displayImages.length})
            </Button>
          </div>
        )}
      </GalleryGate>

      {/* Batch recommend confirmation dialog */}
      <Dialog.Dialog open={batchRecommendOpen} onOpenChange={setBatchRecommendOpen}>
        <Dialog.DialogContent className="max-w-md">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
              <Icon icon="mdi:alert-circle" className="size-5" />
              自荐确认警告
            </Dialog.DialogTitle>
            <Dialog.DialogDescription className="text-sm leading-relaxed space-y-3 pt-2 text-foreground">
              <div className="font-medium text-red-600 dark:text-red-400">
                您确认该图片适合被公开浏览吗？若您执意自荐违规图片，可能会被封号。
              </div>
              <div className="text-muted-foreground text-xs">您当前选择了 {imageSelectedPaths.size} 张图片进行批量自荐。</div>
            </Dialog.DialogDescription>
          </Dialog.DialogHeader>
          <div className="flex justify-end gap-2 px-6 pb-4">
            <Button variant="outline" size="sm" onClick={() => setBatchRecommendOpen(false)} disabled={batchRecommendPending}>取消</Button>
            <Button variant="destructive" size="sm" onClick={executeBatchRecommend} disabled={batchRecommendPending}>
              {batchRecommendPending && <Spinner className="size-4" />}
              确认自荐
            </Button>
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>

      {/* Recommendation history dialog */}
      <Dialog.Dialog open={myRecsOpen} onOpenChange={setMyRecsOpen}>
        <Dialog.DialogContent className="sm:max-w-lg">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle className="flex items-center gap-2">
              <Icon icon="mdi:star-plus-outline" className="size-5" />
              我的自荐
            </Dialog.DialogTitle>
          </Dialog.DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-2 px-6 pb-4">
            {!myRecsLoaded ? (
              <div className="flex justify-center py-4">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : myRecommendations.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">暂无自荐记录</div>
            ) : (
              myRecommendations.map((rec) => {
                const imgPath = String(rec.image_path || '');
                const status = String(rec.status || '');
                const userReason = rec.user_reason ? String(rec.user_reason) : null;
                const adminReason = rec.admin_reason ? String(rec.admin_reason) : null;
                const recUrl = getImageUrl(imgPath);
                return (
                  <div key={String(rec.id)} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {isImageOnly(imgPath) ? (
                        <img src={recUrl} alt="" className="size-10 rounded object-cover border shrink-0" />
                      ) : isVideo(imgPath) ? (
                        <video src={recUrl} autoPlay loop muted playsInline className="size-10 rounded object-cover border shrink-0" />
                      ) : (
                        <div className="size-10 rounded border shrink-0 flex items-center justify-center bg-muted text-muted-foreground">
                          <Icon icon="mdi:file-music" className="size-5" />
                        </div>
                      )}
                      <span className="truncate flex-1">{imgPath}</span>
                      <span className={`text-[10px] shrink-0 px-2 py-0.5 rounded-full border ${
                        status === 'approved'
                          ? 'border-green-500 text-green-600 dark:text-green-400 bg-green-500/10'
                          : status === 'rejected'
                          ? 'border-red-500 text-red-600 dark:text-red-400 bg-red-500/10'
                          : 'border-muted-foreground text-muted-foreground bg-muted/50'
                      }`}>
                        {recStatusBadge(status)}
                      </span>
                    </div>
                    {userReason && (
                      <div className="text-[10px] text-muted-foreground">理由: {userReason}</div>
                    )}
                    {adminReason && (
                      <div className="text-[10px] text-muted-foreground">管理员: {adminReason}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>
    </div>
  );
}

// ─── Featured Content ───
function FeaturedContent() {
  useMediaToken();
  const [images, setImages] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [colCount, setColCount] = useState(4);
  const refreshKey = useRefreshKey();
  const gap = 12;

  // ── Screen resize → colCount ──
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

  // ── Fetch featured images ──
  useEffect(() => {
    setLoading(true);
    fetchFeatured()
      .then((data) => {
        const items = (Array.isArray(data) ? data : ((data as Record<string, unknown>)?.items as Record<string, unknown>[]) || []) as Record<string, unknown>[];
        setImages(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Waterfall layout ──
  const itemKeys = images
    .map((img) => String(img.path || img._path || ''))
    .filter(Boolean);

  const { containerRefCb, containerHeight, placements, handleImageLoad } = useWaterfallLayout({
    itemKeys,
    colCount,
    gap,
  });

  // ── Build image URL ──
  const getUrl = (path: string) => {
    const baseUrl = typeof window !== 'undefined'
      ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com'
      : 'https://api-ai.acofork.com';
    return `${baseUrl}/api/output/file?path=${encodeURIComponent(path)}${mediaTokenParam()}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <GalleryGate>
      <div
        ref={containerRefCb}
        className="relative w-full"
        style={{ height: containerHeight }}
      >
        {placements.map((p, i) => (
          <div
            key={p.key + refreshKey}
            className="absolute overflow-hidden rounded-lg border bg-muted transition-all"
            style={{
              top: p.top,
              left: p.left,
              width: p.width,
              height: p.loaded ? p.renderedHeight : p.placeholderHeight,
            }}
          >
            {!p.loaded && (
              <div className="size-full animate-pulse bg-muted-foreground/10" />
            )}
            <img
              src={`${getUrl(p.key)}&_t=${refreshKey}`}
              alt=""
              className={`w-full block cursor-pointer ${p.loaded ? '' : 'hidden'}`}
              data-lightbox
              data-path={p.key}
              onLoad={(e) => handleImageLoad(i, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            />
          </div>
        ))}
      </div>
    </GalleryGate>
  );
}

export default function DrawPage() {
  return <Suspense fallback={null}><DrawContentInner /></Suspense>;
}
