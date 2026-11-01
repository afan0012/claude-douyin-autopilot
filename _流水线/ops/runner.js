// 执行队列（不经过 Claude，限速在 comments.js / publish.js 里）
//   node runner.js replies   发送 queue/replies/*.json（{aweme, cid, text}），每次最多 3 条，条间隔随机 2～5 分钟
//   node runner.js publish   发布 queue/publish/*.json 里 status=="ready" 的第一个（定时发布），完成后改成 published
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const Q = path.join(__dirname, 'queue');
const node = (args) => JSON.parse(execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', timeout: 40 * 60e3 }).replace(/^[^{]*/s, ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mode = process.argv[2];
  if (mode === 'replies') {
    const dir = path.join(Q, 'replies'); fs.mkdirSync(path.join(dir, 'done'), { recursive: true });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).slice(0, 3);
    for (const [i, f] of files.entries()) {
      if (i) await sleep((120 + Math.random() * 180) * 1000);
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // AI 腔拦截：命中就不发，挪到 rejected/ 留给复盘看
      const bad = [/观察得|说得(好|太)|谢谢(你的)?建议|感谢|视频想(说|表达)|其实|确实|[：:]/, /[？?](\[[^\]]+\])*$/];
      if (j.text.length > 30 || bad.some(b => b.test(j.text))) {
        fs.mkdirSync(path.join(dir, 'rejected'), { recursive: true });
        fs.renameSync(path.join(dir, f), path.join(dir, 'rejected', f));
        console.log(f, JSON.stringify({ rejected: 'ai_tone', text: j.text })); continue;
      }
      let r; try { r = node(['comments.js', 'reply', j.aweme, j.cid, j.text]); } catch (e) { r = { err: e.message.slice(0, 200) }; }
      console.log(f, JSON.stringify(r));
      if (r.ok || r.skipped === 'already') fs.renameSync(path.join(dir, f), path.join(dir, 'done', f));
      if (r.skipped && r.skipped !== 'already') break;   // 触到限速就停，下一轮再发
    }
    // 定时发布的作品上线后，发作者评论（发布包里的 pinComment）
    const pd = path.join(Q, 'publish'); fs.mkdirSync(pd, { recursive: true });
    const cm = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'comments.json'), 'utf8')); } catch { return { items: [] }; } })();
    for (const f of fs.readdirSync(pd).filter(f => f.endsWith('.json'))) {
      const fp = path.join(pd, f), job = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (job.status !== 'published' || job.commented || !job.pinComment) continue;
      const it = cm.items.find(i => i.title === job.title);
      if (!it) continue;                                  // 还没上线（或 comments.json 还没刷新）
      let r; try { r = node(['comments.js', 'post', it.id, job.pinComment]); } catch (e) { r = { err: e.message.slice(0, 200) }; }
      if (r.ok) { job.commented = new Date().toISOString(); job.aweme = it.id; fs.writeFileSync(fp, JSON.stringify(job, null, 1)); }
      console.log('pinComment', f, JSON.stringify(r));
    }
  } else if (mode === 'publish') {
    const dir = path.join(Q, 'publish'); fs.mkdirSync(dir, { recursive: true });
    const f = fs.readdirSync(dir).filter(f => f.endsWith('.json')).find(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).status === 'ready');
    if (!f) return console.log('nothing ready');
    const fp = path.join(dir, f), job = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let r; try { r = node(['publish.js', fp, '--go']); } catch (e) { r = { err: e.message.slice(0, 300) }; }
    job.status = r.ok ? 'published' : 'failed'; job.result = r; job.at = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(job, null, 1)); console.log(f, JSON.stringify(r));
  } else console.log('usage: replies | publish');
})();
