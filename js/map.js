/**
 * map.js — amCharts 5（無料版）の世界地図・日本地図
 *
 *   SatsMap.init()
 *   SatsMap.setTotals(regionType, { code: sats })  塗りの濃さを、合計から作り直す
 *   SatsMap.pulse(regionType, code)               点滅
 *   SatsMap.zoomTo(regionType, code)              その地域へ寄る（Promise）
 *   SatsMap.home(regionType)                      元の大きさへ
 *   SatsMap.screenPoint(regionType, code)         その地域の真ん中の、画面の上の位置 { x, y }
 *   SatsMap.resize()
 *
 * regionType: "country"（世界地図・ISO-2 "US"）| "jp_prefecture"（日本地図・"JP-13"）
 */
const SatsMap = (() => {
  const maps = {}; // regionType -> { root, chart, series, el }
  const kings = { country: {}, jp_prefecture: {} }; // 地域 -> 王様のニックネーム

  function build(divId, geo, opts) {
    const root = am5.Root.new(divId);
    root.setThemes([am5themes_Animated.new(root), am5themes_Dark.new(root)]);

    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        panX: opts.panX,
        panY: "translateY",
        projection: opts.projection,
        homeZoomLevel: 1,
        wheelY: "zoom",
        maxZoomLevel: opts.maxZoom,
      }),
    );
    chart.set("background", am5.Rectangle.new(root, { fill: am5.color(0x060a13), fillOpacity: 1 }));

    const series = chart.series.push(
      am5map.MapPolygonSeries.new(root, { geoJSON: geo, valueField: "value", calculateAggregates: true }),
    );
    series.mapPolygons.template.setAll({
      tooltipText: "{name}",
      stroke: am5.color(0x22314d),
      strokeWidth: 0.6,
      fill: am5.color(0x172239),
      interactive: true,
    });
    series.mapPolygons.template.states.create("hover", { fill: am5.color(0xffd166) });
    series.set("heatRules", [{
      target: series.mapPolygons.template,
      dataField: "value",
      min: am5.color(0x2b3f66),
      max: am5.color(0xffb84d),
      key: "fill",
    }]);
    series.mapPolygons.template.adapters.add("tooltipText", (text, target) => {
      const di = target.dataItem;
      if (!di) return text;
      const v = di.get("value") || 0;
      const king = kings[opts.type] && kings[opts.type][di.get("id")];
      // 地図の文字は amCharts の書式として読まれるので、[ ] { } を取る
      const k = king ? `\n👑 ${String(king).replace(/[\[\]{}]/g, "")}` : "";
      return v > 0 ? `{name}\n${v.toLocaleString("en-US")} sats${k}` : "{name}\nまだ 0 sats";
    });
    chart.set("zoomControl", am5map.ZoomControl.new(root, {}));
    // 形が決まってから日本に合わせる（1 回だけ。毎回だと、色を変えるたびに寄った地図が戻る）
    if (opts.fitOnLoad) series.events.once("datavalidated", () => chart.goHome(0));

    // 0 の行をいつも入れておく（いちばん少ない地域も、塗っていない地域より明るく出るように）
    series.data.setAll([{ id: "__seed", value: 0 }]);
    return { root, chart, series, el: document.getElementById(divId) };
  }

  function init() {
    maps.country = build("worldMapDiv", am5geodata_worldLow, {
      panX: "rotateX", projection: am5map.geoNaturalEarth1(), maxZoom: 16, type: "country",
    });
    maps.jp_prefecture = build("japanMapDiv", am5geodata_japanLow, {
      panX: "translateX", projection: am5map.geoMercator(), maxZoom: 10, fitOnLoad: true, type: "jp_prefecture",
    });
  }

  // data.setAll() だと地図が組み直されて、寄った位置が元に戻る。値だけを書き換える
  function setTotals(regionType, totals) {
    const m = maps[regionType];
    if (!m) return;
    const fresh = [];
    Object.keys(totals).forEach((code) => {
      const v = totals[code] > 0 ? totals[code] : undefined;
      const di = m.series.getDataItemById(code);
      if (di) {
        if (di.get("value") !== v) di.set("value", v);
      } else if (v) {
        fresh.push({ id: code, value: v });
      }
    });
    // 前は数えていて、いまはない地域（やり直したとき）
    m.series.dataItems.forEach((di) => {
      const id = di.get("id");
      if (id !== "__seed" && di.get("value") != null && !(totals[id] > 0)) di.set("value", undefined);
    });
    if (fresh.length) m.series.data.pushAll(fresh);
    m.series.markDirtyValues();
  }

  function polygonOf(regionType, code) {
    const m = maps[regionType];
    if (!m) return null;
    const di = m.series.getDataItemById(code);
    return di ? di.get("mapPolygon") : null;
  }

  function pulse(regionType, code) {
    const p = polygonOf(regionType, code);
    if (!p) return;
    p.animate({ key: "fillOpacity", from: 1, to: 0.35, duration: 380, loops: 4, easing: am5.ease.inOut(am5.ease.cubic) });
  }

  const ZOOM = { country: 3.2, jp_prefecture: 2.6 };
  function zoomTo(regionType, code) {
    const m = maps[regionType];
    const p = polygonOf(regionType, code);
    if (!m || !p) return Promise.resolve();
    // 小さな国・県は寄りすぎない、大きな国（ロシア・アメリカ）は寄らない
    const geo = p.visualCentroid();
    const level = regionType === "country" && ["RU", "CA", "US", "CN", "BR", "AU", "AQ", "GL"].includes(code) ? 1.6 : ZOOM[regionType];
    m.chart.zoomToGeoPoint(geo, level, true, 900);
    return new Promise((r) => setTimeout(r, 950));
  }

  function home(regionType) {
    const m = maps[regionType];
    if (m) m.chart.goHome(900);
  }

  function screenPoint(regionType, code) {
    const m = maps[regionType];
    const p = polygonOf(regionType, code);
    if (!m || !p) return null;
    const local = m.chart.convert(p.visualCentroid());
    const g = m.chart.seriesContainer.toGlobal(local);
    const rect = m.el.getBoundingClientRect();
    const x = rect.left + g.x;
    const y = rect.top + g.y;
    // 地図の外（裏側・切れたところ）なら、地図の真ん中
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, outside: true };
    }
    return { x, y };
  }

  function resize() {
    Object.values(maps).forEach((m) => {
      try { m.root.resize(); } catch (e) { /* no-op */ }
    });
  }

  function setKings(regionType, map) {
    kings[regionType] = map || {};
  }

  return { init, setTotals, setKings, pulse, zoomTo, home, screenPoint, resize };
})();
