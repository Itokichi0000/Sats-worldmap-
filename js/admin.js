/**
 * admin.js — 管理画面。設定は localStorage に書き、スクリーンには SM.bus で知らせる。
 * 記録（entries・round）を書くのはスクリーンだけ。ここからは頼むだけ。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const NUM = ["roundMinutes", "roundGoal", "bigAt", "whaleAt", "rotateSec", "missionMinutes"];
  const BOOL = ["sound", "zoom", "rotate", "countAll", "showMessages", "record", "missions", "fever"];
  let lastSeen = 0;

  function fill() {
    const s = SM.settings();
    $("username").value = s.username || "";
    $("apikey").value = SM.apiKey() ? "••••••••（保存済み）" : "";
    $("apikey").dataset.saved = SM.apiKey() ? "1" : "";
    NUM.forEach((k) => { $(k).value = s[k]; });
    BOOL.forEach((k) => { $(k).checked = !!s[k]; });
    $("ngWords").value = (s.ngWords || []).join("\n");
    $("recordRelays").value = (s.recordRelays || []).join("\n");
    $("recordRelays").placeholder = SM.records.relays().join("\n");
    SM.records.ensureKey();
    $("rec-npub").textContent = SM.records.npub();
    const cfgUser = (window.SATS_CONFIG && window.SATS_CONFIG.blinkUsername) || "";
    $("username-note").textContent = cfgUser
      ? `js/config.js に「${cfgUser}」が書いてあるので、支払いページはそちらを使います。`
      : "支払いページの URL に ?u=（この名前）が付きます。";
    renderPayLink();
  }

  function cleanUser(v) {
    return String(v || "").trim().replace(/@blink\.sv$/i, "").replace(/^@/, "");
  }

  function renderPayLink() {
    const u = new URL("pay.html", location.href);
    const cfgUser = (window.SATS_CONFIG && window.SATS_CONFIG.blinkUsername) || "";
    const user = cleanUser($("username").value);
    if (!cfgUser && user) u.searchParams.set("u", user);
    $("pay-link").href = u.toString();
    $("pay-link").textContent = u.toString();
    const qr = qrcode(0, "M");
    qr.addData(u.toString());
    qr.make();
    $("pay-qr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
  }

  function log(lines, ok) {
    const el = $("blink-log");
    el.hidden = false;
    el.className = `log ${ok ? "ok" : "ng"}`;
    el.textContent = lines.join("\n");
  }

  async function testBlink() {
    const user = cleanUser($("username").value) || (window.SATS_CONFIG && window.SATS_CONFIG.blinkUsername) || "";
    const key = SM.apiKey();
    const out = [];
    let ok = true;
    let walletId = null;
    try {
      walletId = await SM.blink.walletId(user);
      out.push(`✓ ユーザー「${user}」の BTC ウォレットが見つかりました（支払いページはインボイスを作れます）`);
    } catch (e) {
      ok = false;
      out.push(`✗ ユーザー名：${e.message}`);
    }
    if (!key) {
      ok = false;
      out.push("✗ API キーがありません（スクリーンはデモのまま）");
    } else {
      try {
        const me = await SM.blink.me(key);
        const wallets = me.defaultAccount.wallets;
        out.push(`✓ API キーで読めました（アカウント：${me.username || "名前なし"}）`);
        if (walletId && !wallets.some((w) => w.id === walletId)) {
          ok = false;
          out.push(`✗ API キーのアカウントと、ユーザー「${user}」のアカウントが違います。同じアカウントのキーにしてください`);
        }
        const r = await SM.blink.receives(key, { first: 5 });
        out.push(`✓ 受け取った支払いの一覧を読めました（最近の ${r.items.length} 件）`);
      } catch (e) {
        ok = false;
        out.push(`✗ API キー：${e.message}`);
      }
    }
    log(out, ok);
  }

  function saveAll() {
    const patch = { username: cleanUser($("username").value) };
    NUM.forEach((k) => {
      const n = Number($(k).value);
      if (Number.isFinite(n) && n > 0) patch[k] = Math.floor(n);
    });
    BOOL.forEach((k) => { patch[k] = $(k).checked; });
    patch.ngWords = $("ngWords").value.split(/\n/).map((w) => w.trim()).filter(Boolean).slice(0, 200);
    patch.recordRelays = $("recordRelays").value.split(/\s+/).map((w) => w.trim()).filter((u) => SM.records.isRelayUrl(u)).slice(0, 12);
    SM.saveSettings(patch);
  }

  function renderEntries() {
    const list = SM.entries().slice(-40).reverse();
    const s = SM.settings();
    const el = $("entries");
    if (!list.length) {
      el.innerHTML = `<p class="note">まだありません</p>`;
      return;
    }
    el.innerHTML = list.map((e) => {
      const r = SM.regionByKey(e.r);
      const shown = SM.clean(e.m, s.ngWords);
      const t = new Date(e.at);
      return `
      <div class="entry${e.hidden ? " hidden" : ""}">
        <div class="e-main">
          <b>${r ? r.flag + " " + SM.esc(r.name) : "⚡"}</b> +${SM.fmt(e.sats)} ·
          <span>${SM.esc(e.n || "名無し")}</span>
          ${e.m ? `<div class="e-msg">${SM.esc(e.m)}${shown === null ? ' <em>（NG ワードで出していません）</em>' : ""}</div>` : ""}
          <div class="e-time">${t.toLocaleTimeString("ja-JP")}${e.test ? " · テスト" : ""}${e.round ? ` · R${e.round}` : ""}</div>
        </div>
        <button class="btn small${e.hidden ? "" : " danger"}" data-hide="${SM.esc(e.id)}" data-to="${e.hidden ? "0" : "1"}">${e.hidden ? "戻す" : "隠す"}</button>
      </div>`;
    }).join("");
  }

  function renderRound() {
    const r = SM.round();
    const st = { idle: "フリータイム（ラウンドなし）", running: `ROUND ${r.no} の最中（あと ${Math.max(0, Math.ceil((r.endsAt - Date.now()) / 60000))} 分）`, done: `ROUND ${r.no} 終了（結果を表示中）` }[r.state] || "";
    $("round-state").textContent = st;
  }

  function exportCsv() {
    const rows = [["日時", "sats", "地域コード", "地域", "ニックネーム", "ひとこと", "ラウンド", "隠した", "テスト", "id"]];
    SM.entries().forEach((e) => {
      const r = SM.regionByKey(e.r);
      rows.push([new Date(e.at).toISOString(), e.sats, e.r || "", r ? r.name : "", e.n || "", e.m || "", e.round || "", e.hidden ? 1 : "", e.test ? 1 : "", e.id]);
    });
    const csv = "﻿" + rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `satsmap-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function fillRegions() {
    const sel = $("test-region");
    const groups = [["都道府県", SM.prefectures()], ["国", SM.countries().sort((a, b) => a.name.localeCompare(b.name, "ja"))]];
    sel.innerHTML = groups.map(([label, list]) =>
      `<optgroup label="${label}">${list.map((r) => `<option value="${SM.regionKey(r)}">${r.flag} ${SM.esc(r.name)}</option>`).join("")}</optgroup>`).join("");
    sel.value = "jp_prefecture:JP-13";
  }

  // ── 記録（Nostr）・作り直す ─────────────────────────────
  function renderRecord(rec) {
    const el = $("rec-state");
    if (!rec) return;
    if (!rec.on) {
      el.className = "rec-state";
      el.textContent = "Nostr に出していません";
    } else if (rec.failed) {
      el.className = "rec-state ng";
      el.textContent = `⚠ リレーに出せていません（あと ${rec.pending} 件。30 秒ごとに出し直します）`;
    } else {
      el.className = "rec-state ok";
      el.textContent = rec.pending ? `出しています…（あと ${rec.pending} 件）` : "✓ すべてリレーに出しました";
    }
    el.textContent += `　イベント：${rec.session}`;
    fillSessions(rec.session);
  }

  const toLocalInput = (sec) => {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let found = [];
  function fillSessions(current = SM.session()) {
    const sel = $("rebuild-session");
    const keep = sel.value;
    const list = [{ session: current, label: `いまのイベント（${current}）` }];
    found.filter((x) => x.session !== current).forEach((x) => {
      const when = x.since ? new Date(x.since * 1000).toLocaleString("ja-JP") : "";
      list.push({ session: x.session, label: `${x.eventName || "イベント"} ${when}（${x.session}）`, since: x.since });
    });
    sel.innerHTML = list.map((x) => `<option value="${SM.esc(x.session)}" data-since="${x.since || ""}">${SM.esc(x.label)}</option>`).join("");
    if (list.some((x) => x.session === keep)) sel.value = keep;
  }

  function rebuildLog(lines, ok) {
    const el = $("rebuild-log");
    el.hidden = false;
    el.className = `log ${ok ? "ok" : "ng"}`;
    el.textContent = lines.join("\n");
  }

  function screenState() {
    const el = $("screen-state");
    const alive = Date.now() - lastSeen < 6000;
    el.className = `screen-state ${alive ? "ok" : "ng"}`;
    el.textContent = alive ? "● スクリーンとつながっています" : "スクリーンが開いていません（このブラウザで index.html を開いてください）";
  }

  document.addEventListener("DOMContentLoaded", () => {
    fill();
    fillRegions();
    renderEntries();
    renderRound();

    $("username").addEventListener("input", renderPayLink);
    $("apikey").addEventListener("focus", (e) => { if (e.target.dataset.saved) e.target.value = ""; });
    $("save-blink").addEventListener("click", () => {
      const key = $("apikey").value.trim();
      if (key && !key.startsWith("••")) SM.saveApiKey(key);
      saveAll();
      fill();
      log(["保存しました"], true);
    });
    $("test-blink").addEventListener("click", () => {
      const key = $("apikey").value.trim();
      if (key && !key.startsWith("••")) SM.saveApiKey(key);
      saveAll();
      fill();
      log(["確かめています…"], true);
      testBlink();
    });
    $("forget-key").addEventListener("click", () => {
      if (!confirm("このブラウザから API キーを消します。スクリーンはデモに戻ります。")) return;
      SM.saveApiKey("");
      fill();
    });

    [...NUM, ...BOOL, "ngWords", "recordRelays"].forEach((k) => $(k).addEventListener("change", saveAll));

    $("round-start").addEventListener("click", () => { saveAll(); SM.bus.post({ type: "round-start" }); });
    $("round-end").addEventListener("click", () => SM.bus.post({ type: "round-end" }));
    $("mission-next").addEventListener("click", () => SM.bus.post({ type: "mission-next" }));

    $("entries").addEventListener("click", (e) => {
      const b = e.target.closest("[data-hide]");
      if (b) SM.bus.post({ type: "hide", id: b.dataset.hide, hidden: b.dataset.to === "1" });
    });

    $("send-test").addEventListener("click", () => SM.bus.post({
      type: "test", r: $("test-region").value, sats: Number($("test-sats").value), n: $("test-nick").value, m: $("test-msg").value,
    }));
    $("clear-tests").addEventListener("click", () => SM.bus.post({ type: "clear-tests" }));
    $("export").addEventListener("click", exportCsv);
    $("reset").addEventListener("click", () => {
      if (!confirm("集計とラウンドを 0 に戻して、最初からやり直します。先に CSV で保存しておくと安心です。よいですか？")) return;
      SM.bus.post({ type: "reset" });
    });

    SM.bus.on((msg) => {
      if (!msg) return;
      if (msg.type === "changed") {
        lastSeen = Date.now();
        renderEntries();
        renderRound();
        screenState();
        renderRecord(msg.record);
      } else if (msg.type === "rebuild-done") {
        $("rebuild").disabled = false;
        if (!msg.ok) return rebuildLog([`✗ ${msg.error}`], false);
        const lines = [`✓ 作り直しました：${SM.fmt(msg.count)} 投・${SM.fmt(msg.sats)} sats`];
        lines.push(msg.relayError ? `！ Nostr の記録は読めませんでした（${msg.relayError}）。隠した・ラウンドは時刻から決めました` : `Nostr の記録 ${msg.fromRelay} 件から「隠した」「ラウンド」を戻しました`);
        rebuildLog(lines, true);
        $("rebuild-since").value = toLocalInput(SM.since());
      }
    });

    $("rebuild-since").value = toLocalInput(SM.since());
    fillSessions();
    $("rebuild-session").addEventListener("change", (e) => {
      const since = Number(e.target.selectedOptions[0] && e.target.selectedOptions[0].dataset.since);
      if (since) $("rebuild-since").value = toLocalInput(since);
    });
    $("find-sessions").addEventListener("click", async () => {
      rebuildLog(["Nostr で探しています…"], true);
      try {
        const npub = $("find-npub").value.trim();
        const pk = npub ? SM.records.parsePubkey(npub) : SM.records.pubkey();
        found = await SM.records.fetchSessions(pk);
        fillSessions();
        rebuildLog([found.length ? `✓ ${found.length} 件のイベントが見つかりました。上で選んでください` : "見つかりませんでした（鍵・リレーを確かめてください）"], !!found.length);
      } catch (err) {
        rebuildLog([`✗ ${err.message}`], false);
      }
    });
    $("rebuild").addEventListener("click", () => {
      const t = new Date($("rebuild-since").value).getTime();
      if (!Number.isFinite(t)) return rebuildLog(["✗ 時刻を入れてください"], false);
      if (!SM.apiKey()) return rebuildLog(["✗ 先に Blink の API キーを入れてください"], false);
      if (Date.now() - lastSeen > 6000) return rebuildLog(["✗ スクリーン（index.html）をこのブラウザで開いてから押してください"], false);
      if (!confirm("いまの集計を、Blink の入金履歴から作り直します。よいですか？")) return;
      $("rebuild").disabled = true;
      rebuildLog(["作り直しています…（Blink の履歴を読んでいます）"], true);
      const npub = $("find-npub").value.trim();
      SM.bus.post({ type: "rebuild", since: Math.floor(t / 1000), session: $("rebuild-session").value, pubkey: npub || undefined });
    });

    $("copy-npub").addEventListener("click", () => navigator.clipboard.writeText(SM.records.npub()).catch(() => prompt("npub", SM.records.npub())));
    $("export-nsec").addEventListener("click", () => {
      if (!confirm("記録の鍵（nsec）を表示します。この鍵があれば、この記録に書き足せます（お金は動かせません）。人に見せないでください。")) return;
      prompt("記録の鍵（nsec）", SM.records.exportNsec());
    });
    $("import-nsec").addEventListener("click", () => {
      const v = prompt("ほかのパソコンで書き出した nsec を貼り付けてください（いまの鍵は置き換わります）");
      if (!v) return;
      try {
        $("rec-npub").textContent = SM.records.importNsec(v);
        SM.bus.post({ type: "settings" });
      } catch (err) {
        alert(err.message);
      }
    });
    SM.bus.post({ type: "ping" });
    setInterval(() => { SM.bus.post({ type: "ping" }); screenState(); renderRound(); }, 3000);
    screenState();
  });
})();
