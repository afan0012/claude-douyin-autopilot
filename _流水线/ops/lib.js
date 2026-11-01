// 公共工具：连 Edge（CDP 9333，没开就带抖音登录 profile 启动）、拟人等待、逐字输入、实验日志
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 9333;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(ROOT, '.douyin_browser_profile');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const w = (p, a = 900, b = 2000) => p.waitForTimeout(a + Math.random() * (b - a));
const typeH = async (page, s) => { for (const ch of s) { await page.keyboard.insertText(ch); await page.waitForTimeout(40 + Math.random() * 110); } };

async function up() { try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; } }
async function connect() {
  if (!(await up())) {
    spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--restore-last-session=false', 'https://creator.douyin.com/'],
      { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 30 && !(await up()); i++) await sleep(1000);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  return { browser, ctx: browser.contexts()[0] };
}
// 只用一个标签页：复用已开着的创作者中心页（没有就开一个），多出来的创作者中心页关掉；不碰其他网站的标签。脚本结束不关页面
async function newPage(ctx) {
  const mine = ctx.pages().filter(q => /creator\.douyin\.com|^about:blank$/.test(q.url()));
  const p = mine[0] || await ctx.newPage();
  for (const q of mine.slice(1)) await q.close().catch(() => {});
  await p.bringToFront().catch(() => {});
  await p.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  return p;
}
async function loggedOut(p) { return (await p.locator('text=扫码登录').count()) > 0; }

// 每个动作都记一行，实验结果就从这里统计（自动化率、人工介入次数、失败原因）
function log(event, data = {}) {
  const row = { t: new Date().toISOString(), event, ...data };
  fs.appendFileSync(path.join(DATA, 'log.jsonl'), JSON.stringify(row) + '\n');
  return row;
}
function shot(p, name) { return p.screenshot({ path: path.join(DATA, name + '.png'), timeout: 15000 }).catch(() => {}); }

// node xxx.js 直接跑：run(async ({ctx}) => result)
function run(fn) {
  (async () => {
    const { browser, ctx } = await connect();
    try { const r = await fn({ ctx, args: process.argv.slice(2) }); if (r !== undefined) console.log(JSON.stringify(r, null, 1)); }
    finally { await browser.close().catch(() => {}); }   // 只断开 CDP，不关浏览器
  })().catch(e => { log('error', { script: path.basename(process.argv[1]), msg: e.message }); console.error('ERR', e.message); process.exit(1); });
}

module.exports = { ROOT, DATA, sleep, w, typeH, connect, newPage, loggedOut, log, shot, run };
