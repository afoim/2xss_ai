'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { addToQueue } from '@/lib/draw/api/client';
import { Spinner } from '@/components/ui/spinner';

const API_BASE = 'https://api-ai.acofork.com';

interface Props {
  pointsCost?: number;
  workflowPath?: string;
  onQueueUpdate?: () => void;
  storageKey: string;
}

export function RealPromptForm({ pointsCost, workflowPath, onQueueUpdate, storageKey }: Props) {
  const persistKey = `draw-real-${storageKey}`;

  const [cnPrompt, setCnPrompt] = useState('');
  const [enPrompt, setEnPrompt] = useState('');
  const [translating, setTranslating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [translateError, setTranslateError] = useState('');

  // Persist on persistKey change or unmount — reads saveRef at cleanup time
  const saveRef = useRef({ cnPrompt, enPrompt });
  saveRef.current = { cnPrompt, enPrompt };

  useEffect(() => {
    return () => {
      try {
        localStorage.setItem(persistKey, JSON.stringify(saveRef.current));
      } catch {}
    };
  }, [persistKey]);

  // Load saved state on mount or persistKey change.
  // Needed because React reuses the same component instance when
  // switching between Ernie and RedZI (same position in the tree),
  // so useState lazy init only runs once and the old state carries over.
  useEffect(() => {
    try {
      const s = localStorage.getItem(persistKey);
      const data = s ? JSON.parse(s) : null;
      setCnPrompt(data?.cnPrompt ?? '');
      setEnPrompt(data?.enPrompt ?? '');
    } catch {
      setCnPrompt('');
      setEnPrompt('');
    }
  }, [persistKey]);

  const handleTranslate = useCallback(async () => {
    if (!cnPrompt.trim()) return;
    setTranslating(true);
    setTranslateError('');
    try {
      const token = localStorage.getItem('forum-auth-token');
      const baseUrl = localStorage.getItem('draw-api-base-url') || API_BASE;
      const res = await fetch(`${baseUrl}/api/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: cnPrompt,
          mode: 'real',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEnPrompt(data.positive || '');
      } else {
        setTranslateError(data.detail || data.error || '翻译失败');
      }
    } catch (e) {
      setTranslateError('请求失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setTranslating(false);
    }
  }, [cnPrompt]);

  const handleGenerate = useCallback(async () => {
    if (!enPrompt.trim() && !cnPrompt.trim()) return;
    setGenerating(true);
    try {
      await addToQueue({
        direct_prompt: enPrompt || cnPrompt,
        workflow_path: workflowPath || 'ZImage/RedAIO.json',
      });
      toast.success('已加入队列', { description: '等待生图中，前往"我的"页面查看详情。' });
      if (onQueueUpdate) onQueueUpdate();
    } catch (e: unknown) {
      toast.error('加入队列失败', { description: e instanceof Error ? e.message : '生成失败' });
    } finally {
      setGenerating(false);
    }
  }, [enPrompt, cnPrompt, workflowPath, onQueueUpdate]);

  return (
    <div className="space-y-4">
      {/* 中文描述 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center gap-1">
          <Icon icon="mdi:translate" className="size-3.5" />
          中文描述
          <span className="text-[10px] px-1 py-0 rounded bg-secondary text-secondary-foreground">推荐</span>
        </label>
        <textarea
          value={cnPrompt}
          onChange={(e) => setCnPrompt(e.target.value)}
          placeholder="一个穿着西装的东方男性，电影级光影…"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none min-h-[72px]"
        />
      </div>

      {/* 翻译按钮 */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTranslate}
          disabled={translating || !cnPrompt.trim()}
        >
          {translating ? (
            <Spinner className="size-4" />
          ) : (
            <Icon icon="mdi:auto-fix" className="size-4" />
          )}
          翻译为英文
        </Button>
        {cnPrompt.trim() && (pointsCost ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
            <span className="inline-flex items-center">≈<Icon icon="mdi:lightning-bolt" className="size-3" />{Math.max(1, Math.ceil(cnPrompt.length * 2 / 1000))}</span>
          </span>
        )}
      </div>
      {translateError && <p className="text-xs text-red-500">{translateError}</p>}

      {/* 英文描述 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium flex items-center gap-1">
          <Icon icon="mdi:text-box-outline" className="size-3.5" />
          英文描述（最终使用的提示词）
        </label>
        <textarea
          value={enPrompt}
          onChange={(e) => setEnPrompt(e.target.value)}
          placeholder="a Chinese man in suit, cinematic lighting…"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none min-h-[72px]"
        />
      </div>

      {/* 提交 */}
      <Button
        onClick={handleGenerate}
        disabled={generating || (!enPrompt.trim() && !cnPrompt.trim())}
        size="lg"
        className="w-full"
      >
        {generating ? (
          <Spinner className="size-5" />
        ) : (
          <Icon icon="mdi:playlist-plus" className="size-5" />
        )}
        加入队列
        {pointsCost ? (
          <span className="ml-1.5 inline-flex items-center text-[10px] px-1 bg-secondary text-secondary-foreground"><Icon icon="mdi:lightning-bolt" className="size-3" />{pointsCost}</span>
        ) : null}
      </Button>
    </div>
  );
}
