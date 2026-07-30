/**
 * 构建期图标子集生成器。
 *
 * `@iconify/react` 默认在**运行时**向 Iconify API 拉图标数据，所以服务端渲染
 * 出来的只是一个空 <span> —— 禁用 JS 时全站图标都是空的，爬虫看到的也是空的。
 *
 * 这里扫描源码里出现的所有图标名，从 @iconify-json/* 里抽出对应数据，生成一份
 * 极小的离线子集。运行时用 addCollection() 注册后，图标即可同步渲染（含 SSR）。
 *
 * 扫不到的动态图标名会自动回退到原来的 API 拉取路径，不会报错。
 *
 * 用法：node scripts/build-icon-subset.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src"];
const EXTS = new Set([".ts", ".tsx"]);
const OUT = "src/lib/icons/subset.json";

/** 图标名字面量：'mdi:foo-bar' / "simple-icons:x" */
const ICON_RE = /['"`]([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)['"`]/g;

// 只认这几个已安装的集合，避免把 'text/html'、'image/png' 之类误判成图标名
const COLLECTIONS = ["mdi", "simple-icons", "ri"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const wanted = new Map(COLLECTIONS.map((c) => [c, new Set()]));

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(ICON_RE)) {
      const [, prefix, name] = m;
      if (wanted.has(prefix)) wanted.get(prefix).add(name);
    }
  }
}

const result = {};
let total = 0;
let missing = [];

for (const prefix of COLLECTIONS) {
  const names = [...wanted.get(prefix)].sort();
  if (!names.length) continue;
  const full = JSON.parse(
    readFileSync(`node_modules/@iconify-json/${prefix}/icons.json`, "utf-8"),
  );
  const icons = {};
  for (const n of names) {
    // 有的名字是别名，要先解引用
    const resolved = full.aliases?.[n]?.parent ?? n;
    if (full.icons[resolved]) {
      icons[n] = full.aliases?.[n] ? { ...full.icons[resolved], ...full.aliases[n], parent: undefined } : full.icons[resolved];
      delete icons[n].parent;
      total++;
    } else {
      missing.push(`${prefix}:${n}`);
    }
  }
  if (Object.keys(icons).length) {
    result[prefix] = {
      prefix,
      icons,
      width: full.width,
      height: full.height,
    };
  }
}

mkdirSync("src/lib/icons", { recursive: true });
writeFileSync(OUT, JSON.stringify(result));
const bytes = statSync(OUT).size;
console.log(`[icons] 收录 ${total} 个图标 → ${OUT} (${(bytes / 1024).toFixed(1)} KB)`);
if (missing.length) console.log(`[icons] 未找到（将回退到运行时 API）: ${missing.join(", ")}`);
