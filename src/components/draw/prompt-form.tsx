'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import * as Dialog from '@/components/ui/dialog';
import { fetchResolutions, fetchPresets, createPreset, updatePreset, deletePreset } from '@/lib/draw/api/client';
import type { Resolution, Preset } from '@/lib/draw/types';
import { Spinner } from '@/components/ui/spinner';

interface Props {
  directPrompt: string;
  onDirectPromptChange: (v: string) => void;
  negativePrompt: string;
  onNegativePromptChange: (v: string) => void;
  nlPrompt: string;
  onNlPromptChange: (v: string) => void;
  workflowPrompt?: string;
  workflowNegativePrompt?: string;
  width: number;
  onWidthChange: (v: number) => void;
  height: number;
  onHeightChange: (v: number) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  pointsCost?: number;
  llmMode?: string;
  llmTokenPerPoint?: number;
}

/**
 * 预设标签组。
 *
 * 默认态每个标签就是一枚纯按钮，点击即把内容追加进对应提示词 —— 没有 hover 才浮现的
 * 图标按钮，因此标签之间不会为「隐藏按钮」预留空位（手机上无 hover，那些空位既点不到
 * 也解释不了）。改名/删除收进「编辑」开关：进入编辑态后标签才换成「点击=改 / ✕=删」，
 * 与「我的」页面里图片的「选择」模式是同一套心智。
 */
function PresetChips({
  label, labelClassName, items, loggedIn, onApply, onNew, onEdit, onDelete,
}: {
  label: string;
  labelClassName?: string;
  items: Preset[];
  loggedIn: boolean;
  onApply: (p: Preset) => void;
  onNew: () => void;
  onEdit: (p: Preset) => void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 删光了就自动退出编辑态，否则会停在一个只剩「完成」按钮的空面板里
  useEffect(() => {
    if (editing && items.length === 0) setEditing(false);
  }, [editing, items.length]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className={`text-xs font-medium ${labelClassName ?? ''}`}>{label}</p>
        {loggedIn && (
          <div className="flex items-center gap-2 shrink-0">
            {!editing ? (
              <>
                <button type="button" onClick={onNew} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                  <Icon icon="mdi:plus" className="size-3.5" />新建
                </button>
                {items.length > 0 && (
                  <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                    <Icon icon="mdi:pencil-outline" className="size-3.5" />编辑
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-foreground inline-flex items-center gap-0.5">
                <Icon icon="mdi:check" className="size-3.5" />完成
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!loggedIn ? (
          <span className="text-[10px] text-muted-foreground">登录后可保存预设</span>
        ) : items.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">暂无</span>
        ) : editing ? (
          items.map((p) => (
            // 标签与 ✕ 同处一个边框内、以竖线分隔，不用 gap —— 免得看着像两个独立标签
            <span key={p.id} className="inline-flex items-center border border-border max-w-full">
              <button
                type="button"
                onClick={() => onEdit(p)}
                title="修改"
                disabled={deletingId === p.id}
                className="text-[11px] px-2 py-1 inline-flex items-center gap-1 min-w-0 hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
              >
                <Icon icon="mdi:pencil" className="size-3 shrink-0" />
                <span className="truncate max-w-[10rem]">{p.name}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                title="删除"
                disabled={deletingId === p.id}
                className="px-1.5 py-1 border-l border-border text-muted-foreground hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
              >
                {deletingId === p.id ? <Spinner className="size-3" /> : <Icon icon="mdi:close" className="size-3" />}
              </button>
            </span>
          ))
        ) : (
          items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onApply(p)}
              title={p.content}
              className="text-[11px] px-2 py-1 border border-border hover:bg-foreground hover:text-background transition-colors whitespace-nowrap max-w-[12rem] truncate"
            >
              {p.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function PromptForm({
  directPrompt, onDirectPromptChange,
  negativePrompt, onNegativePromptChange,
  nlPrompt, onNlPromptChange,
  workflowPrompt = 'masterpiece, best quality, highly detailed',
  workflowNegativePrompt = 'worst quality, low quality, bad anatomy, bad hands',
  width, height, onWidthChange, onHeightChange,
  onSubmit, disabled, busy, pointsCost, llmMode, llmTokenPerPoint,
}: Props) {
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [rewriteMode, setRewriteMode] = useState(true);
  const [translateError, setTranslateError] = useState('');

  // Presets —— 服务端存储（/api/presets），需登录
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetContent, setPresetContent] = useState('');
  const [presetType, setPresetType] = useState<'positive' | 'negative'>('positive');
  const [presetError, setPresetError] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  useEffect(() => {
    fetchResolutions().then((r) => {
      const arr = (Array.isArray(r) ? r : ((r as Record<string, unknown>)?.resolutions || (r as Record<string, unknown>)?.presets || [])) as Resolution[];
      setResolutions(arr);
    }).catch(() => {});
    // 未登录时不能请求 /api/presets：drawRequest 收到 401 会清 token 并跳转登录页
    let token: string | null = null;
    try { token = localStorage.getItem('forum-auth-token'); } catch {}
    if (!token) return;
    setLoggedIn(true);
    fetchPresets()
      .then((list) => setPresets(Array.isArray(list) ? list : []))
      .catch(() => setPresets([]));
  }, []);

  const positivePresets = presets.filter((p) => p.type === 'positive');
  const negativePresets = presets.filter((p) => p.type === 'negative');

  const openNewPreset = (type: 'positive' | 'negative') => {
    setEditingPresetId(null);
    setPresetName('');
    setPresetContent('');
    setPresetType(type);
    setPresetError('');
    setPresetDialogOpen(true);
  };

  const openEditPreset = (p: Preset) => {
    setEditingPresetId(p.id);
    setPresetName(p.name);
    setPresetContent(p.content);
    setPresetType(p.type);
    setPresetError('');
    setPresetDialogOpen(true);
  };

  const handleSavePreset = useCallback(async () => {
    const name = presetName.trim();
    const content = presetContent.trim();
    if (!name || !content) return;
    setSavingPreset(true);
    setPresetError('');
    try {
      if (editingPresetId) {
        const p = await updatePreset(editingPresetId, { name, content, type: presetType });
        setPresets((list) => list.map((x) => (x.id === editingPresetId ? { ...x, ...p } : x)));
      } else {
        const p = await createPreset({ name, content, type: presetType });
        // 后端若不回完整对象（缺 id），回退成重新拉取列表，避免列表里出现无 id 的条目
        if (p && typeof p.id === 'string') setPresets((list) => [...list, p]);
        else setPresets(await fetchPresets());
      }
      setPresetDialogOpen(false);
      setEditingPresetId(null);
      setPresetName('');
      setPresetContent('');
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingPreset(false);
    }
  }, [presetName, presetContent, presetType, editingPresetId]);

  const handleDeletePreset = useCallback(async (id: string) => {
    try {
      await deletePreset(id);
      setPresets((list) => list.filter((p) => p.id !== id));
    } catch {}
  }, []);

  const handleTranslate = useCallback(async () => {
    if (!nlPrompt.trim()) return;
    setTranslating(true);
    setTranslateError('');
    setPromptsOpen(true);
    try {
      const token = localStorage.getItem('forum-auth-token');
      const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
      const res = await fetch(`${baseUrl}/api/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: nlPrompt,
          original_prompt: directPrompt || undefined,
          negative_prompt: negativePrompt || undefined,
          mode: llmMode || undefined,
          rewrite: rewriteMode,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (llmMode === 'anima' && rewriteMode) {
          onDirectPromptChange(data.positive);
        } else if (llmMode === 'anima') {
          const existing = directPrompt || '';
          onDirectPromptChange(existing ? existing + ', ' + data.positive : data.positive);
        } else {
          onDirectPromptChange(data.positive);
          if (data.negative) onNegativePromptChange(data.negative);
        }
      } else {
        setTranslateError(data.detail || data.error || '翻译失败');
      }
    } catch (e) {
      setTranslateError('请求失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setTranslating(false);
    }
  }, [nlPrompt, directPrompt, negativePrompt, llmMode, rewriteMode, onDirectPromptChange, onNegativePromptChange]);

  const selectedRes = width > 0 && height > 0 ? `${width}x${height}` : '';
  const selectRes = (r: Resolution) => {
    onWidthChange(r.w);
    onHeightChange(r.h);
  };

  const allResolutions = resolutions.flatMap((r) =>
    r.w !== r.h ? [r, { w: r.h, h: r.w, label: '横屏' }] : [r],
  );

  return (
    <div className="space-y-3">
      {/* Natural language input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center gap-1">
          <Icon icon="mdi:translate" className="size-3.5" />
          自然语言描述
          <span className="text-[10px] px-1 py-0 rounded bg-secondary text-secondary-foreground">可选，中文/英文</span>
        </label>
        <Textarea
          value={nlPrompt}
          onChange={(e) => onNlPromptChange(e.target.value)}
          placeholder="一个蓝发少女站在花园里..."
          rows={2}
          className="resize-none min-h-[60px]"
        />
        <div className="flex flex-wrap gap-2 mt-1.5">
          <Button size="sm" variant="outline" onClick={handleTranslate} disabled={translating || !nlPrompt.trim()}>
            {translating ? (
              <Spinner className="size-4" />
            ) : (
              <Icon icon="mdi:auto-fix" className="size-4" />
            )}
            转换
            {!translating && (llmTokenPerPoint ?? 0) > 0 && nlPrompt.length > 0 && (
              <span className="ml-1 text-[10px] px-1 rounded bg-secondary text-secondary-foreground">
                <span className="inline-flex items-center">≈<Icon icon="mdi:lightning-bolt" className="size-3" />{Math.max(1, Math.ceil(nlPrompt.length * 2 / (llmTokenPerPoint || 1)))}</span>
              </span>
            )}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox checked={rewriteMode} onCheckedChange={(c) => setRewriteMode(c === true)} />
            改写
          </label>
        </div>
        {translateError && <p className="text-xs text-red-500 mt-1">{translateError}</p>}
      </div>

      {/* Collapsible prompt panel */}
      <div className="space-y-2">
        <button
          onClick={() => setPromptsOpen(!promptsOpen)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Icon icon={promptsOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'} className="size-4" />
          <Icon icon="mdi:text-box-outline" className="size-4" />
          正向 / 反向提示词
          {(directPrompt || negativePrompt) && (
            <span className="text-[10px] px-1 py-0 rounded bg-secondary text-secondary-foreground ml-1">
              已填写
            </span>
          )}
        </button>

        {promptsOpen && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Positive */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Icon icon="mdi:plus-circle-outline" className="size-3.5 text-primary/80" />
                  正向提示词
                </label>
                {directPrompt !== workflowPrompt && (
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-muted-foreground" onClick={() => onDirectPromptChange(workflowPrompt)}>
                    <Icon icon="mdi:restore" className="size-3 mr-0.5" />恢复默认
                  </Button>
                )}
              </div>
              <Textarea
                value={directPrompt}
                onChange={(e) => onDirectPromptChange(e.target.value)}
                rows={3}
                className="resize-none min-h-[60px]"
              />
              <PresetChips
                label="预设"
                labelClassName="text-primary/80"
                items={positivePresets}
                loggedIn={loggedIn}
                onApply={(p) => onDirectPromptChange(directPrompt ? directPrompt + ', ' + p.content : p.content)}
                onNew={() => openNewPreset('positive')}
                onEdit={openEditPreset}
                onDelete={handleDeletePreset}
              />
            </div>

            {/* Negative */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Icon icon="mdi:minus-circle-outline" className="size-3.5 text-red-400/80" />
                  反向提示词
                </label>
                {negativePrompt !== workflowNegativePrompt && (
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-muted-foreground" onClick={() => onNegativePromptChange(workflowNegativePrompt)}>
                    <Icon icon="mdi:restore" className="size-3 mr-0.5" />恢复默认
                  </Button>
                )}
              </div>
              <Textarea
                value={negativePrompt}
                onChange={(e) => onNegativePromptChange(e.target.value)}
                rows={3}
                className="resize-none min-h-[60px]"
              />
              <PresetChips
                label="预设"
                labelClassName="text-red-400/80"
                items={negativePresets}
                loggedIn={loggedIn}
                onApply={(p) => onNegativePromptChange(negativePrompt ? negativePrompt + ', ' + p.content : p.content)}
                onNew={() => openNewPreset('negative')}
                onEdit={openEditPreset}
                onDelete={handleDeletePreset}
              />
            </div>
          </div>
        )}
      </div>

      {/* Resolution */}
      {allResolutions.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">分辨率</label>
          <div className="flex flex-wrap gap-1.5">
            {allResolutions.map((r) => {
              const key = `${r.w}x${r.h}`;
              return (
                <button
                  key={key}
                  onClick={() => selectRes(r)}
                  className={`px-2 py-1 rounded text-xs border transition-all ${selectedRes === key ? 'border-primary bg-primary text-primary-foreground hover:border-foreground hover:bg-foreground hover:text-background' : 'border-border hover:bg-foreground hover:text-background'}`}
                >
                  {r.label || key}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Submit */}
      <Button onClick={onSubmit} disabled={disabled || busy} size="lg" className="w-full">
        {busy ? (
          <Spinner className="size-5" />
        ) : (
          <Icon icon="mdi:playlist-plus" className="size-5" />
        )}
        加入队列
        {pointsCost ? <span className="ml-1.5 inline-flex items-center text-[10px] px-1 bg-secondary text-secondary-foreground"><Icon icon="mdi:lightning-bolt" className="size-3" />{pointsCost}</span> : null}
      </Button>

      {/* 预设新建 / 编辑 */}
      <Dialog.Dialog
        open={presetDialogOpen}
        onOpenChange={(o) => { if (!o) setEditingPresetId(null); setPresetDialogOpen(o); }}
      >
        <Dialog.DialogContent className="sm:max-w-md">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle>{editingPresetId ? '编辑预设' : '新建预设'}</Dialog.DialogTitle>
            <Dialog.DialogDescription className="text-xs text-muted-foreground">
              预设内容将在点击时追加到对应提示词末尾（最多 2000 字符）
            </Dialog.DialogDescription>
          </Dialog.DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs">名称</label>
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="品质三连" maxLength={50} />
            </div>
            <div className="space-y-1">
              <label className="text-xs">类型</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPresetType('positive')}
                  className={`flex-1 px-3 py-1.5 text-xs border transition-all ${presetType === 'positive' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-foreground hover:text-background'}`}
                >正面</button>
                <button
                  type="button"
                  onClick={() => setPresetType('negative')}
                  className={`flex-1 px-3 py-1.5 text-xs border transition-all ${presetType === 'negative' ? 'border-red-400 bg-red-500 text-white' : 'border-border hover:bg-foreground hover:text-background'}`}
                >反面</button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs">内容</label>
              <Textarea
                value={presetContent}
                onChange={(e) => setPresetContent(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="masterpiece, best quality, highly detailed"
                className="resize-none min-h-[60px]"
              />
              <div className="text-right text-[10px] text-muted-foreground">{presetContent.length}/2000</div>
            </div>
            {presetError && <p className="text-xs text-red-500">{presetError}</p>}
            <Button
              className="w-full"
              size="sm"
              onClick={handleSavePreset}
              disabled={savingPreset || !presetName.trim() || !presetContent.trim()}
            >
              {savingPreset ? <Spinner className="size-4" /> : null}
              保存预设
            </Button>
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>
    </div>
  );
}
