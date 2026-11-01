// 发布（备用引擎，自研）：node publish_own.js <发布包.json> [--go]。主引擎见 sau_publish.py，入口 publish.js
//   不带 --go：填好全部表单后停在发布按钮前（演练），截图 data/pub_form.png
//   带 --go：点发布。job.scheduleHours > 0 时用「定时发布」，留出否决窗口（手机 App 里可取消）
// 发布包.json：{ video, title, desc:[行], tags:[], coverH, coverV, music:{query,name}, aiDecl, scheduleHours, pinComment }
// 步骤来自早期手工跑通的脚本，抖音改版后可能需要调整
const { run, newPage, w, typeH, loggedOut, log, shot } = require('./lib');
const fs = require('fs');

async function upload(p, file) {
  await p.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded' }); await w(p, 2500, 4000);
  if (await loggedOut(p)) throw new Error('LOGGED_OUT');
  await p.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 });
  const cdp = await p.context().newCDPSession(p);   // 大文件直接给本地路径，不经 Playwright 传输
  const { result } = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('input[type=file]')" });
  await cdp.send('DOM.setFileInputFiles', { objectId: result.objectId, files: [file] });
  await p.waitForURL(/publish|post/, { timeout: 90000 }).catch(() => {});
  for (let i = 0; i < 120; i++) {                    // 等上传完成（最多 8 分钟）
    const body = await p.locator('body').first().innerText();
    if (/上传失败/.test(body)) throw new Error('UPLOAD_FAILED');
    if (!/已上传：|剩余时间|检测中|上传中/.test(body) && await p.getByText('重新上传', { exact: true }).count()) return;
    await p.waitForTimeout(4000);
  }
  throw new Error('UPLOAD_TIMEOUT');
}

async function text(p, job) {
  const t = p.locator('input[placeholder*="填写作品标题"]').first();
  await t.waitFor({ state: 'visible', timeout: 120000 }); await t.click(); await w(p);
  await typeH(p, job.title); await w(p, 1500, 2500);
  const d = p.locator('div.zone-container[contenteditable="true"]').first();
  await d.click(); await w(p);
  for (const l of job.desc) { await typeH(p, l); await p.keyboard.press('Shift+Enter'); await w(p, 400, 800); }
  for (const tag of job.tags) { await typeH(p, '#' + tag); await w(p, 1200, 2000); await p.keyboard.press('Space'); await w(p, 600, 1200); }
  await p.keyboard.press('Escape'); await w(p);
}

async function aiDecl(p) {
  const ok = p.getByText('我知道了').first(); if (await ok.count()) { await ok.click().catch(() => {}); await w(p); }
  await p.getByText('请选择自主声明').first().click(); await w(p, 1500, 2500);
  const dlg = p.locator('.semi-modal-content').filter({ hasText: '声明' }).first();
  await dlg.locator('label.semi-radio').filter({ hasText: '内容由AI生成' }).first().click(); await w(p);
  await dlg.locator('button').filter({ hasText: '确定' }).first().click(); await w(p, 1200, 2000);
}

// 封面弹窗里当前可见的「上传封面」input
async function uploadVisible(p, file) {
  const ins = await p.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((e, i) => { let q = e; for (let k = 0; k < 4 && q; k++) q = q.parentElement; const r = q.getBoundingClientRect(); return { i, t: q.innerText.slice(0, 6), vis: r.width > 0 && r.height > 0 }; }));
  const tgt = ins.filter(x => x.t.startsWith('上传封面') && x.vis).pop();
  if (!tgt) throw new Error('COVER_INPUT_NOT_FOUND');
  await p.locator('input[type=file]').nth(tgt.i).setInputFiles(file, { timeout: 180000 }); await w(p, 5000, 7000);
}
// 「设置竖封面获更多流量」提示（10-21 新出现，会挡住「完成」）：选「设置竖封面」
async function vPrompt(p) {
  const tip = p.locator('[class*="modal"]:visible').filter({ hasText: '设置竖封面获更多流量' }).last();
  if (await tip.count()) { await tip.getByText('设置竖封面', { exact: true }).last().click(); await w(p, 2000, 3000); return true; }
  return false;
}
// 一个封面弹窗里依次传横封面、竖封面，再点完成
async function covers(p, fileH, fileV) {
  const lab = p.getByText('横封面4:3', { exact: true }).first(); await lab.scrollIntoViewIfNeeded(); await w(p);
  const box = await lab.boundingBox(); await p.mouse.click(box.x + 30, box.y - 80); await w(p, 3000, 4000);
  await vPrompt(p);
  if (fileH) { await p.getByText('设置横封面', { exact: true }).first().click().catch(() => {}); await w(p, 1500, 2500); await uploadVisible(p, fileH); }
  if (fileV) { if (!(await vPrompt(p))) { await p.getByText('设置竖封面', { exact: true }).first().click(); await w(p, 2000, 3000); } await uploadVisible(p, fileV); }
  for (let i = 0; i < 3; i++) {
    await vPrompt(p);
    const done = p.getByRole('button', { name: '完成', exact: true }).last();
    if (!(await done.isVisible().catch(() => false))) break;
    await done.click({ timeout: 8000 }).catch(() => {}); await w(p, 2500, 3500);
  }
  if (await p.getByRole('button', { name: '完成', exact: true }).last().isVisible().catch(() => false)) throw new Error('COVER_DIALOG_STUCK');
}

async function music(p, m) {
  await p.evaluate(() => window.scrollTo(0, 0)); await w(p, 600, 1000);
  if (!(await p.locator('input[placeholder="搜索音乐"]:visible').count())) {
    const c = p.getByText(/^(选择音乐|添加音乐)$/); let idx = 0;
    for (let i = 0; i < await c.count(); i++) if (await c.nth(i).isVisible()) idx = i;
    await c.nth(idx).locator('xpath=..').click(); await w(p, 2500, 3500);   // 点文字本身打不开，要点外层
  }
  const inp = p.locator('input[placeholder="搜索音乐"]'); await inp.fill(''); await w(p, 400, 800);
  await inp.fill(m.query); await p.keyboard.press('Enter'); await w(p, 4000, 5000);
  const sheet = p.locator('.semi-sidesheet:visible').last();
  const item = sheet.getByText(m.name, { exact: true }).first();
  if (!(await item.count())) throw new Error('MUSIC_NOT_FOUND ' + m.name);
  await item.hover(); await w(p, 1000, 1500);
  await sheet.locator('button[class*="apply-bt"]:visible').first().click(); await w(p, 2500, 3500);   // 悬停后只有这一行的「使用」可见
  // 选中的音乐只出现在「预览视频」里，所以查整页文本节点（含隐藏的）
  await p.getByText('预览视频', { exact: true }).first().click().catch(() => {}); await w(p, 2000, 3000);
  const ok = await p.evaluate(name => document.body.textContent.includes(name), m.name);
  if (!ok) { await shot(p, 'music_fail'); throw new Error('MUSIC_NOT_APPLIED'); }
}

async function schedule(p, hours) {
  // 平台要求定时时间在 2 小时～14 天之间；时间取整到 5 分钟
  const t = new Date(Date.now() + Math.max(hours, 2.1) * 3600e3); t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  const s = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  await p.locator('label').filter({ hasText: '定时发布' }).first().click(); await w(p, 1200, 2000);
  const inp = p.locator('input[placeholder*="日期"], input[placeholder*="时间"], .semi-datepicker input').first();
  await inp.click(); await w(p); await p.keyboard.press('Control+A'); await typeH(p, s); await p.keyboard.press('Enter'); await w(p, 1000, 1500);
  await p.keyboard.press('Escape'); await w(p, 600, 1000);   // 收起日期面板
  const v = await inp.inputValue();
  if (!v.startsWith(s.slice(0, 13))) throw new Error(`SCHEDULE_NOT_SET want ${s} got ${v}`);
  return s;
}

async function state(p) {
  const body = await p.locator('body').first().innerText();
  return {
    title: await p.locator('input[placeholder*="填写作品标题"]').first().inputValue().catch(() => null),
    aiDecl: (await p.locator('text=内容由AI生成').count()) > 0,
    coverOK: (await p.locator('text=封面效果检测通过').count()) > 0,
    coverWarn: (body.match(/封面存在[^\n]*/) || [''])[0],   // 例：「封面存在请勿使用截屏当封面等问题」，出片环节要改封面
    uploading: /已上传：|剩余时间|检测中/.test(body),
    music: (body.match(/[^\n]*(We Never|创作的原声)[^\n]*/) || [''])[0],
  };
}

run(async ({ ctx, args }) => {
  const job = JSON.parse(fs.readFileSync(args[0], 'utf8')); const go = args.includes('--go');
  if (go && process.env.DY_ALLOW_SEND !== '1') return { ok: false, err: 'BLOCKED: 只有 runner.js（或手动设 DY_ALLOW_SEND=1 的人）能真正发送' };
  const p = await newPage(ctx);
  log('publish_start', { job: args[0], go });
  await upload(p, job.video);
  await text(p, job);
  if (job.aiDecl !== false) await aiDecl(p);
  if (job.coverH || job.coverV) await covers(p, job.coverH, job.coverV);
  if (job.music) await music(p, job.music);
  const when = job.scheduleHours > 0 ? await schedule(p, job.scheduleHours) : 'now';
  const st = await state(p); await shot(p, 'pub_form');
  if (!go) { log('publish_dryrun', { job: args[0], when, ...st }); return { dryRun: true, when, ...st }; }
  const btn = p.getByRole('button', { name: '发布', exact: true }).first();
  await btn.scrollIntoViewIfNeeded(); await w(p, 1500, 3000); await btn.click();
  await p.waitForURL(/content\/manage/, { timeout: 90000 }).catch(() => {}); await w(p, 4000, 6000);
  const body = await p.locator('body').first().innerText();
  const ok = /content\/manage/.test(p.url()) && !/验证码/.test(body);
  await shot(p, 'pub_after');
  log(ok ? 'published' : 'publish_failed', { job: args[0], title: job.title, when, sms: /验证码/.test(body), url: p.url() });
  return { ok, when, url: p.url() };
});
