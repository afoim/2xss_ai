'use client';

import { useEffect, useState, type ComponentType } from 'react';
// **只导入类型**：`import type` 在编译期被完全擦除，不会把 @iconify/react 的
// 51KB 运行时拽进包里。运行时实现走下面 RuntimeIcon 里的动态 import()。
import type { IconProps } from '@iconify/react';
import { cn } from '@/lib/utils';
import subset from '@/lib/icons/subset.json';

/**
 * 图标的服务端渲染。
 *
 * 三个坑叠在一起：
 * 1. `@iconify/react` 默认在运行时向 Iconify API 拉图标数据，服务端拿不到；
 * 2. 即便用 addCollection() 提前注册好数据，它的 <Icon> 组件**依然**在服务端
 *    渲染成空 `<span></span>` —— 该组件固定等到 mount 后才填充；
 * 3. 改用它的 getIcon() 自己出 svg 也不行：那读的是 Iconify 内部存储，
 *    服务端能查到、浏览器端查不到，于是 SSR 出 <svg> 而水合出 <svg class=iconify>，
 *    结构对不上直接 React #418。
 *
 * 所以这里彻底不碰 Iconify 的运行时状态：把构建期抽好的子集摊平成一张普通表，
 * 渲染时直接查表出 <svg>。同一份数据同时进服务端和客户端包，两边逐字节一致。
 *
 * 子集由 scripts/build-icon-subset.mjs 从 @iconify-json/* 生成；表里没有的
 * 图标（例如接口数据带来的动态名）才回退到 <IconifyIcon> 的运行时加载路径。
 *
 * 那条回退路径**必须是动态 import**。它此前是模块顶层的静态导入，于是
 * @iconify/react 的整个运行时（API 拉取、缓存、observer，51KB 未压缩）被打进
 * ui-shared —— 而 ui-shared 是每个页面都要下的共享块。实际用得上它的只有 /draw
 * 里可能来自后端的图标名；站内其余所有图标名都是源码字面量，构建期已收录进表。
 */
interface IconData {
  body: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

const ICONS: Record<string, IconData> = {};
for (const [prefix, collection] of Object.entries(
  subset as Record<string, { icons: Record<string, Partial<IconData>>; width?: number; height?: number }>,
)) {
  for (const [name, data] of Object.entries(collection.icons)) {
    ICONS[`${prefix}:${name}`] = {
      body: data.body ?? '',
      width: data.width ?? collection.width ?? 24,
      height: data.height ?? collection.height ?? 24,
      left: data.left ?? 0,
      top: data.top ?? 0,
    };
  }
}

interface Props extends Omit<IconProps, 'icon'> {
  icon: string;
  className?: string;
}

export function Icon({ icon, className, ...props }: Props) {
  const wrapper = cn('inline-flex items-center justify-center shrink-0 leading-none', className);
  const data = ICONS[icon];

  if (data) {
    return (
      <span className={wrapper}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`${data.left} ${data.top} ${data.width} ${data.height}`}
          className="size-full block"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: data.body }}
        />
      </span>
    );
  }

  return (
    <span className={wrapper}>
      <RuntimeIcon icon={icon} {...props} />
    </span>
  );
}

/** 已解析的 @iconify/react <Icon>，模块级缓存，避免每个未收录图标各触发一次状态切换 */
let LoadedIconify: ComponentType<IconProps> | null = null;

/**
 * 未收录图标的运行时兜底。
 *
 * 不用 React.lazy + Suspense：服务端渲染时 lazy 会真的挂起，React 流式 SSR
 * 随即为该边界吐出 `<!--$?-->` 占位并把内容甩到响应末尾的 `<div hidden id="S:n">`，
 * 靠内联 $RC() 搬回原位 —— 禁用 JS 就是空白（见 AGENTS.md）。
 *
 * 改成 effect 里手动 import：服务端与客户端首次渲染都输出同一个空 <span>，
 * 水合逐字节一致；chunk 落地后再换成真图标。
 */
function RuntimeIcon({ icon, ...props }: Props) {
  const [Loaded, setLoaded] = useState<ComponentType<IconProps> | null>(LoadedIconify);

  useEffect(() => {
    if (LoadedIconify) return;
    let alive = true;
    import('@iconify/react').then((m) => {
      LoadedIconify = m.Icon;
      if (alive) setLoaded(() => m.Icon);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!Loaded) return <span className="size-full block" />;
  return <Loaded icon={icon} className="size-full block" {...props} />;
}
