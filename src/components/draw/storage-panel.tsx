'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { fetchStorage } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Spinner } from '@/components/ui/spinner';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];

interface StorageItem {
  user_id: number;
  img_size: number;
  vid_size: number;
  aud_size: number;
  img_files: number;
  vid_files: number;
  aud_files: number;
}

export function StoragePanel() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchStorage();
      setItems((data.items || []) as unknown as StorageItem[]);
      setTotalSize(data.total_size || 0);
    } catch {
      toast.error('加载存储数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const maxSize = Math.max(...items.map((i) => i.img_size + i.vid_size + i.aud_size), 1);

  // Pie data: by user (img_size + aud_size, excluding vid per original)
  const userPieData = items.map((i) => ({
    name: `#${i.user_id}`,
    value: i.img_size + i.aud_size,
  })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

  // Pie data: by type
  const imgTotal = items.reduce((s, i) => s + i.img_size, 0);
  const vidTotal = items.reduce((s, i) => s + i.vid_size, 0);
  const audTotal = items.reduce((s, i) => s + i.aud_size, 0);
  const typePieData = [
    { name: '图片', value: imgTotal },
    { name: '视频', value: vidTotal },
    { name: '音频', value: audTotal },
  ].filter((d) => d.value > 0);

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">存储用量</h3>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner className="size-4" /> : <Icon icon="mdi:refresh" className="size-4" />} 刷新
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner className="size-6 text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">暂无数据</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>总计：{formatSize(totalSize)}</span>
            <span className="text-muted-foreground/50">|</span>
            <span>用户数：{items.length}</span>
          </div>

          {/* Pie charts */}
          <div className="flex flex-wrap gap-6">
            <div className="border rounded-lg p-3">
              <p className="text-xs font-medium mb-2">按用户</p>
              {userPieData.length > 0 ? (
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={userPieData.slice(0, 6)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={70} paddingAngle={2}>
                      {userPieData.slice(0, 6).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => formatSize(Number(value || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-xs text-muted-foreground py-8 text-center">无数据</p>}
              <div className="mt-1 space-y-0.5">
                {userPieData.slice(0, 6).map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="size-2 rounded-sm inline-block shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="ml-auto">{((d.value / userPieData.reduce((a, b) => a + b.value, 0)) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-xs font-medium mb-2">按类型</p>
              {typePieData.length > 0 ? (
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={typePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={70} paddingAngle={2}>
                      {typePieData.map((_, i) => (
                        <Cell key={i} fill={[COLORS[0], COLORS[1], COLORS[2]][i]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => formatSize(Number(value || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-xs text-muted-foreground py-8 text-center">无数据</p>}
              <div className="mt-1 space-y-0.5">
                {typePieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="size-2 rounded-sm inline-block shrink-0" style={{ backgroundColor: [COLORS[0], COLORS[1], COLORS[2]][i] }} />
                    <span>{d.name}</span>
                    <span className="ml-auto">{((d.value / typePieData.reduce((a, b) => a + b.value, 0)) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per-user list */}
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {items.map((item, i) => {
              const tot = item.img_size + item.vid_size + item.aud_size;
              const imgPct = (item.img_size / maxSize) * 100;
              const vidPct = (item.vid_size / maxSize) * 100;
              const audPct = (item.aud_size / maxSize) * 100;
              return (
                <div key={item.user_id} className={`flex items-center gap-2 text-xs border rounded px-3 py-1.5 ${i < 3 ? 'bg-primary/5 border-primary/20' : ''}`}>
                  <span className={`w-6 text-center font-mono text-muted-foreground ${i < 3 ? 'text-primary' : ''}`}>#{i + 1}</span>
                  <span className={`font-medium w-8 text-right ${i < 3 ? 'text-primary' : ''}`}>#{item.user_id}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                      <div className="h-full bg-blue-500/70 rounded-l-full transition-all" style={{ width: `${imgPct}%` }} title={`图片 ${formatSize(item.img_size)}`} />
                      <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${vidPct}%` }} title={`视频 ${formatSize(item.vid_size)}`} />
                      <div className="h-full bg-amber-500/70 rounded-r-full transition-all" style={{ width: `${audPct}%` }} title={`音频 ${formatSize(item.aud_size)}`} />
                    </div>
                    <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-blue-500/70 inline-block" />图片 {formatSize(item.img_size)} ({item.img_files})</span>
                      <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500/70 inline-block" />视频 {formatSize(item.vid_size)} ({item.vid_files})</span>
                      <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-amber-500/70 inline-block" />音频 {formatSize(item.aud_size)} ({item.aud_files})</span>
                    </div>
                  </div>
                  <span className="w-20 text-right font-mono shrink-0">{formatSize(tot)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
