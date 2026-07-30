/**
 * Umami 自定义事件上报。
 *
 * 背景：站点此前只加载 umami 的 script.js 拿自动 pageview，从来没调过
 * `umami.track()`，所以分享页底部的「行为类别」（Events）永远是空的 —— 那不是
 * Umami 坏了，是根本没有 event_type=2 的数据。
 *
 * 两个约束：
 * - **必须 SSR 安全**：`app/` 下的组件是服务端先渲染一遍的，模块顶层碰 window 会炸。
 * - **必须容忍 umami 还没加载完**：script.js 是在 `Analytics` 的 effect 里动态插入的，
 *   而首屏就可能触发事件（比如带 ?q= 直接打开搜索结果页）。所以这里排队，
 *   等 `window.umami` 出现再冲刷，最多等 10 秒就放弃 —— 事件丢了无所谓，
 *   绝不能因为埋点把页面拖住或抛错。
 */

type EventData = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: EventData) => void };
  }
}

const queue: [string, EventData | undefined][] = [];
let waiting = false;

/** 有 umami 就把队列排空；返回是否已就绪 */
function flush(): boolean {
  const umami = typeof window === 'undefined' ? undefined : window.umami;
  if (typeof umami?.track !== 'function') return false;
  while (queue.length) {
    const [name, data] = queue.shift()!;
    try {
      umami.track(name, data);
    } catch {
      /* 埋点永远不该影响页面 */
    }
  }
  return true;
}

/**
 * 上报一个自定义事件。
 * @param name 事件名，直接显示在 Umami「行为类别」列表里，用中文
 * @param data 附加属性，落到 event_data 表。**不要传用户隐私数据**
 */
export function track(name: string, data?: EventData) {
  if (typeof window === 'undefined') return;

  // undefined 的字段直接丢掉，免得在 event_data 里堆一列空值
  const clean = data
    ? (Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined && v !== ''),
      ) as EventData)
    : undefined;

  queue.push([name, clean]);
  if (flush() || waiting) return;

  waiting = true;
  let tries = 0;
  const timer = setInterval(() => {
    if (flush() || ++tries > 40) {
      clearInterval(timer);
      waiting = false;
    }
  }, 250);
}
