# 接管同一个发布页：挂配乐 → 发布前检查 → 点发布。python takeover.py <job.json>
import sys, json, asyncio, re
from pathlib import Path
from datetime import datetime
OPS = Path(__file__).resolve().parent; sys.path.insert(0, str(OPS)); import os; os.chdir(OPS)
import sau_publish as S
from playwright.async_api import async_playwright
async def main(jp):
    job = json.load(open(jp, encoding='utf8')); result = {'when': 'now', 'engine': 'takeover'}
    job['music']['_ref'] = S.DATA / 'music_ref' / (Path(job['video']).stem + '.wav')
    async with async_playwright() as pw:
        b = await pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        page = next(q for q in b.contexts[0].pages if 'creator.douyin.com/creator-micro/content/post' in q.url)
        await page.bring_to_front()
        result.update(await S.music(page, job['music']))
        try: await page.get_by_text('预览封面/标题', exact=True).first.click(timeout=5000)
        except Exception: pass
        hook = S.make_hook(job, True, result)
        try: await hook(None, page, datetime.now())
        except S.Published: S.log('published_takeover', job=jp, title=job['title'], **{k: v for k, v in result.items() if k != 'when'}); return {'ok': True, **result}
try: r = asyncio.run(main(sys.argv[1]))
except Exception as e: r = {'ok': False, 'err': f'{type(e).__name__}: {e}'[:600]}
print(json.dumps(r, ensure_ascii=False, default=str))
