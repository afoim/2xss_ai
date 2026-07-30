import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import { consumeTokenFromHash } from "./lib/auth-bridge";
import "./app/globals.css";

// **必须在 createRoot 之前**：从论坛授权页跳回来时 token 在 URL fragment 里，
// 而首屏第一个 effect 就要读 localStorage 判断登录态。晚一步用户就会被再送去
// 授权一次，看起来像「授权了但没登上」。
consumeTokenFromHash();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
