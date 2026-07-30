import Page from "@/app/draw/page";
import { useTitle } from "@/lib/use-title";

export function Component() {
  useTitle("AI 生图");
  return (
    <>
      {/* 页面主体自己没有 h1（顶栏是个按钮），补一个屏读器可见的标题，
          否则整页没有标题层级 */}
      <h1 className="sr-only">AI 生图</h1>
      <Page />
    </>
  );
}
