// 只读复盘：node stats.js [作品id...]（不给 id 就抓最近 10 条）
// 存 data/stats/<时间>.json：作品列表 + 每条作品详情页「流量分析」里的接口原始数据（播放、2s跳出、5s完播、逐秒留存、同类基准）
const { run, newPage, w, loggedOut, log, DATA } = require('./lib');
const fs = require('fs'), path = require('path');
run(async ({ ctx, args }) => {
  const p = await newPage(ctx);
  await p.goto('https://creator.douyin.com/creator-micro/data-center/content', { waitUntil: 'domcontentloaded' }); await w(p, 4000, 6000);
  if (await loggedOut(p)) { log('logged_out', { where: 'stats' }); throw new Error('LOGGED_OUT'); }
  const items = await p.evaluate(async () => (await (await fetch('/aweme/v1/creator/item/list/?cursor=&aid=2906', { credentials: 'include' })).json()).item_info_list || []);
  const ids = args.length ? args : items.slice(0, 10).map(i => i.item_id_plain);
  const res = { t: new Date().toISOString(), items: items.map(i => ({ id: i.item_id_plain, title: i.title.split(/\s/)[0], time: i.create_time, comments: i.comment_count })), detail: {} };
  for (const id of ids) {
    const out = []; const h = async r => { if (/janus|web\/api\/creator\/data|data_center/.test(r.url())) { try { out.push({ u: r.url().split('?')[0], b: await r.json() }); } catch {} } };
    p.on('response', h);
    await p.goto(`https://creator.douyin.com/creator-micro/work-management/work-detail/${id}?enter_from=item_data`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await w(p, 2500, 3500);
    await p.getByText('流量分析', { exact: true }).click().catch(() => {});
    await w(p, 5000, 7000);
    p.off('response', h); res.detail[id] = out;
  }
  const dir = path.join(DATA, 'stats'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, res.t.slice(0, 16).replace(/[-:T]/g, '') + '.json');
  fs.writeFileSync(f, JSON.stringify(res));
  log('stats', { file: path.basename(f), n: ids.length });
  return { file: f, n: ids.length, apis: [...new Set(Object.values(res.detail).flat().map(o => o.u.replace('https://creator.douyin.com', '')))] };
});
