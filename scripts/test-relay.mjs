// 自動の確認に使う小さな Nostr リレー（メモリだけ。NIP-01 の EVENT・REQ・CLOSE）
import { WebSocketServer } from "ws";

function matches(f, ev) {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  for (const [k, vals] of Object.entries(f)) {
    if (k[0] !== "#") continue;
    const name = k.slice(1);
    if (!ev.tags.some((t) => t[0] === name && vals.includes(t[1]))) return false;
  }
  if (f.since && ev.created_at < f.since) return false;
  if (f.until && ev.created_at > f.until) return false;
  return true;
}

export function startRelay(port = 0) {
  const events = [];
  const wss = new WebSocketServer({ port });
  const subs = new Map(); // ws -> Map(id -> filters)
  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const [type, ...rest] = msg;
      if (type === "EVENT") {
        const ev = rest[0];
        if (!events.some((e) => e.id === ev.id)) events.push(ev);
        ws.send(JSON.stringify(["OK", ev.id, true, ""]));
        for (const [other, m] of subs) {
          for (const [id, filters] of m) if (filters.some((f) => matches(f, ev))) other.send(JSON.stringify(["EVENT", id, ev]));
        }
      } else if (type === "REQ") {
        const [id, ...filters] = rest;
        subs.get(ws).set(id, filters);
        const out = events.filter((ev) => filters.some((f) => matches(f, ev))).sort((a, b) => b.created_at - a.created_at);
        out.slice(0, Math.max(...filters.map((f) => f.limit || 500))).forEach((ev) => ws.send(JSON.stringify(["EVENT", id, ev])));
        ws.send(JSON.stringify(["EOSE", id]));
      } else if (type === "CLOSE") {
        subs.get(ws).delete(rest[0]);
      }
    });
    ws.on("close", () => subs.delete(ws));
  });
  return new Promise((r) => wss.on("listening", () => r({ wss, events, url: `ws://localhost:${wss.address().port}`, close: () => wss.close() })));
}
