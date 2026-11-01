// 逐帧截图（同 _艺术测试/capture.js，改用 ops 里的 playwright-core + 本机 Edge）
// node cap.js scene.html <输出目录> <fps> <总秒数> [只截这些秒数] [起始帧] [结束帧]
const { chromium } = require(require('path').join(__dirname, '../../../_流水线/ops/node_modules/playwright-core'));
const fs = require('fs');
const path = require('path');
(async () => {
  const [html, outDir, fps, dur, only, f0, f1] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto('file:///' + path.resolve(html).replace(/\\/g, '/'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const n = Math.round(+fps * +dur);
  const list = only ? only.split(',').map(Number) : [...Array(n).keys()].slice(+(f0 || 0), f1 ? +f1 : n);
  for (const i of list) {
    const t = only ? i : i / +fps;
    const data = await page.evaluate(([t, i]) => window.grab(t, i), [t, i]);
    const name = only ? 'still_' + t : String(i).padStart(4, '0');
    fs.writeFileSync(path.join(outDir, name + '.jpg'), Buffer.from(data.split(',')[1], 'base64'));
    if (!only && i % 150 === 0) console.log(`frame ${i}/${n}`);
  }
  await browser.close();
})();
