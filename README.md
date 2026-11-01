# Claude 全自动运营抖音

让 Claude Code 自己选题、用代码做动画视频、发布、回评论、看数据写复盘。

这是实验项目，不是成熟产品。代码只在 Windows + Edge 上跑过，抖音页面一改版就可能失效。

## 怎么跑起来的

Windows 计划任务每天定时跑 `autopilot.ps1`，分三个阶段：

| 阶段 | 时间 | 做什么 |
|---|---|---|
| `review` | 08:00、23:00 | 抓创作者中心数据 → Claude 更新选题台账、经验库、日报；发现爆款写进 `hot.md` |
| `produce` | 09:00、15:00 | Claude 按 `chupian` skill 出一条片 → 和对标爆款并排自评 → 写发布包进队列 → 脚本发布 |
| `comments` | 10:30～22:30 每 2 小时 | 抓评论 → Claude 写回复进队列 → 脚本限速发送 |

```
          ┌──────── Claude（claude -p，只能读写文件、跑渲染）────────┐
数据/评论 ─►│ 选题 → 写脚本 → 代码画动画 → 渲染 → 自评 → 写发布包/回复 │─► queue/
          └─────────────────────────────────────────────────────────┘
                                                                        │
                              runner.js（不经过 AI，限速写死在代码里）◄──┘
                                   │
                                   ▼
                     你已登录的 Edge（CDP 127.0.0.1:9333）→ 抖音创作者中心
```

## 几个设计取舍

- **Claude 只写队列，发东西的是脚本。** 两道闸：
  1. `autopilot.ps1` 用 `--disallowedTools` 禁掉 Claude 调用所有会发东西的命令：`runner.js`、`publish.js`、`publish_own.js`、`sau_publish.py`、`takeover.py`、`comments.js reply/post`。
  2. 这些脚本真正发送前检查环境变量 `DY_ALLOW_SEND=1`，没有就直接拒绝。`runner.js` 调子进程时会带上它，`autopilot.ps1` 启动 Claude 前会把它清掉。

  这是防误操作的护栏，不是沙箱：Claude 能跑 node 和 python，存心要绕是绕得过去的。要彻底隔离，用单独的系统用户跑 Claude。
- **限速写在代码里，不写在提示词里。**
  - 回复：每小时最多 6 条、每天最多 30 条，两条之间至少 90 秒（`comments.js`）；每轮最多 3 条，条与条之间随机隔 2～5 分钟（`runner.js`）。
  - 发布：每天最多 2 条（`runner.js` 的 `MAX_PUBLISH_PER_DAY`，按本地日期数已发布的发布包）。
- **回复先过一道 AI 腔拦截。** 超过 30 字、带冒号、以问号结尾、出现「感谢」「其实」「确实」「说得好」的回复直接不发，挪到 `rejected/` 留着复盘。
- **不搞反检测。** 不另开无头浏览器，直接接管你自己已经登录的 Edge 标签页操作；上游 social-auto-upload 的 stealth、伪造鼠标事件都关掉了。上游需要一个登录态文件，所以 `sau_publish.py` 会把当前 Edge 的登录态导出到本地 `data/sau_cookie.json`（已在 `.gitignore` 里），但不会把它塞进另一个浏览器。遇到平台要求验证就停下来等人。
- **只动自己的账号。** 只回自己作品下的评论，不去别人视频下评论，不批量关注、点赞、私信。
- **发布前自检。** 封面、标题、配乐、AI 声明任何一项不对就不点发布。失败不自动重试。

## 目录

```
.claude/skills/chupian/SKILL.md   出片方法 + 经验库（每次复盘 Claude 自己往里补「观察 + 证据」）
_流水线/
  scan.sh / rank.py              抓话题下最新视频，按「每小时点赞」排出正在涨的
  sheet.py                       把截图拼成联系表，方便看节奏
  ops/
    autopilot.ps1                三个阶段的总控
    install.ps1                  安装/卸载计划任务
    prompts/                     三个阶段给 Claude 的提示词
    runner.js                    执行队列（限速、每日发布上限、AI 腔拦截）
    publish.js                   发布入口：默认 sau_publish.py，备用 publish_own.js
    sau_publish.py               在 social-auto-upload 上打补丁：配乐、横竖封面、发布前自检、演练模式
    takeover.py                  发布卡住时，人工接管同一个发布页继续发
    comments.js                  读评论 / 回复（发作者评论的 post 命令保留，队列默认不用）
    stats.js                     只读抓创作者中心的播放、2 秒跳出、逐秒留存、同类基准
    lib.js                       连 Edge、拟人等待、日志
example/cat-attachment/render/   一条视频的完整工程：Canvas 2D 逐帧画面 + 音效 + 封面
```

## 安装

需要：Windows、Edge、Node 18+、Python 3.11、ffmpeg、[Claude Code](https://claude.com/claude-code)（命令行已登录）。

```powershell
# 1. 依赖
cd _流水线/ops; npm install; cd ../..

# 2. 发布用的上游：social-auto-upload，放在这个位置（publish.js 按这个路径找）
git clone https://github.com/dreammis/social-auto-upload _参考工程/oss/social-auto-upload
python -m venv _参考工程/oss/.venv
_参考工程/oss/.venv/Scripts/pip install -r _参考工程/oss/social-auto-upload/requirements.txt playwright numpy

# 3. 登录：会用单独的 profile 启动 Edge 并打开创作者中心，扫码登录一次
node _流水线/ops/probe.js https://creator.douyin.com/

# 4. 先手动跑一遍复盘，看能不能抓到数据
powershell -ExecutionPolicy Bypass -File _流水线/ops/autopilot.ps1 review
```

`scan.sh` 用 monid 调 TikHub 的抖音接口抓话题视频：`CH_ID=<话题 ch_id> bash _流水线/scan.sh`。

都跑通了，再装计划任务（这一步等于授权它自动发布和回复）：

```powershell
powershell -ExecutionPolicy Bypass -File _流水线/ops/install.ps1          # 安装
powershell -ExecutionPolicy Bypass -File _流水线/ops/install.ps1 -Remove  # 全部停掉
```

## 发布包格式

Claude 在 `produce` 阶段写 `_流水线/ops/queue/publish/<日期>_<片名>.json`：

```json
{
  "status": "ready",
  "video": "my-video/output/成片.mp4",
  "title": "…",
  "desc": ["…"],
  "tags": ["…"],
  "coverH": "my-video/output/封面_横4x3.jpg",
  "coverV": "my-video/output/封面_竖3x4.jpg",
  "music": { "query": "曲库搜索词", "name": "曲库里的曲名" },
  "aiDecl": true
}
```

- 不写 `scheduleHours` 就立即发布；写了 `"scheduleHours": N` 就定时到 N 小时后（抖音要求 ≥2 小时）。
- `music` 是平台曲库里的曲子。发布时脚本会把成片音轨和搜索结果逐首比旋律，挑出同一首挂上；对不上就不发。
- 演练：`node _流水线/ops/publish.js <发布包>`（不带 `--go`），填好表单，停在发布按钮前，截图 `data/pub_form.png`。

## 发布卡住时

最常见的是配乐面板打不开（上游「清浮层」时把侧边栏删了）。不要重新上传，在同一个页面接着发：

1. 在发布页点「暂存离开」，再在上传页点「继续编辑」。草稿会保留视频、封面和 AI 声明。
2. 运行 `takeover.py`，它会挂配乐、做发布前自检、点发布，并把发布包标成 `published`：

```bash
DY_ALLOW_SEND=1 _参考工程/oss/.venv/Scripts/python.exe _流水线/ops/takeover.py _流水线/ops/queue/publish/<发布包>.json
```

一次发布只开一个页面、只传一次；失败了先查原因，不要反复重传，平台会当成风险信号。

## 改成你自己的号

提示词和 skill 默认是「代码动画 + 冷知识」这一类内容。要换方向，主要改这几处：

- `.claude/skills/chupian/SKILL.md`：选题方向、视频规格；经验库是通用的观察，可以留着当起点
- `_流水线/ops/prompts/produce.md`：每天几条、哪几条内容线
- `_流水线/ops/prompts/comments.md` + `_流水线/ops/data/persona.md`（自己建）：账号定位、人设、回复风格
- `CH_ID`：你要追的话题

## 没放进来的

账号登录态、cookie、数据和评论记录、日报、选题台账、配乐文件都不在仓库里。

**配乐要用你有权使用的音乐**：平台曲库里的曲子，或者可商用、自己做的。`example` 里的 `sfx.py` 需要你自己提供一个 wav。

## 风险

自动化操作可能违反平台规则，账号被限流或封禁的风险自己承担。别拿它刷量、批量评论别人或者发营销号内容。

## 致谢

- [dreammis/social-auto-upload](https://github.com/dreammis/social-auto-upload)：发布用的上游
- [Azure12355/weilanx-claude-videos](https://github.com/Azure12355/weilanx-claude-videos)（MIT）：用 Claude 做知识视频的打法和工程细则，经验库里很多条来自这里

## License

MIT
