// 评论：读取全部作品的评论 / 以作者身份回复 / 发作者评论
//   node comments.js fetch                       → data/comments.json，打印未回复的
//   node comments.js reply <aweme_id> <cid> <文本>
//   node comments.js post  <aweme_id> <文本>       （作者在自己作品下发一条评论，用于置顶）
// 限速写在代码里：回复每小时 ≤ RATE.hour 条、每天 ≤ RATE.day 条，两条之间 ≥ RATE.gapSec 秒
const { run, newPage, w, typeH, loggedOut, log, shot, DATA } = require('./lib');
const fs = require('fs'), path = require('path');
const RATE = { hour: 6, day: 30, gapSec: 90 };
const PAGE = 'https://creator.douyin.com/creator-micro/interactive/comment';
const F_CMT = path.join(DATA, 'comments.json'), F_DONE = path.join(DATA, 'replied.json');
// 核对发出去没有：[捂脸] 这类表情码在页面上变成图片，按文字找会找不到（10-31 误报失败），只拿第一段纯文字去找
const plain = t => (t.split(/\[[^\]]*\]/).find(x => x.trim()) || '').trim().slice(0, 12);   // 只有表情时返回空：页面上找不了，下次 fetch 再核对
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

async function openPage(ctx) {
  const p = await newPage(ctx);
  await p.goto(PAGE, { waitUntil: 'domcontentloaded' }); await w(p, 5000, 6500);
  if (await loggedOut(p)) { log('logged_out', { where: 'comments' }); throw new Error('LOGGED_OUT'); }
  return p;
}

// 只走页面：像人一样点「选择作品」→ 点作品 → 往下翻 → 点「展开回复」，从页面自己发出的请求里读数据（不自己调接口）
async function fetchAll(ctx) {
  const items = new Map(), lists = {}, replies = {};
  const p = await newPage(ctx);
  p.on('response', async r => {
    const u = r.url(); if (!/creator\.douyin\.com/.test(u)) return;
    try {
      if (/\/creator\/item\/list\//.test(u)) for (const it of (await r.json()).item_info_list || []) items.set(it.item_id_plain, it);
      else if (/comment\/list\/select\//.test(u)) { const id = new URL(u).searchParams.get('aweme_id'); (lists[id] ||= []).push(...((await r.json()).comments || [])); }
      else if (/comment\/list\/reply\//.test(u)) { const id = new URL(u).searchParams.get('comment_id'); (replies[id] ||= []).push(...((await r.json()).comments || [])); }
    } catch {}
  });
  await p.goto(PAGE, { waitUntil: 'domcontentloaded' }); await w(p, 5000, 6500);
  if (await loggedOut(p)) { log('logged_out', { where: 'comments' }); throw new Error('LOGGED_OUT'); }
  const browse = async () => {   // 当前作品：翻到底，展开所有回复
    for (let i = 0; i < 8; i++) {
      await p.mouse.wheel(0, 500 + Math.random() * 400); await w(p, 900, 1800);
      const more = p.getByText(/^(查看|展开)\s*\d*\s*条回复$|^展开更多/);
      for (let k = 0; k < 10 && await more.count(); k++) { await more.first().click().catch(() => {}); await w(p, 1000, 2000); }   // 点开一个就少一个，始终点第一个
      if (await p.getByText('没有更多评论').count()) break;
    }
  };
  await browse();
  // 侧边栏列出全部作品（触发 item/list），逐个点开有评论的
  if (!(await p.locator('.douyin-creator-interactive-sidesheet-inner').isVisible().catch(() => false))) { await p.getByText('选择作品', { exact: true }).first().click(); await w(p, 2000, 3000); }
  const sheet = p.locator('.douyin-creator-interactive-sidesheet-inner');
  for (let i = 0; i < 5; i++) { await sheet.hover().catch(() => {}); await p.mouse.wheel(0, 1500); await w(p, 1200, 2000); }
  for (const it of [...items.values()].filter(i => i.comment_count && !lists[i.item_id_plain])) {
    await selectWork(p, it.title.split(/\s/)[0]); await browse();
  }
  const out = [];
  for (const it of items.values()) {
    const seen = new Set();
    for (const x of lists[it.item_id_plain] || []) {
      if (seen.has(x.cid)) continue; seen.add(x.cid);
      const th = (replies[x.cid] || []).map(y => ({ nick: y.user?.nickname, text: y.text, author: y.user?.uid === it.anchor_user_id }));
      out.push({ aweme_id: it.item_id_plain, title: it.title.split(/\s/)[0], cid: x.cid, text: x.text, nick: x.user?.nickname, uid: x.user?.uid, time: x.create_time, digg: x.digg_count, replies: x.reply_comment_total || 0, author: x.user?.uid === it.anchor_user_id, authorReplied: th.some(y => y.author), thread: th.length ? th : undefined });
    }
  }
  const data = { items: [...items.values()].map(i => ({ id: i.item_id_plain, title: i.title.split(/\s/)[0], time: i.create_time, comments: i.comment_count, dur: i.duration })), comments: out };
  const done = load(F_DONE, {});
  data.fetched = new Date().toISOString();
  fs.writeFileSync(F_CMT, JSON.stringify(data, null, 1));
  const todo = data.comments.filter(c => !c.author && !c.authorReplied && !done[c.cid]);
  log('comments_fetch', { items: data.items.length, comments: data.comments.length, unreplied: todo.length });
  return { items: data.items.length, comments: data.comments.length, unreplied: todo };
}

function rateCheck() {
  const rows = fs.existsSync(path.join(DATA, 'log.jsonl')) ? fs.readFileSync(path.join(DATA, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const now = Date.now(), sent = rows.filter(r => r.event === 'reply_sent' || r.event === 'author_comment').map(r => Date.parse(r.t));
  const inH = sent.filter(t => now - t < 3600e3).length, inD = sent.filter(t => now - t < 86400e3).length, last = Math.max(0, ...sent);
  if (inH >= RATE.hour || inD >= RATE.day) return `rate: ${inH}/h ${inD}/d`;
  if (now - last < RATE.gapSec * 1000) return `gap: ${Math.round((now - last) / 1000)}s`;
  return null;
}

async function selectWork(p, title) {
  if (!(await p.locator('.douyin-creator-interactive-sidesheet-inner').isVisible().catch(() => false))) { await p.getByText('选择作品', { exact: true }).first().click(); await w(p, 2000, 3000); }
  const card = p.locator('.douyin-creator-interactive-sidesheet-inner').getByText(title, { exact: false }).first();
  await card.scrollIntoViewIfNeeded(); await w(p, 600, 1200);
  await card.click(); await w(p, 3000, 4000);
}

async function send(p, editor) {
  // 编辑框所在区域里最近的「发送」
  const box = editor.locator('xpath=ancestor::*[.//*[normalize-space(text())="发送"]][1]');
  await box.getByText('发送', { exact: true }).last().click(); await w(p, 2500, 3500);
}

async function reply(ctx, aweme, cid, text) {
  const why = rateCheck(); if (why) { log('reply_skipped', { cid, why }); return { skipped: why }; }
  const done = load(F_DONE, {}); if (done[cid]) return { skipped: 'already' };
  const c = (load(F_CMT, { comments: [] }).comments).find(x => x.cid === cid);
  if (!c) throw new Error('cid not in comments.json, run fetch first');
  const p = await openPage(ctx);
  await selectWork(p, c.title);
  const row = p.getByText(c.text.slice(0, 15), { exact: false }).first().locator('xpath=ancestor::*[.//*[normalize-space(text())="回复"]][1]');
  await row.getByText('回复', { exact: true }).first().click(); await w(p, 1500, 2500);
  const ed = p.locator(`[contenteditable="true"][placeholder^="回复"], [contenteditable="true"][data-placeholder^="回复"]`).last();
  await ed.click(); await w(p); await typeH(p, text); await w(p, 1200, 2200);
  await send(p, ed);
  const ok = !plain(text) || (await p.getByText(plain(text), { exact: false }).count()) > 0;
  await shot(p, 'last_reply')
  if (ok) { done[cid] = { text, t: new Date().toISOString() }; fs.writeFileSync(F_DONE, JSON.stringify(done, null, 1)); }
  log(ok ? 'reply_sent' : 'reply_failed', { aweme, cid, to: c.text.slice(0, 40), text });
  return { ok };
}

async function post(ctx, aweme, text) {
  const why = rateCheck(); if (why) return { skipped: why };
  const it = (load(F_CMT, { items: [] }).items).find(x => x.id === aweme);
  if (!it) throw new Error('aweme not in comments.json, run fetch first');
  const p = await openPage(ctx);
  await selectWork(p, it.title);
  const ed = p.locator('[contenteditable="true"][placeholder^="有爱评论"], [contenteditable="true"][data-placeholder^="有爱评论"]').first();
  await ed.click(); await w(p); await typeH(p, text); await w(p, 1200, 2200);
  await send(p, ed);
  const ok = !plain(text) || (await p.getByText(plain(text), { exact: false }).count()) > 0;
  await shot(p, 'last_post')
  log(ok ? 'author_comment' : 'author_comment_failed', { aweme, text });
  return { ok };
}

run(async ({ ctx, args }) => {
  const [cmd, ...a] = args;
  if (cmd === 'fetch') return fetchAll(ctx);
  if (cmd === 'reply') return reply(ctx, a[0], a[1], a.slice(2).join(' '));
  if (cmd === 'post') return post(ctx, a[0], a.slice(1).join(' '));
  return 'usage: fetch | reply <aweme> <cid> <text> | post <aweme> <text>';
});
