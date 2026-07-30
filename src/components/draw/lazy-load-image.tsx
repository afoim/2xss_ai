'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';

interface Props {
  children: ReactNode;
  /** 点击"刷新图片"时拉取最新数据 */
  onRefreshData?: () => Promise<unknown> | void;
}

const RefreshContext = createContext(0);

export function useRefreshKey() {
  return useContext(RefreshContext);
}

export function GalleryGate({ children, onRefreshData }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onRefreshData?.(); } catch {} finally { setRefreshing(false); }
    setRefreshKey((k) => k + 1);
  };

  return (
    <RefreshContext.Provider value={refreshKey}>
      <div className="space-y-2">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="刷新图片"
          >
            {refreshing ? <Spinner className="size-3.5" /> : <Icon icon="mdi:refresh" className="size-3.5" />}
            刷新图片
          </button>
        </div>
        {children}
      </div>
    </RefreshContext.Provider>
  );
}
