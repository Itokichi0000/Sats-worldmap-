// 公開するファイルだけを dist/ に集める（nsite に上げるもの）。npm run build
import { cp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const FILES = ["index.html", "pay.html", "admin.html", "css", "js", "vendor"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const f of FILES) await cp(path.join(root, f), path.join(dist, f), { recursive: true });
console.log(`dist/ を作りました（${FILES.join(", ")}）`);
