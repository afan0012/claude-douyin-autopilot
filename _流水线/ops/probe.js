// 调试用：node probe.js <url> [截图名]，打开页面、记录 JSON 接口、截图
const { run, newPage, w, loggedOut, shot, DATA } = require('./lib');
const fs = require('fs'), path = require('path');
run(async ({ ctx, args }) => {
  const [url, name = 'probe'] = args;
  const p = await newPage(ctx); const out = [];
  p.on('response', async r => { if ((r.headers()['content-type'] || '').includes('json') && /douyin\.com/.test(r.url())) { try { out.push({ u: r.url(), b: await r.json() }); } catch {} } });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await w(p, 6000, 8000);
  await shot(p, name);
  fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(out));
  const r = { url: p.url(), loggedOut: await loggedOut(p), apis: out.map(o => o.u.split('?')[0]), text: (await p.locator('body').first().innerText()).slice(0, 1500) };
  return r;
});
