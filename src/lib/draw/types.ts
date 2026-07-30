import type { DrawApiError } from './api/client';

export interface Resolution {
  w: number;
  h: number;
  label?: string;
}

// 服务端 /api/presets 的形状（字段名是 content，不是 prompt）
export interface Preset {
  id: string;
  name: string;
  content: string;
  type: 'positive' | 'negative';
}

export interface TranslateResponse {
  ok: boolean;
  positive?: string;
  negative?: string;
  error?: string;
}
