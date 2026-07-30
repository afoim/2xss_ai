'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getLimits, updateLimits } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

const FIELDS: { key: string; label: string; type: 'number' | 'boolean' }[] = [
  { key: 'gen_cooldown_sec', label: '生成冷却（秒）', type: 'number' },
  { key: 'gen_cooldown_after_sec', label: '生成后冷却（秒）', type: 'number' },
  { key: 'max_queue_per_user', label: '每用户队列上限', type: 'number' },
  { key: 'llm_cooldown_sec', label: 'LLM 冷却（秒）', type: 'number' },
  { key: 'image_rate_window_sec', label: '图片速率窗口（秒）', type: 'number' },
  { key: 'image_rate_max', label: '图片速率上限', type: 'number' },
  { key: 'report_window_sec', label: '举报窗口（秒）', type: 'number' },
  { key: 'report_window_max', label: '举报上限', type: 'number' },
  { key: 'report_pending_max', label: '待处理举报上限', type: 'number' },
  { key: 'gpu_poll_interval_ms', label: 'GPU 轮询间隔（ms）', type: 'number' },
  { key: 'gpu_cache_ttl_ms', label: 'GPU 缓存 TTL（ms）', type: 'number' },
  { key: 'gc_interval_hours', label: 'GC 间隔（小时）', type: 'number' },
  { key: 'turnstile_enabled', label: 'Turnstile 验证', type: 'boolean' },
];

export function LimitsPanel() {
  const [limits, setLimits] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getLimits();
      setLimits(res.limits);
    } catch {
      toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!limits) return;
    setLoading(true);
    try {
      const res = await updateLimits(limits);
      setLimits(res.limits);
      toast.success('配置已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  if (!limits) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">全局配置</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            <Icon icon="mdi:content-save" className="size-4 mr-1" />保存
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex items-center justify-between border rounded px-3 py-2">
            <label className="text-xs">{field.label}</label>
            {field.type === 'boolean' ? (
              <Switch
                checked={!!limits[field.key]}
                onCheckedChange={(c) => setLimits((prev) => prev ? { ...prev, [field.key]: c } : prev)}
              />
            ) : (
              <input
                type="number"
                value={Number(limits[field.key] ?? 0)}
                onChange={(e) => setLimits((prev) => prev ? { ...prev, [field.key]: Number(e.target.value) || 0 } : prev)}
                className="w-24 h-8 px-2 rounded border bg-background text-xs text-right"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
