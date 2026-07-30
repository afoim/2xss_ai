import { useEffect } from "react";

const SITE = "二叉树树";

/**
 * 纯 CSR 下的标题维护。没有服务端渲染，`<head>` 只能在挂载后改 —— 不执行 JS
 * 的抓取工具看到的永远是 index.html 里那份兜底值。生图页本来就都是 noindex，
 * 所以这里只管标题，不折腾 canonical / og。
 */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE}` : SITE;
  }, [title]);
}
