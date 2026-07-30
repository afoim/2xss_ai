'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getLlmConfig, updateLlmConfig, testLlmConfig, getLlmModels } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

const THINKING_LABELS: Record<string, string> = {
  off: '关闭',
  level_minimal: 'Minimal',
  level_low: 'Low',
  level_medium: 'Medium',
  level_high: 'High',
};

interface Profile {
  name?: string;
  provider?: 'google' | 'custom';
  google_api_key?: string;
  google_model?: string;
  google_thinking?: string;
  custom_endpoint?: string;
  custom_api_key?: string;
  custom_model?: string;
  llm_stream?: boolean;
}

export function LlmConfigPanel() {
  const [config, setConfig] = useState<{ profiles: Profile[]; active: number } | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const res = await getLlmConfig();
      setConfig(res.config as { profiles: Profile[]; active: number });
    } catch {
      toast.error('加载 LLM 配置失败');
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!config) return;
    setLoading(true);
    try {
      const res = await updateLlmConfig({ profiles: config.profiles, active: config.active });
      if (res.config) setConfig(res.config as { profiles: Profile[]; active: number });
      toast.success('LLM 配置已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testLlmConfig(activeTab);
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleLoadModels = async () => {
    setModelsLoading(true);
    setModels(null);
    try {
      const res = await getLlmModels(activeTab);
      setModels(res.models || []);
    } catch {
      setModels([]);
      toast.error('探测失败');
    } finally {
      setModelsLoading(false);
    }
  };

  const updateProfile = (idx: number, patch: Partial<Profile>) => {
    if (!config) return;
    const profiles = [...config.profiles];
    profiles[idx] = { ...profiles[idx], ...patch };
    setConfig({ ...config, profiles });
  };

  if (!config) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  const profile = config.profiles[activeTab];

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Icon icon="mdi:brain" className="size-5" />
        <h3 className="text-sm font-medium">LLM 配置</h3>
        <p className="text-[10px] text-muted-foreground">配置 AI 改写/翻译所用的大语言模型</p>
      </div>

      <Button size="sm" variant="outline" onClick={load}>
        <Icon icon="mdi:refresh" className="size-4 mr-1" />加载
      </Button>

      {/* Profile tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {config.profiles.map((p, i) => (
          <div key={i} className="flex items-center gap-0">
            <button
              onClick={() => { setActiveTab(i); setModels(null); setTestResult(null); }}
              className={`px-2.5 py-1.5 text-xs rounded-l-md border transition-colors ${activeTab === i ? 'border-primary bg-primary text-primary-foreground font-medium' : 'border-border hover:bg-foreground hover:text-background'}`}
            >
              {p.name || `配置${i + 1}`}
              {config.active === i && <span className="ml-1 text-green-600">✓</span>}
            </button>
            {config.profiles.length > 1 && (
              <button
                onClick={() => {
                  const profiles = config.profiles.filter((_, j) => j !== i);
                  const active = config.active === i ? 0 : config.active > i ? config.active - 1 : config.active;
                  setConfig({ profiles, active });
                  if (activeTab >= profiles.length) setActiveTab(profiles.length - 1);
                }}
                className="px-1.5 py-1.5 text-xs rounded-r-md border border-l-0 text-muted-foreground hover:text-destructive transition-colors"
              >✕</button>
            )}
          </div>
        ))}
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => {
          if (!config) return;
          setConfig({
            ...config,
            profiles: [...config.profiles, { name: 'Custom', provider: 'custom', custom_endpoint: '', custom_api_key: '', custom_model: '', llm_stream: true }],
          });
          setActiveTab(config.profiles.length);
        }}>
          <Icon icon="mdi:plus" className="size-3.5 mr-0.5" />新增配置
        </Button>
      </div>

      {profile && (
        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">名称</label>
            <input type="text" value={profile.name || ''} onChange={(e) => updateProfile(activeTab, { name: e.target.value })} placeholder={`配置${activeTab + 1}`} className="w-full h-8 px-2 rounded border bg-background text-xs" />
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">类型</label>
            <div className="flex gap-2">
              {(['google', 'custom'] as const).map((prov) => (
                <button
                  key={prov}
                  onClick={() => updateProfile(activeTab, { provider: prov, ...(prov === 'google' ? { google_api_key: profile.google_api_key || '', google_model: profile.google_model || '', google_thinking: profile.google_thinking || 'off' } : { custom_endpoint: profile.custom_endpoint || '', custom_api_key: profile.custom_api_key || '', custom_model: profile.custom_model || '' }) })}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${profile.provider === prov ? 'border-primary bg-primary text-primary-foreground font-medium' : 'border-border hover:bg-foreground hover:text-background'}`}
                >
                  {prov === 'google' ? 'Google Gemini' : 'Custom'}
                </button>
              ))}
            </div>
          </div>

          {/* Google fields */}
          {profile.provider === 'google' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">API Key</label>
                <input type="password" value={profile.google_api_key || ''} onChange={(e) => updateProfile(activeTab, { google_api_key: e.target.value })} placeholder="AIza..." className="w-full h-8 px-2 rounded border bg-background text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">模型名称</label>
                <div className="flex gap-1">
                  <input type="text" value={profile.google_model || ''} onChange={(e) => updateProfile(activeTab, { google_model: e.target.value })} placeholder="gemma-4-31b-it" className="flex-1 h-8 px-2 rounded border bg-background text-xs" />
                  <Button variant="outline" onClick={handleLoadModels} disabled={modelsLoading}>
                    {modelsLoading ? <Spinner className="size-3.5" /> : <Icon icon="mdi:magnify" className="size-3.5" />} 探测模型
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">思维链</label>
                <div className="flex flex-wrap gap-1">
                  {['off', 'level_minimal', 'level_low', 'level_medium', 'level_high'].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => updateProfile(activeTab, { google_thinking: opt })}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${profile.google_thinking === opt ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-foreground hover:text-background'}`}
                    >{THINKING_LABELS[opt] || opt}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Custom fields */}
          {profile.provider === 'custom' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">API 端点 <span className="text-[9px] text-muted-foreground">（完整路径，含 /v1）</span></label>
                <input type="text" value={profile.custom_endpoint || ''} onChange={(e) => updateProfile(activeTab, { custom_endpoint: e.target.value })} placeholder="https://api.openai.com/v1" className="w-full h-8 px-2 rounded border bg-background text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">API Key</label>
                <input type="password" value={profile.custom_api_key || ''} onChange={(e) => updateProfile(activeTab, { custom_api_key: e.target.value })} placeholder="sk-..." className="w-full h-8 px-2 rounded border bg-background text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">模型名称</label>
                <div className="flex gap-1">
                  <input type="text" value={profile.custom_model || ''} onChange={(e) => updateProfile(activeTab, { custom_model: e.target.value })} placeholder="gpt-4o" className="flex-1 h-8 px-2 rounded border bg-background text-xs" />
                  <Button variant="outline" onClick={handleLoadModels} disabled={modelsLoading}>
                    {modelsLoading ? <Spinner className="size-3.5" /> : <Icon icon="mdi:magnify" className="size-3.5" />} 探测模型
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Models list */}
          {models !== null && (
            <div className="border rounded p-2 max-h-40 overflow-y-auto">
              <p className="text-[10px] text-muted-foreground mb-1">可用模型（{models.length} 个）：</p>
              {models.length === 0 ? (
                <p className="text-xs text-muted-foreground">无可用模型或探测失败</p>
              ) : (
                models.map((model) => (
                  <div key={model} className="text-xs py-0.5 hover:bg-foreground hover:text-background rounded px-1 cursor-pointer"
                    onClick={() => {
                      if (profile.provider === 'google') updateProfile(activeTab, { google_model: model });
                      else updateProfile(activeTab, { custom_model: model });
                    }}
                  >{model}</div>
                ))
              )}
            </div>
          )}

          {/* Stream toggle */}
          <div className="flex items-center gap-2">
            <Switch checked={profile.llm_stream ?? true} onCheckedChange={(c) => updateProfile(activeTab, { llm_stream: c })} />
            <label className="text-xs text-muted-foreground">流式输出</label>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || loading}>
              {testing ? <Spinner className="size-3.5 mr-1" /> : <Icon icon="mdi:flask-outline" className="size-3.5 mr-1" />}测试连通性
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading}>
              <Icon icon="mdi:content-save" className="size-3.5 mr-1" />保存
            </Button>
            {config.active !== activeTab ? (
              <Button size="sm" variant="secondary" onClick={() => {
                const profiles = [...config.profiles];
                setConfig({ ...config, active: activeTab });
              }}>
                <Icon icon="mdi:check-circle-outline" className="size-3.5 mr-1" />设为当前配置
              </Button>
            ) : (
              <span className="text-[10px] px-2 py-1 rounded border border-green-300 text-green-600 inline-flex items-center">当前配置</span>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`rounded-lg border p-3 text-xs ${testResult.ok ? 'border-green-200 bg-green-50 dark:bg-green-950/20' : 'border-red-200 bg-red-50 dark:bg-red-950/20'}`}>
              {testResult.ok ? (
                <><span className="font-medium text-green-600">✓ {String(testResult.provider || '')}</span> — {String(testResult.reply || '')}</>
              ) : (
                <><span className="font-medium">✗ 失败</span> — {String(testResult.error || '')}</>
              )}
              {!!testResult.raw && <br />}
              {!!testResult.raw && <span className="text-[9px] text-muted-foreground">原始回复: {String(testResult.raw)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
