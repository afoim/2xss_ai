'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { getLoraApplications, relocateLora, getCivitaiCategory, type LoraApplication } from '@/lib/draw/api/client';
import { toast } from 'sonner';

/**
 * Lora 诊断与修复面板。
 * 场景：用户提交的 Lora「搜不到」。多数不是流水线失败，而是归类问题——
 * 画风被当角色、分类填成无意义值、只有 WAI 版却在 ANIMA 搜等。
 * 这里可查全部已通过申请、看健康诊断、并「不重新下载」直接改分类/类型（移文件+改元数据）。
 */
export function LoraRepairPanel() {
  const [items, setItems] = useState<LoraApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLoraApplications({ search: search.trim(), status, limit: 80 });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Icon icon="mdi:wrench-outline" className="size-5" />
            Lora 诊断与修复
          </h3>
          <p className="text-xs text-muted-foreground mt-1">共 {total} 条 · 查已通过的 Lora，修正分类/类型/触发词（不重新下载）</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
        </Button>
      </div>

      {/* 搜索栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          placeholder="名称 / 链接 / 分类 / 触发词 / 用户ID / 申请ID"
          className="flex-1 min-w-[200px] h-9 px-3 rounded-lg border bg-background text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 px-2 rounded-lg border bg-background text-sm"
        >
          <option value="">全部状态</option>
          <option value="approved">approved</option>
          <option value="pending">pending</option>
        </select>
        <Button size="sm" onClick={load} disabled={loading}>
          <Icon icon="mdi:magnify" className="size-4" /> 搜索
        </Button>
      </div>

      {/* 列表 */}
      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner className="size-5 text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">未找到匹配的 Lora 申请</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <RepairCard key={item.id} item={item} onFixed={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const cls = ok === null
    ? 'border-border text-muted-foreground'
    : ok
      ? 'border-emerald-600/50 text-emerald-500'
      : 'border-destructive/50 text-destructive';
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] border rounded ${cls}`}>{children}</span>;
}

function RepairCard({ item, onFixed }: { item: LoraApplication; onFixed: () => void }) {
  const h = item._health || ({} as LoraApplication['_health']);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(item.name || '');
  const [category, setCategory] = useState(item.category || '');
  const [trigger, setTrigger] = useState(item.trigger || '');
  const [loraType, setLoraType] = useState<'character' | 'style'>(item.lora_type === 'style' ? 'style' : 'character');
  const [mode, setMode] = useState<'WAI' | 'ANIMA'>(item.type === 'Anima' ? 'ANIMA' : 'WAI');

  // CivitAI 官方分类检测（展开时按需拉取一次）
  const [civitai, setCivitai] = useState<{ suggested: 'character' | 'style' | null; tags: string[] } | null>(null);
  const [civitaiLoading, setCivitaiLoading] = useState(false);
  const [civitaiChecked, setCivitaiChecked] = useState(false);
  useEffect(() => {
    if (!open || civitaiChecked || !item.url) return;
    setCivitaiChecked(true);
    setCivitaiLoading(true);
    getCivitaiCategory(item.url)
      .then((r) => setCivitai({ suggested: r.suggested, tags: r.tags || [] }))
      .catch(() => setCivitai(null))
      .finally(() => setCivitaiLoading(false));
  }, [open, civitaiChecked, item.url]);

  const cardCls = !h.located
    ? 'border-destructive/40'
    : (h.issues && h.issues.length > 0) ? 'border-amber-600/40' : '';

  const handleFix = async () => {
    setSaving(true);
    try {
      const res = await relocateLora({ id: item.id, name, category, trigger, lora_type: loraType, mode });
      toast.success('修复完成：' + (res.changes || []).join('；'));
      setOpen(false);
      onFixed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修复失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${cardCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="text-sm font-medium break-all">{item.name}</div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span className="shrink-0">分类：{item.category || '（无）'}</span>
            <span className="shrink-0">类别：{item.lora_type === 'style' ? '画风' : '角色'}</span>
            <span className="shrink-0">{item.type || ''}</span>
          </div>
        </div>
        <Button size="sm" variant={open ? 'default' : 'outline'} className="shrink-0 h-7 text-xs" onClick={() => setOpen((v) => !v)}>
          <Icon icon="mdi:wrench" className="size-3.5" />修复
        </Button>
      </div>

      {/* 健康徽章 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge ok={h.located}>{h.located ? `文件在 ${h.subdir}` : '无文件'}</Badge>
        <Badge ok={!!h.meta}>{h.meta ? '有元数据' : '无元数据'}</Badge>
        <Badge ok={h.searchable}>{h.searchable ? '可搜索' : '搜不到'}</Badge>
        <Badge ok={null}>{item.status}</Badge>
      </div>

      {/* 详情 */}
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span className="shrink-0">用户 #{item.user_id}</span>
        <span className="shrink-0">申请ID {item.id}</span>
        {h.lora_path && <span className="min-w-0">落位：<code className="bg-muted px-1 rounded break-all">{h.lora_path}</code></span>}
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span className="min-w-0">触发词：<code className="bg-muted px-1 rounded break-all">{item.trigger || '（无）'}</code></span>
        <span className="min-w-0">链接：<a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{item.url}</a></span>
      </div>

      {/* issues */}
      {h.issues && h.issues.length > 0 && (
        <div className="space-y-0.5">
          {h.issues.map((iss, i) => (
            <div key={i} className="text-xs text-amber-500 flex gap-1">
              <Icon icon="mdi:alert-outline" className="size-3.5 shrink-0 mt-0.5" />
              <span>{iss}</span>
            </div>
          ))}
        </div>
      )}

      {/* 修复表单 */}
      {open && (
        <div className="border-t border-dashed pt-3 mt-2 space-y-2">
          {!h.located && (
            <p className="text-xs text-destructive">当前 _prod 下找不到文件，无法重定位（可能下载失败，请到「Lora审批」重新触发下载）。</p>
          )}

          {/* CivitAI 官方分类提示 */}
          {civitaiLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Spinner className="size-3.5" /> 正在查询 CivitAI 官方分类…
            </div>
          ) : civitai ? (
            civitai.suggested ? (
              civitai.suggested !== loraType ? (
                <div className="text-xs flex flex-wrap items-center gap-2 border border-amber-600/40 rounded-lg px-2 py-1.5 text-amber-500">
                  <Icon icon="mdi:information-outline" className="size-4 shrink-0" />
                  <span>
                    CivitAI 官方标注为「{civitai.suggested === 'style' ? '画风 style' : '角色 character'}」，
                    与当前「{loraType === 'style' ? '画风' : '角色'}」不一致
                  </span>
                  <button
                    type="button"
                    onClick={() => setLoraType(civitai.suggested!)}
                    className="px-1.5 py-0.5 border border-amber-500/60 rounded hover:bg-amber-500 hover:text-background transition-colors"
                  >
                    采用建议 → {civitai.suggested === 'style' ? '画风' : '角色'}
                  </button>
                </div>
              ) : (
                <div className="text-xs flex items-center gap-1.5 text-emerald-500">
                  <Icon icon="mdi:check-circle-outline" className="size-4 shrink-0" />
                  CivitAI 官方标注为「{civitai.suggested === 'style' ? '画风 style' : '角色 character'}」，与当前一致
                </div>
              )
            ) : (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Icon icon="mdi:tag-outline" className="size-4 shrink-0" />
                CivitAI 未给出明确分类（tags: {civitai.tags.join(', ') || '无'}），请人工判断
              </div>
            )
          ) : null}

          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[11px] text-muted-foreground">名称</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-sm" />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[11px] text-muted-foreground">分类</span>
              <input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-sm" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">触发词</span>
            <input value={trigger} onChange={(e) => setTrigger(e.target.value)} className="h-8 px-2 rounded-lg border bg-background text-sm" />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">类别</span>
              <select value={loraType} onChange={(e) => setLoraType(e.target.value as 'character' | 'style')} className="h-8 px-2 rounded-lg border bg-background text-sm">
                <option value="character">角色 character</option>
                <option value="style">画风 style</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">模式</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'WAI' | 'ANIMA')} className="h-8 px-2 rounded-lg border bg-background text-sm">
                <option value="WAI">WAI (Illustrious)</option>
                <option value="ANIMA">ANIMA</option>
              </select>
            </label>
            <Button size="sm" className="h-8 text-xs" onClick={handleFix} disabled={saving || !h.located}>
              {saving ? <Spinner className="size-3.5" /> : <Icon icon="mdi:content-save-check-outline" className="size-3.5" />}
              应用修复
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            改「类别/模式」会移动模型文件到对应目录并重写元数据、重建工作流卡片；不会重新下载。生成与搜索均以文件落位 + 元数据为准。
          </p>
        </div>
      )}
    </div>
  );
}
