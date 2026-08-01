import { Outlet, ScrollRestoration, isRouteErrorResponse, useRouteError, Link } from "react-router";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

declare const __BUILD_LABEL__: string;

/**
 * 全站外壳。
 *
 * 没有全局导航栏是刻意的：生图页顶栏自带站名、API 状态、余额和登录/退出，
 * 主站那个 SiteHeader 装的是博客/论坛/工具的入口，搬过来只是多一层。
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <div className="flex-1">
        <Outlet />
      </div>
      <SiteFooter />
      <Toaster />
      <ScrollRestoration />
    </ThemeProvider>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-8 border-t pt-6 pb-8">
      <div className="container mx-auto flex flex-col items-center gap-2 px-4 text-sm text-muted-foreground">
        <p>
          &copy; {new Date().getFullYear()} 二叉树树 ·{" "}
          {/* 直接指门户：2x.nz 现在只是重定向壳，/ 会 302 到这里，多一跳还多一个「主站」的错名 */}
          <a href="https://hub.acofork.com" className="underline hover:text-foreground transition-colors">
            回到门户
          </a>
          {" · "}
          <a href="https://bbs.acofork.com" className="underline hover:text-foreground transition-colors">
            论坛
          </a>
        </p>
        {/* 不要再降透明度：/60 时对比度只有 3.3:1，达不到 WCAG AA 的 4.5:1 */}
        <small className="text-xs">构建时间：{__BUILD_LABEL__}</small>
      </div>
    </footer>
  );
}

export function RootErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const message = is404
    ? "这个地址不存在。"
    : error instanceof Error
      ? error.message
      : "页面出错了，刷新试试。";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="font-mono text-5xl font-bold">{is404 ? "404" : "错误"}</h1>
      <p className="mt-4 text-muted-foreground">{message}</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="outline" size="sm">← 返回生图</Button>
      </Link>
    </main>
  );
}
