/**
 * app.js — スクリーン（会場のプロジェクターに映す画面）
 *
 * 流れ：Blink の受け取り一覧を数秒ごとに読む（API キーは管理画面で入れ、このブラウザにだけ置く）
 *   → メモが SatsMap のもの（スマホの支払いページが作ったインボイス）なら記録に足す
 *   → 1 件ずつ順番に演出（その地域へ寄る・稲妻・花火・吹き出し）してから、数字・地図・順位を進める
 * API キーがないときはデモ（下のボタンで送金をまねる）。
 *
 * キーボード：F 全画面 / Space ラウンド開始・終了 / M 音 / 1 世界 2 日本 0 両方 / A 管理画面 / D デモの送金
 */
(function () {
  const params = new URLSearchParams(location.search);
  let settings = SM.settings();
  let entries = SM.entries();
  let round = SM.round();

  const seen = new Set(entries.map((e) => e.id)); // 読んだ Blink の取引（数えないものも）
  const pending = new Set(); // 記録したが、まだ演出していないもの（数字に入れない）
  const queue = [];
  let playing = false;
  let combo = { n: 0, last: 0 };
  let status = { kind: "init", text: "" };

  const $ = (id) => document.getElementById(id);
  const isDemo = () => params.has("demo") || !SM.apiKey();

  // ── 集計 ───────────────────────────────────────────────
  function aggregate(list) {
    const a = {
      sats: 0, count: 0,
      byRegion: new Map(), byPerson: new Map(),
      jp: 0, world: 0, prefs: new Set(), countries: new Set(),
      country: {}, prefecture: {},
    };
    for (const e of list) {
      a.sats += e.sats;
      a.count += 1;
      if (e.n) a.byPerson.set(e.n, (a.byPerson.get(e.n) || 0) + e.sats);
      const r = SM.regionByKey(e.r);
      if (!r) continue;
      a.byRegion.set(e.r, (a.byRegion.get(e.r) || 0) + e.sats);
      if (r.type === "jp_prefecture") {
        a.prefs.add(r.code);
        a.prefecture[r.code] = (a.prefecture[r.code] || 0) + e.sats;
        a.country.JP = (a.country.JP || 0) + e.sats;
        a.jp += e.sats;
      } else {
        a.countries.add(r.code);
        a.country[r.code] = (a.country[r.code] || 0) + e.sats;
        if (r.code === "JP") a.jp += e.sats;
        else a.world += e.sats;
      }
    }
    // 日本の都道府県に投げたら、世界地図の日本も灯す（国の数には入れない）
    if (a.prefs.size) a.countries.add("JP");
    return a;
  }
  const shown = () => entries.filter((e) => !pending.has(e.id));
  const inRound = (list, no) => list.filter((e) => e.round === no && no > 0);

  // ── 描画 ───────────────────────────────────────────────
  function renderAll() {
    const list = shown();
    const a = aggregate(list);
    $("stat-total-sats").textContent = SM.fmt(a.sats);
    $("stat-total-count").textContent = SM.fmt(a.count);
    $("stat-prefs").textContent = a.prefs.size;
    $("stat-countries").textContent = a.countries.size;
    SatsMap.setTotals("country", a.country);
    SatsMap.setTotals("jp_prefecture", a.prefecture);
    renderTug(a);
    renderRanking(list);
    renderRound(list);
    renderFeed(list);
    return a;
  }

  function renderTug(a) {
    $("tug-jp").textContent = SM.fmt(a.jp);
    $("tug-world").textContent = SM.fmt(a.world);
    const total = a.jp + a.world;
    const pct = total ? (a.jp / total) * 100 : 50;
    const clamped = Math.max(6, Math.min(94, pct));
    $("tug-fill").style.width = `${clamped}%`;
    $("tug-knot").style.left = `${clamped}%`;
  }

  let rankMode = "region";
  function renderRanking(list) {
    const el = $("ranking-list");
    const a = aggregate(list);
    let rows;
    if (rankMode === "region") {
      rows = [...a.byRegion.entries()].map(([k, v]) => {
        const r = SM.regionByKey(k);
        return { label: `${r.flag} ${r.name}`, v };
      });
    } else {
      rows = [...a.byPerson.entries()]
        .map(([n, v]) => ({ label: SM.cleanNick(n, settings.ngWords), v }))
        .filter((r) => r.label);
    }
    rows.sort((x, y) => y.v - x.v);
    rows = rows.slice(0, 6);
    const max = rows.length ? rows[0].v : 1;
    document.querySelectorAll(".rank-tab").forEach((b) => b.classList.toggle("active", b.dataset.rank === rankMode));
    if (!rows.length) {
      el.innerHTML = `<div class="empty">${rankMode === "region" ? "最初の 1 投を待っています ⚡" : "ニックネームを付けて投げると、ここに載ります"}</div>`;
      return;
    }
    const medal = ["🥇", "🥈", "🥉"];
    el.innerHTML = rows.map((r, i) => `
      <div class="rank-row">
        <div class="rank-index">${medal[i] || i + 1}</div>
        <div class="rank-info">
          <div class="rank-name"><span>${SM.esc(r.label)}</span><span class="amt">${SM.fmt(r.v)}</span></div>
          <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${Math.max(6, (r.v / max) * 100)}%"></div></div>
        </div>
      </div>`).join("");
  }

  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 45) return "たった今";
    if (s < 3600) return `${Math.round(s / 60)} 分前`;
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function messageOf(e) {
    if (!settings.showMessages || e.hidden) return "";
    const m = SM.clean(e.m, settings.ngWords);
    return m || "";
  }

  function renderFeed(list) {
    const el = $("latest-feed");
    const rows = list.slice(-20).reverse();
    if (!rows.length) {
      el.innerHTML = `<div class="empty">まだだれも投げていません</div>`;
      return;
    }
    el.innerHTML = rows.map((e) => {
      const r = SM.regionByKey(e.r);
      const nick = e.hidden ? "" : SM.cleanNick(e.n, settings.ngWords);
      const msg = messageOf(e);
      return `
      <div class="feed-item${e.sats >= settings.bigAt ? " big" : ""}">
        <div class="feed-flag">${r ? r.flag : "⚡"}</div>
        <div class="feed-body">
          <div class="feed-region">${SM.esc(r ? r.name : "Lightning")}${nick ? ` <span class="feed-nick">${SM.esc(nick)}</span>` : ""}</div>
          ${msg ? `<div class="feed-msg">${SM.esc(msg)}</div>` : ""}
          <div class="feed-time">${ago(e.at)}${e.test ? " · テスト" : ""}</div>
        </div>
        <div class="feed-amount">+${SM.fmt(e.sats)}</div>
      </div>`;
    }).join("");
  }

  // ── ラウンド ───────────────────────────────────────────
  function renderRound(list) {
    const running = round.state === "running";
    const title = $("round-title");
    const r = inRound(list, round.no);
    const sum = r.reduce((s, e) => s + e.sats, 0);
    if (running || round.state === "done") {
      title.innerHTML = `<i class="fa-solid fa-flag-checkered"></i> ROUND ${round.no}${round.state === "done" ? " 終了" : ""}`;
      $("goal-now").textContent = SM.fmt(sum);
      $("goal-target").textContent = SM.fmt(round.goal);
      $("goal-fill").style.width = `${Math.min(100, (sum / Math.max(1, round.goal)) * 100)}%`;
      $("goal-fill").classList.toggle("done", sum >= round.goal);
      const mvp = topPerson(r);
      $("round-mvp").innerHTML = mvp ? `👑 いまの MVP：<b>${SM.esc(mvp.nick)}</b>（${SM.fmt(mvp.sats)} sats）` : "ニックネームを付けて投げると MVP を狙えます";
    } else {
      title.innerHTML = `<i class="fa-solid fa-mug-hot"></i> フリータイム`;
      const all = list.reduce((s, e) => s + e.sats, 0);
      const goal = nextMilestone(all);
      $("goal-now").textContent = SM.fmt(all);
      $("goal-target").textContent = SM.fmt(goal);
      $("goal-fill").style.width = `${Math.min(100, (all / goal) * 100)}%`;
      $("goal-fill").classList.remove("done");
      const mvp = topPerson(list);
      $("round-mvp").innerHTML = mvp ? `👑 今日の MVP：<b>${SM.esc(mvp.nick)}</b>（${SM.fmt(mvp.sats)} sats）` : "累計で次の節目をめざそう";
    }
    tickTimer();
  }

  function topPerson(list) {
    const m = new Map();
    list.forEach((e) => {
      const n = SM.cleanNick(e.n, settings.ngWords);
      if (n && !e.hidden) m.set(n, (m.get(n) || 0) + e.sats);
    });
    let best = null;
    m.forEach((sats, nick) => { if (!best || sats > best.sats) best = { nick, sats }; });
    return best;
  }

  const MILESTONES = [1000, 2100, 5000, 10000, 21000, 50000, 100000, 210000, 500000, 1000000, 2100000, 5000000, 10000000, 21000000];
  function nextMilestone(n) {
    return MILESTONES.find((m) => m > n) || Math.ceil((n + 1) / 10000000) * 10000000;
  }

  function tickTimer() {
    const el = $("round-timer");
    if (round.state !== "running") {
      el.textContent = round.state === "done" ? "0:00" : "∞";
      el.classList.remove("hurry");
      return;
    }
    const left = Math.max(0, round.endsAt - Date.now());
    const s = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    el.classList.toggle("hurry", s <= 30);
    if (s <= 5 && s > 0 && s !== tickTimer.lastBeep) {
      tickTimer.lastBeep = s;
      SM.sound.play("pip");
    }
    if (left <= 0) endRound();
  }

  // これまでのラウンド（作り直すとき、時刻からどのラウンドかを決める）
  const history = () => (Array.isArray(round.history) ? round.history : []);
  function roundAt(ms) {
    const h = history().find((x) => ms >= x.startedAt - 1000 && ms <= x.endsAt + 1000);
    return h ? h.no : 0;
  }

  function startRound() {
    settings = SM.settings();
    const no = (round.no || 0) + 1;
    const startedAt = Date.now();
    const endsAt = startedAt + Math.max(1, Number(settings.roundMinutes) || 10) * 60000;
    const goal = Math.max(1, Number(settings.roundGoal) || 21000);
    round = {
      no, startedAt, endsAt, goal,
      state: "running",
      history: [...history().filter((x) => x.no !== no), { no, startedAt, endsAt, goal }].slice(-200),
    };
    SM.saveRound(round);
    publishMeta();
    $("result").hidden = true;
    SM.sound.play("gong");
    SM.fx.banner(`<small>ROUND ${no}</small>START!<em>ゴール ${SM.fmt(round.goal)} sats</em>`, "goal", 2600);
    renderAll();
    changed();
  }

  function endRound() {
    if (round.state !== "running") return;
    const endsAt = Date.now();
    round = { ...round, state: "done", endsAt, history: history().map((x) => (x.no === round.no ? { ...x, endsAt } : x)) };
    SM.saveRound(round);
    publishMeta();
    showResult();
    renderAll();
    changed();
  }

  function showResult() {
    const list = inRound(shown(), round.no);
    const a = aggregate(list);
    const sum = a.sats;
    const reached = sum >= round.goal;
    $("result-title").textContent = `ROUND ${round.no} 終了！`;
    $("result-sats").textContent = SM.fmt(sum);
    $("result-sub").textContent = `${SM.fmt(a.count)} 投 · ゴール ${SM.fmt(round.goal)} sats ${reached ? "達成 🎯" : `まであと ${SM.fmt(round.goal - sum)}`}`;
    const mvp = topPerson(list);
    const topRegion = [...a.byRegion.entries()].sort((x, y) => y[1] - x[1])[0];
    const tr = topRegion && SM.regionByKey(topRegion[0]);
    const biggest = list.reduce((b, e) => (!b || e.sats > b.sats ? e : b), null);
    const cards = [
      ["👑 MVP", mvp ? `${SM.esc(mvp.nick)}<small>${SM.fmt(mvp.sats)} sats</small>` : "—"],
      ["🏆 いちばん灯った地域", tr ? `${tr.flag} ${SM.esc(tr.name)}<small>${SM.fmt(topRegion[1])} sats</small>` : "—"],
      ["⚡ 最大の 1 投", biggest ? `${SM.fmt(biggest.sats)} sats<small>${SM.esc(SM.cleanNick(biggest.n, settings.ngWords) || "名無しさん")}</small>` : "—"],
      ["🗾 日本 vs 世界 🌍", `${SM.fmt(a.jp)} : ${SM.fmt(a.world)}<small>${a.jp === a.world ? "引き分け" : a.jp > a.world ? "日本チームの勝ち" : "世界チームの勝ち"}</small>`],
    ];
    $("result-grid").innerHTML = cards.map(([k, v]) => `<div class="result-item"><span>${k}</span><b>${v}</b></div>`).join("");
    $("result").hidden = false;
    SM.sound.play("gong");
    if (reached) {
      SM.fx.confetti();
      setTimeout(() => SM.sound.play("fanfare"), 500);
    }
  }

  // ── 届いた 1 件 ────────────────────────────────────────
  function addEntry(e, { silent = false } = {}) {
    if (seen.has(e.id) && entries.some((x) => x.id === e.id)) return;
    seen.add(e.id);
    // いま届いたものは、いまのラウンドに入れる（Blink の時刻は秒までなので、始めた直後の 1 投が外れないように）。
    // 開き直したときに見つけた分（silent）だけ、届いた時刻で決める
    const running = round.state === "running";
    e.round = running && (!silent || e.at >= round.startedAt - 1000) ? round.no : 0;
    entries.push(e);
    entries.sort((x, y) => x.at - y.at);
    SM.saveEntries(entries);
    if (silent) {
      renderAll();
    } else {
      pending.add(e.id);
      queue.push(e);
      play();
    }
    publishRecords();
    changed();
  }

  // ── Nostr リレーへの記録（写し。正しいのは Blink の履歴） ─────
  let publishing = false;
  let recordState = { pending: 0, failed: false };
  async function publishRecords() {
    if (publishing || !settings.record || !window.SM.records) return;
    publishing = true;
    try {
      const session = SM.session();
      for (const e of entries.filter((x) => !x.pub && !x.test)) {
        const ok = await SM.records.publishEntry(e, session, settings.ngWords);
        if (!ok) {
          recordState.failed = true;
          break;
        }
        e.pub = true;
        recordState.failed = false;
        SM.saveEntries(entries);
      }
    } catch (err) {
      console.error(err);
      recordState.failed = true;
    } finally {
      publishing = false;
      recordState.pending = entries.filter((x) => !x.pub && !x.test).length;
      changed();
    }
  }
  function publishMeta() {
    if (!settings.record || !window.SM.records) return;
    SM.records.publishMeta({
      since: SM.since(),
      rounds: history(),
      eventName: (window.SATS_CONFIG && window.SATS_CONFIG.eventName) || "",
    }, SM.session()).catch(() => {});
  }
  setInterval(publishRecords, 30000);

  let homeTimer = 0;
  async function play() {
    if (playing) return;
    playing = true;
    while (queue.length) {
      const e = queue.shift();
      try {
        await show(e, queue.length >= 3);
      } catch (err) {
        console.error(err);
        pending.delete(e.id);
      }
    }
    playing = false;
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => { SatsMap.home("country"); SatsMap.home("jp_prefecture"); }, 5000);
  }

  async function show(e, fast) {
    const before = aggregate(shown());
    const beforeRound = inRound(shown(), round.no).reduce((s, x) => s + x.sats, 0);
    const region = SM.regionByKey(e.r);
    const firstHere = region && !shown().some((x) => x.r === e.r);

    clearTimeout(homeTimer);
    if (region) {
      ensureVisible(region.type);
      if (settings.zoom && !fast) await SatsMap.zoomTo(region.type, region.code);
    }
    pending.delete(e.id);
    const after = renderAll();

    const pt = (region && SatsMap.screenPoint(region.type, region.code)) || centerOfMaps();
    if (region) SatsMap.pulse(region.type, region.code);

    // 金額で演出を変える
    let wait = fast ? 700 : 1800;
    if (e.sats >= settings.whaleAt) {
      SM.fx.fireworks(pt.x, pt.y, 7);
      SM.fx.confetti();
      SM.fx.shake();
      SM.sound.play("fanfare");
      SM.fx.banner(`<small>🐋 WHALE ZAP</small>${SM.fmt(e.sats)} sats<em>${SM.esc(nickOrAnon(e))} → ${region ? `${region.flag} ${SM.esc(region.name)}` : "⚡"}</em>`, "whale", 3800);
      wait = 4600;
    } else if (e.sats >= settings.bigAt) {
      SM.fx.fireworks(pt.x, pt.y, 4);
      SM.sound.play("zap");
      SM.fx.banner(`<small>⚡ BIG ZAP</small>${SM.fmt(e.sats)} sats`, "big", 2200);
      wait = fast ? 1200 : 3000;
    } else if (e.sats >= 100) {
      SM.fx.bolt(pt.x, pt.y);
      SM.sound.play("zap");
    } else {
      SM.fx.spark(pt.x, pt.y);
      SM.sound.play("pip");
    }
    bubble(e, region, pt, wait + 3500);

    // おまけ：ゾロ目
    if (SM.isRepdigit(e.sats)) {
      setTimeout(() => {
        SM.fx.banner(`<small>🎰 ゾロ目！</small>${SM.fmt(e.sats)}`, e.sats >= 777 && String(e.sats).startsWith("7") ? "whale" : "info", 2200);
        SM.sound.play("combo");
      }, 600);
    }
    // 初制覇
    if (firstHere) {
      setTimeout(() => {
        SM.fx.banner(`<small>NEW! 初制覇</small>${region.flag} ${SM.esc(region.name)}`, "info", 2200);
      }, e.sats >= settings.bigAt ? 2400 : 300);
      if (region.type === "jp_prefecture" && after.prefs.size === SM.PREF_COUNT && before.prefs.size < SM.PREF_COUNT) {
        setTimeout(() => {
          SM.fx.banner(`<small>🗾 全国制覇！</small>47 都道府県すべてが灯りました`, "whale", 5000);
          SM.fx.confetti(400);
          SM.sound.play("fanfare");
        }, 2600);
        wait += 3000;
      }
    }
    // キリ番（投げた回数）
    if ([10, 21, 50, 100, 210, 500, 1000, 2100].includes(after.count)) {
      setTimeout(() => SM.fx.banner(`<small>🎉 キリ番</small>${after.count} 投目！<em>${SM.esc(nickOrAnon(e))}</em>`, "info", 2400), 900);
    }
    // 累計の節目
    const crossed = MILESTONES.filter((m) => before.sats < m && after.sats >= m).pop();
    if (crossed) {
      setTimeout(() => {
        SM.fx.banner(`<small>累計</small>${SM.fmt(crossed)} sats 突破！`, "goal", 2600);
        SM.fx.confetti(120);
      }, 1400);
    }
    // ラウンドのゴール
    if (round.state === "running" && e.round === round.no) {
      const afterRound = beforeRound + e.sats;
      const hit = [25, 50, 75, 100].filter((p) => beforeRound < (round.goal * p) / 100 && afterRound >= (round.goal * p) / 100).pop();
      if (hit === 100) {
        setTimeout(() => {
          SM.fx.banner(`<small>ROUND ${round.no}</small>🎯 GOAL!`, "goal", 3200);
          SM.fx.confetti(300);
          SM.sound.play("fanfare");
        }, 1200);
      } else if (hit) {
        setTimeout(() => SM.fx.banner(`<small>ゴールまで</small>${hit}% 到達！`, "info", 1800), 1200);
      }
    }
    // コンボ（20 秒以内に続いたら）
    const now = Date.now();
    combo.n = now - combo.last < 20000 ? combo.n + 1 : 1;
    combo.last = now;
    showCombo();

    await new Promise((r) => setTimeout(r, wait));
  }

  function nickOrAnon(e) {
    return (!e.hidden && SM.cleanNick(e.n, settings.ngWords)) || "名無しさん";
  }

  function centerOfMaps() {
    const r = $("map-grid").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function bubble(e, region, pt, ms) {
    const nick = e.hidden ? "" : SM.cleanNick(e.n, settings.ngWords);
    const msg = messageOf(e);
    const el = document.createElement("div");
    el.className = `bubble${e.sats >= settings.bigAt ? " big" : ""}`;
    el.innerHTML = `
      <div class="bubble-head">${region ? region.flag : "⚡"} <b>${SM.esc(nick || "名無しさん")}</b><span>+${SM.fmt(e.sats)}</span></div>
      ${msg ? `<div class="bubble-msg">${SM.esc(msg)}</div>` : ""}`;
    document.body.appendChild(el);
    const w = el.offsetWidth;
    const x = Math.max(12, Math.min(innerWidth - w - 12, pt.x - w / 2));
    const y = Math.max(12, pt.y - el.offsetHeight - 18 - Math.random() * 30);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    setTimeout(() => el.classList.add("out"), ms);
    setTimeout(() => el.remove(), ms + 500);
  }

  let comboTimer = 0;
  function showCombo() {
    const el = $("combo");
    clearTimeout(comboTimer);
    if (combo.n < 3) {
      el.hidden = true;
      return;
    }
    $("combo-n").textContent = `×${combo.n}`;
    el.hidden = false;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    if (combo.n % 5 === 0) {
      SM.sound.play("combo");
      SM.fx.banner(`<small>🔥 ${combo.n} COMBO!</small>会場が燃えてる！`, "big", 1800);
    }
    comboTimer = setTimeout(() => { el.hidden = true; combo.n = 0; }, 20000);
  }

  // ── 地図の並び（片方を大きく・順に回す） ─────────────────
  let focus = null;
  function setFocus(target) {
    focus = target;
    const grid = $("map-grid");
    grid.classList.remove("focus-world", "focus-japan");
    if (target) grid.classList.add(`focus-${target}`);
    $("restore-both-btn").hidden = !target;
    setTimeout(() => SatsMap.resize(), 60);
  }
  function ensureVisible(type) {
    const need = type === "country" ? "world" : "japan";
    if (focus && focus !== need) setFocus(null);
  }
  let rotateIdx = 0;
  let rotateAt = Date.now();
  setInterval(() => {
    if (!settings.rotate) {
      if (rotateIdx) { rotateIdx = 0; setFocus(null); }
      return;
    }
    if (playing || Date.now() - rotateAt < Math.max(5, Number(settings.rotateSec) || 20) * 1000) return;
    rotateAt = Date.now();
    rotateIdx = (rotateIdx + 1) % 4;
    setFocus([null, "japan", null, "world"][rotateIdx]);
  }, 1000);

  // ── 下の流れる文（だれも投げていないあいだの呼び込み） ─────
  let tickerIdx = 0;
  function tickerLines() {
    const list = shown();
    const a = aggregate(list);
    const lines = ["右上の QR をスマホで読んで、地域を選んで ⚡ を投げよう（21 sats から）"];
    const untouched = SM.prefectures().filter((p) => !a.prefs.has(p.code));
    if (untouched.length) {
      const p = untouched[Math.floor(Math.random() * untouched.length)];
      lines.push(`まだだれも投げていない：${p.flag} ${p.name} — 最初の 1 投で「初制覇」！`);
      lines.push(`都道府県 ${a.prefs.size} / 47 制覇 — 全国制覇まで あと ${untouched.length}`);
    }
    if (round.state === "running") {
      const sum = inRound(list, round.no).reduce((s, e) => s + e.sats, 0);
      if (sum < round.goal) lines.push(`ROUND ${round.no} のゴールまで あと ${SM.fmt(round.goal - sum)} sats！`);
    }
    if (a.jp + a.world > 0) {
      lines.push(a.jp === a.world ? "日本チーム vs 世界チーム、いま互角！" : `日本チーム vs 世界チーム — いまは ${a.jp > a.world ? "🗾 日本" : "🌍 世界"} がリード`);
    }
    const top = [...a.byRegion.entries()].sort((x, y) => y[1] - x[1])[0];
    if (top) {
      const r = SM.regionByKey(top[0]);
      lines.push(`いまのトップ：${r.flag} ${r.name} ${SM.fmt(top[1])} sats — 追い抜けるか？`);
    }
    lines.push("ゾロ目（111・777 など）で投げると……？", `${SM.fmt(settings.whaleAt)} sats 以上で、クジラが現れる 🐋`, "ニックネームとひとことも、地図に出ます");
    return lines;
  }
  function nextTicker() {
    const lines = tickerLines();
    tickerIdx = (tickerIdx + 1) % lines.length;
    const el = $("ticker-text");
    el.classList.remove("in");
    void el.offsetWidth;
    el.textContent = lines[tickerIdx];
    el.classList.add("in");
  }

  // ── QR（スマホの支払いページへ） ─────────────────────────
  function payUrl() {
    const u = new URL("pay.html", location.href);
    u.search = "";
    u.hash = "";
    const cfgUser = (window.SATS_CONFIG && window.SATS_CONFIG.blinkUsername) || "";
    if (!cfgUser && settings.username) u.searchParams.set("u", settings.username);
    // スマホに「いまの会場」を出すための、記録の鍵とイベント（とリレーを変えたときはリレー）
    if (settings.record && window.SM.records) {
      SM.records.ensureKey();
      u.searchParams.set("k", SM.records.npub());
      u.searchParams.set("s", SM.session());
      if (settings.recordRelays && settings.recordRelays.length) u.searchParams.set("rl", SM.records.relays().join(","));
    }
    return u.toString();
  }
  function renderQr() {
    const url = payUrl();
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("pay-qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    $("pay-url").textContent = url.replace(/^https?:\/\//, "");
  }

  // ── Blink を読む ──────────────────────────────────────
  let failures = 0;
  let pollTimer = 0;
  async function poll(initial) {
    clearTimeout(pollTimer);
    if (rebuilding) return;
    const key = SM.apiKey();
    if (!key) {
      setStatus("demo");
      pollTimer = setTimeout(() => poll(true), 5000);
      return;
    }
    try {
      const since = SM.since();
      const fresh = [];
      let after = null;
      for (let page = 0; page < (initial ? 10 : 1); page++) {
        const res = await SM.blink.receives(key, { first: initial ? 50 : 20, after });
        res.items.forEach((it) => { if (it.at >= since && !seen.has(it.id)) fresh.push(it); });
        if (!res.hasMore || res.oldest < since || !res.cursor) break;
        after = res.cursor;
      }
      fresh.sort((x, y) => x.at - y.at);
      for (const it of fresh) {
        const d = SM.memo.decode(it.memo);
        if (!d && !settings.countAll) {
          seen.add(it.id);
          continue;
        }
        addEntry({
          id: it.id,
          at: it.at * 1000,
          sats: it.sats,
          r: d && d.region ? SM.regionKey(d.region) : null,
          n: d ? d.nick : "",
          m: d ? d.msg : SM.tidy(it.memo, SM.MSG_MAX),
          hash: it.hash,
          hidden: false,
        }, { silent: initial });
      }
      failures = 0;
      setStatus("live");
    } catch (err) {
      failures += 1;
      setStatus("error", err.message);
    }
    const base = Math.max(2, Number(settings.pollSec) || 4) * 1000;
    pollTimer = setTimeout(() => poll(false), base * Math.min(8, 2 ** failures));
  }

  function setStatus(kind, text = "") {
    status = { kind, text };
    const el = $("status-chip");
    el.className = `status-chip ${kind}`;
    el.textContent = { live: "● LIVE", demo: "DEMO", error: "⚠ Blink につながりません", init: "…" }[kind] || kind;
    el.title = text;
    $("demo-card").hidden = !isDemo();
    changed();
  }

  // 管理画面へ「変わった」を知らせる
  function changed() {
    SM.bus.post({ type: "changed", status, round, record: { ...recordState, on: !!settings.record, session: SM.session() } });
  }

  // ── デモ ──────────────────────────────────────────────
  const DEMO_NICKS = ["satoshi", "ましゅ", "hodler_mika", "lnとむ", "ノード太郎", "サトコ", "ビットくん", "", ""];
  const DEMO_MSGS = ["GM ⚡", "はじめての Lightning！", "地元を灯しに来ました", "Stay humble, stack sats", "", "", "この会場最高", "全国制覇しよう"];
  function demoEntry(regionKey, sats) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    let r = regionKey;
    if (!r) {
      const pool = Math.random() < 0.55 ? SM.prefectures() : SM.countries();
      r = SM.regionKey(pick(pool));
    }
    const amounts = [21, 21, 100, 210, 210, 500, 777, 1000, 2100, 21000];
    return {
      id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      sats: sats || pick(amounts),
      r,
      n: pick(DEMO_NICKS),
      m: pick(DEMO_MSGS),
      hidden: false,
      test: true,
    };
  }

  function wireUi() {
    document.querySelectorAll(".focus-btn").forEach((b) => b.addEventListener("click", () => setFocus(b.dataset.focusTarget)));
    $("restore-both-btn").addEventListener("click", () => setFocus(null));
    document.querySelectorAll(".rank-tab").forEach((b) => b.addEventListener("click", () => {
      rankMode = b.dataset.rank;
      renderRanking(shown());
    }));
    document.querySelectorAll(".demo-btn[data-demo]").forEach((b) => b.addEventListener("click", () => {
      const [type, code, sats] = b.dataset.demo.split(":");
      addEntry(demoEntry(`${type}:${code}`, Number(sats)));
    }));
    $("demo-random").addEventListener("click", () => addEntry(demoEntry()));
    $("demo-rush").addEventListener("click", () => {
      for (let i = 0; i < 6; i++) setTimeout(() => addEntry(demoEntry(null, [21, 210, 21, 100, 21, 210][i])), i * 400);
    });
    $("result").addEventListener("click", () => { $("result").hidden = true; });

    const unlock = () => {
      SM.sound.unlock();
      $("sound-unlock").hidden = true;
    };
    addEventListener("pointerdown", unlock);
    $("sound-unlock").addEventListener("click", unlock);

    addEventListener("keydown", (ev) => {
      unlock();
      if (ev.target.closest && ev.target.closest("input, textarea")) return;
      const k = ev.key.toLowerCase();
      if (k === "f") {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      } else if (k === " ") {
        ev.preventDefault();
        if (round.state === "running") endRound();
        else startRound();
      } else if (k === "m") {
        SM.saveSettings({ sound: !settings.sound });
      } else if (k === "1") setFocus("world");
      else if (k === "2") setFocus("japan");
      else if (k === "0") setFocus(null);
      else if (k === "a") window.open("admin.html", "satsmap-admin");
      else if (k === "d" && isDemo()) addEntry(demoEntry());
      else if (k === "escape") $("result").hidden = true;
    });
  }

  // ── 作り直す（Blink の履歴が正。Nostr の記録から「隠した」「ラウンド」を戻す） ──
  let rebuilding = false;
  async function rebuild(msg) {
    if (rebuilding) return;
    const key = SM.apiKey();
    const reply = (o) => SM.bus.post({ type: "rebuild-done", ...o });
    if (!key) return reply({ ok: false, error: "Blink の API キーがありません" });
    rebuilding = true;
    clearTimeout(pollTimer);
    try {
      if (msg.session) SM.setSession(msg.session);
      const session = SM.session();
      const since = Number(msg.since) > 0 ? Math.floor(Number(msg.since)) : SM.since();

      // 1. Nostr の記録（あれば）
      let recs = { entries: new Map(), meta: null };
      let relayError = "";
      if (settings.record && window.SM.records) {
        try {
          const pk = msg.pubkey ? SM.records.parsePubkey(msg.pubkey) : SM.records.pubkey();
          recs = await SM.records.fetchAll(session, pk);
        } catch (err) {
          relayError = err.message || String(err);
        }
      }
      if (recs.meta && Array.isArray(recs.meta.rounds)) {
        const known = new Map(history().map((x) => [x.no, x]));
        recs.meta.rounds.forEach((x) => {
          if (x && Number.isInteger(x.no) && x.no > 0 && !known.has(x.no)) known.set(x.no, { no: x.no, startedAt: +x.startedAt || 0, endsAt: +x.endsAt || 0, goal: +x.goal || settings.roundGoal });
        });
        const h = [...known.values()].sort((a, b) => a.no - b.no);
        round = { ...round, no: Math.max(round.no || 0, ...h.map((x) => x.no), 0), history: h };
        SM.saveRound(round);
      }

      // 2. Blink の入金履歴を、since までさかのぼって読む
      const items = [];
      let after = null;
      for (let page = 0; page < 200; page++) {
        const res = await SM.blink.receives(key, { first: 50, after });
        res.items.forEach((it) => { if (it.at >= since) items.push(it); });
        if (!res.hasMore || res.oldest < since || !res.cursor) break;
        after = res.cursor;
      }

      // 3. 組み立てる（いまの記録・Nostr の記録の「隠した」「ラウンド」を引き継ぐ）
      const before = new Map(entries.map((e) => [e.id, e]));
      const next = [];
      for (const it of items) {
        const d = SM.memo.decode(it.memo);
        if (!d && !settings.countAll) continue;
        const old = before.get(it.id);
        const rec = recs.entries.get(it.id);
        const at = it.at * 1000;
        next.push({
          id: it.id,
          at,
          sats: it.sats,
          r: d && d.region ? SM.regionKey(d.region) : null,
          n: d ? d.nick : "",
          m: d ? d.msg : SM.tidy(it.memo, SM.MSG_MAX),
          hash: it.hash,
          hidden: old ? !!old.hidden : !!(rec && rec.hidden),
          round: old && old.round ? old.round : rec && Number.isInteger(rec.round) && rec.round > 0 ? rec.round : roundAt(at),
          // Nostr にあって、中身が同じなら出し直さない
          pub: !!(rec && rec.sats === it.sats && !!rec.hidden === !!(old ? old.hidden : rec.hidden)),
        });
        seen.add(it.id);
      }
      next.sort((x, y) => x.at - y.at);
      queue.length = 0;
      pending.clear();
      entries = next;
      SM.saveEntries(entries);
      SM.setSince(since);
      renderAll();
      renderQr();
      publishMeta();
      publishRecords();
      reply({
        ok: true,
        count: entries.length,
        sats: entries.reduce((s, e) => s + e.sats, 0),
        fromRelay: recs.entries.size,
        relayError,
      });
    } catch (err) {
      reply({ ok: false, error: err.message || String(err) });
    } finally {
      rebuilding = false;
      changed();
      pollTimer = setTimeout(() => poll(false), 2000);
    }
  }

  // 管理画面からの頼み
  SM.bus.on((msg) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "settings":
        settings = SM.settings();
        SM.sound.enabled = settings.sound;
        $("event-name").textContent = (window.SATS_CONFIG && window.SATS_CONFIG.eventName) || "";
        renderQr();
        renderAll();
        poll(true);
        publishRecords();
        break;
      case "round-start":
        startRound();
        break;
      case "round-end":
        endRound();
        break;
      case "hide": {
        const e = entries.find((x) => x.id === msg.id);
        if (e) {
          e.hidden = !!msg.hidden;
          e.pub = false;
          SM.saveEntries(entries);
          publishRecords();
          document.querySelectorAll(".bubble").forEach((b) => b.remove());
          renderAll();
          changed();
        }
        break;
      }
      case "test":
        addEntry({ ...demoEntry(msg.r, Number(msg.sats) || 21), n: SM.tidy(msg.n, SM.NICK_MAX), m: SM.tidy(msg.m, SM.MSG_MAX) });
        break;
      case "clear-tests":
        entries = entries.filter((e) => !e.test);
        SM.saveEntries(entries);
        renderAll();
        changed();
        break;
      case "reset":
        entries = [];
        queue.length = 0;
        pending.clear();
        SM.saveEntries(entries);
        SM.resetSince();
        round = { no: 0, startedAt: 0, endsAt: 0, goal: settings.roundGoal, state: "idle", history: [] };
        SM.saveRound(round);
        $("result").hidden = true;
        renderAll();
        renderQr();
        publishMeta();
        changed();
        poll(true);
        break;
      case "rebuild":
        rebuild(msg);
        break;
      case "ping":
        changed();
        break;
      default:
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    SatsMap.init();
    SM.sound.enabled = settings.sound;
    $("event-name").textContent = (window.SATS_CONFIG && window.SATS_CONFIG.eventName) || "";
    wireUi();
    renderQr();
    setTimeout(() => {
      renderAll();
      if (round.state === "done") showResult();
    }, 400);
    poll(true);
    setInterval(tickTimer, 250);
    setInterval(() => renderFeed(shown()), 30000);
    setInterval(() => {
      rankMode = rankMode === "region" ? "people" : "region";
      renderRanking(shown());
    }, 12000);
    nextTicker();
    setInterval(nextTicker, 9000);
    // 音：ブラウザは一度押すまで音を出させない
    SM.sound.unlock();
    setTimeout(() => { $("sound-unlock").hidden = !(settings.sound && SM.sound.blocked); }, 600);
  });
})();
