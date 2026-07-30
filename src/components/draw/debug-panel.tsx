'use client';

import { useState, useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { fetchDebugInfo, clearQueue } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

export function DebugPanel() {
  const [data, setData] = useState<{ queue_items: Record<string, unknown>[]; stuck: Record<string, unknown>[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const load = async () => {
    setLoading(true);
    try {
      const d = await fetchDebugInfo();
      setData(d);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearQueue();
      toast.success('已清空队列');
      load();
    } catch {
      toast.error('清空队列失败');
    } finally {
      setClearing(false);
    }
  };

  const items = data?.queue_items || [];
  const stuck = data?.stuck || [];

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Icon icon="mdi:bug-outline" className="size-5" />
        <div>
          <h3 className="text-sm font-medium">队列管理</h3>
          <p className="text-[10px] text-muted-foreground">活跃队列 — 仅用于断电恢复，任务完结自动消失</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
        </Button>
        <Button size="sm" variant="destructive" onClick={handleClear} disabled={clearing}>
          {clearing ? <Spinner className="size-4" /> : <Icon icon="mdi:delete-sweep" className="size-4" />} 清空队列
        </Button>
      </div>

      {stuck.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-red-500">卡住任务 ({stuck.length})</h4>
          <div className="space-y-1">
            {stuck.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs border rounded px-3 py-2">
                <Icon icon="mdi:alert" className="size-4 text-red-500" />
                <span>UID {String(item.user_id)}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">{String(item.status)}</span>
                <span className="text-muted-foreground">ID:{String(item.id)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium mb-2">活跃队列（{items.length}）</h4>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">队列为空</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2">ID</th>
                  <th className="py-1 pr-2">UID</th>
                  <th className="py-1 pr-2">状态</th>
                  <th className="py-1 pr-2">等待</th>
                  <th className="py-1 pr-2">已启动</th>
                  <th className="py-1 pr-2">工作流</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1 pr-2 font-mono">{String(item.id)}</td>
                    <td className="py-1 pr-2">{String(item.user_id)}</td>
                    <td className="py-1 pr-2">
                      {String(item.status || '') === '运行' || String(item.status || '') === 'running' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 animate-pulse">运行</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">排队</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">{String(item.created_ago || '')}s</td>
                    <td className="py-1 pr-2 text-muted-foreground">{item.started_ago != null ? `${String(item.started_ago)}s` : '-'}</td>
                    <td className="py-1 pr-2 break-all max-w-[120px] text-muted-foreground text-[10px]">{String(item.workflow_path || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
