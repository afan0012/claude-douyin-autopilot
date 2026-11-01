// 执行队列（不经过 Claude，限速在 comments.js 和这里）
//   node runner.js replies   发送 queue/replies/*.json（{aweme, cid, text}），每次最多 3 条，条间隔随机 2～5 分钟
//   node runner.js publish   发布 queue/publish/*.json 里 status=="ready" 的第一个，完成后改成 published；每天最多 MAX_PUBLISH_PER_DAY 条
// 真正会发东西的命令（publish.js --go、sau_publish.py --go、publish_own.js --go、comments.js reply/post、takeover.py）
// 只有带环境变量 DY_ALLOW_SEND=1 才执行；这里调用子进程时带上，autopilot 给 Claude 的环境里没有
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const Q = path.join(__dirname, 'queue');
const MAX_PUBLISH_PER_DAY = 2;
const ENV = { ...process.env, DY_ALLOW_SEND: '1' };
const node = (args) => JSON.parse(execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', timeout: 40 * 60e3, env: ENV }).replace(/^[^{]*/s, ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv');   // 本地日期 YYYY-MM-DD

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
  } else if (mode === 'publish') {
    const dir = path.join(Q, 'publish'); fs.mkdirSync(dir, { recursive: true });
    const jobs = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);
    const done = jobs.filter(([, j]) => j.status === 'published' && j.at && new Date(j.at).toLocaleDateString('sv') === today()).length;
    if (done >= MAX_PUBLISH_PER_DAY) return console.log(JSON.stringify({ skipped: 'daily_limit', publishedToday: done }));
    const hit = jobs.find(([, j]) => j.status === 'ready');
    if (!hit) return console.log('nothing ready');
    const [f, job] = hit, fp = path.join(dir, f);
    let r; try { r = node(['publish.js', fp, '--go']); } catch (e) { r = { err: e.message.slice(0, 300) }; }
    job.status = r.ok ? 'published' : 'failed'; job.result = r; job.at = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(job, null, 1)); console.log(f, JSON.stringify(r));
  } else console.log('usage: replies | publish');
})();
