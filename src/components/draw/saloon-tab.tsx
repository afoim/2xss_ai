'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { LibrarySelector } from '@/components/draw/library-selector';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import {
  chatRequest, fetchChatPresets, saveChatPreset, deleteChatPreset,
  fetchChatHistory, appendChatHistory, clearChatHistory,
  addToQueue, fetchMyQueue, ttsSynthesize,
} from '@/lib/draw/api/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  imageUrls?: string[];
  pendingImages?: { itemId: string; status: string }[];
  ttsUrl?: string;
}

const POLL_INTERVAL = 3000;
const STORAGE_KEY = 'draw-saloon';

export function SaloonTab({ onQueueUpdate }: { onQueueUpdate?: () => void }) {
  // ── System prompt / Presets ──
  const [presets, setPresets] = useState<{ id: string; name: string; system_prompt: string }[]>([]);
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

  // ── Queue polling ──
  const [pendingItemIds, setPendingItemIds] = useState<Map<string, number>>(new Map());
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const chatHistoryRef = useRef<{ role: string; content: string }[]>([]);
  const assistantMsgIdxRef = useRef(-1);

  // ── Cost tracking ──
  const [llmTokens, setLlmTokens] = useState(0);
  const [llmCost, setLlmCost] = useState(0);
  const [genCount, setGenCount] = useState(0);
  const [genCost, setGenCost] = useState(0);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load presets on mount
  useEffect(() => {
    fetchChatPresets().then((res) => setPresets(res.items || [])).catch(() => {});
    fetchChatHistory().then((data) => {
      if (data?.items?.length) {
        chatHistoryRef.current = data.items;
        const restored: ChatMessage[] = data.items.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          imageUrls: [],
          pendingImages: [],
        }));
        setMessages(restored);
      }
    }).catch(() => {});
    // Restore saloon state from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.systemPrompt) setSystemPrompt(parsed.systemPrompt);
        if (parsed.presetName) setPresetName(parsed.presetName);
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
    setMessages([]);
    setLlmTokens(0);
    setLlmCost(0);
    setGenCount(0);
    setGenCost(0);
    chatHistoryRef.current = [];
    try {
      await clearChatHistory();
    } catch {}
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
          for (const [itemId, msgIdx] of prev) {
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
              // Update message with result
              setMessages((msgs) => {
                const updated = [...msgs];
                if (!updated[msgIdx]) return updated;
                const msg = { ...updated[msgIdx] };
                const pending = (msg.pendingImages || []).filter((p) => p.itemId !== itemId);
                msg.pendingImages = pending;
                if (status === 'done') {
                  const files = (item._output_files as string[]) || [];
                  if (files[0]) {
                    const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';
                    const imgUrl = files[0].startsWith('http') ? files[0] : `${baseUrl}${files[0].startsWith('/') ? '' : '/'}${files[0]}`;
                    msg.imageUrls = [...(msg.imageUrls || []), imgUrl];
                  }
                }
                updated[msgIdx] = msg;
                return updated;
              });
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
  const submitGenJob = useCallback(async (tags: string, msgIdx: number) => {
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
          next.set(String(result.item_id), msgIdx);
          return next;
        });
        startQueuePolling();
        setMessages((msgs) => {
          const updated = [...msgs];
          const msg = { ...updated[msgIdx] };
          msg.pendingImages = [...(msg.pendingImages || []), { itemId: String(result.item_id), status: 'pending' }];
          updated[msgIdx] = msg;
          return updated;
        });
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

    // Capture the index BEFORE adding messages (state isn't updated yet)
    const baseMsgCount = messages.length;
    const assistantIdx = baseMsgCount + 1;

    // Add user message + placeholder assistant message
    const userMsg: ChatMessage = { role: 'user', content: text, imageUrls: [], pendingImages: [] };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', streaming: true, imageUrls: [], pendingImages: [] };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    assistantMsgIdxRef.current = assistantIdx;

    const currentHistory = [...chatHistoryRef.current, { role: 'user', content: text }];

    // Persist user message
    try {
      await appendChatHistory([{ role: 'user', content: text }]);
    } catch {}

    chatHistoryRef.current = currentHistory;

    const idx = assistantIdx; // stable reference for closures

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
                const msgIdx = idx;
                setMessages((prev) => {
                  const updated = [...prev];
                  if (updated[msgIdx]) {
                    updated[msgIdx] = { ...updated[msgIdx], content: updated[msgIdx].content + (parsed.content || '') };
                  }
                  return updated;
                });
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
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], streaming: false };
        }
        return updated;
      });

      // Submit gen job if we got tags
      if (genTags && genEnabled) {
        submitGenJob(genTags, idx);
      }

      // Persist assistant message
      const assistantContent = genTags ? textContent : fullText;
      if (assistantContent.trim()) {
        chatHistoryRef.current = [...chatHistoryRef.current, { role: 'assistant', content: assistantContent }];
        try {
          await appendChatHistory([{ role: 'assistant', content: assistantContent }]);
        } catch {}
      }

      // TTS
      if (ttsEnabled && textContent.trim()) {
        try {
          const result = await ttsSynthesize({ text: textContent, source: 'saloon' });
          if (result.audio_url) {
            setMessages((prev) => {
              const updated = [...prev];
              if (updated[idx]) {
                updated[idx] = { ...updated[idx], ttsUrl: result.audio_url };
              }
              return updated;
            });
          }
        } catch {}
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : '发送失败');
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], streaming: false, content: updated[idx].content || '（发送失败）' };
        }
        return updated;
      });
    } finally {
      setSending(false);
    }
  }, [input, sending, systemPrompt, genEnabled, saloonMode, saloonCharTags, saloonStyleTags, ttsEnabled, submitGenJob, messages.length]);

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
                  if (p) { setPresetName(p.name); setSystemPrompt(p.system_prompt); }
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
              <Button size="sm" onClick={handleSavePreset} disabled={!presetName.trim() || !systemPrompt.trim()}>保存预设</Button>
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
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
                  <a key={j} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt="" className="max-w-[180px] rounded-md mt-1 border" loading="lazy" />
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
                  <audio controls src={msg.ttsUrl} className="h-8 mt-1 max-w-full" />
                )}
              </div>
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
