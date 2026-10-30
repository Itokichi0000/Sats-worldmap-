// 手元で確かめる用の小さなサーバー：npm run serve → http://localhost:8787/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

export function serve(port = Number(process.env.PORT) || 8787) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(root, path.normalize(p));
      if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git`)) throw new Error("no");
      await stat(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve();
  console.log(`http://localhost:${s.address().port}/  （スクリーン）`);
  console.log(`http://localhost:${s.address().port}/pay.html?u=<Blink のユーザー名>  （支払いページ）`);
  console.log(`http://localhost:${s.address().port}/admin.html  （管理画面）`);
}
