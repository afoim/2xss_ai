/**
 * 跨站登录桥 —— 让本站（AI 生图）能用论坛账号登录。
 *
 * 为什么需要它：登录凭证存在 `localStorage['forum-auth-token']`，而 localStorage
 * **按 origin 隔离**。生图站和论坛是两个域名，在论坛登录拿到的 token，这边根本
 * 读不到。直接把「登录」跳到论坛去、登录完再跳回来也没用 —— 回到本 origin 时
 * 依然没有 token，成了死循环。
 *
 * 所以走一次**显式授权交接**：
 *
 *   本站（未登录）
 *     → 论坛 /auth/authorize?redirect_uri=…      （论坛侧，未登录会先要求登录）
 *     → 授权确认页（告诉用户要把论坛身份交给哪个站点）
 *     → 本站 /#auth_token=…                       （用 fragment，不是 query）
 *     → 本模块把 token 收进本站自己的 localStorage 并擦掉地址栏的 fragment
 *
 * 两个安全点，改动时不要绕过：
 *
 * 1. **token 走 URL fragment 而不是查询串**。fragment 不会被浏览器发给服务器，
 *    因此不会进 Cloudflare / nginx 的访问日志，也不会出现在 Referer 头里。
 *    论坛后端的 GitHub 回调用的也是这个办法。
 * 2. **redirect_uri 的白名单在论坛那一侧**（`VITE_AUTH_ALLOWED_ORIGINS`）。
 *    没有白名单，那个授权页就是个开放重定向：任何人构造
 *    `?redirect_uri=https://evil.example` 就能把已登录用户的 token 骗走。
 *
 * 拿到的 token 就是论坛的 JWT，生图后端（api-ai.acofork.com）本来就认它
 * （`Authorization: Bearer <论坛 token>`），所以交接完成即登录完成，没有第二套账号。
 */

const TOKEN_KEY = 'forum-auth-token';
const HASH_KEY = 'auth_token';

/** 论坛所在的 origin —— 授权交接的唯一发起方 */
export const FORUM_ORIGIN = (
  import.meta.env.VITE_FORUM_SITE_URL || 'https://bbs.acofork.com'
).replace(/\/+$/, '');

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略即可 */
  }
}

/**
 * 未登录时该把用户送去哪里：论坛的授权页，带上回来的地址。
 * `returnTo` 缺省用当前页（含查询串），授权后原样回到这里。
 */
export function authorizeUrl(returnTo?: string): string {
  const target = returnTo || window.location.pathname + window.location.search;
  const redirectUri = new URL(target, window.location.origin).toString();
  return `${FORUM_ORIGIN}/auth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

/** 直接把当前标签页送去授权 */
export function goAuthorize(returnTo?: string) {
  window.location.href = authorizeUrl(returnTo);
}

/**
 * 从地址栏 fragment 里接收 token 并落到本 origin 的 localStorage。
 *
 * **必须在任何读 token 的代码之前跑**（见 src/main.tsx 的调用点，在 createRoot
 * 之前），否则首屏第一个 effect 读到的还是空的，用户会被再送去授权一次。
 *
 * 返回是否真的收到了 token。
 */
export function consumeTokenFromHash(): boolean {
  const hash = window.location.hash;
  if (!hash || !hash.includes(`${HASH_KEY}=`)) return false;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get(HASH_KEY);
  if (!token) return false;

  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return false;
  }

  // 擦掉 fragment，免得用户复制地址栏时把 token 一起发出去。
  // 用 replaceState 而不是改 location.hash：后者会留下一条历史记录，
  // 用户按返回键又会回到带 token 的地址。
  params.delete(HASH_KEY);
  const rest = params.toString();
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search + (rest ? `#${rest}` : ''),
  );
  return true;
}
