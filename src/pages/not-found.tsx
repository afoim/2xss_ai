import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/lib/use-title";

export function Component() {
  useTitle("404 页面未找到");
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="font-mono text-5xl font-bold">404</h1>
      <p className="mt-4 text-muted-foreground">你访问的页面不存在。</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="outline" size="sm">← 返回生图</Button>
      </Link>
    </main>
  );
}
