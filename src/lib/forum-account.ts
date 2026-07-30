/**
 * 论坛账号接口 —— 只保留生图站真正用得到的两个动作。
 *
 * 生图站没有自己的账号体系：登录态是论坛的 JWT，由授权交接拿到（见 auth-bridge.ts），
 * 生图后端也直接认这个 token。所以这里不需要搬整份论坛 API client（那是 675 行、
 * 帖子评论一大堆），只要「我是谁」和「退出」两件事。
 */
import { getToken, clearToken } from './auth-bridge';

const FORUM_API = (import.meta.env.VITE_FORUM_API_BASE || 'https://i.2x.nz').replace(/\/+$/, '');

export interface ForumUser {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
}

/** 当前登录用户。未登录或 token 失效时抛错，调用方自己决定要不要去授权 */
export async function getCurrentUser(): Promise<ForumUser> {
  const token = getToken();
  if (!token) throw new Error('未登录');
  const res = await fetch(`${FORUM_API}/api/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(res.status === 401 ? '登录已失效' : '获取用户信息失败');
  const raw = (await res.json()) as Record<string, unknown>;
  const u = (raw.user && typeof raw.user === 'object' ? raw.user : raw) as Record<string, unknown>;
  return {
    id: String(u.id ?? ''),
    username: String(u.username ?? ''),
    displayName: u.display_name as string | undefined,
    avatarUrl: (u.avatar_url as string) || undefined,
    role: u.role as string | undefined,
  };
}

/**
 * 退出登录：先清本地、再异步吊销论坛那边的会话。
 * 顺序不能反 —— 先 await 接口的话，接口慢/挂了 UI 会一直停在已登录状态。
 *
 * 注意这只登出**本站**。论坛那边的登录态不受影响（那是另一个 origin 的
 * localStorage），要彻底退出得去论坛自己退一次 —— 这也是授权模型的应有之义。
 */
export async function logout(): Promise<void> {
  const token = getToken();
  clearToken();
  if (!token) return;
  try {
    await fetch(`${FORUM_API}/api/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Nonce': crypto.randomUUID?.() || Math.random().toString(36),
      },
    });
  } catch {
    /* 本地已经登出了，服务端吊销失败不影响用户 */
  }
}
