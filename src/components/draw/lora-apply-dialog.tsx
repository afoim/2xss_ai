'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { submitLora, getMyLoraSubmissions, cancelLora, getApproveStatus } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Default lora type when dialog opens */
  defaultType?: 'character' | 'style';
}

export function LoraApplyDialog({ open, onOpenChange, defaultType = 'character' }: Props) {
  // Delegate to the inline form, with a Dialog wrapper
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-full p-0 gap-0" showCloseButton={false}>
        <LoraApplyForm onClose={() => onOpenChange(false)} defaultType={defaultType} />
      </DialogContent>
    </Dialog>
  );
}

// ── Reusable inline form (no Dialog wrapper) ──

interface FormProps {
  onClose?: () => void;
  /** Callback when view changes: 'form' | 'success' | 'my-subs' */
  onViewChange?: (view: string) => void;
  defaultType?: 'character' | 'style';
  /** When false, the title bar is not rendered (use when parent provides its own). Default true. */
  showHeader?: boolean;
}

export function LoraApplyForm({ onClose, onViewChange, defaultType = 'character', showHeader = true }: FormProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [trigger, setTrigger] = useState('');
  const [loraType, setLoraType] = useState<'character' | 'style'>(defaultType);
  const [submitting, setSubmitting] = useState(false);
  // 提交前预探测：CivitAI 官方分类与所选不一致时的二次确认
  const [confirmMismatch, setConfirmMismatch] = useState<null | { suggested: 'character' | 'style'; tags: string[] }>(null);
  // 内联校验错误：toast 在 Shell UI 的原生 <dialog>（top layer）里会被遮罩盖住看不见，
  // 所以必填校验的反馈必须内联展示，否则「提交审核点了没反应」
  const [errorMsg, setErrorMsg] = useState('');

  const [view, setView] = useState<'form' | 'success' | 'my-subs'>('form');

  const [mySubs, setMySubs] = useState<Record<string, unknown>[]>([]);
  const [mySubsLoading, setMySubsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Category dropdown
  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [useCustomCategory, setUseCustomCategory] = useState(false);

  // Reset form when mount or defaultType changes
  useEffect(() => {
    setView('form');
    setUrl('');
    setName('');
    setCategory('');
    setTrigger('');
    setLoraType(defaultType);
    setConfirmMismatch(null);
  }, [defaultType]);

  // Notify parent of view changes
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  // Fetch available categories when form view opens
  useEffect(() => {
    if (view !== 'form') return;
    setCategoryLoading(true);
    setUseCustomCategory(false);
    const token = localStorage.getItem('forum-auth-token');
    const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    Promise.all([
      fetch(`${baseUrl}/api/library/categories?mode=WAI`, { headers }).then(r => r.json()).catch(() => ({})),
      fetch(`${baseUrl}/api/library/categories?mode=ANIMA`, { headers }).then(r => r.json()).catch(() => ({})),
    ]).then(([waiData, animaData]) => {
      const cats = new Set<string>();
      [...(waiData.characters || []), ...(waiData.styles || []),
       ...(animaData.characters || []), ...(animaData.styles || [])]
        .forEach((c: any) => { if (c.name) cats.add(c.name); });
      setCategoryList([...cats].sort());
    }).catch(() => {}).finally(() => setCategoryLoading(false));
  }, [view]);

  async function doSubmit(confirm: boolean, typeOverride?: 'character' | 'style') {
    if (!url.trim() || !name.trim() || !category.trim() || !trigger.trim()) {
      setErrorMsg('请填写所有必填字段');
      return;
    }
    setErrorMsg('');
    const effType = typeOverride ?? loraType;
    setSubmitting(true);
    try {
      const res = await submitLora({
        url: url.trim(),
        name: name.trim(),
        category: category.trim(),
        trigger: trigger.trim(),
        lora_type: effType,
        confirm,
      });

      // CivitAI 官方分类与所选不一致 → 弹二次确认，暂不提交
      if (res.needs_confirm && res.suggested) {
        setConfirmMismatch({ suggested: res.suggested, tags: res.tags || [] });
        return;
      }
      setConfirmMismatch(null);

      if (res.auto_approving && res.task_id) {
        onClose?.();
        toast.info('Lora 自动审批中', { description: '正在后台下载模型文件...' });
        const poll = setInterval(async () => {
          try {
            const sr = await getApproveStatus(res.task_id!);
            const t = sr.task;
            if (t.status === 'done') {
              clearInterval(poll);
              toast.success('Lora 自动审批完成', { description: `${(t as any).name || name.trim()} 已下载并可用` });
            } else if (t.status === 'failed') {
              clearInterval(poll);
              toast.error('Lora 自动审批失败', { description: ((t as any).error as string) || '请稍后重试' });
            }
          } catch {
            clearInterval(poll);
          }
        }, 2000);
      } else {
        setView('success');
      }
    } catch (e: any) {
      toast.error('提交失败', { description: e instanceof Error ? e.message : '' });
    } finally {
      setSubmitting(false);
    }
  }

  const handleSubmit = () => doSubmit(false);

  async function loadMySubmissions() {
    setMySubsLoading(true);
    try {
      const res = await getMyLoraSubmissions();
      setMySubs(res.items || []);
      setView('my-subs');
    } catch (e: any) {
      toast.error('加载失败', { description: e instanceof Error ? e.message : '' });
    } finally {
      setMySubsLoading(false);
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await cancelLora(id);
      setMySubs((prev) => prev.filter((s) => s.id !== id));
      toast.success('已取消提交', { duration: 2000 });
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : '取消失败', { duration: 3000 });
    } finally {
      setCancellingId(null);
    }
  }

  function statusBadge(status: unknown): { variant: 'default' | 'destructive' | 'outline'; label: string } {
    if (status === 'approved') return { variant: 'default', label: '已通过' };
    if (status === 'rejected') return { variant: 'destructive', label: '已拒绝' };
    return { variant: 'outline', label: '待审核' };
  }

  function formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ── Success view ──
  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 gap-4">
        <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon icon="mdi:check-circle-outline" className="size-8 text-primary" />
        </div>
        <p className="text-base font-medium">提交成功</p>
        <p className="text-xs text-muted-foreground text-center">已收到您的 Lora 申请，等待管理员审核</p>
        <Button size="sm" className="mt-2" onClick={onClose}>知道了</Button>
      </div>
    );
  }

  // ── My submissions view ──
  if (view === 'my-subs') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0 border-b">
          <button onClick={() => setView('form')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Icon icon="mdi:arrow-left" className="size-4" />
            返回
          </button>
          <span className="text-sm font-medium flex-1 text-center">我的 Lora 提交</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {mySubsLoading ? (
            <div className="flex justify-center py-8"><Spinner className="size-5 text-muted-foreground" /></div>
          ) : mySubs.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">暂无提交记录</div>
          ) : (
            mySubs.map((sub) => {
              const badge = statusBadge(sub.status);
              return (
                <div key={sub.id as string} className="border border-border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{String(sub.name || '')}</span>
                    <div className="flex items-center gap-2">
                      {sub.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(sub.id as string)}
                          disabled={cancellingId === sub.id}
                          className="text-xs text-destructive hover:underline disabled:opacity-50"
                        >
                          {cancellingId === sub.id && (
                            <Spinner className="size-3 inline mr-1" />
                          )}
                          取消
                        </button>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                        badge.variant === 'default' ? 'bg-primary/10 text-primary border-primary/20' :
                        badge.variant === 'destructive' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        'bg-muted text-muted-foreground border-border'
                      }`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {String(sub.type || '')} · {String(sub.category || '')}
                    <span className="ml-2">{sub.created_at ? formatDate(Number(sub.created_at)) : ''}</span>
                  </div>
                  {sub.status === 'rejected' && !!sub.admin_reason && (
                    <div className="text-xs text-destructive">原因：{String(sub.admin_reason)}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── Form view (default) ──
  return (
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 border-b">
          <span className="text-sm font-medium flex items-center gap-2">
            <Icon icon="mdi:plus-circle-outline" className="size-4" />
            提交您的Lora（ByoLora）
          </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={loadMySubmissions}>
            <Icon icon="mdi:history" className="size-3.5 mr-1" />
            我的提交
          </Button>
        </div>
      </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!showHeader && (
          <div className="flex justify-end -mt-1">
            <button onClick={loadMySubmissions}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon icon="mdi:history" className="size-3.5" />
              查看我的提交记录
            </button>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Lora 链接 <span className="text-destructive">*</span></Label>
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setConfirmMismatch(null); setErrorMsg(''); }}
            placeholder="https://civitai.red/models/2677495/neverness-to-everness-lacrimosa-anima"
            className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">显示名称 <span className="text-destructive">*</span></Label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrorMsg(''); }}
            placeholder="安魂曲"
            className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="space-y-1.5">
          {useCustomCategory ? (
            <div className="space-y-1.5">
              <Label className="text-xs">
                分类 <span className="text-destructive">*</span>
                <button onClick={() => { setUseCustomCategory(false); setCategory(''); }}
                  className="text-xs text-primary hover:underline ml-2 font-normal"
                >选择已有分类</button>
              </Label>
              <input
                type="text"
                value={category}
                onChange={(e) => { setCategory(e.target.value); setErrorMsg(''); }}
                placeholder="输入新分类名称"
                className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground/60"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">
                分类 <span className="text-destructive">*</span>
                {!categoryLoading && (
                  <button onClick={() => setUseCustomCategory(true)}
                    className="text-xs text-primary hover:underline ml-2 font-normal"
                  >自定义</button>
                )}
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex w-full h-8 items-center justify-between gap-1 rounded-lg border border-input bg-background px-2.5 text-xs text-left whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                  <span className="flex-1 truncate">{category || (categoryLoading ? '加载中...' : '请选择分类')}</span>
                  <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted-foreground">▾</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-48">
                  {categoryList.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">暂无分类</div>
                  ) : (
                    categoryList.map((cat) => (
                      <DropdownMenuItem key={cat} onClick={() => { setCategory(cat); setErrorMsg(''); }} className="text-xs">
                        {category === cat && <span aria-hidden="true" className="shrink-0 font-mono text-xs">✓</span>}
                        <span className={category === cat ? '' : 'pl-5'}>{cat}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">类别 <span className="text-destructive">*</span></Label>
          <div className="flex gap-2">
            {([{ v: 'character' as const, l: '角色' }, { v: 'style' as const, l: '画风' }] as const).map((lt) => (
              <button
                key={lt.v}
                onClick={() => { setLoraType(lt.v); setConfirmMismatch(null); setErrorMsg(''); }}
                className={`flex-1 h-8 text-xs rounded-lg border transition-colors ${
                  loraType === lt.v
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                }`}
              >
                {lt.l}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">触发词 <span className="text-destructive">*</span></Label>
          <input
            type="text"
            value={trigger}
            onChange={(e) => { setTrigger(e.target.value); setErrorMsg(''); }}
            placeholder="anhunqu"
            className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2 flex flex-col gap-2 border-t">
        {confirmMismatch ? (
          <div className="rounded-lg border border-amber-600/50 bg-amber-500/5 p-2.5 space-y-2">
            <div className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <Icon icon="mdi:alert-outline" className="size-4 shrink-0 mt-0.5" />
              <span>
                CivitAI 官方把该模型标注为「{confirmMismatch.suggested === 'style' ? '画风' : '角色'}」，
                但你选择的是「{loraType === 'style' ? '画风' : '角色'}」。选错会导致之后在对应分类里找不到它，请确认。
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={submitting}
                className="flex-1 h-7 text-xs"
                onClick={() => { const s = confirmMismatch.suggested; setLoraType(s); setConfirmMismatch(null); doSubmit(true, s); }}
              >
                {submitting && <Spinner className="size-3.5" />}
                改为「{confirmMismatch.suggested === 'style' ? '画风' : '角色'}」并提交
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                className="flex-1 h-7 text-xs"
                onClick={() => { setConfirmMismatch(null); doSubmit(true); }}
              >
                仍按「{loraType === 'style' ? '画风' : '角色'}」提交
              </Button>
            </div>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <Icon icon="mdi:alert-circle-outline" className="size-3.5 shrink-0" />
                {errorMsg}
              </div>
            )}
            <Button onClick={handleSubmit} disabled={submitting} className="w-full h-8 text-xs">
              {submitting && <Spinner className="size-3.5" />}
              提交审核
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">提交后需管理员审核，审核通过后自动创建 Lora 工作流</p>
          </>
        )}
      </div>
    </div>
  );
}
