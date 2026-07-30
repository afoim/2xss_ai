import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shell 风格骨架屏：斜纹扫描块（高对比度，纯黑背景上清晰可见）。
 * 样式定义在 globals.css 的 .shell-skeleton。
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('shell-skeleton', className)}
      {...props}
    />
  );
}

export { Skeleton };
