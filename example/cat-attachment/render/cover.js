// node cover.js cover.html <横封面.jpg> <竖封面.jpg>
const { chromium } = require(require('path').join(__dirname, '../../../_流水线/ops/node_modules/playwright-core'));
const path = require('path');
(async () => {
  const [html, outH, outV] = process.argv.slice(2);
  const b = await chromium.launch({ channel: 'msedge' });
  for (const [q, out, w, h] of [['', outH, 1440, 1080], ['?v=1', outV, 1080, 1440]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file:///' + path.resolve(html).replace(/\\/g, '/') + q);
    await p.waitForFunction(() => window.ready);
    await p.locator('canvas').screenshot({ path: out, type: 'jpeg', quality: 92 });
  }
  await b.close();
})();
