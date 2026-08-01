'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { LibrarySelector } from '@/components/draw/library-selector';
import { mediaTokenParam, useMediaToken, withFreshMediaToken } from '@/lib/draw/media-token';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import {
  chatRequest, fetchChatPresets, saveChatPreset, deleteChatPreset,
  fetchChatHistory, appendChatHistory, clearChatHistory, deleteChatHistoryAt,
  addToQueue, fetchMyQueue, ttsSynthesize,
  type ChatPreset,
} from '@/lib/draw/api/client';

interface ChatMessage {
  /** 稳定 id：撤回会让下标整体前移，所有异步回填（流式、生图轮询）只能按 id 找人 */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  imageUrls?: string[];
  pendingImages?: { itemId: string; status: string }[];
  ttsUrl?: string;
  /** 已落到服务端聊天记录里 —— 撤回时才需要连带删服务端那条 */
  persisted?: boolean;
  /** 发送失败的占位气泡：不进上下文，也没落过盘 */
  failed?: boolean;
}

const POLL_INTERVAL = 3000;
const STORAGE_KEY = 'draw-saloon';

let msgSeq = 0;
function newMsgId() {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** 会话上下文 = 现存消息去掉失败占位与空气泡。撤回过的消息已不在 messages 里，自然不会再拼进去 */
function toHistory(messages: ChatMessage[]) {
  return messages
    .filter((m) => !m.failed && m.content.trim())
    .map((m) => ({ role: m.role as string, content: m.content }));
}

/**
 * 撤回按钮：常驻显示，不做 hover 才现身。
 * 触屏上没有 hover，藏起来等于没有；而这个功能就是给「说错话了赶紧收回」用的。
 */
function WithdrawButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="撤回这条消息（不再作为上下文发给模型）"
      aria-label="撤回这条消息"
      className="mt-1 size-6 shrink-0 flex items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-30 disabled:pointer-events-none"
    >
      <Icon icon="mdi:undo-variant" className="size-3.5" />
    </button>
  );
}

export function SaloonTab({ onQueueUpdate }: { onQueueUpdate?: () => void }) {
  // 订阅媒体令牌：图片/音频 URL 存进 state 后，token 换新时靠它触发重渲染补 mt
  useMediaToken();
  // ── System prompt / Presets ──
  const [presets, setPresets] = useState<ChatPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [presetOpen, setPresetOpen] = useState(true);

  // ── Chat ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Settings ──
  const [saloonMode, setSaloonMode] = useState<'WAI' | 'ANIMA'>('WAI');
  const [genEnabled, setGenEnabled] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // ── LibrarySelector ──
  const [charSelectorOpen, setCharSelectorOpen] = useState(false);
  const [saloonCharTags, setSaloonCharTags] = useState('');
  const [saloonCharName, setSaloonCharName] = useState('');
  const [saloonStyleTags, setSaloonStyleTags] = useState('');
  const [saloonStyleName, setSaloonStyleName] = useState('');

  // ── Queue polling ── itemId → 该图要回填到哪条消息（按 id，不按下标）
  const [pendingItemIds, setPendingItemIds] = useState<Map<string, string>>(new Map());
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  /** messages 的镜像：sendMessage / handleWithdraw 需要读到最新一份，而不是闭包里的旧值 */
  const messagesRef = useRef<ChatMessage[]>([]);

  // ── Cost tracking ──
  const [llmTokens, setLlmTokens] = useState(0);
  const [llmCost, setLlmCost] = useState(0);
  const [genCount, setGenCount] = useState(0);
  const [genCost, setGenCost] = useState(0);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesRef.current = messages;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load presets on mount
  useEffect(() => {
    fetchChatPresets().then((res) => setPresets(res.items || [])).catch(() => {});
    fetchChatHistory().then((data) => {
      if (data?.items?.length) {
        const restored: ChatMessage[] = data.items.map((m) => ({
          id: newMsgId(),
          role: m.role as 'user' | 'assistant',
          content: m.content,
          imageUrls: [],
          pendingImages: [],
          persisted: true,
        }));
        messagesRef.current = restored;
        setMessages(restored);
      }
    }).catch(() => {});
    // Restore saloon state from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.systemPrompt) setSystemPrompt(String(parsed.systemPrompt));
        if (parsed.presetName) setPresetName(String(parsed.presetName));
        if (parsed.saloonMode) setSaloonMode(parsed.saloonMode);
        if (parsed.genEnabled !== undefined) setGenEnabled(parsed.genEnabled);
      }
    } catch {}
  }, []);

  const saveState = useCallback((overrides?: Record<string, unknown>) => {
    try {
      const data = { systemPrompt, presetName, saloonMode, genEnabled, ...overrides };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, [systemPrompt, presetName, saloonMode, genEnabled]);

  // ── Preset handlers ──
  const handleSavePreset = useCallback(async () => {
    if (!presetName.trim() || !systemPrompt.trim()) return;
    try {
      await saveChatPreset(presetName, systemPrompt);
      const updated = await fetchChatPresets();
      setPresets(updated.items || []);
      toast.success('预设已保存');
    } catch (e) {
      toast.error('保存预设失败', { description: e instanceof Error ? e.message : '' });
    }
  }, [presetName, systemPrompt]);

  const handleDeletePreset = useCallback(async (id: string) => {
    try {
      await deleteChatPreset(id);
      setPresets((p) => p.filter((x) => x.id !== id));
      toast.success('预设已删除');
    } catch (e) {
      toast.error('删除预设失败', { description: e instanceof Error ? e.message : '' });
    }
  }, []);

  const handleNewPreset = useCallback(() => {
    setPresetName('');
    setSystemPrompt('');
  }, []);

  const handleClearChat = useCallback(async () => {
    messagesRef.current = [];
    setMessages([]);
    setLlmTokens(0);
    setLlmCost(0);
    setGenCount(0);
    setGenCost(0);
    try {
      await clearChatHistory();
    } catch {}
  }, []);

  // ── 撤回单条消息 ──
  // 移出 messages 即移出上下文（toHistory 只读现存消息），落过盘的还要连带删服务端那条，
  // 否则刷新页面它又被 fetchChatHistory 拉回来。
  const handleWithdraw = useCallback(async (id: string) => {
    const list = messagesRef.current;
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return;
    const target = list[i];

    // 服务端下标 = 它前面有多少条落过盘的（失败占位不在服务端，不能算进去）
    const serverIndex = target.persisted
      ? list.slice(0, i).filter((m) => m.persisted).length
      : -1;

    // 同步推进镜像，连点两下时第二次才算得对下标
    messagesRef.current = list.filter((m) => m.id !== id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    // 这条消息上挂着的生图任务不用再等了
    setPendingItemIds((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [itemId, msgId] of prev) {
        if (msgId === id) { next.delete(itemId); changed = true; }
      }
      return changed ? next : prev;
    });

    if (serverIndex < 0) {
      toast.success('已撤回');
      return;
    }
    try {
      await deleteChatHistoryAt(serverIndex, target.role, target.content);
      toast.success('已撤回');
    } catch (e) {
      toast.error('已从当前会话移除，但未能同步到服务器', {
        description: e instanceof Error ? e.message : '刷新页面后这条可能会回来',
      });
    }
  }, []);

  // ── Queue polling ──
  const startQueuePolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const raw = await fetchMyQueue();
        const queue = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.items as Record<string, unknown>[]) || [];
        setPendingItemIds((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [itemId, msgId] of prev) {
            const item = queue.find((q: Record<string, unknown>) => String(q.id) === itemId);
            if (!item) continue;
            const status = String(item.status || 'pending');
            if (status === 'done' || status === 'failed') {
              next.delete(itemId);
              changed = true;
              // Track gen cost
              const cost = Number(item.cost || item.points_cost || 0);
              if (status === 'done' && cost > 0) {
                setGenCount((c) => c + 1);
                setGenCost((c) => c + cost);
              }
              // Update message with result（消息可能已被撤回，找不到就当没发生）
              setMessages((msgs) => msgs.map((m) => {
                if (m.id !== msgId) return m;
                const msg = { ...m };
                msg.pendingImages = (msg.pendingImages || []).filter((p) => p.itemId !== itemId);
                if (status === 'done') {
                  const files = (item._output_files as string[]) || [];
                  if (files[0]) {
                    const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
                    // 图片 URL 必须带媒体令牌：/api/output/file 只认 mt，不带就是 401
                    const imgUrl = files[0].startsWith('http')
                      ? files[0]
                      : `${baseUrl}${files[0].startsWith('/') ? '' : '/'}${files[0]}${mediaTokenParam()}`;
                    msg.imageUrls = [...(msg.imageUrls || []), imgUrl];
                  }
                }
                return msg;
              }));
            }
          }
          if (!changed) return prev;
          return next;
        });
      } catch {}
    }, POLL_INTERVAL);
  }, []);

  // Stop polling when no pending items
  useEffect(() => {
    if (pendingItemIds.size === 0 && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = undefined;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = undefined;
      }
    };
  }, [pendingItemIds.size]);

  // ── Submit gen job (called when SSE receives gen_tags) ──
  const submitGenJob = useCallback(async (tags: string, msgId: string) => {
    try {
      const prompt = [saloonCharTags, tags].filter(Boolean).join(', ');
      const payload: Record<string, unknown> = {
        direct_prompt: prompt,
        source: 'saloon',
        mode: saloonMode,
      };
      if (saloonStyleTags) payload.style_tags = saloonStyleTags;
      const result = await addToQueue(payload);
      if (result.item_id) {
        setPendingItemIds((prev) => {
          const next = new Map(prev);
          next.set(String(result.item_id), msgId);
          return next;
        });
        startQueuePolling();
        setMessages((msgs) => msgs.map((m) => (
          m.id === msgId
            ? { ...m, pendingImages: [...(m.pendingImages || []), { itemId: String(result.item_id), status: 'pending' }] }
            : m
        )));
      }
    } catch {}
  }, [saloonCharTags, saloonStyleTags, saloonMode, startQueuePolling]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!systemPrompt.trim()) {
      toast.error('请先填写角色扮演设定');
      return;
    }

    setInput('');
    setSending(true);
    setErrorText('');

    // Add user message + placeholder assistant message
    const userMsg: ChatMessage = { id: newMsgId(), role: 'user', content: text, imageUrls: [], pendingImages: [] };
    const assistantMsg: ChatMessage = { id: newMsgId(), role: 'assistant', content: '', streaming: true, imageUrls: [], pendingImages: [] };
    const idx = assistantMsg.id; // 后续所有回填都按 id 找人，撤回导致的下标位移伤不到它

    // 上下文由现存消息现算 —— 撤回掉的消息已经不在里面了
    const currentHistory = [...toHistory(messagesRef.current), { role: 'user', content: text }];

    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg];
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Persist user message
    try {
      await appendChatHistory([{ role: 'user', content: text }]);
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, persisted: true } : m)));
    } catch {}

    try {
      const payload: Record<string, unknown> = {
        message: text,
        system_prompt: systemPrompt,
        gen_enabled: genEnabled,
        mode: saloonMode.toLowerCase(),
        history: currentHistory.slice(-40),
      };
      if (saloonStyleTags) payload.style_tags = saloonStyleTags;
      if (saloonCharTags) payload.workflow_prompt = saloonCharTags;

      const resp = await chatRequest(payload);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || body.error || body.message || '请求失败');
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fullText = '';
      let textContent = '';
      let genTags = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.content !== undefined) {
                fullText += parsed.content;
                textContent += parsed.content;
                setMessages((prev) => prev.map((m) => (
                  m.id === idx ? { ...m, content: m.content + (parsed.content || '') } : m
                )));
              }
              if (parsed.type === 'gen_tags' && parsed.tags) {
                genTags = parsed.tags;
              }
              if (parsed.gen_tags) {
                genTags = parsed.gen_tags;
              }
              if (parsed.type === 'error' && parsed.content) {
                setErrorText(parsed.content);
              }
              if (parsed.type === 'done') {
                if (parsed.llm_tokens) setLlmTokens((p) => p + parsed.llm_tokens);
                if (parsed.llm_cost) setLlmCost((p) => p + parsed.llm_cost);
              }
            } catch {}
          }
        }
      }

      // Done streaming
      setMessages((prev) => prev.map((m) => (m.id === idx ? { ...m, streaming: false } : m)));

      // Submit gen job if we got tags
      if (genTags && genEnabled) {
        submitGenJob(genTags, idx);
      }

      // Persist assistant message
      const assistantContent = genTags ? textContent : fullText;
      if (assistantContent.trim()) {
        try {
          await appendChatHistory([{ role: 'assistant', content: assistantContent }]);
          setMessages((prev) => prev.map((m) => (m.id === idx ? { ...m, persisted: true } : m)));
        } catch {}
      }

      // TTS
      if (ttsEnabled && textContent.trim()) {
        try {
          const result = await ttsSynthesize({ text: textContent, source: 'saloon' });
          if (result.audio_url) {
            setMessages((prev) => prev.map((m) => (m.id === idx ? { ...m, ttsUrl: result.audio_url } : m)));
          }
        } catch {}
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : '发送失败');
      setMessages((prev) => prev.map((m) => (
        m.id === idx
          ? { ...m, streaming: false, content: m.content || '（发送失败）', failed: !m.content }
          : m
      )));
    } finally {
      setSending(false);
    }
  }, [input, sending, systemPrompt, genEnabled, saloonMode, saloonCharTags, saloonStyleTags, ttsEnabled, submitGenJob]);

  // ── Keydown handler ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // ── LibrarySelector confirm ──
  const handleLibConfirm = useCallback(({ tags, names, styleTags, styleName }: { tags: string; names: string; styleTags?: string; styleName?: string }) => {
    setSaloonCharTags(tags);
    setSaloonCharName(names);
    if (styleTags) setSaloonStyleTags(styleTags);
    if (styleName) setSaloonStyleName(styleName);
    setGenEnabled(true);
    setCharSelectorOpen(false);
  }, []);

  const hasChar = !!saloonCharName;
  const hasStyle = !!saloonStyleName;

  return (
    <div className="h-[calc(100vh-260px)] min-h-[400px] flex flex-col space-y-3">
      {/* Preset Panel */}
      <div className="shrink-0">
        <button onClick={() => setPresetOpen(!presetOpen)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
          <Icon icon={presetOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'} className="size-4" />
          角色扮演设定
          {presetName && <span className="ml-1 text-[10px] px-1 py-0 rounded bg-secondary text-secondary-foreground">{presetName}</span>}
        </button>

        {presetOpen && (
          <div className="mt-2 space-y-2 pl-5 border-l-2 border-muted">
            {/* Preset selector */}
            <div className="flex gap-2">
              <NativeSelect
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const p = presets.find((x) => x.id === e.target.value);
                  // 兜一层 ?? ''：setSystemPrompt(undefined) 会让下一帧的 .trim() 直接把整页打成 Application Error
                  if (p) { setPresetName(p.name ?? ''); setSystemPrompt(p.systemPrompt ?? ''); }
                }}
                className="flex-1"
                size="sm"
              >
                <NativeSelectOption value="">从预设加载…</NativeSelectOption>
                {presets.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            {/* Preset name */}
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="预设名称（如：遐蝶）"
              className="h-8 text-xs"
            />

            {/* System prompt */}
            <Textarea
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); saveState({ systemPrompt: e.target.value }); }}
              placeholder="你正在扮演遐蝶。你是一个…"
              rows={2}
              className="text-xs resize-none min-h-[52px]"
            />

            {/* Actions */}
            <div className="flex gap-2">
              {/* 渲染路径上的 .trim() 一旦碰到 undefined 就是整页 Application Error，这里不省这两个 || '' */}
              <Button size="sm" onClick={handleSavePreset} disabled={!(presetName || '').trim() || !(systemPrompt || '').trim()}>保存预设</Button>
              <Button size="sm" variant="outline" onClick={handleNewPreset}>新建</Button>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={handleClearChat}>清空聊天</Button>
            </div>
          </div>
        )}
      </div>

      {/* Mode + Library Selector */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex border rounded-lg overflow-hidden">
          <button
            onClick={() => { setSaloonMode('WAI'); saveState({ saloonMode: 'WAI' }); }}
            className={`px-2.5 py-1 text-xs transition-colors ${saloonMode === 'WAI' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'hover:bg-foreground hover:text-background'}`}
          >二次元动漫 WAI</button>
          <button
            onClick={() => { setSaloonMode('ANIMA'); saveState({ saloonMode: 'ANIMA' }); }}
            className={`px-2.5 py-1 text-xs transition-colors ${saloonMode === 'ANIMA' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'hover:bg-foreground hover:text-background'}`}
          >二次元动漫 Anima</button>
        </div>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => setCharSelectorOpen(true)}>
          {hasChar || hasStyle ? (
            <>{hasChar ? '角色 ✓' : ''}{hasChar && hasStyle ? ' ' : ''}{hasStyle ? '画风 ✓' : ''}</>
          ) : '选角色/画风'}
        </Button>
        <LibrarySelector
          open={charSelectorOpen}
          onOpenChange={setCharSelectorOpen}
          mode={saloonMode}
          onConfirm={handleLibConfirm}
        />
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 py-2">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            开始与角色对话吧
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex items-start gap-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {/* 撤回按钮常驻在气泡外侧：用户消息在左，模型消息在右 */}
              {msg.role === 'user' && (
                <WithdrawButton onClick={() => handleWithdraw(msg.id)} disabled={sending || msg.streaming} />
              )}
              <div className={`max-w-[80%] space-y-1 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2'
                  : 'bg-muted rounded-2xl rounded-bl-sm px-3 py-2'
              }`}>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                  {msg.streaming && <span className="animate-pulse">|</span>}
                </p>
                {/* Images */}
                {msg.imageUrls?.map((url, j) => (
                  <a key={j} href={withFreshMediaToken(url)} target="_blank" rel="noopener noreferrer">
                    <img src={withFreshMediaToken(url)} alt="" className="max-w-[180px] rounded-md mt-1 border" loading="lazy" />
                  </a>
                ))}
                {/* Pending images */}
                {msg.pendingImages?.map((p, j) => (
                  <div key={j} className="size-[120px] rounded-lg bg-muted-foreground/10 flex flex-col items-center justify-center gap-1 mt-1">
                    {p.status === 'failed' ? (
                      <Icon icon="mdi:alert-circle" className="size-6 text-red-500" />
                    ) : (
                      <Spinner className="size-6 text-primary" />
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {p.status === 'failed' ? '生图失败' : p.status === 'running' ? '生图中' : '等待中'}
                    </span>
                  </div>
                ))}
                {/* TTS audio */}
                {msg.ttsUrl && (
                  <audio controls src={withFreshMediaToken(msg.ttsUrl)} className="h-8 mt-1 max-w-full" />
                )}
              </div>
              {msg.role === 'assistant' && (
                <WithdrawButton onClick={() => handleWithdraw(msg.id)} disabled={sending || msg.streaming} />
              )}
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 space-y-2">
        {errorText && (
          <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 border border-red-200 dark:border-red-900/40">
            <Icon icon="mdi:alert-circle" className="size-4 shrink-0" />
            {errorText}
          </div>
        )}

        <div className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5">
          {/* Gen toggle */}
          <button
            onClick={() => { setGenEnabled(!genEnabled); saveState({ genEnabled: !genEnabled }); }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors shrink-0 ${genEnabled ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title={genEnabled ? '生图已开启' : '纯聊'}
          >
            <Icon icon="mdi:image-outline" className="size-4" />
            <span className="hidden sm:inline">{genEnabled ? '生图' : '纯聊'}</span>
          </button>

          {/* TTS toggle */}
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors shrink-0 ${ttsEnabled ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title={ttsEnabled ? '朗读已开启' : '静音'}
          >
            <Icon icon={ttsEnabled ? 'mdi:volume-high' : 'mdi:volume-off'} className="size-4" />
            <span className="hidden sm:inline">{ttsEnabled ? '朗读' : '静音'}</span>
          </button>

          {/* Text input */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={genEnabled ? '输入消息，AI 会边聊边生图...' : '输入消息...'}
            className="flex-1 bg-transparent text-sm outline-none px-1 min-w-0"
            disabled={sending}
          />

          {/* Send */}
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            className="size-7 flex items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 shrink-0"
          >
            {sending ? (
              <Spinner className="size-4" />
            ) : (
              <Icon icon="mdi:send" className="size-4" />
            )}
          </button>
        </div>

        {/* Usage */}
        {(llmTokens > 0 || genCount > 0) && (
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center">LLM: {llmTokens} tokens (<Icon icon="mdi:lightning-bolt" className="size-3" />{llmCost})</span>
            <span className="inline-flex items-center">生图: {genCount} 次 (<Icon icon="mdi:lightning-bolt" className="size-3" />{genCost})</span>
            <span className="inline-flex items-center">合计: <Icon icon="mdi:lightning-bolt" className="size-3" />{llmCost + genCost}</span>
          </div>
        )}
      </div>
    </div>
  );
}
