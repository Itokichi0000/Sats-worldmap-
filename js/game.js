/**
 * game.js — 遊びのしくみ（スクリーンとスマホの支払いページで共通。画面の部品は持たない）
 *   SM.AREAS / SM.areaOf(key)     地方（北海道・東北・関東…）
 *   SM.kings(list, ngWords)       地域ごとの「王様」（その地域にいちばん多く投げたニックネーム）
 *   SM.crowns(kings)              ニックネームごとの王冠の数
 *   SM.missions                   お題（数分ごとに変わる。だれかが達成すると「クリア」）
 *
 * list の 1 件は { r: "jp_prefecture:JP-13", n: ニックネーム, sats, at, hidden }
 * （スクリーンの記録・Nostr の記録のどちらも、この形で渡せる）
 */
window.SM = window.SM || {};

(function (SM) {
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `JP-${String(a + i).padStart(2, "0")}`);
  SM.AREAS = [
    { id: "hokkaido", name: "北海道", emoji: "🦀", codes: range(1, 1) },
    { id: "tohoku", name: "東北", emoji: "🍎", codes: range(2, 7) },
    { id: "kanto", name: "関東", emoji: "🗼", codes: range(8, 14) },
    { id: "chubu", name: "中部", emoji: "🗻", codes: range(15, 23) },
    { id: "kinki", name: "近畿", emoji: "🐙", codes: range(24, 30) },
    { id: "chugoku", name: "中国", emoji: "🍁", codes: range(31, 35) },
    { id: "shikoku", name: "四国", emoji: "🍜", codes: range(36, 39) },
    { id: "kyushu", name: "九州・沖縄", emoji: "🌋", codes: range(40, 47) },
  ];
  const areaByCode = new Map();
  SM.AREAS.forEach((a) => a.codes.forEach((c) => areaByCode.set(c, a)));
  SM.areaOf = (key) => {
    const r = SM.regionByKey(key);
    return r && r.type === "jp_prefecture" ? areaByCode.get(r.code) || null : null;
  };

  // ── 王様 ───────────────────────────────────────────────
  /** Map<地域, { nick, sats }>。同じ額なら先に届いた人が王様のまま（抜くには上回る） */
  SM.kings = function (list, ngWords) {
    const sums = new Map(); // 地域 -> Map<nick, sats>
    const kings = new Map();
    [...list].sort((x, y) => (x.at || 0) - (y.at || 0)).forEach((e) => {
      if (!e.r || e.hidden || !(e.sats > 0)) return;
      const nick = SM.cleanNick(e.n, ngWords);
      if (!nick) return;
      if (!sums.has(e.r)) sums.set(e.r, new Map());
      const m = sums.get(e.r);
      const total = (m.get(nick) || 0) + e.sats;
      m.set(nick, total);
      const k = kings.get(e.r);
      if (!k || k.nick === nick || total > k.sats) kings.set(e.r, { nick, sats: total });
    });
    return kings;
  };
  /** その人がその地域にもう投げた額 */
  SM.sentTo = function (list, key, nick, ngWords) {
    const me = SM.cleanNick(nick, ngWords);
    if (!me) return 0;
    return list.filter((e) => e.r === key && !e.hidden && SM.cleanNick(e.n, ngWords) === me).reduce((s, e) => s + e.sats, 0);
  };
  SM.crowns = function (kings) {
    const m = new Map();
    kings.forEach((k) => m.set(k.nick, (m.get(k.nick) || 0) + 1));
    return m;
  };

  // ── お題 ───────────────────────────────────────────────
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const nickOf = (e) => SM.tidy(e.n, SM.NICK_MAX) || "名無しさん";

  /**
   * お題の種類。text はお題の文、check(since) は始まってから届いたもので達成したか（{ cur, need, by }）
   * params は Nostr に出してスマホでも同じ文を作れるよう、数と地域だけにする
   */
  const TYPES = {
    pref: {
      make(ctx) {
        const untouched = SM.prefectures().filter((p) => !ctx.prefs.has(p.code));
        if (!untouched.length) return null;
        return { r: SM.regionKey(pick(untouched)) };
      },
      text(p) {
        const r = SM.regionByKey(p.r);
        return `まだだれも投げていない ${r.flag} ${r.name} を灯せ！`;
      },
      check(p, since) {
        const hit = since.find((e) => e.r === p.r);
        return { cur: hit ? 1 : 0, need: 1, by: hit && nickOf(hit) };
      },
    },
    area: {
      make() { return { area: pick(SM.AREAS).id, n: pick([3, 3, 4]) }; },
      text(p) {
        const a = SM.AREAS.find((x) => x.id === p.area);
        return `${a.emoji} ${a.name}の県に ${p.n} 投！`;
      },
      check(p, since) {
        const hits = since.filter((e) => { const a = SM.areaOf(e.r); return a && a.id === p.area; });
        return { cur: hits.length, need: p.n, by: hits.length >= p.n && nickOf(hits[p.n - 1]) };
      },
    },
    count: {
      make() { return { n: pick([6, 8, 10]) }; },
      text(p) { return `みんなで ${p.n} 投！（どこでも OK）`; },
      check(p, since) { return { cur: since.length, need: p.n, by: since.length >= p.n && nickOf(since[p.n - 1]) }; },
    },
    zoro: {
      make() { return {}; },
      text() { return "ゾロ目の金額（111・222・777…）で投げろ！"; },
      check(p, since) {
        const hit = since.find((e) => SM.isRepdigit(e.sats));
        return { cur: hit ? 1 : 0, need: 1, by: hit && nickOf(hit) };
      },
    },
    countries: {
      make() { return { n: 3 }; },
      text(p) { return `🌍 日本以外の国を ${p.n} か国 灯せ！`; },
      check(p, since) {
        const seen = [];
        let by = null;
        since.forEach((e) => {
          const r = SM.regionByKey(e.r);
          if (r && r.type === "country" && r.code !== "JP" && !seen.includes(r.code)) {
            seen.push(r.code);
            if (seen.length === p.n) by = nickOf(e);
          }
        });
        return { cur: seen.length, need: p.n, by };
      },
    },
    exact: {
      make() { return { sats: 21, n: 3 }; },
      text(p) { return `ちょうど ${p.sats} sats を ${p.n} 回！`; },
      check(p, since) {
        const hits = since.filter((e) => e.sats === p.sats);
        return { cur: hits.length, need: p.n, by: hits.length >= p.n && nickOf(hits[p.n - 1]) };
      },
    },
    big: {
      make() { return { sats: 2100 }; },
      text(p) { return `${SM.fmt(p.sats)} sats 以上の大きな 1 投を！`; },
      check(p, since) {
        const hit = since.find((e) => e.sats >= p.sats);
        return { cur: hit ? 1 : 0, need: 1, by: hit && nickOf(hit) };
      },
    },
  };

  SM.missions = {
    TYPES: Object.keys(TYPES),
    /** 次のお題。前の 2 つと同じ種類は避ける。ctx = { prefs: Set（灯った都道府県）, recent: [種類] } */
    next(ctx) {
      const recent = ctx.recent || [];
      const order = Object.keys(TYPES).filter((t) => !recent.includes(t)).sort(() => Math.random() - 0.5);
      for (const type of order) {
        const params = TYPES[type].make(ctx);
        if (params) return { type, params };
      }
      return { type: "count", params: { n: 8 } };
    },
    make(type, params) {
      return TYPES[type] ? { type, params: params || TYPES[type].make({ prefs: new Set() }) } : null;
    },
    text(m) {
      try { return TYPES[m.type] ? TYPES[m.type].text(m.params || {}) : ""; } catch (e) { return ""; }
    },
    /** since：お題が始まってから届いたもの（時刻順） */
    check(m, since) {
      try { return TYPES[m.type].check(m.params || {}, since); } catch (e) { return { cur: 0, need: 1, by: null }; }
    },
    /** Nostr から届いたお題を確かめる（知らない種類・形は捨てる） */
    valid(m) {
      if (!m || typeof m !== "object" || !TYPES[m.type]) return false;
      if (m.params && m.params.r && !SM.regionByKey(m.params.r)) return false;
      return !!SM.missions.text(m);
    },
  };
})(window.SM);
