/**
 * pay.js — スマホの支払いページ
 * 地域・金額・名前・ひとことを選ぶ → Blink に受け取る人宛てのインボイスを作ってもらう（キーは要らない）
 * → ウォレットで払う → 支払われたら「届きました」。スクリーンは Blink の受け取り一覧からこれを見つける。
 */
(function () {
  const cfg = window.SATS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const REMEMBER = "satsmap.pay.v1";
  const QUICK = ["US", "SV", "GB", "DE", "FR", "KR", "TW", "CN", "AU", "CA", "BR", "IN", "SG", "TH"];

  let region = null;
  let amount = cfg.amounts ? cfg.amounts[1] || cfg.amounts[0] : 210;
  let invoice = null;
  let pollTimer = 0;
  let expiresAt = 0;

  const username = SM.username();

  // ── いまの会場（スクリーンが Nostr に出した記録を読む。QR の URL に k・s があるとき） ──
  const q = new URLSearchParams(location.search);
  let live = null;     // Map<取引 id, 記録>
  let mine = null;     // { hash, key, nick, before: { rank, sats } }
  let liveMission = null;
  const liveList = () => (live ? [...live.values()] : []);

  function summarize(items) {
    const a = { sats: 0, count: 0, jp: 0, world: 0, byRegion: new Map(), prefs: new Set() };
    items.forEach((c) => {
      a.sats += c.sats;
      a.count += 1;
      const r = SM.regionByKey(c.r);
      if (!r) return;
      a.byRegion.set(c.r, (a.byRegion.get(c.r) || 0) + c.sats);
      if (r.type === "jp_prefecture") { a.prefs.add(r.code); a.jp += c.sats; }
      else if (r.code === "JP") a.jp += c.sats;
      else a.world += c.sats;
    });
    a.ranked = [...a.byRegion.entries()].sort((x, y) => y[1] - x[1]);
    return a;
  }
  function rankOf(a, key) {
    const i = a.ranked.findIndex(([k]) => k === key);
    return i < 0 ? { rank: 0, sats: 0 } : { rank: i + 1, sats: a.ranked[i][1] };
  }

  function startLive() {
    const k = q.get("k");
    const session = q.get("s");
    if (!window.SM.records || !window.NostrTools || !k || !/^[a-z0-9]{6,32}$/.test(session || "")) return;
    let pk;
    try { pk = SM.records.parsePubkey(k); } catch (e) { return; }
    if (q.get("rl")) SM.records.setRelays(q.get("rl").split(","));
    SM.records.watch(session, pk, (items) => {
      live = items;
      renderLive();
    }, (m) => {
      liveMission = SM.missions.valid(m) ? m : null;
      renderLiveMission();
    });
    setInterval(renderLiveMission, 1000);
  }

  // いまのお題（スクリーンが Nostr に出したもの）
  function renderLiveMission() {
    const box = $("live-mission");
    if (!liveMission || !live) { box.hidden = true; return; }
    box.hidden = false;
    box.className = `live-mission ${liveMission.state}`;
    $("lm-text").textContent = SM.missions.text(liveMission);
    let state = "";
    if (liveMission.state === "clear") state = `✓ クリア！ by ${SM.tidy(liveMission.by, SM.NICK_MAX)}`;
    else if (liveMission.state === "fail") state = "時間切れ";
    else {
      const sec = Math.max(0, Math.ceil((liveMission.endsAt - Date.now()) / 1000));
      state = `のこり ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }
    $("lm-state").textContent = state;
  }

  // 選んだ地域の王様と、王座までの額
  function renderKing() {
    const box = $("king");
    if (!live || !region) { box.hidden = true; return; }
    const key = SM.regionKey(region);
    const list = liveList();
    const king = SM.kings(list).get(key);
    const me = SM.cleanNick($("nick").value);
    box.hidden = false;
    if (!king) {
      box.innerHTML = `👑 ${SM.esc(region.name)} にはまだ王様がいません。<b>ニックネームを付けて投げれば初代王様！</b>`;
      return;
    }
    if (me && king.nick === me) {
      box.innerHTML = `👑 <b>あなたが ${SM.esc(region.name)} の王様</b>です（${SM.fmt(king.sats)} sats）。王座を守れ！`;
      return;
    }
    const need = Math.max(1, king.sats - SM.sentTo(list, key, me) + 1);
    box.innerHTML = `👑 王様：<b>${SM.esc(king.nick)}</b>（${SM.fmt(king.sats)} sats）<br>あと <b>${SM.fmt(need)} sats</b> で王座を奪える！${me ? "" : "（ニックネームが要ります）"}
      <button type="button" class="steal" id="steal">${SM.fmt(need)} sats にする</button>`;
    $("steal").addEventListener("click", () => {
      $("custom-amount").value = need;
      $("custom-amount").dispatchEvent(new Event("input"));
      if (!me) $("nick").focus();
    });
  }

  function renderLive() {
    if (!live) return;
    const a = summarize(live);
    $("live").hidden = false;
    $("live-sats").textContent = SM.fmt(a.sats);
    $("live-sub").textContent = `${SM.fmt(a.count)} 投 · 都道府県 ${a.prefs.size}/47`;
    $("live-jp").textContent = SM.fmt(a.jp);
    $("live-world").textContent = SM.fmt(a.world);
    const total = a.jp + a.world;
    $("live-fill").style.width = `${total ? Math.max(4, Math.min(96, (a.jp / total) * 100)) : 50}%`;
    const medal = ["🥇", "🥈", "🥉"];
    $("live-rank").innerHTML = a.ranked.length
      ? a.ranked.slice(0, 3).map(([k, v], i) => {
        const r = SM.regionByKey(k);
        return `<li><span>${medal[i]} ${r.flag} ${SM.esc(r.name)}</span><b>${SM.fmt(v)}</b></li>`;
      }).join("")
      : `<li class="empty">まだだれも投げていません。最初の 1 投をどうぞ ⚡</li>`;
    // まだだれも投げていない県に ★
    document.querySelectorAll(".pref").forEach((b) => b.classList.toggle("fresh", !a.prefs.has(b.dataset.key.split(":")[1])));
    $("fresh-note").hidden = a.prefs.size >= SM.PREF_COUNT;
    renderKing();
    renderLiveMission();
    // 自分の 1 投が記録に出たら、順位を出す
    if (mine && !$("done").hidden) {
      const hit = [...live.values()].some((c) => c.hash && c.hash === mine.hash);
      if (hit) {
        const now = rankOf(a, mine.key);
        const r = SM.regionByKey(mine.key);
        const name = `${r.flag} <b>${SM.esc(r.name)}</b>`;
        let text;
        if (!mine.before.rank) text = `🎉 ${name} を初制覇！ いま <b>${now.rank} 位</b>`;
        else if (now.rank < mine.before.rank) text = `🚀 ${name} が <b>${mine.before.rank} 位 → ${now.rank} 位</b> に！`;
        else text = `${name} はいま <b>${now.rank} 位</b>（${SM.fmt(now.sats)} sats）`;
        const k = SM.kings(liveList()).get(mine.key);
        if (k && mine.nick && k.nick === SM.cleanNick(mine.nick)) text += `<br>👑 <b>${SM.esc(r.name)} の王様</b>になりました！`;
        $("done-rank").innerHTML = text;
        $("done-rank").hidden = false;
        mine = null;
      }
    }
  }

  function remember() {
    try {
      localStorage.setItem(REMEMBER, JSON.stringify({ r: region && SM.regionKey(region), nick: $("nick").value }));
    } catch (e) { /* 使えない */ }
  }
  function recall() {
    try {
      const v = JSON.parse(localStorage.getItem(REMEMBER) || "{}");
      if (v.nick) $("nick").value = SM.tidy(v.nick, SM.NICK_MAX);
      const r = SM.regionByKey(v.r);
      if (r) pick(r, false);
    } catch (e) { /* なし */ }
  }

  // ── 地域 ───────────────────────────────────────────────
  function regionButton(r, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.dataset.key = SM.regionKey(r);
    b.innerHTML = `<span class="emo">${r.flag}</span><span class="nm">${SM.esc(r.type === "jp_prefecture" ? r.name.replace(/[都府県]$/, "") : r.name)}</span>`;
    b.title = r.name;
    b.addEventListener("click", () => pick(r, true));
    return b;
  }

  function buildRegions() {
    const grid = $("pref-grid");
    SM.prefectures().forEach((p) => grid.appendChild(regionButton(p, "pref")));
    const quick = $("quick-countries");
    QUICK.map((c) => SM.region("country", c)).filter(Boolean).forEach((c) => quick.appendChild(regionButton(c, "chip")));
    renderCountryList("");
    $("country-search").addEventListener("input", (e) => renderCountryList(e.target.value));
    document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  }

  const all = () => SM.countries().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  function renderCountryList(q) {
    const list = $("country-list");
    const s = q.trim().toLowerCase();
    const rows = all().filter((c) => !s || c.name.toLowerCase().includes(s) || c.en.toLowerCase().includes(s) || c.code.toLowerCase() === s);
    list.innerHTML = "";
    rows.slice(0, 60).forEach((c) => list.appendChild(regionButton(c, "row")));
    if (!rows.length) list.innerHTML = `<div class="hint">見つかりません</div>`;
    markPicked();
  }

  function showTab(tab) {
    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    $("tab-jp").hidden = tab !== "jp";
    $("tab-world").hidden = tab !== "world";
  }

  function pick(r, user) {
    region = r;
    if (!user) showTab(r.type === "jp_prefecture" ? "jp" : "world");
    markPicked();
    $("picked").innerHTML = `<b>${r.flag} ${SM.esc(r.name)}</b> を灯します`;
    $("picked").classList.add("on");
    renderKing();
    updateGo();
    if (user && navigator.vibrate) navigator.vibrate(12);
  }
  function markPicked() {
    const key = region && SM.regionKey(region);
    document.querySelectorAll("[data-key]").forEach((b) => b.classList.toggle("on", b.dataset.key === key));
  }

  // ── 金額 ───────────────────────────────────────────────
  function buildAmounts() {
    const box = $("amounts");
    (cfg.amounts || [21, 210, 2100, 21000]).forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "amt";
      b.dataset.amt = n;
      b.innerHTML = `<b>${SM.fmt(n)}</b><span>sats</span>`;
      b.addEventListener("click", () => {
        amount = n;
        $("custom-amount").value = "";
        updateAmounts();
      });
      box.appendChild(b);
    });
    $("custom-amount").addEventListener("input", (e) => {
      const n = Math.floor(Number(e.target.value));
      amount = Number.isFinite(n) && n > 0 ? n : 0;
      updateAmounts();
    });
    updateAmounts();
  }
  function updateAmounts() {
    document.querySelectorAll(".amt").forEach((b) => b.classList.toggle("on", Number(b.dataset.amt) === amount && !$("custom-amount").value));
    let hint = "";
    if (amount >= 21000) hint = "🐋 クジラ級！ スクリーンが大さわぎになります";
    else if (amount >= 2100) hint = "🎆 花火が上がります";
    else if (SM.isRepdigit(amount)) hint = "🎰 ゾロ目……？";
    else if (amount > 0 && amount < 100) hint = "✨ ぱちっと灯ります";
    else if (amount > 0) hint = "⚡ 稲妻が落ちます";
    $("amount-hint").textContent = hint;
    updateGo();
  }

  function updateGo() {
    $("go-label").textContent = amount > 0 ? `${SM.fmt(amount)} sats を投げる` : "投げる";
  }

  // ── 投げる ─────────────────────────────────────────────
  function fail(msg) {
    $("form-error").textContent = msg;
  }

  async function submit(ev) {
    ev.preventDefault();
    fail("");
    const min = cfg.minSats || 1;
    const max = cfg.maxSats || 1000000;
    if (!username) return fail("受け取る人が設定されていません。会場のスタッフに知らせてください。");
    if (!region) return fail("地域を選んでください（1 のところ）");
    if (!(amount >= min)) return fail(`金額を選んでください（${SM.fmt(min)} sats から）`);
    if (amount > max) return fail(`${SM.fmt(max)} sats までです`);
    const go = $("go");
    go.disabled = true;
    go.classList.add("busy");
    remember();
    try {
      const memo = SM.memo.encode({ region, nick: $("nick").value, msg: $("msg").value });
      invoice = await SM.blink.createInvoice(username, amount, memo);
      mine = live ? { hash: invoice.paymentHash, key: SM.regionKey(region), nick: $("nick").value, before: rankOf(summarize(live), SM.regionKey(region)) } : null;
      showInvoice();
    } catch (e) {
      fail(e.message || "インボイスを作れませんでした");
    } finally {
      go.disabled = false;
      go.classList.remove("busy");
    }
  }

  function showInvoice() {
    const pr = invoice.paymentRequest;
    $("form").hidden = true;
    $("invoice").hidden = false;
    $("inv-title").innerHTML = `⚡ ${SM.fmt(amount)} sats → ${region.flag} ${SM.esc(region.name)}`;
    $("open-wallet").href = `lightning:${pr}`;
    const qr = qrcode(0, "L");
    qr.addData(pr.toUpperCase(), "Alphanumeric");
    qr.make();
    $("inv-qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    expiresAt = Date.now() + 15 * 60000;
    window.scrollTo({ top: 0, behavior: "smooth" });
    watch();
  }

  async function watch() {
    clearTimeout(pollTimer);
    if (!invoice) return;
    const left = expiresAt - Date.now();
    $("expires").textContent = left > 0 ? `（あと ${Math.ceil(left / 60000)} 分）` : "";
    try {
      const st = await SM.blink.invoiceStatus(invoice.paymentRequest);
      if (st === "PAID") return paid();
      if (st === "EXPIRED" || left <= 0) {
        $("waiting").innerHTML = "⌛ 期限が切れました。もう一度選んでください";
        return;
      }
    } catch (e) {
      /* 一時的に読めないだけ。続けて待つ */
    }
    pollTimer = setTimeout(watch, document.hidden ? 4000 : 2000);
  }

  function paid() {
    invoice = null;
    $("invoice").hidden = true;
    $("done").hidden = false;
    $("done-text").innerHTML = `${region.flag} ${SM.esc(region.name)} に ${SM.fmt(amount)} sats。<br>スクリーンを見てください 👀`;
    $("done-rank").hidden = true;
    renderLive();
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
  }

  function reset() {
    clearTimeout(pollTimer);
    invoice = null;
    $("invoice").hidden = true;
    $("done").hidden = true;
    $("form").hidden = false;
    $("waiting").innerHTML = `<span class="dot"></span> 支払いを待っています… <span id="expires"></span>`;
    $("msg").value = "";
    $("msg-count").textContent = `0 / ${SM.MSG_MAX}`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("recipient").textContent = username ? `${username}@blink.sv` : "（未設定）";
    buildRegions();
    buildAmounts();
    recall();
    startLive();
    $("nick").addEventListener("input", renderKing);
    $("msg").addEventListener("input", (e) => { $("msg-count").textContent = `${[...e.target.value].length} / ${SM.MSG_MAX}`; });
    $("form").addEventListener("submit", submit);
    $("copy-inv").addEventListener("click", async () => {
      if (!invoice) return;
      try {
        await navigator.clipboard.writeText(invoice.paymentRequest);
        $("copy-inv").innerHTML = `<i class="fa-solid fa-check"></i> コピーしました`;
      } catch (e) {
        prompt("インボイス", invoice.paymentRequest);
      }
    });
    $("cancel").addEventListener("click", reset);
    $("again").addEventListener("click", reset);
    // ウォレットから戻ってきたら、すぐ確かめる
    document.addEventListener("visibilitychange", () => { if (!document.hidden && invoice) watch(); });
    if (!username) fail("受け取る人が設定されていません。会場のスタッフに知らせてください。");
  });
})();
