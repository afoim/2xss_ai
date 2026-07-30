'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { fetchStats } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import { Spinner } from '@/components/ui/spinner';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const PERIODS = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
];

const FEATURE_LABELS: Record<string, string> = {
  text_to_image: '文生图 (Txt2Img)',
  image_to_image: '图生图 (Img2Img)',
  text_to_video: '视频生成 (Video)',
  tts_generate: '语音合成 (TTS)',
  image_upscale: '超分放大 (Upscale)',
};

const FEATURE_COLORS: Record<string, string> = {
  text_to_image: '#3b82f6',
  image_to_image: '#22c55e',
  text_to_video: '#a855f7',
  tts_generate: '#ec4899',
  image_upscale: '#f59e0b',
};

export function StatsPanel() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [income, setIncome] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState('7d');
  const [chartMetric, setChartMetric] = useState<'calls' | 'cost'>('calls');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStats();
      setData(res.stats as Record<string, unknown>);
      setIncome(res.income as Record<string, number> || {});
    } catch {
      toast.error('加载统计失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const st = (data?.[period] as Record<string, unknown>) || {};
  const points = (st.pointsStats as Record<string, number>) || {};
  const llm = (st.llmBreakdown as Record<string, number>) || {};
  const feature = (st.featureBreakdown as Record<string, number>) || {};
  const leaderboard = (st.userLeaderboard as Array<Record<string, unknown>>) || [];
  const series = (st.series as Array<Record<string, unknown>>) || [];
  // 与上面同样先收窄再用：直接写 `st.byModel && ...` 会让整条 JSX 子表达式
  // 的类型退化成 unknown（st 是 Record<string, unknown>），无法赋给 ReactNode。
  const byModel = (st.byModel as Record<string, Record<string, unknown>>) || {};

  const totalFeature = Object.values(feature).reduce((a, b) => a + b, 0);

  const chartData = series.map((s) => ({
    time: s.time ? new Date(Number(s.time) * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit' }) : '',
    calls: Number(s.calls) || 0,
    cost: Number(s.cost) || 0,
  }));

  const chartConfig = {
    calls: { label: '调用次数', color: '#3b82f6' },
    cost: { label: '消耗点数', color: '#f59e0b' },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Icon icon="mdi:chart-timeline-variant" className="size-5 text-primary" />
          系统运行多维统计
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8 gap-1 text-xs">
            {loading ? <Spinner className="size-3.5" /> : <Icon icon="mdi:refresh" className="size-3.5" />} 刷新
          </Button>
          <div className="flex items-center bg-muted p-0.5 rounded-lg border text-xs font-medium">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 rounded transition-all ${period === p.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      {!data ? (
        loading ? (
          <div className="flex justify-center py-12"><Spinner className="size-6 text-muted-foreground" /></div>
        ) : (
          <div className="border-2 border-dashed rounded-lg p-12 text-center space-y-2">
            <Icon icon="mdi:chart-timeline-variant" className="size-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">点击「刷新」按钮载入系统统计信息</p>
            <Button size="sm" variant="outline" onClick={load}>立即载入</Button>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            <KpiCard icon="mdi:lightning-bolt-outline" iconColor="text-blue-500" label="总调用" value={String(st.calls ?? '-')} sub={st.failed ? `失败 ${st.failed}` : '100%'} />
            <KpiCard icon="mdi:fire" iconColor="text-amber-500" label="消耗点数" value={String(points.totalSpent ?? '-')} sub={st.cost ? `生成 ${st.cost}` : ''} />
            <KpiCard icon="mdi:cash" iconColor="text-green-500" label="营收" value={income[period] ? `¥${income[period]}` : '-'} sub={points.totalEarned ? `收入 ${points.totalEarned}点` : ''} />
            <KpiCard icon="mdi:account-group-outline" iconColor="text-purple-500" label="活跃用户" value={String(st.totalUsers ?? '-')} sub="唯一用户" />
            <KpiCard icon="mdi:wallet-outline" iconColor="text-pink-500" label="钱包余额" value={String(points.walletBalance ?? '-')} sub="系统总余额" />
          </div>

          {/* Performance */}
          <div className="flex gap-4 text-xs text-muted-foreground border rounded-lg px-3 py-2">
            <span className="flex items-center gap-1"><Icon icon="mdi:clock-outline" className="size-3.5 text-amber-500" />队列等待: {st.queueAvg != null ? `${Number(st.queueAvg).toFixed(1)}s` : '-'}</span>
            <span className="flex items-center gap-1"><Icon icon="mdi:cog-outline" className="size-3.5 text-primary" />生成耗时: {st.processAvg != null ? `${Number(st.processAvg).toFixed(1)}s` : '-'}</span>
          </div>

          {/* Per-Model Duration */}
          {Object.keys(byModel).length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold">各模型平均耗时</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-2">模型</th>
                      <th className="py-1 pr-2">调用</th>
                      <th className="py-1 pr-2">排队</th>
                      <th className="py-1 pr-2">生成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byModel).sort(([,a],[,b]) => Number(b.calls) - Number(a.calls)).map(([label, m]) => (
                      <tr key={label} className="border-b">
                        <td className="py-1 pr-2 font-medium">{label}</td>
                        <td className="py-1 pr-2">{String(m.calls ?? '-')}</td>
                        <td className="py-1 pr-2">{m.qCount ? `${(Number(m.qSum) / Number(m.qCount)).toFixed(1)}s` : '-'}</td>
                        <td className="py-1 pr-2">{m.gCount ? `${(Number(m.gSum) / Number(m.gCount)).toFixed(1)}s` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Leaderboard */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold">高频活跃用户排行榜 (Top 10)</h4>
              {leaderboard.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">当前周期内无生成记录</p>
              ) : (
                <div className="space-y-1">
                  {leaderboard.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                      <span className="w-5 text-center">{`#${i + 1}`}</span>
                      <span className="font-mono">UID {String(u.user_id)}</span>
                      <span className="flex-1 text-right">{String(u.calls)} 次</span>
                      <span className="text-muted-foreground inline-flex items-center"><Icon icon="mdi:lightning-bolt" className="size-3" />{String(u.cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Feature breakdown */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold">业务功能分布与占比</h4>
              {totalFeature === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">暂无数据</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(feature).filter(([, v]) => v > 0).map(([key, val]) => (
                    <div key={key} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span>{FEATURE_LABELS[key] || key}</span>
                        <span className="text-muted-foreground">{val} ({((val / totalFeature) * 100).toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${(val / totalFeature) * 100}%`, backgroundColor: FEATURE_COLORS[key] || '#3b82f6' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LLM Breakdown */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold">LLM 大语言模型使用细分</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border rounded px-2 py-1.5"><span className="text-muted-foreground">总调用</span><br />{llm.totalCalls ?? '-'}</div>
                <div className="border rounded px-2 py-1.5"><span className="text-muted-foreground">总 Token</span><br />{llm.totalTokens ?? '-'}</div>
                <div className="border rounded px-2 py-1.5"><span className="text-muted-foreground">总点数</span><br /><span className="inline-flex items-center"><Icon icon="mdi:lightning-bolt" className="size-3" />{llm.totalCost ?? '-'}</span></div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between border-b pb-1"><span>AI 绘图助手 (沙龙)</span><span className="inline-flex items-center">{llm.saloonCalls ?? 0} 次 / <Icon icon="mdi:lightning-bolt" className="size-3" />{llm.saloonCost ?? 0}</span></div>
                <div className="flex justify-between border-b pb-1"><span>提示词自动翻译</span><span className="inline-flex items-center">{llm.translateCalls ?? 0} 次 / <Icon icon="mdi:lightning-bolt" className="size-3" />{llm.translateCost ?? 0}</span></div>
                <div className="flex justify-between"><span>识图反推 (Vision)</span><span className="inline-flex items-center">{llm.reverseCalls ?? 0} 次 / <Icon icon="mdi:lightning-bolt" className="size-3" />{llm.reverseCost ?? 0}</span></div>
              </div>
              <p className="text-[10px] text-muted-foreground">LLM 费用为自动折算（1 点 ≈ 1000 chars 上下文）</p>
            </div>

            {/* Chart */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold">历史调用频次与流量趋势</h4>
              <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg w-fit text-xs">
                <button onClick={() => setChartMetric('calls')} className={`px-2 py-0.5 rounded transition-all ${chartMetric === 'calls' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>调用次数</button>
                <button onClick={() => setChartMetric('cost')} className={`px-2 py-0.5 rounded transition-all ${chartMetric === 'cost' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>消耗点数</button>
              </div>
              {chartData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">暂无趋势线图数据</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fillCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-calls)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--color-calls)" stopOpacity={0} /></linearGradient>
                      <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-cost)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--color-cost)" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} className="text-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey={chartMetric} stroke={`var(--color-${chartMetric})`} fill={`url(#fill${chartMetric === 'calls' ? 'Calls' : 'Cost'})`} strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, iconColor, label, value, sub }: { icon: string; iconColor: string; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon icon={icon} className={`size-3.5 ${iconColor}`} />
        <span>{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
