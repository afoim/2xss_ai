import Page from "@/app/draw/admin/page";
import { useTitle } from "@/lib/use-title";

export function Component() {
  useTitle("生图管理");
  return <Page />;
}
