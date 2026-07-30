import Page from "@/app/draw/admin/collaborator/page";
import { useTitle } from "@/lib/use-title";

export function Component() {
  useTitle("协作者管理");
  return <Page />;
}
