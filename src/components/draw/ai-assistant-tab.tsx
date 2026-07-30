'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import * as Dialog from '@/components/ui/dialog';
import { LibrarySelector, type LibraryItem } from '@/components/draw/library-selector';
import {
  assistantChatRequest, fetchAssistantSession, saveAssistantSession, deleteAssistantSession,
  addToQueue, fetchMyQueue, fetchAssistantResult,
} from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

// ─── Types ───

interface AssistantStep {
  icon: string;
  text: string;
  status: 'tool_call' | 'tool_result';
  done?: boolean;
}

/**
 * 后端随 `final` 事件回来的完整资产（含 lora_path）。
 * 有了它前端就不必再拉 `/api/library` 全量（9.6MB / 26177 条）去把 id 换成 lora_path。
 */
interface ResolvedAsset {
  id: string;
  kind?: string;
  type?: 'character' | 'style';
  name: string;
  tags?: string;
  lora_path?: string;
  category?: string;
}

interface ReviewParams {
  prompt: string;
  negative_prompt?: string;
  character_id?: string;
  style_id?: string;
  width?: number;
  height?: number;
  /** 这张卡片实际用到的角色/画风。随会话一起落盘，历史卡片才能显示自己的角色名 */
  assets?: ResolvedAsset[];
}

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  steps?: AssistantStep[];
  imageUrl?: string;
  _taskInfo?: Record<string, unknown>;
  cardState?: 'review' | 'submitting' | 'done' | 'failed' | 'idle';
  reviewParams?: ReviewParams;
  /**
   * 这条用户消息发送时随附的角色/画风。
   * 必须显示出来 —— 否则界面上只是一句纯文本，AI 却"凭空"知道了角色，看着像见鬼。
   */
  selectedAssets?: ResolvedAsset[];
  llmCost?: number;
  llmTokens?: number;
  toolCallId?: string;
}

const POLL_INTERVAL = 3000;

// 会话持久化用的裁剪：只保留需要落盘的字段
function cleanMessages(msgs: AssistantMessage[]) {
  return msgs.map((m) => ({
    role: m.role,
    content: m.content,
    thinking: m.thinking,
    steps: m.steps,
    imageUrl: m.imageUrl,
    _taskInfo: m._taskInfo,
    cardState: m.cardState,
    reviewParams: m.reviewParams,
    selectedAssets: m.selectedAssets,
    llmCost: m.llmCost,
    llmTokens: m.llmTokens,
  }));
}

// 由输出文件名构造图片 URL（与轮询里 my-queue 的 imageUrl 拼法保持一致）
function buildAssistantImageUrl(file: string): string {
  const token = typeof window !== 'undefined' ? localStorage.getItem('forum-auth-token') : null;
  const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') : null) || 'https://api-ai.acofork.com';
  const filename = file.split('/').pop()?.split('\\').pop() || file;
  return `${baseUrl}/api/image?filename=${encodeURIComponent(filename)}&format=webp${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

const SUGGESTIONS = [
  '画一只猫娘，白毛蓝瞳',
  '一个蓝发少女站在花园里',
  '赛博朋克风格的城市夜景',
  '水彩风格的风景画',
];

function renderMarkdown(text: string): string {
  // Simple markdown-like rendering for AI responses
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs">$1</code>')
    .replace(/\n/g, '<br/>');
  return html;
}

/**
 * 卡片上的角色/画风标签。
 *
 * 优先显示后端回带的真实条目名；只有旧会话（没有 assets）才退回「拿 id 剥前缀」那套
 * —— `tag_原神_胡桃` 剥成「原神 胡桃」并不是任何一个条目的名字。
 */
function AssetChips({ args, inline }: { args: ReviewParams; inline?: boolean }) {
  const chips: { key: string; icon: string; label: string }[] = [];

  if (args.assets && args.assets.length > 0) {
    for (const a of args.assets) {
      chips.push({
        key: a.id,
        icon: a.type === 'style' ? 'mdi:palette-outline' : 'mdi:account-outline',
        label: a.category ? `${a.name} · ${a.category}` : a.name,
      });
    }
  } else {
    if (args.character_id) chips.push({ key: 'c', icon: 'mdi:account-outline', label: String(args.character_id).replace(/^tag_|^external_/, '').replace(/_/g, ' ') });
    if (args.style_id) chips.push({ key: 's', icon: 'mdi:palette-outline', label: String(args.style_id).replace(/^style_|^external_/, '').replace(/_/g, ' ') });
  }

  if (chips.length === 0) return null;

  const items = chips.map((c) => (
    <span key={c.key} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-secondary text-secondary-foreground max-w-full">
      <Icon icon={c.icon} className="size-3 shrink-0" />
      <span className="truncate">{c.label}</span>
    </span>
  ));

  return inline ? <>{items}</> : <div className="flex flex-wrap gap-1.5">{items}</div>;
}

// ─── Component ───

export function AiAssistantTab({
  onQueueUpdate,
}: {
  onQueueUpdate?: () => void;
}) {
  // ── Core state ──
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: 'assistant',
      content: '你好！我是你的 AI绘图助手。你可以用自然语言告诉我你想画什么，我会帮你挑选最适合的角色 Lora、画风以及分辨率，并为你生成专属的生图卡片。比如你可以说："我想画一个原神的胡桃，赛博朋克风格，横屏尺寸"。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'WAI' | 'ANIMA'>('WAI');
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // ── Mode locking ──
  const modeLocked = messages.length > 1;

  // ── Image refresh ──
  const [aiImageRefresh, setAiImageRefresh] = useState(0);

  // ── Settings ──
  const [autoApprove, setAutoApprove] = useState(false);
  const [alwaysScroll, setAlwaysScroll] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // ── Dialogs ──
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // ── Steps ──
  const [currentSteps, setCurrentSteps] = useState<AssistantStep[]>([]);

  // ── Edit context ──
  const [editContext, setEditContext] = useState<ReviewParams | null>(null);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);

  // ── Library selector (per-mode) ──
  // 存的是选择器给出的**完整条目**（含 id / tags / lora_path），不再只留一串名字：
  // 名字发给 AI 只能让它再去模糊搜一遍，而库里同名角色一抓一大把（「胡桃」有 22 个）。
  const [libOpen, setLibOpen] = useState(false);
  const [libSelections, setLibSelections] = useState<Record<string, { charItems: LibraryItem[]; styleItems: LibraryItem[] }>>({});
  const currentLib = libSelections[mode] || { charItems: [], styleItems: [] };
  const { charItems, styleItems } = currentLib;

  // ── Session persistence ──
  // mode 首条消息后即锁定，用 ref 保证异步回调里拿到的是最新值
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // 当前 mode 下勾选的资产，随会话一起落盘 —— 刷新后 chip 要还在，
  // 否则用户以为还选着，下一条消息却已悄悄退回按名字模糊搜索
  const selectionRef = useRef<{ charItems: LibraryItem[]; styleItems: LibraryItem[] }>({ charItems: [], styleItems: [] });
  selectionRef.current = currentLib;

  // 直接用给定的消息数组落盘（不依赖 messagesRef——它要等 re-render 后才更新，
  // 在 setMessages 之后立刻读会拿到旧值，正是"卡在提交中"被持久化的根因）
  const persistMessages = useCallback((msgs: AssistantMessage[], modeOverride?: 'WAI' | 'ANIMA') => {
    if (msgs.length === 0) return;
    saveAssistantSession(cleanMessages(msgs), modeOverride || modeRef.current, selectionRef.current).catch(() => {});
  }, []);

  // 兼容旧调用点：从最新 ref 落盘
  const saveCurrentSession = useCallback(() => {
    persistMessages(messagesRef.current);
  }, [persistMessages]);

  // ── Refs ──
  const abortRef = useRef<AbortController | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<AssistantStep[]>([]);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const capturedToolCallRef = useRef<Record<string, unknown> | null>(null);

  // ── Queue tasks (for status display, matched by prompt) ──
  const [assistantTasks, setAssistantTasks] = useState<Record<string, unknown>[]>([]);
  const tasksRef = useRef<Record<string, unknown>[]>([]);
  useEffect(() => { tasksRef.current = assistantTasks; }, [assistantTasks]);

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { stepsRef.current = currentSteps; }, [currentSteps]);

  // ── Fullscreen effect ──
  useEffect(() => {
    if (fullscreen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => document.body.classList.remove('overflow-hidden');
  }, [fullscreen]);

  // ── Scroll management ──
  // Only auto-scroll when "始终滚动" is enabled AND AI is actively loading
  useEffect(() => {
    if (alwaysScroll && loading) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentSteps, alwaysScroll, loading]);

  // ── Auto-approve / always-scroll persistence ──
  // Same pattern: saveRef + cleanup-only save, separate load.
  const settingsRef = useRef({ autoApprove, alwaysScroll });
  settingsRef.current = { autoApprove, alwaysScroll };

  useEffect(() => {
    return () => {
      try {
        localStorage.setItem('assistant-auto-approve', String(settingsRef.current.autoApprove));
        localStorage.setItem('assistant-always-scroll', String(settingsRef.current.alwaysScroll));
      } catch {}
    };
  }, []);  

  // ── Load session on mount ──
  useEffect(() => {
    // Restore settings first (separate from session fetch so the load is
    // not delayed by an async call; also avoids the hydration bug where
    // an auto-save effect would overwrite with SSR's false before this runs)
    try {
      const saved = localStorage.getItem('assistant-auto-approve');
      if (saved === 'true') setAutoApprove(true);
    } catch {}
    try {
      const saved = localStorage.getItem('assistant-always-scroll');
      if (saved === 'true') setAlwaysScroll(true);
    } catch {}

    fetchAssistantSession().then(async (data) => {
      if (data?.messages?.length) {
        let restored = data.messages as AssistantMessage[];
        const sessionMode: 'WAI' | 'ANIMA' = data.mode === 'ANIMA' ? 'ANIMA' : 'WAI';
        setMode(sessionMode);

        // 还原勾选的角色/画风 chip
        const sel = data.selection;
        if (sel && (sel.charItems?.length || sel.styleItems?.length)) {
          setLibSelections((prev) => ({
            ...prev,
            [sessionMode]: {
              charItems: (sel.charItems || []) as LibraryItem[],
              styleItems: (sel.styleItems || []) as LibraryItem[],
            },
          }));
        }

        // 跨刷新/队列清理后找回图片：对已提交但未出图的卡片，从后端持久化结果里恢复。
        // 这解决了"卡在正在提交到队列/已提交但刷新后图片丢失"的核心问题。
        const needRecover = restored
          .map((m, idx) => ({ m, idx }))
          .filter(({ m }) => m.role === 'assistant' && !m.imageUrl && m.cardState !== 'review'
            && (m._taskInfo != null || m.reviewParams != null));
        if (needRecover.length > 0) {
          const found: Record<number, string> = {};
          await Promise.all(needRecover.map(async ({ m, idx }) => {
            const itemIdRaw = m._taskInfo?.itemId;
            const itemId = itemIdRaw != null ? Number(itemIdRaw) : undefined;
            const prompt = m.reviewParams?.prompt || (m._taskInfo?.prompt as string | undefined) || '';
            try {
              const r = await fetchAssistantResult(itemId, prompt);
              if (r?.file) found[idx] = buildAssistantImageUrl(r.file);
            } catch {}
          }));
          if (Object.keys(found).length > 0) {
            restored = restored.map((m, idx) => (
              found[idx] ? { ...m, imageUrl: found[idx], cardState: 'done' as const } : m
            ));
            persistMessages(restored, sessionMode);
          }
        }

        setMessages(restored);

        // 仍未出图的任务（可能还在队列里跑）恢复轮询
        const tasks: Record<string, unknown>[] = [];
        for (const msg of restored) {
          if (msg._taskInfo && !msg.imageUrl) tasks.push(msg._taskInfo);
        }
        if (tasks.length > 0) {
          setAssistantTasks(tasks);
          startPolling();
        }
      }
      setSessionLoaded(true);
    }).catch(() => setSessionLoaded(true));

    // Auto-show tutorial on mount (matching original)
    try {
      const d = localStorage.getItem('svaf_ai_assistant_tutorial_dismissed');
      if (d !== 'true') {
        setTutorialOpen(true);
      }
    } catch {}
  }, []);

  // ── Queue polling (exactly matching original) ──
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 已发起持久化找回的 itemId，避免队列消失后重复请求
  const vanishHandledRef = useRef<Set<number>>(new Set());

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      // Check if there are active tasks first (matching original)
      const activeTasks = tasksRef.current.filter(
        (t) => t.status === 'pending' || t.status === 'running',
      );
      if (activeTasks.length === 0) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return;
      }

      try {
        const raw = await fetchMyQueue();
        const queueItems = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.items as Record<string, unknown>[]) || []);
        const token = localStorage.getItem('forum-auth-token');
        const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('draw-api-base-url') : null) || 'https://api-ai.acofork.com';

        setAssistantTasks((prev) => {
          const updated = prev.map((task) => {
            const status = String(task.status || '');
            if (status === 'success' || status === 'failed') return task;
            const match = queueItems.find((it: Record<string, unknown>) => Number(it.id) === Number(task.itemId));
            if (!match) {
              // 队列里已找不到（完成超 5 分钟被清理，或确实失败）：先从持久化结果里找回，
              // 找到即出图，找不到才判失败——避免"图已生成却显示失败"。
              const itemId = Number(task.itemId);
              if (!Number.isNaN(itemId) && !vanishHandledRef.current.has(itemId)) {
                vanishHandledRef.current.add(itemId);
                const prompt = String(task.prompt || '');
                fetchAssistantResult(itemId, prompt).then((r) => {
                  setAssistantTasks((cur) => cur.map((t) => Number(t.itemId) === itemId
                    ? (r?.file
                        ? { ...t, status: 'success', imageUrl: buildAssistantImageUrl(r.file), filename: r.file }
                        : { ...t, status: 'failed' })
                    : t));
                }).catch(() => {
                  setAssistantTasks((cur) => cur.map((t) => Number(t.itemId) === itemId ? { ...t, status: 'failed' } : t));
                });
              }
              return task; // 维持当前状态，等异步找回决定 success / failed
            }
            const s = String(match.status || '');
            const newStatus = (s === 'success' || s === 'finished' || s === 'done')
              ? 'success'
              : s === 'failed' ? 'failed' : s === 'running' ? 'running' : 'pending';
            const outputFile = newStatus === 'success' && (match._output_files as string[])?.[0];
            return {
              ...task,
              status: newStatus,
              position: match.position ?? null,
              imageUrl: outputFile
                ? `${baseUrl}/api/image?filename=${encodeURIComponent(outputFile)}&format=webp${token ? `&token=${encodeURIComponent(token)}` : ''}`
                : task.imageUrl,
              filename: outputFile || task.filename,
            };
          });
          return updated;
        });
      } catch {}
    }, POLL_INTERVAL);
  }, []); // uses tasksRef internally — no stale closure

  // After assistantTasks updates, sync imageUrl to messages, then persist
  useEffect(() => {
    if (assistantTasks.length === 0) return;
    setMessages((prev) => {
      let changed = false;
      const synced = prev.map((m) => {
        if (m.imageUrl || !m._taskInfo?.prompt) return m;
        const t = assistantTasks.find((u) => String(u.prompt || '') === String(m._taskInfo!.prompt));
        if (t?.imageUrl) {
          changed = true;
          return { ...m, imageUrl: t.imageUrl as string };
        }
        return m;
      });
      // Persist session immediately when image obtained (matching original)
      // Save from computed data to avoid ref timing issues
      if (changed) {
        // 用同一份裁剪函数，别在这里再抄一遍字段表（抄漏一个就是那个字段永远存不下来）
        saveAssistantSession(cleanMessages(synced), mode, selectionRef.current).catch(() => {});
      }
      return changed ? synced : prev;
    });
  }, [assistantTasks, mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Stop polling when no messages are submitting
  useEffect(() => {
    const hasSubmitting = messages.some((m) => m.cardState === 'submitting');
    if (!hasSubmitting && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = undefined;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = undefined;
      }
    };
  }, [messages]);

  // Stop polling when no messages are submitting
  useEffect(() => {
    const hasSubmitting = messages.some((m) => m.cardState === 'submitting');
    if (!hasSubmitting && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = undefined;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = undefined;
      }
    };
  }, [messages]);

  // ── Auto-generate (matching original: fetch library, match loras) ──
  const autoGenerate = useCallback(async (params: ReviewParams, msgIdx: number) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated[msgIdx]) updated[msgIdx] = { ...updated[msgIdx], reviewParams: params, cardState: 'submitting' };
      persistMessages(updated);
      return updated;
    });

    try {
      // 1. 组装 loras。
      //    后端已随 final 事件把完整资产（含 lora_path）回带过来，直接用即可 ——
      //    此前这里每次点「确认生成」都要拉一次 /api/library 全量（9.6MB / 26177 条），
      //    只为把 id 换成 lora_path。
      const selectedLoras: Record<string, unknown>[] = [];
      const toLora = (it: Record<string, unknown>) => ({
        kind: it.kind,
        type: it.type,
        tags: it.tags,
        lora_path: it.lora_path,
      });

      if (params.assets && params.assets.length > 0) {
        for (const a of params.assets) selectedLoras.push(toLora(a as unknown as Record<string, unknown>));
      } else if (params.character_id || params.style_id) {
        // 兜底：旧会话恢复出来的卡片没有 assets，仍按 id 查一次库
        const token = localStorage.getItem('forum-auth-token');
        const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
        const libResp = await fetch(`${baseUrl}/api/library?mode=${mode}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const library = libResp.ok ? await libResp.json() : { characters: [], styles: [] };
        const allAssets = [...(library.characters || []), ...(library.styles || [])];
        for (const id of [params.character_id, params.style_id]) {
          if (!id) continue;
          const match = allAssets.find((it: Record<string, unknown>) => it.id === id);
          if (match) selectedLoras.push(toLora(match));
        }
      }

      // 3. Build payload
      const payload: Record<string, unknown> = {
        direct_prompt: params.prompt,
        width: params.width,
        height: params.height,
        negative_prompt: params.negative_prompt || undefined,
        mode,
        source: 'assistant',
        loras: selectedLoras.length > 0 ? selectedLoras : undefined,
        ...(selectedLoras.length === 0 ? { workflow_path: `${mode}/通用/无Lora.json` } : {}),
      };

      const res = await addToQueue(payload);
      startPolling();

      // Create task from queue response (matching original flow)
      const task: Record<string, unknown> = {
        itemId: res.item_id,
        prompt: params.prompt,
        width: params.width,
        height: params.height,
        status: 'pending',
        position: res.position,
      };
      setAssistantTasks((prev) => [task, ...prev]);

      // Store on message (for session persistence and prompt-based matching)
      // 关键：在 updater 内用刚算出的数组落盘，避免读取尚未更新的 messagesRef
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[msgIdx]) {
          updated[msgIdx] = {
            ...updated[msgIdx],
            reviewParams: updated[msgIdx].reviewParams || params,
            cardState: 'done' as const,
            _taskInfo: task,
          };
        }
        persistMessages(updated);
        return updated;
      });

      if (onQueueUpdate) onQueueUpdate();
    } catch (e) {
      toast.error('生图入队失败', { description: e instanceof Error ? e.message : '' });
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[msgIdx]) updated[msgIdx] = { ...updated[msgIdx], cardState: 'failed' };
        persistMessages(updated);
        return updated;
      });
    }
  }, [mode, startPolling, onQueueUpdate, persistMessages]);

  // ── Handle send ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);
    setQuotedMsg(null);
    capturedToolCallRef.current = null;

    // 这一条消息实际带出去的角色/画风，快照到消息上并显示在气泡里。
    // 光发不显示的话，界面上是一句纯文本、AI 却知道是哪个角色，用户会以为见鬼了。
    // 只列真正发得出去的（payload 按 id 发，没有 id 的条目后端根本收不到）
    const sentAssets: ResolvedAsset[] = [
      ...charItems.filter((i) => i.id).map((i) => ({ id: i.id!, name: i.name, category: i.category, type: 'character' as const })),
      ...styleItems.filter((i) => i.id).map((i) => ({ id: i.id!, name: i.name, category: i.category, type: 'style' as const })),
    ];

    const userMsg: AssistantMessage = {
      role: 'user',
      content: text,
      ...(sentAssets.length > 0 ? { selectedAssets: sentAssets } : {}),
    };
    const assistantMsg: AssistantMessage = { role: 'assistant', content: '', thinking: '', steps: [], cardState: 'idle' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    const msgIdx = messages.length + 1; // index of the assistant message

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    try {
      // Build history from previous messages (matching original: exclude tool_call messages, last 6)
      const history = messagesRef.current
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
        .filter((m) => !m._taskInfo && !m.reviewParams)
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.thinking ? { thinking: m.thinking } : {}),
        }));

      const payload: Record<string, unknown> = {
        message: text,
        history,
        mode,
      };
      if (editContext) {
        payload.context = editContext;
      }
      // 用户在选择器里勾了什么，就明确告诉后端是哪一条 —— 后端按 id 精确取，
      // 并在 trigger_image_generation 时强制回填，不再依赖模型搜索猜测
      if (charItems.length > 0 || styleItems.length > 0) {
        payload.selection = {
          character_ids: charItems.map((i) => i.id).filter(Boolean),
          style_ids: styleItems.map((i) => i.id).filter(Boolean),
        };
      }

      const resp = await assistantChatRequest(payload);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || body.error || body.message || '请求失败');
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fullContent = '';
      let fullThinking = '';
      let finalData: Record<string, unknown> | null = null;
      let sseBuffer = '';

      setCurrentSteps([]);
      stepsRef.current = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          let trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            trimmed = trimmed.slice(6).trim();
          }
          if (!trimmed) continue;

          try {
            const evt = JSON.parse(trimmed);

            if (evt.type === 'reasoning') {
              fullThinking += (evt.content || '');
              setMessages((prev) => {
                const updated = [...prev];
                if (updated[msgIdx]) updated[msgIdx] = { ...updated[msgIdx], thinking: fullThinking };
                return updated;
              });
            }

            if (evt.type === 'content') {
              fullContent += (evt.content || '');
              setMessages((prev) => {
                const updated = [...prev];
                if (updated[msgIdx]) updated[msgIdx] = { ...updated[msgIdx], content: fullContent };
                return updated;
              });
            }

            if (evt.type === 'step') {
              if (evt.status === 'tool_call') {
                const step: AssistantStep = { icon: evt.icon || 'mdi:tool', text: evt.text || '', status: 'tool_call', done: false };
                stepsRef.current = [...stepsRef.current, step];
                setCurrentSteps([...stepsRef.current]);
              } else if (evt.status === 'tool_result') {
                const updated = stepsRef.current.map((s) =>
                  s.text === evt.text ? { ...s, status: 'tool_result' as const, done: true } : s
                );
                stepsRef.current = updated;
                setCurrentSteps([...updated]);
              }
              // Capture trigger_image_generation tool_call from step events
              if (evt.name === 'trigger_image_generation' && evt.tool_call) {
                capturedToolCallRef.current = evt.tool_call as Record<string, unknown>;
              }
            }

            if (evt.type === 'error') {
              throw new Error(evt.content || 'AI 助手处理出错');
            }

            if (evt.type === 'final') {
              finalData = evt;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // Process final event
      if (finalData) {
        const textContent = finalData.text as string || '';
        const toolCall = finalData.tool_call as Record<string, unknown> | undefined;
        const toolCalls = finalData.toolCalls as Record<string, unknown>[] | undefined;
        const llmCost = finalData.llm_cost as number || 0;
        const llmTokens = finalData.llm_tokens as number || 0;

        // Merge final text
        if (textContent) {
          fullContent = textContent;
        }

        // Check if trigger_image_generation was called
        const genToolCall = toolCall?.name === 'trigger_image_generation'
          ? toolCall
          : toolCalls?.find((tc) => tc.name === 'trigger_image_generation')
            ?? capturedToolCallRef.current;

        if (genToolCall) {
          const rawArgs = genToolCall.args;
          const args = (rawArgs ? (typeof rawArgs === 'string' ? JSON.parse(rawArgs as string) : rawArgs) : {}) as Record<string, unknown>;

          // Handle empty prompt
          if (!args.prompt || String(args.prompt).trim() === '') {
            setMessages((prev) => {
              const updated = [...prev];
              if (updated[msgIdx]) {
                updated[msgIdx] = { ...updated[msgIdx], cardState: 'failed' as const };
              }
              return updated;
            });
            setInput('你刚才调用了 trigger_image_generation 但 prompt 为空，请重新生成完整的英文提示词并再次调用。注意：prompt 参数必须填写！');
            setLoading(false);
            abortRef.current = null;
            return;
          }

          const resolvedAssets = Array.isArray(finalData.resolved_assets)
            ? (finalData.resolved_assets as ResolvedAsset[]).filter((a) => a && a.id)
            : [];

          const reviewParams: ReviewParams = {
            prompt: String(args.prompt || ''),
            negative_prompt: String(args.negative_prompt || ''),
            character_id: String(args.character_id || ''),
            style_id: String(args.style_id || ''),
            width: Number(args.width) || 0,
            height: Number(args.height) || 0,
            assets: resolvedAssets,
          };

          // Build review params and set cardState (matching original: submitting if autoApprove, else review)
          const newCardState = autoApprove ? 'submitting' as const : 'review' as const;

          setMessages((prev) => {
            const updated = [...prev];
            if (updated[msgIdx]) {
              updated[msgIdx] = {
                ...updated[msgIdx],
                content: fullContent,
                llmCost,
                llmTokens,
                steps: [...stepsRef.current],
                reviewParams,
                cardState: newCardState,
              };
            }
            persistMessages(updated);
            return updated;
          });

          // Auto-approve
          if (autoApprove) {
            autoGenerate(reviewParams, msgIdx);
          }
        } else {
          // No generation tool call
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[msgIdx]) {
              updated[msgIdx] = {
                ...updated[msgIdx],
                content: fullContent,
                llmCost,
                llmTokens,
                steps: [...stepsRef.current],
                cardState: 'idle',
              };
            }
            persistMessages(updated);
            return updated;
          });
        }
      }

      // Save session
      saveCurrentSession();

    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[msgIdx]) {
            updated[msgIdx] = { ...updated[msgIdx], content: (updated[msgIdx].content || '') + '\n\n*[已中断]*' };
          }
          return updated;
        });
      } else {
        toast.error('AI 助手处理失败', { description: e instanceof Error ? e.message : '' });
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[msgIdx]) {
            updated[msgIdx] = {
              ...updated[msgIdx],
              content: (updated[msgIdx].content || '') + '\n\n> ✕ ' + (e instanceof Error ? e.message : '未知错误'),
            };
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setCurrentSteps([]);
      stepsRef.current = [];
      saveCurrentSession();
    }
  }, [input, loading, mode, editContext, autoApprove, messages.length, autoGenerate, persistMessages, charItems, styleItems]);

  // ── Stop generation ──
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Clear chat ──
  const dismissTutorial = useCallback(() => {
    if (dontShowAgain) {
      try { localStorage.setItem('svaf_ai_assistant_tutorial_dismissed', 'true'); } catch {}
    } else {
      try { localStorage.removeItem('svaf_ai_assistant_tutorial_dismissed'); } catch {}
    }
    setTutorialOpen(false);
  }, [dontShowAgain]);

  const handleClear = useCallback(() => {
    setConfirmClear(true);
  }, []);

  const doClear = useCallback(() => {
    setMessages([{
      role: 'assistant',
      content: '你好！我是你的 AI绘图助手。你可以用自然语言告诉我你想画什么，我会帮你挑选最适合的角色 Lora、画风以及分辨率，并为你生成专属的生图卡片。比如你可以说："我想画一个原神的胡桃，赛博朋克风格，横屏尺寸"。',
    }]);
    setCurrentSteps([]);
    setEditContext(null);
    setQuotedMsg(null);
    setLibSelections({});   // 会话都清了，chip 不该还留着
    deleteAssistantSession().catch(() => {});
    setConfirmClear(false);
  }, []);

  // ── Match task from queue by prompt text (matching original) ──
  const getTaskForMsg = useCallback((msg: AssistantMessage): Record<string, unknown> | undefined => {
    // If message already has imageUrl, don't show stale task info
    if (msg.imageUrl) return undefined;
    const prompt = msg.reviewParams?.prompt;
    if (!prompt) return undefined;
    const found = assistantTasks.find(
      (t: Record<string, unknown>) => String(t.prompt || '') === prompt,
    );
    return found || msg._taskInfo;
  }, [assistantTasks]);

  // ── Edit context (modify generation) ──
  const handleEdit = useCallback((params: ReviewParams, quote: string) => {
    setEditContext(params);
    setQuotedMsg(quote);
  }, []);


  // ── Library selector confirm ──
  // 选择结果不再拼成中文塞进输入框（那样 AI 只能拿到「胡桃」二字再去猜），
  // 而是留成结构化条目、以 chip 形式显示，发送时按 id 直接告诉后端。
  // 选择变了就立刻落盘（不等下一条消息）—— selectionRef 要等 re-render 才更新，
  // 所以这里把新值显式传进去
  const persistSelection = useCallback((sel: { charItems: LibraryItem[]; styleItems: LibraryItem[] }) => {
    saveAssistantSession(cleanMessages(messagesRef.current), modeRef.current, sel).catch(() => {});
  }, []);

  const handleLibConfirm = useCallback(({ charItems: cItems, styleItems: sItems }: {
    charItems: LibraryItem[]; styleItems: LibraryItem[];
  }) => {
    const next = { charItems: cItems, styleItems: sItems };
    setLibSelections((prev) => ({ ...prev, [mode]: next }));
    persistSelection(next);
    setLibOpen(false);
  }, [mode, persistSelection]);

  // 移除单个已选资产（chip 上的 ×）
  const removeSelected = useCallback((id: string, type: 'character' | 'style') => {
    // 用 selectionRef 算新值再 set —— 别把网络请求写进 updater 里（Strict Mode 会跑两遍）
    const cur = selectionRef.current;
    const next = type === 'character'
      ? { ...cur, charItems: cur.charItems.filter((i) => (i.id ?? i.name) !== id) }
      : { ...cur, styleItems: cur.styleItems.filter((i) => (i.id ?? i.name) !== id) };
    setLibSelections((prev) => ({ ...prev, [mode]: next }));
    persistSelection(next);
  }, [mode, persistSelection]);

  // ── Keydown handler ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 bg-background' : 'h-[calc(100vh-260px)] min-h-[400px]'}`}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <Icon icon="mdi:robot-outline" className="size-5" />
          <span className="text-sm font-semibold">AI 绘图助手</span>
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 shadow-sm" onClick={() => setTutorialOpen(true)} title="AI助手使用教程">
            <Icon icon="mdi:help-circle-outline" className="size-3" />
            <span>使用教程</span>
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="size-8 p-0" title="清空对话" onClick={handleClear} disabled={messages.length === 0}>
            <Icon icon="mdi:delete-outline" className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" className="size-8 p-0" title="全屏" onClick={() => setFullscreen(!fullscreen)}>
            <Icon icon={fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} className="size-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b bg-muted/30">
        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer select-none">
          <Checkbox checked={autoApprove} onCheckedChange={(c) => setAutoApprove(c === true)} />
          自动批准
          <button onClick={(e) => { e.stopPropagation(); setHelpOpen(true); }} className="inline-flex items-center justify-center size-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground text-[9px] font-bold hover:border-primary hover:text-primary transition-colors shrink-0" title="关于自动批准">?</button>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer select-none">
          <Checkbox checked={alwaysScroll} onCheckedChange={(c) => setAlwaysScroll(c === true)} />
          始终滚动
        </label>

        <div className="flex-1" />

        <div className="flex border rounded overflow-hidden">
          <button
            onClick={() => !modeLocked && setMode('WAI')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${mode === 'WAI' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'hover:bg-foreground hover:text-background'} ${modeLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          >WAI</button>
          <button
            onClick={() => !modeLocked && setMode('ANIMA')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${mode === 'ANIMA' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'hover:bg-foreground hover:text-background'} ${modeLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
          >Anima</button>
        </div>

        <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => setLibOpen(true)}>
          {charItems.length + styleItems.length > 0 ? `已选 ${charItems.length + styleItems.length}` : '选角色/画风'}
        </Button>
        <LibrarySelector
          open={libOpen}
          onOpenChange={setLibOpen}
          mode={mode}
          onConfirm={handleLibConfirm}
          initialCharItems={charItems}
          initialStyleItems={styleItems}
        />
      </div>

      {/* Chat area */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative">
        {!sessionLoaded ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <Spinner className="size-5 mr-2" />
            加载会话中…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <Icon icon="mdi:robot-outline" className="size-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">告诉我你想画什么</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-foreground hover:text-background hover:border-foreground transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[75%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    {/* 这条消息随附的角色/画风 —— 不显示的话，界面上只有纯文本，
                        AI 却"凭空"知道了角色 */}
                    {msg.selectedAssets && msg.selectedAssets.length > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/25 flex flex-wrap gap-1">
                        {msg.selectedAssets.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary-foreground/15 max-w-full"
                            title={a.type === 'style' ? '画风' : '角色'}
                          >
                            <Icon icon={a.type === 'style' ? 'mdi:palette-outline' : 'mdi:account-outline'} className="size-3 shrink-0" />
                            <span className="truncate">{a.category ? `${a.name} · ${a.category}` : a.name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-2">
                    {/* Thinking block */}
                    {msg.thinking && (
                      <details className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-1.5">
                        <summary className="cursor-pointer font-medium">思考过程</summary>
                        <p className="mt-1 whitespace-pre-wrap">{msg.thinking}</p>
                      </details>
                    )}

                    {/* Steps */}
                    {msg.steps && msg.steps.length > 0 && (
                      <div className="space-y-1">
                        {msg.steps.map((step, j) => (
                          <div key={j} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {step.done ? (
                              <Icon icon="mdi:check-circle" className="size-3.5 text-green-500" />
                            ) : (
                              <Icon icon={step.icon as string} className="size-3.5" />
                            )}
                            <span>{step.text}</span>
                          </div>
                        ))}
                        {/* Active steps during loading */}
                        {i === messages.length - 1 && loading && currentSteps.length > 0 && msg.cardState === 'idle' && (
                          <div className="space-y-1">
                            {currentSteps.filter((s) => !s.done).map((step, j) => (
                              <div key={j} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Spinner className="size-3.5" />
                                <span>{step.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content */}
                    {msg.content && (
                      <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
                        <div className="text-sm whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                      </div>
                    )}

                    {/* ── Generation Card (review / submitting / done-with-status) ── */}
                    {msg.reviewParams && (() => {
                      const args = msg.reviewParams!;
                      const task = getTaskForMsg(msg);

                      if (msg.cardState === 'review') {
                        return (
                          <ReviewCardInline
                            args={args}
                            msgIdx={i}
                            onAutoGenerate={autoGenerate}
                            onContinueDiscuss={(a) => { setEditContext(a); setQuotedMsg('调整生图参数'); }}
                          />
                        );
                      }

                      if (msg.cardState === 'submitting') {
                        {/* ── Submitting Card ── */}
                        return (
                          <div className="border-t border-border/20 pt-2 space-y-2">
                            <div className="bg-background rounded-lg border p-3 shadow-sm space-y-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                                  <Icon icon="mdi:palette-swatch-outline" className="size-4" />
                                  智能生图方案
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded border text-muted-foreground">{args.width || '?'} × {args.height || '?'}</span>
                              </div>

                              <div className="space-y-1">
                                <div className="text-[11px] text-muted-foreground font-medium">提示词</div>
                                <div className="text-xs bg-muted/40 p-2 rounded border font-mono break-all max-h-20 overflow-y-auto">{args.prompt}</div>
                              </div>

                              {args.negative_prompt && (
                                <div className="space-y-1">
                                  <div className="text-[11px] text-muted-foreground/60 font-medium">负面提示词</div>
                                  <div className="text-xs bg-destructive/5 p-2 rounded border border-destructive/10 font-mono break-all max-h-16 overflow-y-auto text-muted-foreground/80">{args.negative_prompt}</div>
                                </div>
                              )}

                              <AssetChips args={args} />

                              <div className="flex items-center justify-center py-1">
                                <span className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                                  <Spinner className="size-4" />
                                  正在提交到队列...
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      {/* ── Done / Task Progress Card ── */}
                      return (
                        <div className="border-t border-border/20 pt-2 space-y-2">
                          <div className="bg-background rounded-lg border p-3 shadow-sm space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                                <Icon icon="mdi:palette-swatch-outline" className="size-4" />
                                智能生图方案
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded border text-muted-foreground">{args.width || '?'} × {args.height || '?'}</span>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground font-medium">提示词</div>
                              <div className="text-xs bg-muted/40 p-2 rounded border font-mono break-all max-h-20 overflow-y-auto">{args.prompt}</div>
                            </div>

                            {args.negative_prompt && (
                              <div className="space-y-1">
                                <div className="text-[11px] text-muted-foreground/60 font-medium">负面提示词</div>
                                <div className="text-xs bg-destructive/5 p-2 rounded border border-destructive/10 font-mono break-all max-h-16 overflow-y-auto text-muted-foreground/80">{args.negative_prompt}</div>
                              </div>
                            )}

                            {/* 读这条消息自己的 assets —— 此前读的是选择器的当前状态，
                                换一次选择，之前所有历史卡片的标签会跟着一起变 */}
                            <AssetChips args={args} />

                            {/* Inline Task Progress — skip stale task if msg already has image */}
                            {task && !msg.imageUrl ? (
                              <div className="border-t border-border/20 pt-2 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-mono text-muted-foreground">#{String(task.itemId || task.id || '')}</span>
                                  {['waiting', 'pending'].includes(String(task.status || '')) ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border text-amber-600 border-amber-600/20 bg-amber-500/5 animate-pulse">
                                      排队中 {(task.position != null ? `(${task.position}位)` : '')}
                                    </span>
                                  ) : String(task.status) === 'running' ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border text-primary border-primary/20 bg-primary/5 inline-flex items-center gap-1">
                                      <Spinner className="size-3" />
                                      正在生成
                                    </span>
                                  ) : String(task.status) === 'done' || String(task.status) === 'success' ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border text-green-600 border-green-600/20 bg-green-500/5 inline-flex items-center gap-1">
                                      <Icon icon="mdi:check" className="size-3" />
                                      完成
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border text-destructive border-destructive/20 bg-destructive/5 inline-flex items-center gap-1">
                                      <Icon icon="mdi:close" className="size-3" />
                                      失败
                                    </span>
                                  )}
                                </div>

                                {/* Image from task (matching original: task.imageUrl) */}
                                {(String(task.status || '') === 'done' || String(task.status) === 'success') && task.imageUrl ? (
                                  <>
                                    <div className="rounded-lg overflow-hidden border bg-muted/30 shadow-sm" style={{ aspectRatio: `${task.width || 896}/${task.height || 1152}`, maxHeight: 400 }}>
                                      <img key={aiImageRefresh} src={`${task.imageUrl as string}&_t=${aiImageRefresh}`} alt="Result" className="w-full h-full object-contain" loading="lazy" />
                                    </div>
                                    <div className="flex items-center gap-2 pt-1">
                                      <button
                                        onClick={() => setAiImageRefresh((v) => v + 1)}
                                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        title="刷新图片"
                                      >
                                        <Icon icon="mdi:refresh" className="size-3.5" />
                                        刷新图片
                                      </button>
                                      <a href={task.imageUrl as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                        <Icon icon="mdi:open-in-new" className="size-3.5" />
                                        查看原图
                                      </a>
                                      <button onClick={() => handleEdit(args, '编辑这张图')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                        <Icon icon="mdi:pencil" className="size-3.5" />
                                        编辑
                                      </button>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            ) : msg.imageUrl ? (
                              <>
                                <div className="rounded-lg overflow-hidden border bg-muted/30 shadow-sm" style={{ aspectRatio: `${args.width || 896}/${args.height || 1152}`, maxHeight: 400 }}>
                                  <a href={`${msg.imageUrl}&_t=${aiImageRefresh}`} target="_blank" rel="noopener noreferrer">
                                    <img key={aiImageRefresh} src={`${msg.imageUrl}&_t=${aiImageRefresh}`} alt="Result" className="w-full h-full object-contain" loading="lazy" />
                                  </a>
                                </div>
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    onClick={() => setAiImageRefresh((v) => v + 1)}
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    title="刷新图片"
                                  >
                                    <Icon icon="mdi:refresh" className="size-3.5" />
                                    刷新图片
                                  </button>
                                  <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    <Icon icon="mdi:open-in-new" className="size-3.5" />
                                    查看原图
                                  </a>
                                  <button onClick={() => handleEdit(args, '编辑这张图')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    <Icon icon="mdi:pencil" className="size-3.5" />
                                    编辑
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="flex justify-end pt-1">
                                <span className="inline-flex items-center gap-1 text-xs text-green-600 border border-green-600/30 bg-green-500/5 rounded px-2 py-1">
                                  <Icon icon="mdi:check-circle-outline" className="size-4" />
                                  已提交生图
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* ── End Generation Card ── */}

                    {/* Failed */}
                    {msg.cardState === 'failed' && (
                      <div className="text-xs text-red-500 flex items-center gap-1">
                        <Icon icon="mdi:alert-circle" className="size-3.5" />
                        生图失败
                      </div>
                    )}

                    {/* LLM cost */}
                    {(msg.llmCost || msg.llmTokens) && (
                      <div className="text-[10px] text-muted-foreground text-right">
                        {msg.llmTokens ? `${msg.llmTokens} tokens` : ''}
                        {msg.llmCost ? <span className="inline-flex items-center ml-1"><Icon icon="mdi:lightning-bolt" className="size-3" />{msg.llmCost}</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t bg-background px-4 py-2 space-y-1">
        {/* 已选资产 —— 这是发给 AI 的确定事实（按 id），不是输入框里可被误删的一段文字 */}
        {(charItems.length > 0 || styleItems.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="text-muted-foreground shrink-0">已选</span>
            {[
              ...charItems.map((i) => ({ item: i, type: 'character' as const, icon: 'mdi:account-outline' })),
              ...styleItems.map((i) => ({ item: i, type: 'style' as const, icon: 'mdi:palette-outline' })),
            ].map(({ item, type, icon }) => {
              const key = item.id ?? item.name;
              return (
                <span key={key} className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border max-w-[220px]">
                  <Icon icon={icon} className="size-3 shrink-0" />
                  <span className="truncate">{item.category ? `${item.name} · ${item.category}` : item.name}</span>
                  <button
                    onClick={() => removeSelected(key, type)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="取消选择"
                  >
                    <Icon icon="mdi:close" className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Quoted message indicator */}
        {quotedMsg && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-1.5">
            <Icon icon="mdi:reply" className="size-3.5" />
            <span>{quotedMsg}</span>
            <button onClick={() => { setEditContext(null); setQuotedMsg(null); }} className="ml-auto text-muted-foreground hover:text-foreground">
              <Icon icon="mdi:close" className="size-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={editContext ? '进一步调整参数…' : '告诉我你想画什么…'}
            rows={2}
            disabled={loading}
            className="flex-1 resize-none min-h-[36px] max-h-[120px]"
          />
          {loading ? (
            <Button size="sm" variant="destructive" onClick={handleStop} className="shrink-0 h-9">
              <Icon icon="mdi:stop" className="size-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleSend} disabled={!input.trim() || loading} className="shrink-0 h-9">
              <Icon icon="mdi:send" className="size-4" />
            </Button>
          )}
        </div>
      </div>

<Dialog.Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.DialogContent className="max-w-md">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle>自动批准</Dialog.DialogTitle>
            <div className="text-sm leading-relaxed space-y-2">
              <div>开启<strong>自动批准</strong>后，当 AI 助手为您配置完生图提示词与比例参数时，将<strong>自动提交任务</strong>至后台生图队列，无需您在聊天框内再次点击“确认生成”卡片。</div>
              <div className="bg-muted p-2 rounded text-xs text-muted-foreground">
                <strong>提示：</strong>自动批准机制不会影响您的正常编辑。在自动提交后，您仍可在右侧任务队列中随时查看进度或取消任务。
              </div>
            </div>
          </Dialog.DialogHeader>
        </Dialog.DialogContent>
      </Dialog.Dialog>

      {/* Tutorial Dialog */}
      <Dialog.Dialog open={tutorialOpen} onOpenChange={setTutorialOpen}>
        <Dialog.DialogContent className="max-w-md max-h-[85dvh] flex flex-col p-0 overflow-hidden">
          <Dialog.DialogHeader className="p-5 pb-3 border-b shrink-0">
            <Dialog.DialogTitle className="flex items-center gap-1.5 text-lg font-bold">AI绘图助手使用教程</Dialog.DialogTitle>
          </Dialog.DialogHeader>
          <div className="flex-1 overflow-y-auto p-5 py-3 min-h-0">
            <div className="text-sm leading-relaxed text-left text-foreground">
              <div className="space-y-4">
                <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-lg flex items-center justify-between gap-2 shadow-sm">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Icon icon="mdi:video-play" className="size-4 text-red-500" />
                      <span>AI绘图助手视频教程</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">新手 1 分钟快速上手 AI 助手核心功能</div>
                  </div>
                  <a href="https://www.bilibili.com/video/BV1kCjH63EEe/" target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors shadow-sm">
                    立即播放
                  </a>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-primary flex items-center gap-1">1. 用自然语言“说人话”</h4>
                  <p className="text-xs text-muted-foreground pl-5">你不需要学习烦杂的英文画图标签，也无需手动拼接提示词。只需像聊天一样直接告诉 AI 助手你的想法，支持全中文输入。</p>
                  <p className="text-xs text-muted-foreground pl-5 bg-muted/50 p-1.5 rounded italic">例：“帮我画一个原神的胡桃，赛博朋克画风，要横屏高清的”</p>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-primary flex items-center gap-1">2. 快捷选择角色/画风</h4>
                  <p className="text-xs text-muted-foreground pl-5">觉得手动用文字描述角色或画风太麻烦？你可以直接点击右上角的【选角色/画风】按钮。在库中勾选好后点击确认，所选条目会显示在输入框上方，AI 会直接收到你选的<strong>是哪一条</strong>（而不是靠名字去搜）——库里同名角色很多，这样能确保用对。不想要了点标签上的 × 即可取消。</p>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-primary flex items-center gap-1">3. 自动匹配并生成配置卡片</h4>
                  <p className="text-xs text-muted-foreground pl-5">AI 助手会自动解析你的需求，自动从库中为你匹配适合的角色 LoRA 模型、画风风格、分辨率和出图尺寸，并以消息卡片的形式呈现。</p>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-primary flex items-center gap-1">4. 一键确认与快捷生成</h4>
                  <p className="text-xs text-muted-foreground pl-5">卡片生成后，你可以仔细核对。直接点击【确认生成】即可将任务提交至后台队列。如果你想进行微调，也可直接在卡片上修改提示词或参数后再提交。</p>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-primary flex items-center gap-1">5. 图片永久保存</h4>
                  <p className="text-xs text-muted-foreground pl-5">所有通过 AI 助手生成的图片都将永久保存在【我的】页面中。点击右上角的垃圾桶按钮仅会清空当前的聊天对话记录，并不会删除您已经生成的任何图片，请放心使用。</p>
                </div>
                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <h4 className="font-semibold text-primary flex items-center gap-1">6. 添加新画风/角色</h4>
                  <p className="text-xs text-muted-foreground pl-5">如果您在库中找不到所需的角色/画风，可以提交申请。审核通过后将自动下载并收录供大家使用。详情请参考视频教程：</p>
                  <div className="pl-5 space-y-1 mt-1">
                    <a href="https://www.bilibili.com/video/BV14ajH6UE1x/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Icon icon="mdi:video-play-outline" className="size-3.5 text-red-500" />
                      <span>AI画图站新增角色Lora教程</span>
                    </a>
                    <a href="https://www.bilibili.com/video/BV1KajH6UEXt/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Icon icon="mdi:video-play-outline" className="size-3.5 text-red-500" />
                      <span>AI画图站新增画风Lora教程</span>
                    </a>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <h4 className="font-semibold text-amber-500 flex items-center gap-1">小巧门：开启“自动批准”</h4>
                  <p className="text-xs text-muted-foreground pl-5">如果你对 AI 的选择非常信任，可以打开输入框上方的“自动批准”开关。这样 AI 助手配置完参数后会<strong>直接为您提交后台生成</strong>，无需每次手动确认，出图更高效！</p>
                </div>
                <div className="border-t border-border/40 pt-3 space-y-2">
                  <div className="flex items-center gap-2 select-none cursor-pointer">
                    <Checkbox checked={dontShowAgain} onCheckedChange={(c) => { const v = c === true; setDontShowAgain(v); if (v) { try { localStorage.setItem('svaf_ai_assistant_tutorial_dismissed', 'true'); } catch {} } else { try { localStorage.removeItem('svaf_ai_assistant_tutorial_dismissed'); } catch {} } }} id="dont-show-again" />
                    <label htmlFor="dont-show-again" className="text-xs text-muted-foreground select-none cursor-pointer">下次不再自动显示</label>
                  </div>
                  {dontShowAgain && (
                    <div className="text-xs text-amber-500 font-medium pl-5">
                      提示：已设置下次不再自动弹出。如果以后想再次查看教程，可随时点击“使用教程”按钮。</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="p-5 pt-3 border-t shrink-0">
            <Button size="sm" className="w-full" onClick={dismissTutorial}>知道了</Button>
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>

      {/* Confirm Clear Dialog */}
      <Dialog.Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <Dialog.DialogContent className="max-w-sm">
          <Dialog.DialogHeader>
            <Dialog.DialogTitle>清空对话</Dialog.DialogTitle>
            <Dialog.DialogDescription>确定要清空所有对话吗？</Dialog.DialogDescription>
          </Dialog.DialogHeader>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button size="sm" variant="destructive" onClick={doClear}>清空</Button>
          </div>
        </Dialog.DialogContent>
      </Dialog.Dialog>
    </div>
  );
}

// ─── Review Card Inline Component (editable) ───
function ReviewCardInline({ args, msgIdx, onAutoGenerate, onContinueDiscuss }: {
  args: ReviewParams;
  msgIdx: number;
  onAutoGenerate: (params: ReviewParams, idx: number) => void;
  onContinueDiscuss: (params: ReviewParams) => void;
}) {
  const [prompt, setPrompt] = useState(args.prompt);
  const [negPrompt, setNegPrompt] = useState(args.negative_prompt || '');
  const [w, setW] = useState(args.width || 896);
  const [h, setH] = useState(args.height || 1152);

  return (
    <div className="border-t border-border/20 pt-2 space-y-2">
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 rounded-lg p-3 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <Icon icon="mdi:clipboard-text-outline" className="size-4" />
            审核生图参数
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400">等待确认</span>
        </div>
        <p className="text-[11px] text-muted-foreground">请确认以下参数，满意后点击「确认生成」；如需修改可编辑文本框或点「继续讨论」让AI调整。</p>

        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground font-medium">正向提示词</div>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className="px-2 py-1 text-xs font-mono resize-none" />
        </div>

        {args.negative_prompt && (
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground/60 font-medium">反向提示词</div>
            <Textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} rows={1} className="px-2 py-1 text-xs font-mono resize-none" />
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <AssetChips args={args} inline />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>宽:</span>
            <input type="number" value={w} onChange={(e) => setW(Number(e.target.value) || 0)} className="w-16 text-xs bg-background border rounded px-1.5 py-0.5 text-center" min={256} max={2048} step={64} />
            <span>高:</span>
            <input type="number" value={h} onChange={(e) => setH(Number(e.target.value) || 0)} className="w-16 text-xs bg-background border rounded px-1.5 py-0.5 text-center" min={256} max={2048} step={64} />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="text-xs" onClick={() => onContinueDiscuss(args)}>
            <Icon icon="mdi:message-outline" className="size-3.5 mr-1" />
            继续讨论
          </Button>
          <Button size="sm" className="text-xs" onClick={() => {
            const modified: ReviewParams = { ...args, prompt, negative_prompt: negPrompt, width: w, height: h };
            onAutoGenerate(modified, msgIdx);
          }}>
            <Icon icon="mdi:check" className="size-3.5 mr-1" />
            确认生成
          </Button>
        </div>
      </div>

      {/* Help Dialog */}
      
    </div>
  );
}
