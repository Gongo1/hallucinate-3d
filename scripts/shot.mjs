// Headless screenshots of the 3D bar for visual checks (dev server must be up).
// usage: node scripts/shot.mjs <outDir> [room[@x,y] ...] [--w=1440 --h=900 --dpr=2 --crop=x,y,w,h --walk --mobile]
// Rooms are entered with the dev-only window.__barEngine.jumpToRoom hook.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? true];
}));
const [outDir, ...rooms] = args.filter((a) => !a.startsWith("--"));
const W = +(flags.w ?? 1440);
const H = +(flags.h ?? 900);
const url = flags.url ?? "http://localhost:3100";
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: +(flags.dpr ?? 1), isMobile: !!flags.mobile, hasTouch: !!flags.mobile });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector("#intro", { timeout: 30000 }).catch(() => null);
await page.click("#intro").catch(() => null);
await new Promise((r) => setTimeout(r, 2500));

const list = rooms.length ? rooms : ["kissa"];
for (const room of list) {
  const [id, pos] = room.split("@");
  await page.evaluate((id) => window.__barEngine?.jumpToRoom(id), id);
  if (pos) {
    const [x, y] = pos.split(",").map(Number);
    await page.evaluate(([x, y]) => {
      const e = window.__barEngine;
      e.player.x = x;
      e.player.y = y;
    }, [x, y]);
  }
  if (flags.walk) {
    await page.keyboard.down("d");
    await new Promise((r) => setTimeout(r, 450));
  }
  await new Promise((r) => setTimeout(r, 1400));
  const file = path.join(outDir, `${room.replace(/[@,]/g, "_")}.png`);
  const clip = flags.crop ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(String(flags.crop).split(",").map(Number)) : undefined;
  await page.screenshot({ path: file, clip });
  if (flags.walk) await page.keyboard.up("d");
  console.log("shot", file);
}
if (errors.length) console.log("ERRORS:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
