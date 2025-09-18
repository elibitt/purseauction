// scripts/login.js
import { chromium, devices } from 'playwright';
import readline from 'node:readline';

const AUCTION_URL = process.env.AUCTION_URL;
const STORAGE = 'auth.json';

function waitForEnter(prompt = 'Logged in and on the auction page? Press Enter to save session...') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(`${prompt}\n`, () => { rl.close(); resolve(); }));
}

(async () => {
  if (!AUCTION_URL) {
    console.error('Missing AUCTION_URL env var.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ ...devices['Desktop Safari'] }); // match scrape.js UA
  const page = await ctx.newPage();

  // Load the auction but don’t over-wait
  await page.goto(AUCTION_URL, { waitUntil: 'domcontentloaded' });

  console.log('A Chromium window opened. If needed, log in to Christie’s and navigate to your auction.');
  console.log('Tip: keep this tab open; don’t close the window.');

  // You said CAPTCHA isn’t shown in a real browser—great. Just ensure you’re logged in here.
  await waitForEnter();

  await ctx.storageState({ path: STORAGE });
  console.log(`Saved session to ${STORAGE}`);
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
