import { createBrowserRouter } from "react-router";
import RootLayout, { RootErrorBoundary } from "./root-layout";
import { ROUTER_BASENAME } from "./lib/base-path";

/**
 * 路由表 —— **只有生图**，没有博客/论坛/工具那些路由。
 *
 * 主站上这四条路由是 `/draw`、`/draw/img2img`、`/draw/admin`、
 * `/draw/admin/collaborator`；独立部署后前缀去掉，由 basename 统一补
 * （见 lib/base-path.ts）。
 *
 * 没有 loader：生图页的数据全部依赖登录态和用户交互，一上来就取没有意义 ——
 * 这也是它在主站上一直是整页 ClientOnly 的原因（canvas/WebGL/File API
 * 在组件顶层就有依赖，SSR 零收益）。
 */
export const router = createBrowserRouter(
  [
    {
      path: "/",
      Component: RootLayout,
      ErrorBoundary: RootErrorBoundary,
      children: [
        { index: true, lazy: () => import("./pages/draw") },
        { path: "img2img", lazy: () => import("./pages/img2img") },
        // /admin/collaborator 必须排在 /admin 之前吗？不必 —— 两条都是精确路径，
        // 没有参数段，匹配顺序无关。列在一起只是为了看着顺
        { path: "admin", lazy: () => import("./pages/admin") },
        { path: "admin/collaborator", lazy: () => import("./pages/admin-collaborator") },
        { path: "*", lazy: () => import("./pages/not-found") },
      ],
    },
  ],
  { basename: ROUTER_BASENAME },
);
