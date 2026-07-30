'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { getPendingLoraSubmissions, approveLora, getApproveStatus, rejectLora } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

export function LoraApprovalPanel() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPendingLoraSubmissions();
      setItems(res.items || []);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);

  const startPolling = (id: string, taskId: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const poll = setInterval(async () => {
      try {
        const res = await getApproveStatus(taskId);
        const task = res.task;
        (item as any)._task = { progress: task.progress, stage: task.stage, status: task.status };
        setItems([...items]);

        if (task.status === 'done') {
          clearInterval(poll);
          pollingRef.current.delete(id);
          setItems((prev) => prev.filter((i) => i.id !== id));
          toast.success(`已通过「${(task as any).name || id}」`);
        } else if (task.status === 'failed') {
          clearInterval(poll);
          pollingRef.current.delete(id);
          (item as any)._task = null;
          setItems([...items]);
          toast.error(String(task.error || '处理失败'));
        }
      } catch {
        clearInterval(poll);
        pollingRef.current.delete(id);
        (item as any)._task = null;
        setItems([...items]);
      }
    }, 1000);

    pollingRef.current.set(id, poll);
  };

  const handleApprove = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    // Optimistic: show queued state immediately
    (item as any)._task = { progress: 0, stage: '排队中...', status: 'queued' };
    setItems([...items]);

    try {
      const res = await approveLora(id);
      startPolling(id, res.task_id);
    } catch (e: any) {
      // If error has task_id, still poll
      if (e?.body?.task_id) {
        startPolling(id, e.body.task_id);
        return;
      }
      (item as any)._task = null;
      setItems([...items]);
      toast.error('操作失败');
    }
  };

  const handleReject = async (id: string) => {
    setRejectingId(id);
    try {
      await rejectLora(id);
      toast.success('已拒绝');
      load();
    } catch {
      toast.error('操作失败');
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Icon icon="mdi:shape-plus-outline" className="size-5" />
            Lora 申请
          </h3>
          <p className="text-xs text-muted-foreground mt-1">共 {items.length} 条待审核</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner className="size-5 text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">暂无待审核的 Lora 申请</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const task = (item as any)._task;
            return (
              <div key={item.id as string} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{String(item.name || '')}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span>提交者: #{String(item.user_id)}</span>
                      <span>类型: {String(item.type || '')}</span>
                      <span>类别: {item.lora_type === 'style' ? '画风' : '角色'}</span>
                      <span>分类: {String(item.category || '')}</span>
                      <span>触发词: <code className="bg-muted px-1 rounded">{String(item.trigger || '')}</code></span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      链接: <a href={String(item.url || '')} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{String(item.url || '')}</a>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.created_at ? new Date(Number(item.created_at) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}
                    </div>
                  </div>
                </div>

                {task ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground inline-flex items-center gap-1">
                        <Spinner className="size-3" />
                        审批中
                      </span>
                    </div>
                    <div className="w-full space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{String(task.stage || '')}</span>
                        <span>{task.progress ?? 0}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${task.progress ?? 0}%` }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="text-xs h-7" onClick={() => handleApprove(item.id as string)}>
                      <Icon icon="mdi:check" className="size-3.5" />通过
                    </Button>
                    <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => handleReject(item.id as string)} disabled={rejectingId === item.id}>
                      {rejectingId === item.id ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Icon icon="mdi:close" className="size-3.5" />
                      )}
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
