import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * 部署基路径。
 *
 * 空（默认）= 站点根，适合独立子域名（`forum.example.com/post/19`）。
 * 设成 `/forum` 则与主站 2x.nz 上的历史 URL 完全一致（`/forum/post/19`），
 * 迁移期可以先按老地址跑，再改。
 *
 * 三处必须用同一个值，别只改一处：
 *   1. Vite 的 `base`（决定 index.html 里 JS/CSS 的引用前缀）
 *   2. React Router 的 `basename`（见 src/lib/base-path.ts）
 *   3. 静态托管的 SPA 回退规则（见 README）
 */
function buildLabel() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export default defineConfig(({ mode }) => {
  // .env 里的 VITE_BASE_PATH 不会自动进 process.env，必须显式 loadEnv 才读得到
  const env = loadEnv(mode, process.cwd(), "");
  const BASE_PATH = (env.VITE_BASE_PATH || "").replace(/\/+$/, "");

  return {
  base: BASE_PATH ? `${BASE_PATH}/` : "/",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel()),
    // 头像/封面等外链图片的缓存刷新标记，每次构建变一次
    __BUILD_ID__: JSON.stringify(String(Date.now())),
  },
  plugins: [react(), tailwindcss()],
  build: {
    // canvas/WebGL/recharts 只跑在现代浏览器，跳过降级转换省构建时间
    target: "es2021",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  };
});
