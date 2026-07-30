import { cn } from '@/lib/utils';

/**
 * Shell 风格加载指示器：三个方形点依次点亮（■ □ □ → □ ■ □ → □ □ ■）。
 * 占位盒与被替换的图标一致（默认 size-4），用 size-* 类覆盖尺寸，
 * 颜色跟随 currentColor（text-* 类照常生效）。
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="加载中" className={cn('shell-spinner size-4', className)}>
      <span />
      <span />
      <span />
    </span>
  );
}
