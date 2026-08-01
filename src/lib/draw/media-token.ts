/**
 * 媒体令牌 —— 给 `<img src>` 和下载链接用的短时效凭证。
 *
 * 为什么需要它：图片请求和 `a.click()` 下载都**带不了 Authorization 头**，
 * 以前的做法是把论坛会话令牌直接拼进 query string。那条 URL 一旦被复制出去
 * （右键「复制图片地址」、分享、进访问日志），拿到的人就有了一张 7 天有效的
 * 全权账号令牌 —— 它当 Bearer 用在任何接口上都成立，包括管理接口。
 *
 * 现在改成先用会话令牌换一张 15 分钟、只有几个图片端点认的媒体令牌。
 *
 * 取值是**同步**的（URL 拼接都发生在渲染期），靠 localStorage 缓存 + 后台刷新
 * 保证绝大多数时候手上就有一张；首次进站那一下拿不到时，组件用 `useMediaToken()`
 * 订阅，令牌到手会触发一次重渲染把 URL 补上。
 */
import { useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'draw-media-token';
const AUTH_KEY = 'forum-auth-token';
const BASE_URL_KEY = 'draw-api-base-url';
const DEFAULT_BASE = 'https://api-ai.acofork.com';
/** 剩余不到这个数就提前换新的，别等用户点到一张刚过期的图 */
const REFRESH_MARGIN_MS = 3 * 60 * 1000;

interface Cached {
  token: string;
  /** 绝对过期时刻（毫秒） */
  expiresAt: number;
  /** 签这张令牌时用的会话令牌指纹，换账号/重新登录后作废 */
  authFingerprint: string;
}

let memo: Cached | null = null;
let inflight: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

/**
 * 异步通知。`getMediaToken()` 是在渲染期被 URL 拼接函数调到的，同步 emit
 * 会变成「渲染一个组件时更新另一个组件」，React 直接告警。丢进微任务，
 * 等这一轮渲染跑完再通知。
 */
function emit() {
  queueMicrotask(() => {
    for (const l of listeners) l();
  });
}

function readLocal(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function baseUrl(): string {
  return readLocal(BASE_URL_KEY) || DEFAULT_BASE;
}

/** 会话令牌本身不入内存做比对，取首尾做指纹就够区分「换人了」 */
function fingerprint(auth: string): string {
  return `${auth.length}:${auth.slice(0, 8)}:${auth.slice(-8)}`;
}

function loadFromStorage(): Cached | null {
  const raw = readLocal(STORAGE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Cached;
    if (typeof p?.token === 'string' && typeof p?.expiresAt === 'number') return p;
  } catch {}
  return null;
}

function persist(c: Cached | null) {
  if (typeof window === 'undefined') return;
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function usable(c: Cached | null, auth: string, marginMs: number): boolean {
  return (
    !!c &&
    c.authFingerprint === fingerprint(auth) &&
    c.expiresAt - Date.now() > marginMs
  );
}

/**
 * 同步取当前可用的媒体令牌；顺手在需要时触发一次后台刷新。
 * 没登录、或还没换到令牌时返回 null（调用方就不拼 `mt` 参数，后端会给 401，
 * 令牌到手后重渲染自然补上）。
 */
export function getMediaToken(): string | null {
  const auth = readLocal(AUTH_KEY);
  if (!auth) {
    // 登出了：把残留的媒体令牌清掉，别让它继续能用满 15 分钟
    if (memo) {
      memo = null;
      persist(null);
      emit();
    }
    return null;
  }
  if (!memo) memo = loadFromStorage();
  if (!usable(memo, auth, REFRESH_MARGIN_MS)) void ensureMediaToken();
  // 已过期就别再拿出来用了（还没到刷新余量的那段仍可用）
  return usable(memo, auth, 0) ? memo!.token : null;
}

/** 需要「一定拿到」时用它（比如点击下载）。失败返回 null */
export async function ensureMediaToken(): Promise<string | null> {
  const auth = readLocal(AUTH_KEY);
  if (!auth) return null;
  if (!memo) memo = loadFromStorage();
  if (usable(memo, auth, REFRESH_MARGIN_MS)) return memo!.token;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${baseUrl()}/api/media-token`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string; expires_in?: number };
      if (!data?.token) return null;
      memo = {
        token: data.token,
        // 比服务端 TTL 保守 30 秒，避开两边时钟差
        expiresAt: Date.now() + ((data.expires_in ?? 900) - 30) * 1000,
        authFingerprint: fingerprint(auth),
      };
      persist(memo);
      emit();
      return memo.token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 接在已有查询串后面用（已带 `&`），没令牌时是空串 */
export function mediaTokenParam(): string {
  const t = getMediaToken();
  return t ? `&mt=${encodeURIComponent(t)}` : '';
}

/** 作为 URL 的第一个查询参数用（已带 `?`），没令牌时是空串 */
export function mediaTokenQuery(): string {
  const t = getMediaToken();
  return t ? `?mt=${encodeURIComponent(t)}` : '';
}

/**
 * 把 URL 里的 `mt` 换成当前这一张。
 *
 * 给「URL 被存进 state / 持久化过」的场景用：会话令牌能管 7 天，媒体令牌只有
 * 15 分钟，恢复旧会话时存下来的那条 URL 上的令牌基本都过期了 —— 渲染时刷一遍，
 * 就不用把这些地方改成存文件名再拼。
 */
export function withFreshMediaToken(raw: string): string {
  if (!raw) return raw;
  const t = getMediaToken();
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.href : 'https://2x.nz');
    u.searchParams.delete('mt');
    if (t) u.searchParams.set('mt', t);
    return u.href;
  } catch {
    return raw;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function snapshot(): string | null {
  return memo?.token ?? null;
}

/**
 * 在会渲染图片 URL 的组件里调一次。作用是**订阅**：令牌换到手时触发重渲染，
 * 让那一批 `<img src>` 从「没有 mt」变成「带 mt」。
 */
export function useMediaToken(): string | null {
  const token = useSyncExternalStore(subscribe, snapshot, () => null);
  // 放 effect 里而不是渲染期：ensureMediaToken 内部会 emit。
  // 不写依赖数组是有意的 —— 令牌够新时它立即返回，等于一次对象比较
  useEffect(() => {
    void ensureMediaToken();
  });
  return token;
}
