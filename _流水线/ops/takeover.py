# 发布卡住时由人接管同一个发布页：挂配乐 → 发布前检查 → 点发布 → 把发布包标成 published
#   用法（人手动跑，需要 DY_ALLOW_SEND=1）：DY_ALLOW_SEND=1 <venv python> takeover.py <job.json>
#   典型场景：配乐面板打不开（上游清浮层把侧边栏删了）。先在页面点「暂存离开」→ 上传页点「继续编辑」
#   （草稿会保留视频、封面、AI 声明），再跑这个脚本
import sys, json, asyncio, os
from pathlib import Path
from datetime import datetime, timezone
OPS = Path(__file__).resolve().parent; sys.path.insert(0, str(OPS)); os.chdir(OPS)
import sau_publish as S
from playwright.async_api import async_playwright
async def main(jp):
    job = json.load(open(jp, encoding='utf8')); result = {'when': 'now', 'engine': 'takeover'}
    if job.get('music'): job['music']['_ref'] = S.DATA / 'music_ref' / (Path(job['video']).stem + '.wav')
    async with async_playwright() as pw:
        b = await pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        page = next(q for q in b.contexts[0].pages if 'creator.douyin.com/creator-micro/content/post' in q.url)
        await page.bring_to_front()
        if job.get('music'): result.update(await S.music(page, job['music']))
        try: await page.get_by_text('预览封面/标题', exact=True).first.click(timeout=5000)
        except Exception: pass
        hook = S.make_hook(job, True, result)
        try: await hook(None, page, datetime.now())
        except S.Published:
            S.log('published_takeover', job=jp, title=job['title'], **{k: v for k, v in result.items() if k != 'when'})
            job.update(status='published', result={'ok': True, **result}, at=datetime.now(timezone.utc).isoformat())
            job.get('music', {}).pop('_ref', None)
            json.dump(job, open(jp, 'w', encoding='utf8'), ensure_ascii=False, indent=1, default=str)
            return {'ok': True, **result}
    return {'ok': False, 'err': 'NOT_PUBLISHED'}
if os.environ.get('DY_ALLOW_SEND') != '1':
    print(json.dumps({'ok': False, 'err': 'BLOCKED: 只有 runner.js（或手动设 DY_ALLOW_SEND=1 的人）能真正发送'}, ensure_ascii=False)); sys.exit(1)
try: r = asyncio.run(main(sys.argv[1]))
except Exception as e: r = {'ok': False, 'err': f'{type(e).__name__}: {e}'[:600]}
print(json.dumps(r, ensure_ascii=False, default=str))
