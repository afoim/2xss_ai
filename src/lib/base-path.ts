/**
 * 部署基路径 —— 全站唯一来源。
 *
 * 站内路径在代码里一律**不带**前缀（`/post/19`、`/auth/login`），由 React Router
 * 的 `basename` 统一补。所以：
 *   - `<Link to="/post/19">` / `navigate('/me')` 直接写裸路径，什么都不用管；
 *   - 只有绕过路由的地方（`window.location.href`、发给后端的绝对回调地址）
 *     才需要 `withBase()` / `absUrl()` 手动补前缀。
 *
 * 值由构建期环境变量 `VITE_BASE_PATH` 决定，必须与 vite.config.ts 的 `base`
 * 保持一致（两处读的是同一个变量）。
 */

/** 归一化后的前缀：`""`（站点根）或 `/forum` 这样的无尾斜杠形态 */
export const BASE_PATH: string = (import.meta.env.VITE_BASE_PATH || "").replace(/\/+$/, "");

/** React Router 的 basename —— 空前缀时必须是 `/` 而不是空串 */
export const ROUTER_BASENAME: string = BASE_PATH || "/";

/** 给站内路径补上部署前缀：`/auth/login` → `/forum/auth/login` */
export function withBase(path: string): string {
  return BASE_PATH + path;
}

/** 补成同源绝对地址（GitHub OAuth 回跳等要求绝对 URL 的场景） */
export function absUrl(path: string): string {
  return window.location.origin + withBase(path);
}
