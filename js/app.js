/**
 * app.js
 * -----------------------------------------------------------------------
 * Wires together: map (map.js), dummy data (dummy-data.js), sidebar feed,
 * ranking list, header stats, tab switching and the demo buttons.
 *
 * NOTE: This is a MOCKUP. In the real app, instead of reading from
 * DUMMY_TRANSACTIONS / firing demo buttons, a polling function would call
 * `GET tables/donations?sort=-created_at` (populated when an LNbits
 * invoice for a region gets paid) and call `handleNewTransaction()` for
 * every new row it hasn't seen yet.
 * -----------------------------------------------------------------------
 */

(function () {

  // extra pool of regions used only by the "random" demo button
  const RANDOM_POOL = [
    { region_type: "country", region_code: "JP", region_name: "Japan", flag: "🇯🇵" },
    { region_type: "country", region_code: "DE", region_name: "Germany", flag: "🇩🇪" },
    { region_type: "country", region_code: "BR", region_name: "Brazil", flag: "🇧🇷" },
    { region_type: "country", region_code: "AU", region_name: "Australia", flag: "🇦🇺" },
    { region_type: "country", region_code: "GB", region_name: "United Kingdom", flag: "🇬🇧" },
    { region_type: "country", region_code: "SV", region_name: "El Salvador", flag: "🇸🇻" },
    { region_type: "jp_prefecture", region_code: "JP-27", region_name: "Osaka", flag: "🏯" },
    { region_type: "jp_prefecture", region_code: "JP-23", region_name: "Aichi", flag: "🎌" },
    { region_type: "jp_prefecture", region_code: "JP-40", region_name: "Fukuoka", flag: "🎌" },
    { region_type: "jp_prefecture", region_code: "JP-11", region_name: "Saitama", flag: "🎌" }
  ];

  // running state
  let totalCount = 0;
  let totalSats = 0;
  const regionTotals = {}; // key: `${region_type}:${region_code}` -> { name, flag, amount }

  const feedListEl = document.getElementById("latest-feed");
  const rankingListEl = document.getElementById("ranking-list");
  const statCountEl = document.getElementById("stat-total-count");
  const statSatsEl = document.getElementById("stat-total-sats");
  const statRegionsEl = document.getElementById("stat-total-regions");
  const pulseLayerWorldEl = document.getElementById("pulse-layer-world");
  const pulseLayerJapanEl = document.getElementById("pulse-layer-japan");

  function regionKey(tx) {
    return `${tx.region_type}:${tx.region_code}`;
  }

  function handleNewTransaction(tx, opts = {}) {
    const silent = !!opts.silent;

    // 1. update running totals
    totalCount += 1;
    totalSats += tx.amount_sats;

    const key = regionKey(tx);
    if (!regionTotals[key]) {
      regionTotals[key] = {
        region_type: tx.region_type,
        region_code: tx.region_code,
        name: tx.region_name,
        flag: tx.flag,
        amount: 0
      };
    }
    regionTotals[key].amount += tx.amount_sats;

    // 2. update map heat + pulse
    SatsMap.addAmount(tx.region_type, tx.region_code, tx.amount_sats);
    if (!silent) {
      SatsMap.pulse(tx.region_type, tx.region_code);
      showToast(tx);
    }

    // 3. update header stats
    statCountEl.textContent = totalCount.toLocaleString("en-US");
    statSatsEl.textContent = totalSats.toLocaleString("en-US");
    statRegionsEl.textContent = Object.keys(regionTotals).length;

    // 4. prepend to feed
    prependFeedItem(tx);

    // 5. re-render ranking
    renderRanking();
  }

  function prependFeedItem(tx) {
    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerHTML = `
      <div class="feed-flag">${tx.flag || "⚡"}</div>
      <div class="feed-body">
        <div class="feed-region">${tx.region_name}</div>
        <div class="feed-time">${tx.time || "Just now"}</div>
      </div>
      <div class="feed-amount">+${tx.amount_sats.toLocaleString("en-US")}</div>
    `;
    feedListEl.prepend(item);

    // cap feed length for tidiness
    while (feedListEl.children.length > 25) {
      feedListEl.removeChild(feedListEl.lastChild);
    }
  }

  function renderRanking() {
    const rows = Object.values(regionTotals).sort((a, b) => b.amount - a.amount);
    const max = rows.length ? rows[0].amount : 1;

    rankingListEl.innerHTML = rows.slice(0, 8).map((r, idx) => `
      <div class="rank-row">
        <div class="rank-index">${idx + 1}</div>
        <div class="rank-info">
          <div class="rank-name">
            <span>${r.flag || "⚡"} ${r.name}</span>
            <span class="amt">${r.amount.toLocaleString("en-US")}</span>
          </div>
          <div class="rank-bar-track">
            <div class="rank-bar-fill" style="width:${Math.max(6, (r.amount / max) * 100)}%"></div>
          </div>
        </div>
      </div>
    `).join("");
  }

  function showToast(tx) {
    const layer = tx.region_type === "country" ? pulseLayerWorldEl : pulseLayerJapanEl;
    if (!layer) return;
    const toast = document.createElement("div");
    toast.className = "tx-toast";
    toast.innerHTML = `${tx.flag || "⚡"} <strong>${tx.region_name}</strong> が <span class="amt">${tx.amount_sats.toLocaleString("en-US")} sats</span> を受信！`;
    layer.appendChild(toast);
    setTimeout(() => toast.remove(), 3300);
  }

  /**
   * World map and Japan map are shown side by side by default. Each map
   * card has a "focus" (expand) button that makes that card take the
   * full width of the grid while hiding the other one. A "restore both"
   * button appears once a map is focused, letting the user go back to
   * the side-by-side view.
   */
  function wireFocusControls() {
    const grid = document.getElementById("map-grid");
    const restoreBtn = document.getElementById("restore-both-btn");

    function setFocus(target) {
      grid.classList.remove("focus-world", "focus-japan");
      if (target === "world") grid.classList.add("focus-world");
      if (target === "japan") grid.classList.add("focus-japan");
      restoreBtn.style.display = target ? "flex" : "none";
      // give the layout a tick to settle, then nudge amCharts to redraw
      // at the new container size
      setTimeout(() => SatsMap.resize(), 60);
    }

    document.querySelectorAll(".focus-btn").forEach((btn) => {
      btn.addEventListener("click", () => setFocus(btn.dataset.focusTarget));
    });

    restoreBtn.addEventListener("click", () => setFocus(null));
  }

  function wireDemoButtons() {
    document.querySelectorAll(".demo-btn[data-demo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.demo;
        const source = DUMMY_TRANSACTIONS.find(t => t.region_code === code) ||
                        RANDOM_POOL.find(t => t.region_code === code);
        if (!source) return;
        handleNewTransaction({
          ...source,
          amount_sats: source.amount_sats || (Math.floor(Math.random() * 5) + 1) * 100,
          time: "Just now"
        });
      });
    });

    document.getElementById("demo-random").addEventListener("click", () => {
      const pick = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
      const amount = (Math.floor(Math.random() * 10) + 1) * 50;
      handleNewTransaction({ ...pick, amount_sats: amount, time: "Just now" });
    });
  }

  function seedInitialData() {
    // load the 3 dummy transactions quietly (no toast spam), then fire a
    // brief pulse sequence so the viewer can see them "arrive" on load.
    DUMMY_TRANSACTIONS.forEach(tx => handleNewTransaction(tx, { silent: true }));

    // replay pulses with a short stagger, purely for visual demo effect
    DUMMY_TRANSACTIONS.forEach((tx, i) => {
      setTimeout(() => SatsMap.pulse(tx.region_type, tx.region_code), 600 + i * 500);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    SatsMap.init();
    wireFocusControls();
    wireDemoButtons();
    // slight delay so amCharts finishes first paint before we push data in
    setTimeout(seedInitialData, 400);


  });

})();
