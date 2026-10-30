/**
 * common.js — 投げる側（pay.html）・スクリーン（index.html）・管理画面（admin.html）で共通のもの
 *   SM.region(type, code)  地域の名前・旗
 *   SM.memo                 インボイスのメモに地域・名前・メッセージを入れる／読む
 *   SM.clean                メッセージを画面に出す前の整え（NG ワード・URL）
 */
window.SM = window.SM || {};

(function (SM) {
  // 都道府県（ISO 3166-2:JP）。絵文字は名物から
  const PREFS = [
    ["JP-01", "北海道", "Hokkaido", "🦀"], ["JP-02", "青森県", "Aomori", "🍎"],
    ["JP-03", "岩手県", "Iwate", "🥢"], ["JP-04", "宮城県", "Miyagi", "🎋"],
    ["JP-05", "秋田県", "Akita", "🐕"], ["JP-06", "山形県", "Yamagata", "🍒"],
    ["JP-07", "福島県", "Fukushima", "🐂"], ["JP-08", "茨城県", "Ibaraki", "🍈"],
    ["JP-09", "栃木県", "Tochigi", "🍓"], ["JP-10", "群馬県", "Gunma", "🐎"],
    ["JP-11", "埼玉県", "Saitama", "🎎"], ["JP-12", "千葉県", "Chiba", "🥜"],
    ["JP-13", "東京都", "Tokyo", "🗼"], ["JP-14", "神奈川県", "Kanagawa", "🌊"],
    ["JP-15", "新潟県", "Niigata", "🍙"], ["JP-16", "富山県", "Toyama", "🦑"],
    ["JP-17", "石川県", "Ishikawa", "✨"], ["JP-18", "福井県", "Fukui", "🦖"],
    ["JP-19", "山梨県", "Yamanashi", "🍇"], ["JP-20", "長野県", "Nagano", "🏔️"],
    ["JP-21", "岐阜県", "Gifu", "🏮"], ["JP-22", "静岡県", "Shizuoka", "🗻"],
    ["JP-23", "愛知県", "Aichi", "🍤"], ["JP-24", "三重県", "Mie", "🦞"],
    ["JP-25", "滋賀県", "Shiga", "🛶"], ["JP-26", "京都府", "Kyoto", "⛩️"],
    ["JP-27", "大阪府", "Osaka", "🐙"], ["JP-28", "兵庫県", "Hyogo", "🐄"],
    ["JP-29", "奈良県", "Nara", "🦌"], ["JP-30", "和歌山県", "Wakayama", "🐼"],
    ["JP-31", "鳥取県", "Tottori", "🐫"], ["JP-32", "島根県", "Shimane", "💞"],
    ["JP-33", "岡山県", "Okayama", "🍑"], ["JP-34", "広島県", "Hiroshima", "🍁"],
    ["JP-35", "山口県", "Yamaguchi", "🐡"], ["JP-36", "徳島県", "Tokushima", "💃"],
    ["JP-37", "香川県", "Kagawa", "🍜"], ["JP-38", "愛媛県", "Ehime", "🍊"],
    ["JP-39", "高知県", "Kochi", "🐟"], ["JP-40", "福岡県", "Fukuoka", "🌶️"],
    ["JP-41", "佐賀県", "Saga", "🎈"], ["JP-42", "長崎県", "Nagasaki", "⛪"],
    ["JP-43", "熊本県", "Kumamoto", "🐻"], ["JP-44", "大分県", "Oita", "♨️"],
    ["JP-45", "宮崎県", "Miyazaki", "🥭"], ["JP-46", "鹿児島県", "Kagoshima", "🌋"],
    ["JP-47", "沖縄県", "Okinawa", "🌺"],
  ];
  const prefByCode = new Map(PREFS.map((p) => [p[0], p]));
  const countryEn = new Map(window.SATS_COUNTRIES || []);

  let jaNames = null;
  try { jaNames = new Intl.DisplayNames(["ja"], { type: "region" }); } catch (e) { /* 古いブラウザ */ }

  function flagOf(code) {
    if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
    return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  function countryName(code) {
    let ja = "";
    try { ja = jaNames ? jaNames.of(code) : ""; } catch (e) { ja = ""; }
    return ja && ja !== code ? ja : countryEn.get(code) || code;
  }

  /** 地域の情報。知らない地域は null */
  SM.region = function (type, code) {
    if (type === "jp_prefecture") {
      const p = prefByCode.get(code);
      return p ? { type, code, name: p[1], en: p[2], flag: p[3] } : null;
    }
    if (type === "country") {
      if (!countryEn.has(code)) return null;
      return { type, code, name: countryName(code), en: countryEn.get(code), flag: flagOf(code) };
    }
    return null;
  };
  /** "jp_prefecture:JP-13" の形から */
  SM.regionByKey = function (key) {
    if (typeof key !== "string") return null;
    const i = key.indexOf(":");
    return i < 0 ? null : SM.region(key.slice(0, i), key.slice(i + 1));
  };
  SM.regionKey = (r) => `${r.type}:${r.code}`;
  SM.prefectures = () => PREFS.map((p) => SM.region("jp_prefecture", p[0]));
  SM.countries = () => [...countryEn.keys()].map((c) => SM.region("country", c));
  SM.PREF_COUNT = PREFS.length;

  SM.fmt = (n) => Math.round(n || 0).toLocaleString("en-US");

  SM.esc = function (s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  };

  // 見えない文字・向きを変える記号・改行を取って、長さをそろえる
  SM.tidy = function (s, max) {
    const t = String(s ?? "")
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [...t].slice(0, max).join("");
  };

  SM.NICK_MAX = 20;
  SM.MSG_MAX = 60;

  /**
   * インボイスのメモ。ウォレットで読める文のあとに、機械が読む部分（##{…}）を付ける。
   * 例：⚡SatsMap 🗼東京都 from ましゅ ##{"v":1,"r":"jp_prefecture:JP-13","n":"ましゅ","m":"こんにちは"}
   */
  SM.memo = {
    MARK: "##",
    encode({ region, nick, msg }) {
      const n = SM.tidy(nick, SM.NICK_MAX);
      const m = SM.tidy(msg, SM.MSG_MAX);
      const head = `⚡SatsMap ${region.flag}${region.name}${n ? ` from ${n}` : ""}`;
      return `${head} ${this.MARK}${JSON.stringify({ v: 1, r: SM.regionKey(region), n, m })}`;
    },
    /** SatsMap のメモなら { region, nick, msg }、違えば null */
    decode(memo) {
      if (typeof memo !== "string") return null;
      const i = memo.lastIndexOf(this.MARK + "{");
      if (i < 0 || !memo.startsWith("⚡SatsMap")) return null;
      let o;
      try { o = JSON.parse(memo.slice(i + this.MARK.length)); } catch (e) { return null; }
      if (!o || typeof o !== "object" || o.v !== 1) return null;
      return {
        region: SM.regionByKey(o.r),
        nick: SM.tidy(o.n, SM.NICK_MAX),
        msg: SM.tidy(o.m, SM.MSG_MAX),
      };
    },
  };

  // 会場のスクリーンに出す前の整え。NG ワードを含むメッセージは出さない、URL は 🔗 にする
  const BUILTIN_NG = ["死ね", "殺す", "ころす", "fuck", "shit", "nigger", "faggot", "rape"];
  SM.clean = function (text, ngWords) {
    let t = SM.tidy(text, SM.MSG_MAX);
    if (!t) return "";
    const lower = t.toLowerCase().normalize("NFKC");
    const words = BUILTIN_NG.concat(ngWords || []).map((w) => String(w).trim().toLowerCase().normalize("NFKC")).filter(Boolean);
    if (words.some((w) => lower.includes(w))) return null; // 出さない
    t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "🔗").replace(/\b(?:lnbc|lnurl|npub1|nsec1)\w{8,}/gi, "🔗");
    return t;
  };
  SM.cleanNick = function (nick, ngWords) {
    const n = SM.clean(nick, ngWords);
    return n === null ? "" : SM.tidy(n, SM.NICK_MAX);
  };

  /** 「ゾロ目」（111・7777 など。3 けた以上） */
  SM.isRepdigit = (n) => n >= 111 && /^(\d)\1+$/.test(String(n));

  SM.username = function () {
    const q = new URLSearchParams(location.search).get("u");
    const raw = q || (window.SATS_CONFIG && window.SATS_CONFIG.blinkUsername) || SM.settings?.().username || "";
    return String(raw).trim().replace(/@blink\.sv$/i, "").replace(/^@/, "");
  };
})(window.SM);
