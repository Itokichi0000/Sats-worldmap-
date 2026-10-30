/**
 * dummy-data.js
 * -----------------------------------------------------------------------
 * TEMPORARY MOCK DATA for previewing the "Sats World Map" look & feel.
 *
 * In the real app this array will instead be populated by polling a
 * Table API (e.g. `tables/donations`) that gets a new row every time an
 * LNbits invoice tied to a region is paid. The shape of each object below
 * is designed to match that future table schema so the map/feed code can
 * be reused with almost no changes:
 *
 *   { id, region_type, region_code, region_name, flag, amount_sats, memo, time }
 *
 *   region_type : "country"        -> region_code is an ISO-2 code (e.g. "US")
 *               | "jp_prefecture"  -> region_code is an ISO 3166-2:JP code (e.g. "JP-13")
 * -----------------------------------------------------------------------
 */

const DUMMY_TRANSACTIONS = [
  {
    id: 1,
    region_type: "country",
    region_code: "US",
    region_name: "United States",
    flag: "🇺🇸",
    amount_sats: 100,
    memo: "Test payment",
    time: "2 min ago"
  },
  {
    id: 2,
    region_type: "jp_prefecture",
    region_code: "JP-13",
    region_name: "Tokyo",
    flag: "🗼",
    amount_sats: 200,
    memo: "Test payment",
    time: "1 min ago"
  },
  {
    id: 3,
    region_type: "jp_prefecture",
    region_code: "JP-01",
    region_name: "Hokkaido",
    flag: "🐟",
    amount_sats: 300,
    memo: "Test payment",
    time: "Just now"
  }
];
