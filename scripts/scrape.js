// scripts/scrape.js
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

const AUCTION_URL =
  process.env.AUCTION_URL ||
  "https://onlineonly.christies.com/s/handbags-online-new-york-edit/lots/3756?page=2&sortby=LotNumber";

const TARGET_LOTS = new Set([
  "5","18","20","28","45","69","75","79","86","87","105","106","117","118","140","141","144","145","146","158"
]);

// --- helpers ---
function toNumber(x) {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const n = parseFloat(x.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Given the full HTML string, extract every top-level object that contains `"lot_number":`
function extractLotObjects(html) {
  const results = [];
  let idx = 0;

  while (true) {
    const keyIdx = html.indexOf('"lot_number"', idx);
    if (keyIdx === -1) break;

    // Scan left to the nearest '{'
    let start = keyIdx;
    while (start > 0 && html[start] !== "{") start--;
    if (html[start] !== "{") { idx = keyIdx + 12; continue; }

    // Now bracket-match forward to find the matching '}'
    let depth = 0;
    let end = start;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          // We found a JSON object boundary
          const objText = html.slice(start, end + 1);

          try {
            // Some pages inject floats without quotes (valid JSON), good.
            // If trailing commas or weird line-seps exist, mild cleanup:
            const cleaned = objText
              .replace(/\u2028|\u2029/g, "")
              .replace(/,\s*([\]}])/g, "$1");
            const obj = JSON.parse(cleaned);
            results.push(obj);
          } catch (_) {
            // If parse fails, skip this one
          }
          break;
        }
      }
    }
    idx = end + 1;
  }
  return results;
}

function pickBidForLot(lotObj) {
  // Prefer explicit current_bid (string like "14000.00"), else dynamic next_bid
  // Examples visible in your HTML snippets: current_bid/current_bid_txt and next_bid. :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
  const currentBid = toNumber(lotObj?.current_bid);
  const nextBid = toNumber(lotObj?.online_only_dynamic_lot_data?.next_bid);
  const currencyText =
    lotObj?.current_bid_txt ||
    lotObj?.online_only_dynamic_lot_data?.next_bid_text ||
    lotObj?.online_only_static_lot_data?.header_price ||
    null;

  return {
    current_bid: currentBid,
    next_bid: nextBid,
    currency_text: currencyText
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices["Desktop Safari"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    viewport: { width: 1400, height: 900 }
  });

  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(180_000);
  await page.goto(AUCTION_URL, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(2000);

  // Grab the full HTML and parse embedded lot JSON
  const html = await page.content();
  await browser.close();

  const allLots = extractLotObjects(html);

  // Deduplicate by lot_number - keep the first occurrence of each lot
  const lotMap = new Map();
  for (const lot of allLots) {
    const lotNum = String(lot?.lot_number || "").trim();
    if (!lotMap.has(lotNum)) {
      lotMap.set(lotNum, lot);
    }
  }

  // Filter to target lots and build entries
  const entries = [];
  for (const lotNum of TARGET_LOTS) {
    const lot = lotMap.get(lotNum);
    if (!lot) {
      // Lot not found, add placeholder
      entries.push({
        lot: Number(lotNum),
        current_bid: null,
        next_bid: null,
        shown_amount: null,
        status: null,
        estimate: null,
        bid_text: null
      });
      continue;
    }

    const bids = pickBidForLot(lot);
    const chosen =
      bids.current_bid != null ? bids.current_bid :
      bids.next_bid != null ? bids.next_bid :
      null;

    entries.push({
      lot: Number(lotNum),
      current_bid: bids.current_bid,           // number or null
      next_bid: bids.next_bid,                 // number or null
      shown_amount: chosen,                    // what we'll sum
      status: lot?.online_only_dynamic_lot_data?.item_status || null,
      estimate: lot?.online_only_static_lot_data?.header_price || null,
      bid_text: bids.currency_text || null
    });
  }

  // Ensure every requested lot is present (even if not found)
  for (const t of TARGET_LOTS) {
    const n = Number(t);
    if (!entries.find(e => e.lot === n)) {
      entries.push({
        lot: n,
        current_bid: null,
        next_bid: null,
        shown_amount: null,
        status: null,
        estimate: null,
        bid_text: null
      });
    }
  }

  entries.sort((a, b) => a.lot - b.lot);

  const total = entries.reduce((s, e) => s + (typeof e.shown_amount === "number" ? e.shown_amount : 0), 0);

  await fs.mkdir("out", { recursive: true });
  await fs.writeFile(
    path.resolve("out/data.json"),
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        auction_url: AUCTION_URL,
        lots_requested: Array.from(TARGET_LOTS).map(Number).sort((a, b) => a - b),
        total,
        entries
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Wrote out/data.json — total: ${total}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
