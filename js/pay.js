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
