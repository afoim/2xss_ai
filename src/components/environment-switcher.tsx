'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

const CONFIG = {
  draw: {
    storageKey: 'draw-api-base-url',
    envKey: 'draw-api-env',
    label: '生图',
    urls: { prod: 'https://api-ai.acofork.com', dev: 'http://localhost:8080' },
  },
  forum: {
    storageKey: 'forum-api-base-url',
    envKey: 'forum-api-env',
    label: '论坛',
    urls: { prod: 'https://i.2x.nz', dev: 'http://127.0.0.1:8787' },
  },
};

interface Props {
  type: 'draw' | 'forum';
  onClose?: () => void;
}

export function EnvironmentSwitcher({ type, onClose }: Props) {
  const cfg = CONFIG[type];
  const [env, setEnv] = useState<'prod' | 'dev'>('prod');
  const [customUrl, setCustomUrl] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(cfg.envKey);
      if (saved === 'dev' || saved === 'prod') setEnv(saved);
    } catch {}
    try {
      const url = localStorage.getItem(cfg.storageKey);
      setCustomUrl(url || cfg.urls[env]);
    } catch {}
  }, [cfg.envKey, cfg.storageKey, cfg.urls, env]);

  const toggleEnv = () => {
    const next = env === 'prod' ? 'dev' : 'prod';
    setEnv(next);
    try {
      localStorage.setItem(cfg.envKey, next);
      localStorage.setItem(cfg.storageKey, cfg.urls[next]);
    } catch {}
    setCustomUrl(cfg.urls[next]);
  };

  const apply = () => {
    try {
      localStorage.setItem(cfg.storageKey, customUrl);
    } catch {}
    window.location.reload();
  };

  const resetUrl = () => {
    setCustomUrl(cfg.urls[env]);
    try {
      localStorage.setItem(cfg.storageKey, cfg.urls[env]);
    } catch {}
  };

  return (
    <div className="space-y-3">
      {/* Environment toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => { setEnv('prod'); try { localStorage.setItem(cfg.envKey, 'prod'); localStorage.setItem(cfg.storageKey, cfg.urls.prod); } catch {} setCustomUrl(cfg.urls.prod); }}
          className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${env === 'prod' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'border border-input hover:bg-foreground hover:text-background'}`}
        >
          生产 {env === 'prod' && '✓'}
        </button>
        <button
          onClick={toggleEnv}
          className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${env === 'dev' ? 'bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'border border-input hover:bg-foreground hover:text-background'}`}
        >
          开发 {env === 'dev' && '✓'}
        </button>
      </div>

      {/* Custom URL */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {cfg.label} API 地址
          {env === 'prod' && <span className="ml-1 text-[10px] text-muted-foreground/60">（生产环境不可编辑）</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            disabled={env === 'prod'}
            placeholder={cfg.urls[env]}
            className="flex-1 h-9 px-3 rounded-lg border bg-background text-xs disabled:opacity-50"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={apply}>应用并刷新</Button>
        <Button size="sm" variant="outline" onClick={resetUrl}>恢复默认</Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
        )}
      </div>
    </div>
  );
}
