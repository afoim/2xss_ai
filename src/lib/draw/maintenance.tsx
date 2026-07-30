import { Outlet } from 'react-router';

// ── AI 生图后端维护开关 ──
// 后端重构（JSON → SQLite）期间置 true，整块 /draw 路由显示维护页并冻结用户写入；
// 重构上线后改回 false 即可恢复。仅影响 AI 生图，博客/工具/论坛不受影响。
export const DRAW_MAINTENANCE = false;

export const DRAW_MAINTENANCE_MESSAGE =
  'AI 生图正在进行后台升级维护，暂时无法使用。你已生成的图片与账户数据均安全保存，升级完成后会自动恢复，无需任何操作。';

export function DrawMaintenanceGate() {
  if (!DRAW_MAINTENANCE) return <Outlet />;

  return (
    <main className="min-h-[calc(100vh-var(--header-height,56px))] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md border border-border bg-card p-6 font-mono">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <span className="inline-block size-2 bg-amber-500 animate-pulse" aria-hidden />
          <span>SYSTEM · MAINTENANCE</span>
        </div>
        <h1 className="text-lg font-semibold mb-3">AI 生图 · 升级维护中</h1>
        <p className="text-sm leading-relaxed text-muted-foreground mb-5">
          {DRAW_MAINTENANCE_MESSAGE}
        </p>
        <div className="text-xs text-muted-foreground border-t border-border pt-4 space-y-1">
          <div>· 已生成图片：安全保存，可稍后在「我的」查看</div>
          <div>· 账户点数 / 订单：不受影响</div>
          <div>· 预计恢复：升级完成后自动开放</div>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1 mt-5 text-sm text-foreground hover:bg-foreground hover:text-background border border-border px-3 py-1.5 transition-colors"
        >
          ← 返回首页
        </a>
      </div>
    </main>
  );
}
