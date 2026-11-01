// 发布入口：node publish.js <发布包.json> [--go] [--engine=own]
//   默认引擎：开源 social-auto-upload（sau_publish.py，补了配乐、横竖封面、演练模式，关掉了反检测）
//   --engine=own：自研的 publish_own.js（上游坏了时的备用）
//   不带 --go 是演练：填好表单、设好定时，停在发布按钮前；截图 data/pub_form.png
//   10-30 起：日常直接 --go（一次上传，点发布前自动检查封面/标题/配乐/AI声明/定时，任一不对就停、不发）；
//   失败不自动重试，尤其「服务器开小差」这类风控信号，先报给用户。只在改了发布代码后演练一次
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PY = path.join(ROOT, '_参考工程/oss/.venv/Scripts/python.exe');
const args = process.argv.slice(2);
const own = args.includes('--engine=own');
const rest = args.filter(a => !a.startsWith('--engine'));
const r = own
  ? spawnSync(process.execPath, [path.join(__dirname, 'publish_own.js'), ...rest], { encoding: 'utf8', timeout: 35 * 60e3 })
  : spawnSync(PY, ['-X', 'utf8', path.join(__dirname, 'sau_publish.py'), ...rest], { encoding: 'utf8', timeout: 35 * 60e3, env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' } });
// 上游会往 stdout/stderr 打很多日志，只把最后一行 JSON 交给 runner
const out = own ? (r.stdout || '').replace(/^[^{]*/s, '').trim() : (r.stdout || '').trim().split('\n').filter(l => l.startsWith('{')).pop();
if (out) console.log(out); else { console.log(JSON.stringify({ ok: false, err: (r.stderr || r.error?.message || 'no output').slice(-400) })); process.exitCode = 1; }
