'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import {
  getWallets, setWalletBalance, givePoints, giveVouchers, getPlans, savePlan, deletePlan, savePointsConfig,
} from '@/lib/draw/api/client';

const MODEL_CFG = [
  { key: 'text_to_image', label: '二次元动漫 WAI' },
  { key: 'text_to_image_anima', label: '二次元动漫 Anima' },
  { key: 'text_to_image_ernie', label: '真人写实 Ernie' },
  { key: 'text_to_image_real', label: '真人写实 RedZI' },
  { key: 'image_to_image', label: 'Flux2' },
  { key: 'text_to_video', label: '视频' },
];

export function CreditsPanel() {
  const [wallets, setWallets] = useState<Record<string, unknown>[]>([]);
  const [plans, setPlans] = useState<Record<string, unknown>[]>([]);
  const [pointsCfg, setPointsCfg] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [giveTarget, setGiveTarget] = useState<'all' | 'uid'>('all');
  const [giveCurrency, setGiveCurrency] = useState<'points' | 'voucher'>('points');
  const [giveUid, setGiveUid] = useState(0);
  const [giveValue, setGiveValue] = useState(0);
  const [searchUid, setSearchUid] = useState('');
  const [searchedWallet, setSearchedWallet] = useState<Record<string, unknown> | null>(null);

  // 充值分类字段编辑辅助（pay_categories.points|voucher）
  const setCatField = (catKey: string, field: string, value: string | number) => {
    setPointsCfg((prev) => {
      const pc = { ...(((prev.pay_categories as Record<string, Record<string, unknown>>) || {})) };
      pc[catKey] = { ...(pc[catKey] || {}), [field]: value };
      return { ...prev, pay_categories: pc };
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const [wr, pr] = await Promise.all([getWallets(), getPlans()]);
      setWallets((wr.items || []).map((w: Record<string, unknown>) => ({ ...w, _edit: w.balance, _vEdit: w.skip_vouchers })));
      setPlans(pr.items || []);
    } catch {}
    try {
      const baseUrl = typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com' : 'https://api-ai.acofork.com';
      const r = await fetch(`${baseUrl}/api/wallet/points-config`).then((res) => res.json());
      if (r.text_to_image != null) setPointsCfg(r);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleGivePoints = async () => {
    if (giveValue <= 0) return;
    try {
      const r = giveCurrency === 'voucher'
        ? await giveVouchers(giveTarget === 'uid' ? giveUid : null, giveValue)
        : await givePoints(giveTarget === 'uid' ? giveUid : null, giveValue);
      toast.success(`已赠送 ${r.count} 个用户`);
      setGiveValue(0);
      load();
    } catch { toast.error('赠送失败'); }
  };

  const searchWallet = () => {
    const uid = Number(searchUid);
    if (!uid) { setSearchedWallet(null); return; }
    const found = wallets.find((w) => Number(w.user_id) === uid);
    if (found) setSearchedWallet({ ...found, _edit: found.balance, _vEdit: found.skip_vouchers });
    else setSearchedWallet(null);
  };

  const topWallets = [...wallets].sort((a, b) => Number(b.balance) - Number(a.balance)).slice(0, 10);

  return (
    <div className="space-y-4">
      <Button size="sm" variant="outline" onClick={load} disabled={loading}>
        {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
      </Button>

      {/* Points config */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-medium">点数消耗配置</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MODEL_CFG.map((m) => (
            <div key={m.key} className="space-y-1">
              <label className="text-[10px] text-muted-foreground">{m.label}</label>
              <input type="number" value={Number(pointsCfg[m.key] ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, [m.key]: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">LLM 翻译</label>
            <input type="number" value={Number(pointsCfg.llm_translate ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, llm_translate: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">LLM Token/点</label>
            <input type="number" value={Number(pointsCfg.llm_token_per_point ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, llm_token_per_point: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">注册赠送</label>
            <input type="number" value={Number(pointsCfg.signup_bonus ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, signup_bonus: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">TTS 生成</label>
            <input type="number" value={Number(pointsCfg.tts_generate ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, tts_generate: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">TTS 每字</label>
            <input type="number" value={Number(pointsCfg.tts_per_char ?? 0) || ''} onChange={(e) => setPointsCfg((prev) => ({ ...prev, tts_per_char: Number(e.target.value) || 0 }))} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>
        </div>

        {/* 插队券 + 充值分类（2026-08-02） */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">插队券功能</span>
            <button
              onClick={() => {
                const cur = (pointsCfg.skip_voucher as { enabled?: boolean } | undefined)?.enabled;
                setPointsCfg((prev) => ({ ...prev, skip_voucher: { enabled: !cur } }));
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(pointsCfg.skip_voucher as { enabled?: boolean } | undefined)?.enabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`inline-block size-3.5 rounded-full bg-white transition-transform ${(pointsCfg.skip_voucher as { enabled?: boolean } | undefined)?.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </button>
            <span className="text-[10px] text-muted-foreground">关闭后用户无法使用/购买插队券</span>
          </div>
          <p className="text-[10px] text-muted-foreground">充值分类（爱发电订单按 plan_id 核对分流）</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['points', 'voucher'] as const).map((catKey) => {
              const cat = ((pointsCfg.pay_categories as Record<string, Record<string, unknown>> | undefined) || {})[catKey] || {};
              return (
                <div key={catKey} className="space-y-1 border rounded p-2">
                  <label className="text-[10px] text-muted-foreground">{catKey === 'points' ? '生图点分类' : '插队券分类'}</label>
                  <input value={String(cat.name || '')} onChange={(e) => setCatField(catKey, 'name', e.target.value)} placeholder="名称" className="w-full h-7 px-2 rounded border bg-background text-xs" />
                  <input value={String(cat.plan_id || '')} onChange={(e) => setCatField(catKey, 'plan_id', e.target.value)} placeholder="plan_id（订单核对用）" className="w-full h-7 px-2 rounded border bg-background text-xs font-mono" />
                  <input type="number" value={Number(cat.per_sku) || 0} onChange={(e) => setCatField(catKey, 'per_sku', Number(e.target.value) || 0)} placeholder="per_sku（每份数量）" className="w-full h-7 px-2 rounded border bg-background text-xs" />
                  <input value={String(cat.url || '')} onChange={(e) => setCatField(catKey, 'url', e.target.value)} placeholder="购买链接（remark=1 占位）" className="w-full h-7 px-2 rounded border bg-background text-xs font-mono" />
                </div>
              );
            })}
          </div>
        </div>

        <Button size="sm" onClick={async () => { try { await savePointsConfig(pointsCfg as unknown as Record<string, unknown>); toast.success('已保存'); load(); } catch { toast.error('保存失败'); } }}>
          <Icon icon="mdi:content-save-outline" className="size-4 mr-1" />保存
        </Button>
      </div>

      {/* Give points / vouchers */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-medium">赠送 {giveCurrency === 'points' ? '点数' : '插队券'}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-between gap-1 h-9 rounded-lg border border-input bg-transparent px-3 text-xs text-left min-w-[72px]">
              {giveCurrency === 'points' ? '点数' : '插队券'}
              <Icon icon="mdi:chevron-down" className="size-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setGiveCurrency('points')}>点数</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGiveCurrency('voucher')}>插队券</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-between gap-1 h-9 rounded-lg border border-input bg-transparent px-3 text-xs text-left min-w-[100px]">
              {giveTarget === 'all' ? '全部用户' : '指定 UID'}
              <Icon icon="mdi:chevron-down" className="size-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setGiveTarget('all')}>全部用户</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGiveTarget('uid')}>指定 UID</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {giveTarget === 'uid' && (
            <input type="number" value={giveUid || ''} onChange={(e) => setGiveUid(Number(e.target.value) || 0)} placeholder="UID" className="w-20 h-9 px-2 rounded-lg border bg-background text-sm" />
          )}
          <input type="number" value={giveValue || ''} onChange={(e) => setGiveValue(Number(e.target.value) || 0)} placeholder={giveCurrency === 'points' ? '点数' : '券数'} className="w-24 h-9 px-2 rounded-lg border bg-background text-sm" />
          <Button size="lg" onClick={handleGivePoints} disabled={giveValue <= 0}>赠送</Button>
        </div>
      </div>

      {/* Top 10 */}
      <div className="rounded-lg border p-4 space-y-2">
        <h4 className="text-sm font-medium">钱包排行 (Top 10)</h4>
        <div className="space-y-1">
          {topWallets.map((w, i) => (
            <div key={String(w.user_id)} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5 flex-wrap">
              <span className="w-4 text-muted-foreground">#{i + 1}</span>
              <span className="font-mono w-16">UID {String(w.user_id)}</span>
              <span className="flex-1 inline-flex items-center min-w-0"><Icon icon="mdi:lightning-bolt" className="size-3" />{Number(w.balance).toLocaleString()}</span>
              <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400"><Icon icon="mdi:ticket-confirmation-outline" className="size-3" />{Number(w.skip_vouchers || 0).toLocaleString()}</span>
              <input type="number" defaultValue={Number(w.balance)} onChange={(e) => { const val = Number(e.target.value) || 0; setWallets((prev) => prev.map((x) => String(x.user_id) === String(w.user_id) ? { ...x, _edit: val } : x)); }} className="w-20 h-7 px-1.5 rounded border bg-background text-xs text-right" title="生图点" />
              <input type="number" defaultValue={Number(w.skip_vouchers || 0)} onChange={(e) => { const val = Number(e.target.value) || 0; setWallets((prev) => prev.map((x) => String(x.user_id) === String(w.user_id) ? { ...x, _vEdit: val } : x)); }} className="w-16 h-7 px-1.5 rounded border bg-background text-xs text-right" title="插队券" />
              <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={async () => { try { await setWalletBalance(Number(w.user_id), Number((w as any)._edit ?? w.balance), Number((w as any)._vEdit != null ? (w as any)._vEdit : (w.skip_vouchers ?? 0))); toast.success('已更新'); load(); } catch { toast.error('保存失败'); } }}>保存</Button>
            </div>
          ))}
        </div>
      </div>

      {/* UID search */}
      <div className="rounded-lg border p-4 space-y-2">
        <h4 className="text-sm font-medium">按 UID 查询</h4>
        <div className="flex gap-2">
          <input type="number" value={searchUid} onChange={(e) => setSearchUid(e.target.value)} placeholder="UID" className="w-32 h-9 px-2 rounded-lg border bg-background text-sm" />
          <Button size="lg" variant="secondary" onClick={searchWallet}>查询</Button>
        </div>
        {searchedWallet && (
          <div className="flex items-center gap-2 text-xs border rounded px-2 py-1.5 flex-wrap">
            <span className="font-mono">UID {String(searchedWallet.user_id)}</span>
            <span className="flex-1 inline-flex items-center min-w-0"><Icon icon="mdi:lightning-bolt" className="size-3" />{Number(searchedWallet.balance).toLocaleString()}</span>
            <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400"><Icon icon="mdi:ticket-confirmation-outline" className="size-3" />{Number(searchedWallet.skip_vouchers || 0).toLocaleString()}</span>
            <input type="number" defaultValue={Number(searchedWallet.balance)} onChange={(e) => setSearchedWallet({ ...searchedWallet, _edit: Number(e.target.value) || 0 })} className="w-20 h-7 px-1.5 rounded border bg-background text-xs text-right" title="生图点" />
            <input type="number" defaultValue={Number(searchedWallet.skip_vouchers || 0)} onChange={(e) => setSearchedWallet({ ...searchedWallet, _vEdit: Number(e.target.value) || 0 })} className="w-16 h-7 px-1.5 rounded border bg-background text-xs text-right" title="插队券" />
            <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={async () => { try { await setWalletBalance(Number(searchedWallet.user_id), Number((searchedWallet as any)._edit ?? searchedWallet.balance), Number((searchedWallet as any)._vEdit != null ? (searchedWallet as any)._vEdit : (searchedWallet.skip_vouchers ?? 0))); toast.success('已更新'); setSearchedWallet(null); load(); } catch { toast.error('保存失败'); } }}>保存</Button>
          </div>
        )}
        {searchUid && !searchedWallet && <p className="text-xs text-muted-foreground">未找到</p>}
      </div>

      {/* Plans */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-medium">充值计划</h4>
        {plans.map((plan, i) => (
          <div key={String(plan.id) || String(i)} className="flex flex-wrap items-center gap-2 border rounded px-3 py-2">
            <input value={String(plan.name || '')} onChange={(e) => { const v = e.target.value; setPlans((prev) => prev.map((p) => String(p.id) === String(plan.id) ? { ...p, name: v } : p)); }} placeholder="名称" className="w-28 h-8 px-2 rounded border bg-background text-xs" />
            <input type="number" value={Number(plan.points) || 0} onChange={(e) => { const v = Number(e.target.value) || 0; setPlans((prev) => prev.map((p) => String(p.id) === String(plan.id) ? { ...p, points: v } : p)); }} placeholder="点数" className="w-20 h-8 px-2 rounded border bg-background text-xs" />
            <input value={String(plan.url || '')} onChange={(e) => { const v = e.target.value; setPlans((prev) => prev.map((p) => String(p.id) === String(plan.id) ? { ...p, url: v } : p)); }} placeholder="URL" className="flex-1 h-8 px-2 rounded border bg-background text-xs min-w-[120px]" />
            <Button size="sm" variant="ghost" className="h-8 text-[10px] px-2" onClick={async () => { try { await savePlan(plan); toast.success('已保存'); load(); } catch { toast.error('保存失败'); } }}>保存</Button>
            <Button size="sm" variant="destructive" className="h-8 text-[10px] px-2" onClick={async () => { try { await deletePlan(String(plan.id)); toast.success('已删除'); load(); } catch { toast.error('删除失败'); } }}>删除</Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setPlans((prev) => [...prev, { id: '', name: '', points: 0, url: '' }])}>
          + 新计划
        </Button>
      </div>
    </div>
  );
}
