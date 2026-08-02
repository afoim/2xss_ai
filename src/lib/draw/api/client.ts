import { track } from '@/lib/track';
import { clearToken, goAuthorize } from '@/lib/auth-bridge';

const DRAW_API_BASE_URLS = {
  prod: import.meta.env.VITE_DRAW_API_BASE || 'https://api-ai.acofork.com',
  dev: 'http://localhost:8080',
};

function getBaseUrl(): string {
  if (typeof window === 'undefined') return DRAW_API_BASE_URLS.prod;
  try {
    return localStorage.getItem('draw-api-base-url') || DRAW_API_BASE_URLS.prod;
  } catch {
    return DRAW_API_BASE_URLS.prod;
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('forum-auth-token');
  } catch {
    return null;
  }
}

export class DrawApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DrawApiError';
    this.status = status;
  }
}

export async function drawRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (res.ok) {
      return (await res.json()) as T;
    }

    let errMsg = '请求失败';
    try {
      const body = await res.json();
      errMsg = body.detail || body.error || body.message || errMsg;
      if (body.code === 'USER_BANNED') {
        throw new DrawApiError('USER_BANNED', res.status);
      }
    } catch (e) {
      if (e instanceof DrawApiError) throw e;
    }

    if (res.status === 401) {
      // 本站没有自己的登录页：token 是论坛的，失效了只能回论坛重新授权一次
      clearToken();
      goAuthorize();
    }

    throw new DrawApiError(errMsg, res.status);
  } catch (e) {
    if (e instanceof DrawApiError) throw e;
    throw new DrawApiError(e instanceof Error ? e.message : '网络错误', 0);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Queue ──

/** 生图请求从哪个界面来的 —— 五个入口最终都汇到 addToQueue，在这里认一次就够 */
function queueEntry(payload: Record<string, unknown>): string {
  if (payload.image1_name) return '图生图';
  if (payload.source === 'assistant') return 'AI 助手';
  if (payload.source === 'saloon') return '包间';
  return '文生图';
}

export function addToQueue(payload: Record<string, unknown>) {
  // 埋点放在这个汇合点，而不是五个调用处各写一遍：prompt-form / real-prompt-form /
  // img2img-form / ai-assistant-tab / saloon-tab / draw page 都走这里，
  // 以后新增生图入口也自动被统计到。**不上报 prompt 内容**，那是用户输入
  track('生成图片', {
    入口: queueEntry(payload),
    模式: typeof payload.mode === 'string' ? payload.mode : undefined,
    带Lora: Array.isArray(payload.loras) && payload.loras.length > 0,
  });
  return drawRequest<{ queued?: boolean; position?: number; item_id?: number; message?: string }>('/api/draw/queue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchMyQueue() {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>('/api/draw/my-queue');
}

/** 插队券：位置 N 用 N 张券插到队首（2026-08-02） */
export function skipQueueItem(itemId: number) {
  return drawRequest<{ ok: boolean; position?: number; skipped_ahead?: number }>(`/api/draw/queue/${itemId}/skip`, {
    method: 'POST',
  });
}

export function clearQueue() {
  return drawRequest<void>('/api/draw/queue', { method: 'DELETE' });
}

export function fetchDebugInfo() {
  return drawRequest<{ queue_items: Record<string, unknown>[]; stuck: Record<string, unknown>[] }>('/api/draw/debug');
}

export function fetchStorage() {
  return drawRequest<{ items: Record<string, unknown>[]; total_size: number }>('/api/draw/admin/storage');
}

// ── Admin: Lora Approval ──

export function getPendingLoraSubmissions() {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>('/api/lora/admin/pending');
}

export function approveLora(id: string) {
  return drawRequest<{ ok: boolean; task_id: string }>('/api/lora/admin/approve', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function getApproveStatus(taskId: string) {
  return drawRequest<{ task: Record<string, unknown> }>(`/api/lora/admin/approve-status/${taskId}`);
}

export function rejectLora(id: string) {
  return drawRequest<{ ok: boolean }>('/api/lora/admin/reject', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

// ── Admin: Lora 诊断与修复 ──

export interface LoraHealth {
  located: boolean;
  subdir: string | null;
  lora_path: string | null;
  meta_key: string | null;
  meta: Record<string, unknown> | null;
  meta_key_by_url: string | null;
  searchable: boolean;
  issues: string[];
}

export interface LoraApplication {
  id: string;
  user_id: number;
  url: string;
  name: string;
  category: string;
  trigger: string;
  type: string;
  lora_type: string;
  status: string;
  created_at: number;
  admin_note?: string;
  _health: LoraHealth;
}

export function getLoraApplications(params: { search?: string; status?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  qs.set('limit', String(params.limit ?? 80));
  return drawRequest<{ items: LoraApplication[]; total: number }>(`/api/lora/admin/applications?${qs.toString()}`);
}

export function relocateLora(payload: {
  id: string;
  name?: string;
  category?: string;
  trigger?: string;
  lora_type?: 'character' | 'style';
  mode?: 'WAI' | 'ANIMA';
}) {
  return drawRequest<{ ok: boolean; changes: string[]; health: LoraHealth; app: LoraApplication }>('/api/lora/admin/relocate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getCivitaiCategory(url: string) {
  return drawRequest<{ ok: boolean; model_id: string; model_type: string; tags: string[]; suggested: 'character' | 'style' | null }>(
    `/api/lora/admin/civitai-category?url=${encodeURIComponent(url)}`,
  );
}

// ── User: Lora Apply (ByoLora) ──

export function submitLora(data: {
  url: string;
  name: string;
  category: string;
  trigger: string;
  lora_type: string;
  confirm?: boolean;
}) {
  return drawRequest<{
    ok?: boolean;
    application?: Record<string, unknown>;
    auto_approving?: boolean;
    task_id?: string;
    // 预探测：CivitAI 官方分类与所选不一致时返回，需二次确认
    needs_confirm?: boolean;
    suggested?: 'character' | 'style';
    submitted?: 'character' | 'style';
    tags?: string[];
  }>('/api/lora/apply', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getMyLoraSubmissions() {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>('/api/lora/my-submissions');
}

export function cancelLora(id: string) {
  return drawRequest<{ ok: boolean }>('/api/lora/cancel', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

// ── Output ──

export function fetchOutputList(params: Record<string, string | number | undefined> = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return drawRequest<Record<string, unknown>[]>(`/api/output/list${qs ? '?' + qs : ''}`);
}

export function fetchMyImages(source = 'default') {
  return drawRequest<{ items: { path: string; mtime: number }[]; total: number }>(`/api/draw/my-images?source=${source}`);
}

export function fetchFeatured() {
  return drawRequest<Record<string, unknown>[]>('/api/output/featured');
}

export function fetchOutputMeta(path: string) {
  return drawRequest<Record<string, unknown>>(`/api/output/meta?path=${encodeURIComponent(path)}`);
}

/** Fork 一张图：后端解析 PNG 里的 ComfyUI 工作流，反解出生图页能填的参数 */
export interface ForkParams {
  supported: boolean;
  reason?: string;
  nav_key?: string;
  mode?: 'WAI' | 'ANIMA';
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  characters?: Record<string, unknown>[];
  styles?: Record<string, unknown>[];
  /** 图里用过、但已不在当前库里的 Lora（旧图常见，只能保留其提示词） */
  unmatched_loras?: string[];
}

export function fetchForkParams(path: string) {
  return drawRequest<ForkParams>(`/api/output/params?path=${encodeURIComponent(path)}`);
}

export function deleteMyImage(path: string) {
  return drawRequest<void>('/api/draw/my-images', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
}

export function clearMyImages() {
  return drawRequest<void>('/api/draw/my-images/all', { method: 'DELETE' });
}

// ── Wallet ──

export function fetchWalletBalance() {
  return drawRequest<{ balance: number; total_purchased?: number; skip_vouchers?: number }>('/api/wallet/balance');
}

export function fetchPlans() {
  return drawRequest<Record<string, unknown>[]>('/api/wallet/plans');
}

export function fetchPointsConfig() {
  return drawRequest<Record<string, unknown>>('/api/wallet/points-config');
}

export function createWalletOrder(planId: string) {
  return drawRequest<{ orderUrl?: string }>('/api/wallet/create-order', {
    method: 'POST',
    body: JSON.stringify({ plan_id: planId }),
  });
}

export function giftPoints(recipientId: string, points: number) {
  return drawRequest<{ ok: boolean; balance: number }>('/api/wallet/gift', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientId, points }),
  });
}

// ── Library ──

export function fetchLibrary(mode: 'WAI' | 'ANIMA') {
  return drawRequest<{ characters?: unknown[]; styles?: unknown[] }>(`/api/library?mode=${mode}`);
}

// ── Workflows ──

export function fetchWorkflows(subdir?: string) {
  const qs = subdir ? `?subdir=${encodeURIComponent(subdir)}` : '';
  return drawRequest<unknown[]>(`/api/workflows${qs}`);
}

export function fetchStyles() {
  return drawRequest<unknown[]>('/api/styles');
}

export function fetchResolutions() {
  return drawRequest<unknown[]>('/api/resolutions');
}

// ── 提示词预设（服务端存储，需登录）──

export function fetchPresets() {
  return drawRequest<import('../types').Preset[]>('/api/presets');
}

export function createPreset(data: { name: string; content: string; type: string }) {
  return drawRequest<import('../types').Preset>('/api/presets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePreset(id: string, data: { name?: string; content?: string; type?: string }) {
  return drawRequest<import('../types').Preset>(`/api/presets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deletePreset(id: string) {
  return drawRequest<{ ok: boolean }>(`/api/presets/${id}`, { method: 'DELETE' });
}

// ── Chat / Presets ──

export function chatRequest(payload: Record<string, unknown>) {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/draw/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export function chatNudge(payload: Record<string, unknown>) {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/draw/chat/nudge`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

/**
 * 预设的字段名是 **camelCase 的 `systemPrompt`** —— 库里 98 条存的都是它。
 * 注意别照抄 `/api/draw/chat` 的 `system_prompt`：那条是 snake_case，两边确实不一样。
 * 这里仍读两种拼法，是为了兜住可能存在的老数据。
 */
export interface ChatPreset {
  id: string;
  name: string;
  systemPrompt: string;
}

export async function fetchChatPresets(): Promise<{ items: ChatPreset[] }> {
  const res = await drawRequest<{ items: (Partial<ChatPreset> & { system_prompt?: string })[] }>(
    '/api/draw/chat-presets',
  );
  const items = (res.items || []).map((p) => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    systemPrompt: String(p.systemPrompt ?? p.system_prompt ?? ''),
  }));
  return { items };
}

export function saveChatPreset(name: string, systemPrompt: string) {
  return drawRequest<{ ok: boolean; preset?: { id: string } }>('/api/draw/chat-presets', {
    method: 'POST',
    // 两种拼法都发，免得哪个客户端/后端版本只认其中一种
    body: JSON.stringify({ name, systemPrompt, system_prompt: systemPrompt }),
  });
}

export function deleteChatPreset(id: string) {
  return drawRequest<{ ok: boolean }>(`/api/draw/chat-presets/${id}`, { method: 'DELETE' });
}

export function fetchChatHistory() {
  return drawRequest<{ items: { role: string; content: string }[] }>('/api/draw/chat-history');
}

export function appendChatHistory(messages: { role: string; content: string }[]) {
  return drawRequest<void>('/api/draw/chat-history', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}

export function clearChatHistory() {
  return drawRequest<void>('/api/draw/chat-history', { method: 'DELETE' });
}

/**
 * 撤回聊天记录里的第 index 条（0 基，服务端下标）。
 * role/content 是给服务端做防漂移校验的，对不上它回 409 而不是删错人。
 */
export function deleteChatHistoryAt(index: number, role: string, content: string) {
  return drawRequest<{ ok: boolean; total: number }>('/api/draw/chat-history/delete', {
    method: 'POST',
    body: JSON.stringify({ index, role, content }),
  });
}

// ── AI Assistant ──

export function assistantChatRequest(payload: Record<string, unknown>, signal?: AbortSignal) {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/draw/assistant/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    // signal 不接上的话，聊天框的「停止」按钮 abort 的是一个没挂到请求上的控制器，
    // 流照常吐，表现为点了没反应
    signal,
  });
}

/** selection = 用户在选择器里勾的角色/画风完整条目，刷新后要能还原成 chip */
export interface AssistantSelection {
  charItems?: unknown[];
  styleItems?: unknown[];
}

export function fetchAssistantSession() {
  return drawRequest<{ messages?: unknown[]; mode?: string; selection?: AssistantSelection | null } | null>('/api/draw/assistant/session');
}

export function saveAssistantSession(messages: unknown[], mode: string, selection?: AssistantSelection | null) {
  return drawRequest<void>('/api/draw/assistant/session', {
    method: 'POST',
    body: JSON.stringify({ messages, mode, selection: selection ?? null }),
  });
}

export function deleteAssistantSession() {
  return drawRequest<void>('/api/draw/assistant/session', { method: 'DELETE' });
}

// 依据 item_id / prompt 从后端持久化结果里找回生图输出（跨刷新、队列清理后仍可恢复）
export function fetchAssistantResult(itemId?: number, prompt?: string) {
  return drawRequest<{ file: string | null }>('/api/draw/assistant/result', {
    method: 'POST',
    body: JSON.stringify({
      item_id: itemId != null && !Number.isNaN(itemId) ? itemId : undefined,
      prompt: prompt || undefined,
    }),
  });
}

export function ttsSynthesize(payload: Record<string, unknown>) {
  return drawRequest<{ audio_url?: string }>('/api/draw/tts/synthesize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── TTS ──

export function fetchTtsSpeakers() {
  return drawRequest<Record<string, unknown>[]>('/api/draw/tts/speakers');
}

export function fetchTtsMyRecords() {
  return drawRequest<Record<string, unknown>[]>('/api/draw/tts/my-records');
}

export async function uploadTtsRefAudio(file: File): Promise<{ filename: string }> {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const fd = new FormData();
  fd.append('audio', file);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}/api/tts/upload-ref`, {
    method: 'POST',
    headers,
    body: fd,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || body.error || body.message || '上传失败');
  }
  return resp.json();
}

// ── Admin ──

export function getAnnouncement() {
  return drawRequest<{ announcement: { enabled: boolean; title: string; content: string } }>('/api/draw/admin/announcement');
}

export function updateAnnouncement(data: { enabled?: boolean; title?: string; content?: string }) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/announcement', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getRecentImages(limit = 50, offset = 0) {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>(`/api/draw/admin/recent?limit=${limit}&offset=${offset}`);
}

export function getImagesByUser(userId: string | number) {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>(`/api/draw/admin/images_by_user?user_id=${userId}`);
}

export function adminDeleteImage(path: string) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/delete', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
}

export function adminDeleteImages(paths: string[]) {
  return drawRequest<{ ok: boolean; deleted: number; failed: number }>('/api/draw/admin/delete_batch', {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });
}

export function addFeatured(path: string) {
  return drawRequest<{ ok: boolean; items: string[] }>('/api/draw/admin/featured/add', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function getFeatured() {
  return drawRequest<{ items: string[] }>('/api/draw/admin/featured');
}

export function removeFeatured(path: string) {
  return drawRequest<{ ok: boolean; items: string[] }>('/api/draw/admin/featured/remove', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function getBannedUsers() {
  return drawRequest<{ banned: Record<string, unknown>[] }>('/api/draw/admin/draw-banned');
}

export function banUser(userId: number, days: number, reason: string) {
  return drawRequest<{ ok: boolean; banned: Record<string, unknown>[] }>('/api/draw/admin/draw-ban', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, days, reason }),
  });
}

export function unbanUser(userId: number) {
  return drawRequest<{ ok: boolean; banned: Record<string, unknown>[] }>('/api/draw/admin/draw-unban', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function fetchRecommendations() {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>('/api/draw/admin/recommendations');
}

export function resolveRecommendation(recId: string, action: 'approve' | 'reject', reason?: string, imagePath?: string) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/recommendations/resolve', {
    method: 'POST',
    body: JSON.stringify({ rec_id: recId, action, reason: reason || '', image_path: imagePath || '' }),
  });
}

export function resolveRecommendations(recIds: string[], action: 'approve' | 'reject', reason?: string) {
  return drawRequest<{ ok: boolean; resolved: number }>('/api/draw/admin/recommendations/resolve-batch', {
    method: 'POST',
    body: JSON.stringify({ rec_ids: recIds, action, reason: reason || '' }),
  });
}

// ── Admin: Wallet ──

export function getWallets() {
  return drawRequest<{ items: Record<string, unknown>[] }>('/api/draw/admin/wallets');
}

export function setWalletBalance(userId: number, balance?: number, skipVouchers?: number) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/wallets/set', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, balance, skip_vouchers: skipVouchers }),
  });
}

export function givePoints(userId: number | null, points: number) {
  return drawRequest<{ ok: boolean; count: number }>('/api/draw/admin/wallets/give', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, points }),
  });
}

/** 后台发插队券（currency: voucher） */
export function giveVouchers(userId: number | null, vouchers: number) {
  return drawRequest<{ ok: boolean; count: number }>('/api/draw/admin/wallets/give', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, points: vouchers, currency: 'voucher' }),
  });
}

export function getPlans() {
  return drawRequest<{ items: Record<string, unknown>[] }>('/api/draw/admin/plans');
}

export function savePlan(plan: Record<string, unknown>) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/plans', {
    method: 'POST',
    body: JSON.stringify(plan),
  });
}

export function deletePlan(id: string) {
  return drawRequest<{ ok: boolean }>(`/api/draw/admin/plans/${id}`, { method: 'DELETE' });
}

export function savePointsConfig(cfg: Record<string, unknown>) {
  return drawRequest<{ ok: boolean }>('/api/draw/admin/points-config', {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
}

export function fetchStats() {
  return drawRequest<Record<string, unknown>>('/api/draw/admin/stats');
}

// ── Admin: LLM Config ──

export function getLlmConfig() {
  return drawRequest<{ config: Record<string, unknown>; providers: string[] }>('/api/draw/admin/llm_config');
}

export function updateLlmConfig(data: Record<string, unknown>) {
  return drawRequest<{ ok: boolean; config?: Record<string, unknown> }>('/api/draw/admin/llm_config', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function testLlmConfig(profileIndex?: number) {
  return drawRequest<Record<string, unknown>>('/api/draw/admin/llm_config/test', {
    method: 'POST',
    body: JSON.stringify({ profile_index: profileIndex }),
  });
}

export function getLlmModels(profileIndex?: number) {
  return drawRequest<{ models: string[] }>('/api/draw/admin/llm_config/models', {
    method: 'POST',
    body: JSON.stringify({ profile_index: profileIndex }),
  });
}

// ── Admin: Limits ──

export function getLimits() {
  return drawRequest<{ limits: Record<string, unknown>; defaults: Record<string, unknown> }>('/api/draw/admin/limits');
}

export function updateLimits(partial: Record<string, unknown>) {
  return drawRequest<{ ok: boolean; limits: Record<string, unknown> }>('/api/draw/admin/limits', {
    method: 'POST',
    body: JSON.stringify(partial),
  });
}

// ── Recommendations ──

export function recommendImage(imagePath: string, reason?: string) {
  return drawRequest<{ ok: boolean }>('/api/draw/recommend', {
    method: 'POST',
    body: JSON.stringify({ image_path: imagePath, reason: reason || '' }),
  });
}

export function fetchMyRecommendations() {
  return drawRequest<{ items: Record<string, unknown>[]; total: number }>('/api/draw/my-recommendations');
}

// ── Image URL helpers ──

export function getThumbnailUrl(path: string): string {
  return `${getBaseUrl()}/api/thumbnail?path=${encodeURIComponent(path)}`;
}

export function getImageUrl(path: string): string {
  return `${getBaseUrl()}/api/output/file?path=${encodeURIComponent(path)}`;
}
