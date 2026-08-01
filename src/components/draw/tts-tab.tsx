'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { drawRequest, uploadTtsRefAudio, getImageUrl, fetchPointsConfig } from '@/lib/draw/api/client';
import { useMediaToken, withFreshMediaToken } from '@/lib/draw/media-token';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

const STORAGE_KEY = 'tts-form';

const PRESET_VOICES: { id: string; label: string }[] = [
  { id: 'mimo_default', label: 'MiMo-default' },
  { id: 'bingtang', label: '冰糖 (Female)' },
  { id: 'mol', label: '茉莉 (Female)' },
  { id: 'soda', label: '苏打 (Male)' },
  { id: 'baihua', label: '白桦 (Male)' },
  { id: 'Mia', label: 'Mia (English Female)' },
  { id: 'Chloe', label: 'Chloe (English Female)' },
  { id: 'Milo', label: 'Milo (English Male)' },
  { id: 'Dean', label: 'Dean (English Male)' },
];

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

type Mode = 'preset' | 'custom' | 'clone';

interface TagGroup {
  name: string;
  tags: string[];
  format: 'paren' | 'bracket';
}

const TAG_GROUPS: TagGroup[] = [
  { name: '基础情绪', tags: ['开心', '悲伤', '愤怒', '恐惧', '惊讶', '兴奋', '委屈', '平静', '冷漠'], format: 'paren' },
  { name: '复合情绪', tags: ['怅然', '欣慰', '无奈', '愧疚', '释然', '嫉妒', '厌倦', '忐忑', '动情'], format: 'paren' },
  { name: '总体语调', tags: ['温柔', '高冷', '活泼', '严肃', '慵懒', '俏皮', '深沉', '干练', '凌厉'], format: 'paren' },
  { name: '音色定位', tags: ['磁性', '醇厚', '清亮', '空灵', '稚嫩', '苍老', '甜美', '沙哑', '醇雅'], format: 'paren' },
  { name: '角色口音', tags: ['夹子音', '御姐音', '正太音', '大叔音', '台湾腔'], format: 'paren' },
  { name: '方言', tags: ['东北话', '四川话', '河南话', '粤语'], format: 'paren' },
  { name: '精细控制', tags: ['laugh', 'chuckle', 'laugh loudly', 'sneer', 'sob', 'whimper', 'choke', 'cry loudly', 'nervous', 'scared', 'excited', 'tired', 'wronged', 'coquettish', 'guilty', 'shocked', 'impatient', 'tremble', 'voice tremble', 'change pitch', 'crack', 'nasal', 'breathy', 'hoarse', 'inhale', 'deep breath', 'sigh', 'long sigh', 'pant', 'hold breath', 'speed up', 'slow down', 'whisper'], format: 'bracket' },
  { name: '特殊', tags: ['唱歌', '孙悟空', '林黛玉'], format: 'paren' },
];

export function TtsTab() {
  // 订阅媒体令牌：结果音频 URL 存进 state 后，token 换新时靠它触发重渲染补 mt
  useMediaToken();
  // Form state
  const [mode, setMode] = useState<Mode>('preset');
  const [speaker, setSpeaker] = useState('mimo_default');
  const [instruct, setInstruct] = useState('');
  const [targetText, setTargetText] = useState('');
  const [language, setLanguage] = useState('auto');
  const [tags, setTags] = useState('');

  // Clone mode
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState('');

  // Points config
  const [ttsPerChar, setTtsPerChar] = useState(0.01);
  const [ttsMin, setTtsMin] = useState(1);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [resultUrl, setResultUrl] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.mode) setMode(p.mode);
        if (p.speaker) setSpeaker(p.speaker);
        if (p.instruct) setInstruct(p.instruct);
        if (p.targetText) setTargetText(p.targetText);
        if (p.language) setLanguage(p.language);
        if (p.tags) setTags(p.tags);
      }
    } catch {}
    // Fetch points config
    fetchPointsConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      if (typeof c.tts_per_char === 'number') setTtsPerChar(c.tts_per_char);
      if (typeof c.tts_generate === 'number') setTtsMin(c.tts_generate);
    }).catch(() => {});
  }, []);

  // Save state
  const saveState = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, speaker, instruct, targetText, language, tags }));
    } catch {}
  }, [mode, speaker, instruct, targetText, language, tags]);

  useEffect(() => { saveState(); }, [saveState]);

  const estimatedCost = Math.max(ttsMin, Math.ceil(targetText.length * ttsPerChar));

  const handleReset = () => {
    setError('');
    setDone(false);
    setResultUrl('');
  };

  // Tag click
  const toggleTag = (tag: string, format: 'paren' | 'bracket') => {
    const wrapped = format === 'paren' ? `(${tag})` : `[${tag}]`;
    if (tags.includes(wrapped)) {
      setTags(tags.replace(wrapped, '').replace(/\s+/g, ' ').trim());
    } else {
      setTags((tags ? tags + ' ' : '') + wrapped);
    }
  };

  // File input
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioPreviewUrl(URL.createObjectURL(file));
  }, [audioPreviewUrl]);

  // Remove file
  const removeFile = useCallback(() => {
    setAudioFile(null);
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioPreviewUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [audioPreviewUrl]);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!targetText.trim()) return;
    setSubmitting(true);
    setError('');
    setDone(false);
    setResultUrl('');

    try {
      let refName: string | undefined;
      if (mode === 'clone' && audioFile) {
        const uploadRes = await uploadTtsRefAudio(audioFile);
        refName = uploadRes.filename;
      }

      const payload: Record<string, unknown> = {
        text: targetText,
        mode,
        speaker: mode === 'preset' ? speaker : undefined,
        instruct: instruct || undefined,
        tags: tags || undefined,
        ...(language !== 'auto' ? { language } : {}),
        ...(refName ? { ref_audio_name: refName } : {}),
      };

      const res = await drawRequest<{ ok: boolean; filename: string; cost: number }>('/api/draw/tts/synthesize', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (res.filename) {
          setResultUrl(getImageUrl(res.filename));
        }
        setDone(true);
        toast.success('合成完成');
      } else {
        throw new Error('合成失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '合成失败');
    } finally {
      setSubmitting(false);
    }
  }, [targetText, mode, audioFile, speaker, instruct, tags, language]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon icon="mdi:waveform" className="size-5" />
        <span className="text-sm font-semibold">语音合成 (TTS)</span>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-1">
        {([
          { key: 'preset' as const, label: '预设音色' },
          { key: 'custom' as const, label: '自定义音色' },
          { key: 'clone' as const, label: '音色克隆' },
        ]).map((m) => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); handleReset(); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${mode === m.key ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'border border-input hover:bg-foreground hover:text-background'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode-specific sections */}
      {mode === 'preset' && (
        <div className="space-y-3 p-3 rounded-lg border">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">选择音色</label>
            <NativeSelect value={speaker} onChange={(e) => setSpeaker(e.target.value)} className="w-full">
              {PRESET_VOICES.map((v) => (
                <NativeSelectOption key={v.id} value={v.id}>{v.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">风格指令（可选）</label>
            <Textarea
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder="Use a light, rising tone, slightly fast pace, bright and energetic voice."
              rows={2}
              className="resize-none min-h-[52px]"
            />
            <p className="text-[10px] text-muted-foreground">支持在文本中嵌入标签： (happy)[speed up][laugh][sigh] 等</p>
          </div>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-3 p-3 rounded-lg border">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">音色描述 / 导演模式</label>
            <Textarea
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder={`
[角色]活泼开朗的少女
[场景]清晨的花园，阳光明媚
[方向]语气轻快，带点撒娇
              `.trim()}
              rows={3}
              className="resize-none min-h-[72px]"
            />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">查看可用标签</summary>
            <div className="mt-2 space-y-2 pl-2">
              <div><strong>基础情绪：</strong>happy, sad, angry, fear, surprise, excited, 委屈, calm, indifferent</div>
              <div><strong>总体语调：</strong>gentle, cold, lively, serious, lazy, playful, deep, capable, sharp</div>
              <div><strong>音色定位：</strong>magnetic, full, bright, ethereal, young, old, sweet, hoarse, elegant</div>
              <div><strong>气息声：</strong>deep breath, inhale, panting, sigh, laugh, sneer, dry laugh, tears to smile</div>
            </div>
          </details>
        </div>
      )}

      {mode === 'clone' && (
        <div className="space-y-3 p-3 rounded-lg border">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">上传参考音频</label>
            {!audioFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground cursor-pointer hover:border-primary/50 transition-colors"
              >
                <Icon icon="mdi:upload" className="size-6 mx-auto mb-1" />
                <p>点击上传音频文件</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{audioFile.name} ({(audioFile.size / 1024).toFixed(1)} KB)</span>
                  <button onClick={removeFile} className="text-destructive hover:underline">移除</button>
                </div>
                {audioPreviewUrl && (
                  <audio controls src={audioPreviewUrl} className="w-full h-9" />
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">上传参考音频进行音色克隆，无需填写参考文本。</p>
        </div>
      )}

      {/* Audio Tags */}
      <div className="space-y-2">
        <label className="text-xs font-medium flex items-center gap-1">
          <Icon icon="mdi:tag-text-outline" className="size-3.5" />
          音频标签
        </label>
        <div className="space-y-2">
          {TAG_GROUPS.map((group) => (
            <div key={group.name}>
              <p className="text-[10px] text-muted-foreground mb-1">{group.name}</p>
              <div className="flex flex-wrap gap-1">
                {group.tags.map((tag) => {
                  const wrapped = group.format === 'paren' ? `(${tag})` : `[${tag}]`;
                  const active = tags.includes(wrapped);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag, group.format)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-foreground hover:text-background text-muted-foreground'
                      }`}
                    >
                      {wrapped}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Textarea
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder='也可手动输入，多个标签直接拼接如 (happy)[deep breath]你好'
          rows={2}
          className="text-xs resize-none min-h-[40px]"
        />
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">语言</label>
        <NativeSelect value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full">
          {LANGUAGE_OPTIONS.map((opt) => (
            <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {/* Target text */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">合成文本</label>
        <Textarea
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
          placeholder="输入要合成语音的文本…"
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={!targetText.trim() || submitting || done}
        size="lg"
        className="w-full gap-2"
      >
        {submitting ? (
          <>
            <Spinner className="size-5" />
            合成中…
          </>
        ) : done ? (
          '已完成'
        ) : (
          <>
            <Icon icon="mdi:playlist-plus" className="size-5" />
            开始生成
            {targetText.trim() && (
              <span className="ml-1.5 text-[10px] px-1 rounded bg-secondary text-secondary-foreground">
                <span className="inline-flex items-center"><Icon icon="mdi:lightning-bolt" className="size-3" />{estimatedCost}~</span>
              </span>
            )}
          </>
        )}
      </Button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 border border-red-200 dark:border-red-900/40">
          <Icon icon="mdi:alert-circle" className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Result */}
      {done && (
        <div className="rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <Icon icon="mdi:check-circle" className="size-5" />
            合成完成
          </div>
          {resultUrl ? (
            <div className="space-y-2">
              <audio controls src={withFreshMediaToken(resultUrl)} className="w-full h-10" />
              <div className="flex gap-2">
                <a href={withFreshMediaToken(resultUrl)} download="tts-output.wav" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Icon icon="mdi:download" className="size-4" />
                  下载
                </a>
                <Button size="sm" variant="outline" onClick={handleReset}>重新开始</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">音频文件正在处理中，请前往"我的"页面查看和下载。</p>
              <Button size="sm" variant="outline" onClick={handleReset}>重新开始</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
