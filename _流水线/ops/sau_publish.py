# 发布（主引擎）：用开源 social-auto-upload 的抖音上传器，外面补三样它没有的：配乐、横竖两张封面、演练模式
#   python sau_publish.py <发布包.json> [--go]     （由 publish.js 调用；发布包格式同 publish.js）
# 原则：
#   - 不改上游代码（_参考工程/oss/social-auto-upload，git pull 跟进抖音改版），只在这里打补丁
#   - 关掉它的三层反检测：patchright → 普通 playwright、不注入 stealth.min.js、不加 --disable-blink-features=AutomationControlled
#   - 登录：不另开浏览器、不搬 cookie，直接在已登录的 Edge（CDP 9333，同 lib.js）的创作者中心标签页里操作
#   - 默认立即发布（10-31 用户：追热度不等 2 小时，定时也没拦住坏封面）；发布包写 "scheduleHours": N 才定时
import asyncio, json, os, re, subprocess, sys, time, types, urllib.request
from datetime import datetime, timedelta
from pathlib import Path

OPS = Path(__file__).resolve().parent
ROOT = OPS.parents[1]
REPO = ROOT / '_参考工程/oss/social-auto-upload'
DATA = OPS / 'data'
COOKIE = DATA / 'sau_cookie.json'
EDGE = r'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
PROFILE = ROOT / '.douyin_browser_profile'

def log(event, **d):
    row = {'t': datetime.utcnow().isoformat(timespec='milliseconds') + 'Z', 'event': event, **d}
    with open(DATA / 'log.jsonl', 'a', encoding='utf8') as f: f.write(json.dumps(row, ensure_ascii=False) + '\n')

# ---- 关掉反检测，接上配置 ----
import playwright, playwright.async_api
sys.modules['patchright'] = playwright
sys.modules['patchright.async_api'] = playwright.async_api
conf = types.ModuleType('conf'); conf.BASE_DIR = DATA; conf.DEBUG_MODE = False
conf.LOCAL_CHROME_HEADLESS = False; conf.LOCAL_CHROME_PATH = ''; conf.XHS_SERVER = ''; conf.YT_PROXY = None
sys.modules['conf'] = conf
sys.path.insert(0, str(REPO))
import uploader.douyin_uploader.main as dy
from playwright.async_api import async_playwright
from playwright.async_api._generated import BrowserType

async def _same(ctx): return ctx
dy.set_init_script = _same
async def _ok(_): return True
dy.cookie_auth = _ok                     # 它的 cookie 检查会另起一个带 stealth 的无头浏览器；登录由 export_cookie 在真 Edge 里查
async def _plain_click(page, locator):   # 上游 _native_click 用 JS 伪造整套鼠标事件（注释写明为了过身份验证组件），换成普通点击
    try: await locator.click(timeout=8000); return True
    except Exception: return False
dy._native_click = _plain_click
# 上游每次 launch 一个新浏览器、再塞导出的 cookie：同一个 sessionid 出现在两个指纹不同的浏览器里，
# 10-30 连续上传后被判风控、session 作废。改成：launch 直接接管已登录的 Edge（CDP 9333），
# new_context 返回它自己的 context（忽略 storage_state），new_page 复用创作者中心标签页（同 lib.js newPage），close 不关
class _Ctx:
    def __init__(self, c): self._c = c
    def __getattr__(self, k): return getattr(self._c, k)
    async def new_page(self):
        mine = [q for q in self._c.pages if re.search(r'creator\.douyin\.com|^about:blank$', q.url)]
        p = mine[0] if mine else await self._c.new_page()
        for q in mine[1:]:
            try: await q.close()
            except Exception: pass
        await p.bring_to_front()
        return p
    async def close(self): pass             # 脚本结束不关页面：卡住时人接管同一页面
class _Br:
    def __init__(self, b): self._b = b
    def __getattr__(self, k): return getattr(self._b, k)
    async def new_context(self, **_): return _Ctx(self._b.contexts[0])
    async def close(self): pass
async def _attach(self, **_):
    return _Br(await self.connect_over_cdp('http://127.0.0.1:9333'))
BrowserType.launch = _attach

# ---- 补丁 1：横竖两张封面。上游一次只传一张，且竖封面页会选错上传框（把横封面覆盖掉，10-22 实测「竖封面缺失」）
#      换成 publish_own.js 里验证过的做法：一个弹窗里先横后竖，每次都找「当前可见」的那个上传封面 input ----
async def _upload_visible(page, file):
    ins = await page.evaluate("""() => [...document.querySelectorAll('input[type=file]')].map((e, i) => {
        let q = e; for (let k = 0; k < 4 && q; k++) q = q.parentElement; const r = q.getBoundingClientRect();
        return { i, t: q.innerText.slice(0, 6), vis: r.width > 0 && r.height > 0 }; })""")
    tgt = [x for x in ins if x['t'].startswith('上传封面') and x['vis']]
    if not tgt: raise RuntimeError('COVER_INPUT_NOT_FOUND')
    # 10-30 改版：弹窗里有两个一样的「上传封面」input，只有第一个生效（横、竖都是）
    await page.locator('input[type=file]').nth(tgt[0]['i']).set_input_files(file, timeout=180000)
    await page.wait_for_timeout(6000)

async def _v_prompt(page):   # 「设置竖封面获更多流量」提示会挡住「完成」
    tip = page.locator('[class*="modal"]:visible').filter(has_text='设置竖封面获更多流量').last
    if await tip.count():
        # 10-31 下午：get_by_text 找不到（按钮文字带空白），按角色找再按坐标点；点完进同一弹窗的竖封面标签（底图同步自横封面），
        # 先点「完成」收掉，竖封面由下一次 _cover_dialog('竖封面3:4') 重新上传
        b = tip.get_by_role('button', name='设置竖封面').last; bb = await b.bounding_box()
        await page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await page.wait_for_timeout(2500); return True
    return False

async def _cover_dialog(page, label, file):
    # 10-31 改版：横、竖各点自己的缩略图开各自的弹窗（「设置横封面」「设置竖封面」），不再是一个弹窗里切标签
    await page.evaluate("() => document.querySelectorAll('.shepherd-element,.shepherd-modal-overlay-container').forEach(e=>e.remove())")
    lab = page.get_by_text(label, exact=True).first
    await lab.scroll_into_view_if_needed(); await page.wait_for_timeout(1000)
    box = await lab.bounding_box(); await page.mouse.click(box['x'] + 30, box['y'] - 80); await page.wait_for_timeout(3500)
    await _upload_visible(page, file)
    done = page.get_by_role('button', name='完成', exact=True).last
    for _ in range(3):
        await _v_prompt(page)
        if not await done.is_visible(): break
        try: await done.click(timeout=8000)
        except Exception: pass
        await page.wait_for_timeout(3000)
    if await done.is_visible(): raise RuntimeError('COVER_DIALOG_STUCK ' + label)

async def _covers(self, page):
    h, v = self.thumbnail_landscape_path, self.thumbnail_portrait_path
    if h: await _cover_dialog(page, '横封面4:3', h)
    if v: await _cover_dialog(page, '竖封面3:4', v)   # 竖封面放在横封面之后传，免得被「同步横封面底图」覆盖
dy.DouYinVideo.set_thumbnail = _covers

# ---- 补丁 2：配乐（曲库原曲，署名正确）；补丁 3：演练模式。都挂在「设好定时之后、点发布之前」 ----
class DryRun(Exception): pass
class Published(Exception): pass

async def music(page, m):
    await page.keyboard.press('Escape'); await page.wait_for_timeout(800)          # 收起日期面板
    await page.evaluate('window.scrollTo(0, 0)'); await page.wait_for_timeout(800)
    search = page.locator('input[placeholder="搜索音乐"]:visible'); diag = []
    # 入口文案和可点的那一层随版本变：依次试「文字 / 外层 / 外两层」，哪个点开了搜索框就停
    async def open_panel():
        for txt in ['添加音乐', '选择音乐']:
            c = page.get_by_text(txt, exact=True)
            for i in range(await c.count()):
                if await search.count(): return
                el = c.nth(i)
                if not await el.is_visible(): continue
                for tgt in [el, el.locator('xpath=..'), el.locator('xpath=../..')]:
                    try: await tgt.click(timeout=5000)
                    except Exception: continue
                    await page.wait_for_timeout(3500)
                    diag.append(await page.evaluate("() => [...document.querySelectorAll('input')].filter(e => e.offsetParent).map(e => e.placeholder).filter(Boolean)"))
                    if await search.count(): return
    await open_panel()
    if not await search.count():
        await page.screenshot(path=str(DATA / 'music_fail.png')); raise RuntimeError('MUSIC_PANEL_NOT_OPEN ' + json.dumps(diag, ensure_ascii=False)[:800])
    inp = search.first
    sheet = page.locator('.semi-sidesheet:visible').last
    # 曲库搜索结果会变（10-22 前一天还在的「千年之后 (We Never)（剪辑版）」搜不到了），名字也常有出入。
    # 所以：先按名字精确找；找不到，就把名字里带关键词的候选逐个试听，截下试听音频，和成片里的音乐比旋律，选旋律对得上的。
    # 都对不上就失败：成片带原曲，不挂曲库音乐会被标成「@Hey创作的原声」
    norm = lambda s: ''.join(ch for ch in s if ch not in ' ()（）').lower()
    keys = [k.lower() for k in m.get('match', ['we never', '千年之后'])]
    queries = m.get('queries') or [m['query'], m['name'], 'We Never 剪辑版', '千年之后 剪辑版', 'We Never']

    async def search_for(q):
        # 面板偶尔在动画中或被试听弹层挡住（10-22 真发时 fill 超时）：等输入框可用，不行就重开面板，最多 3 次
        for attempt in range(3):
            try:
                await inp.wait_for(state='visible', timeout=8000); await inp.fill(q, timeout=8000); break
            except Exception:
                if attempt == 2:
                    await page.screenshot(path=str(DATA / 'music_fail.png')); raise
                await page.keyboard.press('Escape'); await page.wait_for_timeout(1500); await open_panel()
        await page.keyboard.press('Enter'); await page.wait_for_timeout(4000)
        names = []
        for _ in range(6):
            names = [n.strip() for n in await sheet.locator('[class*="song-name"], [class*="name"]').all_inner_texts() if n.strip()]
            if names: break
            await page.wait_for_timeout(1000)
        return names

    chosen, score, cands = None, None, []
    for q in dict.fromkeys(queries):
        names = await search_for(q)
        hit = next((n for n in names if norm(n) == norm(m['name'])), None)
        if hit: chosen = hit; break
        cands += [n for n in names if any(k in n.lower() for k in keys) and n not in cands]

    if chosen is None:
        audio = []
        page.on('response', lambda r: audio.append(r.url) if (r.headers.get('content-type', '').startswith('audio')
                or re.search(r'\.(mp3|m4a|aac)(\?|$)', r.url)) else None)
        scores = {}
        for i, name in enumerate(cands[:6]):
            if name not in await search_for(name): continue
            el = sheet.get_by_text(name, exact=True).first
            row = el.locator("xpath=ancestor::*[.//button[contains(@class,'apply-bt')]][1]")
            n0, before = len(audio), set(await page.evaluate("() => [...document.querySelectorAll('audio')].map(a => a.currentSrc || a.src)"))
            for tgt in [row.locator('img').first, el]:          # 点封面或歌名就会试听
                try: await tgt.click(timeout=4000)
                except Exception: continue
                for _ in range(8):
                    srcs = [u for u in await page.evaluate("() => [...document.querySelectorAll('audio')].map(a => a.currentSrc || a.src)") if u and u not in before]
                    if len(audio) > n0 or srcs: break
                    await page.wait_for_timeout(500)
                if len(audio) > n0 or srcs: break
            url = (srcs[-1] if srcs else None) or (audio[-1] if len(audio) > n0 else None)
            if not url: scores[name] = 'no-audio'; continue
            f = DATA / 'music_ref' / f'cand{i}.audio'
            f.write_bytes(await (await page.request.get(url)).body())
            scores[name] = round(await asyncio.to_thread(melody_score, f, m['_ref']), 3)
            try: await tgt.click(timeout=3000)                  # 再点一下停止试听
            except Exception: pass
        ok = {k: v for k, v in scores.items() if isinstance(v, float)}
        log('music_match', want=m['name'], scores=scores)
        if not ok or max(ok.values()) < MELODY_MIN:
            await page.screenshot(path=str(DATA / 'music_fail.png'))
            raise RuntimeError('MUSIC_NO_MATCH ' + json.dumps(scores, ensure_ascii=False)[:1000])
        chosen = max(ok, key=ok.get); score = ok[chosen]
        await search_for(chosen)

    item = sheet.get_by_text(chosen, exact=True).first
    # 悬停后只有这一行的「使用」可见；10-30 起悬停歌名不一定触发，依次试：歌名 → 整行 → 按文字找「使用」
    row = item.locator("xpath=ancestor::*[.//button][1]")
    applied = False
    for hov, btn in [(item, sheet.locator('button[class*="apply-bt"]:visible')),
                     (row, sheet.locator('button[class*="apply-bt"]:visible')),
                     (row, row.get_by_text('使用', exact=True)),
                     (row, sheet.get_by_role('button', name='使用'))]:
        try:
            await hov.scroll_into_view_if_needed(timeout=3000); await hov.hover(timeout=3000); await page.wait_for_timeout(1200)
            await btn.first.click(timeout=5000); applied = True; break
        except Exception: continue
    if not applied:
        diag = await sheet.evaluate("s => [...s.querySelectorAll('button')].slice(0, 30).map(b => [b.className, b.innerText.trim(), !!b.offsetParent])")
        await page.screenshot(path=str(DATA / 'music_fail.png'))
        raise RuntimeError('MUSIC_APPLY_NOT_FOUND ' + json.dumps(diag, ensure_ascii=False)[:1200])
    await page.wait_for_timeout(3000)
    await page.get_by_text('预览视频', exact=True).first.click(timeout=5000)
    await page.wait_for_timeout(2500)
    if not await page.evaluate('n => document.body.textContent.includes(n)', chosen):
        await page.screenshot(path=str(DATA / 'music_fail.png')); raise RuntimeError('MUSIC_NOT_APPLIED ' + chosen)
    return {'music': chosen, 'musicScore': score}

# 旋律相似度（chroma 序列对齐，允许移调；同一首曲子 ≥0.9，10-20 同一录音实测 0.99）
MELODY_MIN = 0.85
def melody_score(f, ref):
    import librosa, numpy as np, warnings; warnings.filterwarnings('ignore')
    def feat(x):
        y, sr = librosa.load(str(x), sr=11025, mono=True, duration=150)
        return librosa.feature.chroma_cens(y=librosa.effects.harmonic(y), sr=sr, hop_length=2048)[:, ::2]
    a, b, L, best = feat(f), feat(ref), 27, 0.0
    for k in range(12):
        S = a.T @ np.roll(b, k, axis=0); n, mm = S.shape
        for d in range(-n + L, mm - L):
            v = np.diagonal(S, d)
            if len(v) >= L: best = max(best, float(np.convolve(v, np.ones(L) / L, 'valid').max()))
    return best

async def state(page, title=''):
    body = await page.locator('body').first.inner_text()
    return {
        'titleOK': bool(title) and title.replace('｜', '|')[:10] in body.replace('｜', '|'),   # 标题框不一定在，看预览里有没有标题
        'aiDecl': '内容由AI生成' in body,
        'coverWarn': next((l for l in body.split('\n') if l.startswith('封面存在') or '封面存在' in l), ''),
        'schedule': await page.evaluate("() => (document.querySelector('.semi-input[placeholder=\"日期和时间\"], input[placeholder=\"日期和时间\"]') || {}).value || null"),
        'musicShown': next((l for l in body.split('\n') if 'We Never' in l or '创作的原声' in l), ''),
    }

# 点「发布」由我们来做（上游点完会无限等跳转、不截图，10-22 第一次真发卡死 20 分钟没留下任何线索）：
# 跳到作品管理 = 成功；出现验证码/身份验证 = 明确失败，留截图；1 分钟没反应 = 失败，记下页面上的弹窗文字
async def click_publish(page):
    await page.evaluate("() => document.querySelectorAll('.shepherd-element,.shepherd-modal-overlay-container,[class*=\"mention-wrapper\"]').forEach(e => e.remove())")
    await page.get_by_role('button', name='发布', exact=True).first.click()
    toasts = set()
    for i in range(40):
        await page.wait_for_timeout(1500)
        for t in await page.locator('[class*="toast"]:visible, [class*="Toast"]:visible, [class*="notice"]:visible').all_inner_texts():
            if t and t.strip(): toasts.add(t.strip()[:120])   # 提示一闪就没，边等边记；SVG 元素的 innerText 是 None
        if 'content/manage' in page.url: raise Published()
        body = await page.locator('body').first.inner_text()
        if any(k in body for k in ['验证码', '身份验证', '安全验证', '短信验证']):
            await page.screenshot(path=str(DATA / 'pub_verify.png'))
            raise RuntimeError('NEED_VERIFY 平台要求验证，需要人在手机上处理')
        if i % 8 == 0: await page.screenshot(path=str(DATA / 'pub_after.png'))
    modals = await page.locator('[class*="modal"]:visible, [class*="toast"]:visible, [class*="notice"]:visible').all_inner_texts()
    await page.screenshot(path=str(DATA / 'pub_after.png'))
    raise RuntimeError('PUBLISH_NO_NAV ' + ' | '.join(sorted(toasts) + [m.strip()[:120] for m in modals if m and m.strip()])[:600])

_sched = dy.DouYinBaseUploader.set_schedule_time_douyin
_decl = dy.DouYinVideo.apply_self_declaration
def make_hook(job, go, result):
    # 配乐必须在上游第一次「清浮层」之前挂：它会删掉所有非模态 .semi-portal，之后侧边栏渲染到脱离文档的节点上，永远打不开（10-22 实测）
    async def decl(self, page):
        if job.get('music'):
            result.update(await music(page, job['music']))
            try: await page.get_by_text('预览封面/标题', exact=True).first.click(timeout=5000)   # 切回封面预览
            except Exception: pass
        await _decl(self, page)
    dy.DouYinVideo.apply_self_declaration = decl

    async def hook(self, page, when):
        # 借上游「设定时」这一步做发布前检查和点发布；立即发布时不设时间，点「立即发布」
        if job.get('scheduleHours'): await _sched(self, page, when)
        else:   # 普通 click 点不动这个单选（10-31 两次超时），按坐标点
            el = page.get_by_text('立即发布', exact=True).first; await el.scroll_into_view_if_needed()
            bb = await el.bounding_box(); await page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await page.wait_for_timeout(800)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(800)
        try: await page.get_by_text('预览视频', exact=True).first.click(timeout=5000)   # 歌名只显示在「预览视频」里
        except Exception: pass
        await page.wait_for_timeout(2500)
        st = await state(page, job['title']); result.update(st)
        await page.screenshot(path=str(DATA / 'pub_form.png'), full_page=True)
        if job.get('music') and not await page.evaluate('n => document.body.textContent.includes(n)', result['music']):
            raise RuntimeError('MUSIC_LOST')
        want = when.strftime('%Y-%m-%d %H:%M')
        if job.get('scheduleHours') and not (st['schedule'] or '').startswith(want[:13]): raise RuntimeError(f"SCHEDULE_NOT_SET want {want} got {st['schedule']}")
        # 点发布前的最后一道关：这几项任一不对就停，不发（10-30 起不再先演练再正式发，一次上传、检查通过直接发）
        bad = [k for k, ok in [('COVER_WARN ' + st.get('coverWarn', ''), not st.get('coverWarn')),
                               ('TITLE', st.get('titleOK', True)), ('AI_DECL', st.get('aiDecl', True))] if not ok]
        if bad: raise RuntimeError('PRECHECK_FAILED ' + '; '.join(bad))
        if not go: raise DryRun()
        await click_publish(page)
    return hook

def edge_up():
    try: return urllib.request.urlopen('http://127.0.0.1:9333/json/version', timeout=2).status == 200
    except Exception: return False

async def export_cookie(pw):
    if not edge_up():
        subprocess.Popen([EDGE, '--remote-debugging-port=9333', f'--user-data-dir={PROFILE}', '--no-first-run', '--restore-last-session=false', 'https://creator.douyin.com/'])
        for _ in range(30):
            if edge_up(): break
            time.sleep(1)
    b = await pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    await b.contexts[0].storage_state(path=str(COOKIE))
    if not any(c['domain'].endswith('douyin.com') and c['name'] == 'sessionid' for c in json.load(open(COOKIE, encoding='utf8'))['cookies']):
        raise RuntimeError('LOGGED_OUT')

async def main(job_path, go):
    job = json.load(open(job_path, encoding='utf8'))
    # 定时（仅发布包写了 scheduleHours 时）：抖音要求点「发布」那一刻离定时 ≥2 小时；填表+试听配乐要 10～30 分钟，
    # 10-23 用 2.1 小时，填完已不足 2 小时，点发布无反应（PUBLISH_NO_NAV）。留足 45 分钟余量
    hours = max(float(job.get('scheduleHours') or 0), 2.75)
    when = (datetime.now() + timedelta(hours=hours)).replace(second=0, microsecond=0)
    when += timedelta(minutes=(5 - when.minute % 5) % 5)              # 取整到 5 分钟
    result = {'engine': 'social-auto-upload', 'when': when.strftime('%Y-%m-%d %H:%M') if job.get('scheduleHours') else 'now'}
    if job.get('music'):   # 旋律比对的基准：这条成片自己的音轨
        ref = DATA / 'music_ref' / (Path(job['video']).stem + '.wav'); ref.parent.mkdir(exist_ok=True)
        if not ref.exists():
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', job['video'], '-vn', '-ac', '1', '-ar', '11025', str(ref)], check=True)
        job['music']['_ref'] = ref
    dy.DouYinBaseUploader.set_schedule_time_douyin = make_hook(job, go, result)
    log('publish_start', job=job_path, go=go, engine='sau')
    async with async_playwright() as pw: await export_cookie(pw)
    v = dy.DouYinVideo(
        title=job['title'], file_path=job['video'], tags=job.get('tags', []), desc='\n'.join(job.get('desc', [])),
        publish_date=when, account_file=str(COOKIE), thumbnail_landscape_path=job.get('coverH'), thumbnail_portrait_path=job.get('coverV'),
        publish_strategy=dy.DOUYIN_PUBLISH_STRATEGY_SCHEDULED, headless=False,
        declaration='内容由AI生成' if job.get('aiDecl', True) else None)
    try:
        await asyncio.wait_for(v.main(), timeout=30 * 60)
    except Published:
        log('published', job=job_path, title=job['title'], **result); return {'ok': True, **result}
    except DryRun:
        log('publish_dryrun', job=job_path, **result); return {'dryRun': True, **result}
    log('published', job=job_path, title=job['title'], **result)
    return {'ok': True, **result}

if __name__ == '__main__':
    a = sys.argv[1:]
    try: r = asyncio.run(main(a[0], '--go' in a))
    except Exception as e:
        log('publish_failed', job=a[0] if a else None, engine='sau', msg=f'{type(e).__name__}: {e}'[:400])
        r = {'ok': False, 'err': f'{type(e).__name__}: {e}'[:400]}
    print(json.dumps(r, ensure_ascii=False))
