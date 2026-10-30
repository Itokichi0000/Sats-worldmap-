/**
 * map.js
 * -----------------------------------------------------------------------
 * amCharts 5 (free) map setup for the Sats World Map mockup.
 *
 * Exposes a small `SatsMap` namespace used by app.js:
 *   SatsMap.init()                                 -> builds both charts
 *   SatsMap.addAmount(regionType, regionCode, amt)  -> updates heat color
 *   SatsMap.pulse(regionType, regionCode)           -> flash animation
 *   SatsMap.showTab(tabKey)                         -> "world" | "japan"
 *
 * regionType: "country" (world map, ISO-2 codes e.g. "US")
 *           | "jp_prefecture" (japan map, ISO 3166-2:JP e.g. "JP-13")
 * -----------------------------------------------------------------------
 */

const SatsMap = (() => {

  let worldRoot, japanRoot;
  let worldSeries, japanSeries;

  // running totals per region code, used to drive heat color
  const totals = {
    country: {},
    jp_prefecture: {}
  };

  function buildWorldMap() {
    worldRoot = am5.Root.new("worldMapDiv");
    worldRoot.setThemes([am5themes_Animated.new(worldRoot), am5themes_Dark.new(worldRoot)]);

    const chart = worldRoot.container.children.push(
      am5map.MapChart.new(worldRoot, {
        panX: "rotateX",
        panY: "translateY",
        projection: am5map.geoNaturalEarth1(),
        homeZoomLevel: 1,
        homeRotationX: 0,
        wheelY: "zoom",
        maxZoomLevel: 8
      })
    );

    chart.set("background", am5.Rectangle.new(worldRoot, {
      fill: am5.color(0x060a13),
      fillOpacity: 1
    }));

    worldSeries = chart.series.push(
      am5map.MapPolygonSeries.new(worldRoot, {
        geoJSON: am5geodata_worldLow,
        valueField: "value",
        calculateAggregates: true
      })
    );

    worldSeries.mapPolygons.template.setAll({
      tooltipText: "{name}: {valueLabel}",
      stroke: am5.color(0x22314d),
      strokeWidth: 0.6,
      fill: am5.color(0x172239),
      interactive: true
    });

    worldSeries.mapPolygons.template.states.create("hover", {
      fill: am5.color(0xffb84d)
    });

    worldSeries.set("heatRules", [{
      target: worldSeries.mapPolygons.template,
      dataField: "value",
      min: am5.color(0x1c2b45),
      max: am5.color(0xffb84d),
      key: "fill"
    }]);

    // add a custom adapter to build the tooltip label with "sats"
    worldSeries.mapPolygons.template.adapters.add("tooltipText", (text, target) => {
      const di = target.dataItem;
      if (!di) return text;
      const v = di.get("value") || 0;
      return v > 0 ? `{name}\n${formatSats(v)} sats` : "{name}\n受信なし";
    });

    chart.set("zoomControl", am5map.ZoomControl.new(worldRoot, {}));

    // seed with all countries at value 0 so the whole map renders in base color
    worldSeries.data.setAll([{ id: "__seed", value: 0 }]);

    return chart;
  }

  function buildJapanMap() {
    japanRoot = am5.Root.new("japanMapDiv");
    japanRoot.setThemes([am5themes_Animated.new(japanRoot), am5themes_Dark.new(japanRoot)]);

    const chart = japanRoot.container.children.push(
      am5map.MapChart.new(japanRoot, {
        panX: "translateX",
        panY: "translateY",
        projection: am5map.geoMercator(),
        homeZoomLevel: 1,
        wheelY: "zoom",
        maxZoomLevel: 10
      })
    );

    chart.set("background", am5.Rectangle.new(japanRoot, {
      fill: am5.color(0x060a13),
      fillOpacity: 1
    }));

    japanSeries = chart.series.push(
      am5map.MapPolygonSeries.new(japanRoot, {
        geoJSON: am5geodata_japanLow,
        valueField: "value",
        calculateAggregates: true
      })
    );

    japanSeries.mapPolygons.template.setAll({
      tooltipText: "{name}: {valueLabel}",
      stroke: am5.color(0x22314d),
      strokeWidth: 0.6,
      fill: am5.color(0x172239),
      interactive: true
    });

    japanSeries.mapPolygons.template.states.create("hover", {
      fill: am5.color(0xffb84d)
    });

    japanSeries.set("heatRules", [{
      target: japanSeries.mapPolygons.template,
      dataField: "value",
      min: am5.color(0x1c2b45),
      max: am5.color(0xffb84d),
      key: "fill"
    }]);

    japanSeries.mapPolygons.template.adapters.add("tooltipText", (text, target) => {
      const di = target.dataItem;
      if (!di) return text;
      const v = di.get("value") || 0;
      return v > 0 ? `{name}\n${formatSats(v)} sats` : "{name}\n受信なし";
    });

    chart.set("zoomControl", am5map.ZoomControl.new(japanRoot, {}));

    // Fit the map to Japan's own bounds once the series geometry has been
    // validated. Calling zoomToGeoPoint() synchronously right after chart
    // creation runs before amCharts has computed the projection/geometry,
    // which left this map blank — waiting for "datavalidated" fixes it.
    japanSeries.events.on("datavalidated", () => {
      chart.goHome(0);
    });

    japanSeries.data.setAll([{ id: "__seed", value: 0 }]);

    return chart;
  }

  function formatSats(v) {
    return v.toLocaleString("en-US");
  }

  function getSeries(regionType) {
    return regionType === "country" ? worldSeries : japanSeries;
  }

  function addAmount(regionType, regionCode, amount) {
    const store = totals[regionType];
    store[regionCode] = (store[regionCode] || 0) + amount;

    const series = getSeries(regionType);
    if (!series) return;

    // Rebuild the full data set for the series from current totals.
    // IMPORTANT: always keep a fixed 0-value baseline row ("__seed") in
    // the set, even once real regions exist. amCharts5's heat rule scales
    // colors between the *current min and max values in the data*. If we
    // only ever pass the real regions, whichever region has the smallest
    // total becomes the new "min" and gets mapped to the darkest heat
    // color (almost indistinguishable from the unset base fill) even
    // though it actually received a real payment. Keeping 0 as a
    // permanent floor guarantees every region that received sats renders
    // brighter than the true "no data" regions.
    const rows = [{ id: "__seed", value: 0 }];
    Object.keys(store).forEach(code => rows.push({ id: code, value: store[code] }));
    series.data.setAll(rows);
  }

  function pulse(regionType, regionCode) {
    const series = getSeries(regionType);
    if (!series) return;

    series.mapPolygons.each((polygon) => {
      const di = polygon.dataItem;
      if (di && di.get("id") === regionCode) {
        polygon.states.create("pulseState", {
          scale: 1,
          fillOpacity: 1
        });

        // simple pulse: animate a temporary bright fill then fade back to heat color
        polygon.animate({
          key: "fillOpacity",
          from: 1,
          to: 0.55,
          duration: 500,
          loops: 3,
          easing: am5.ease.inOut(am5.ease.cubic)
        });

        // small "bump" scale animation for extra visibility
        const originalScale = polygon.get("scale") || 1;
        polygon.animate({
          key: "scale",
          from: originalScale,
          to: originalScale * 1.0,
          duration: 10
        });
      }
    });
  }

  function init() {
    buildWorldMap();
    buildJapanMap();
  }

  /**
   * Both maps are now always mounted side by side (never display:none),
   * so amCharts always initializes them with a real, non-zero size.
   * When the user "focuses" one map, the OTHER map's container is hidden
   * via CSS grid (display:none on the card), which can leave amCharts5
   * with a stale layout. Calling appear()/resize-safe invalidation on
   * un-hide fixes that — see `resize()` below, called from app.js after
   * toggling focus classes.
   */
  function resize() {
    [worldRoot, japanRoot].forEach((root) => {
      if (root && typeof root.resize === "function") {
        try { root.resize(); } catch (e) { /* no-op */ }
      }
    });
  }

  return { init, addAmount, pulse, resize };
})();
