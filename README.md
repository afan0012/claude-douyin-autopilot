# Claude 全自动运营抖音

让 Claude Code 自己选题、做动画视频、发布、回评论、看数据写复盘。我用它跑了一个实验号「Hey」：

- 16 天发了 13 条，全部由 Claude 制作
- 3 条破万播放，最高一条 6.7 万（3371 次分享）
- 无人值守做一条视频，日志实测 16～17 分钟
- 涨粉只有 31 个：有播放不等于有粉丝，这个问题还没解决

这是实验记录，不是成熟产品。代码只在 Windows + Edge 上跑过，抖音页面一改版就可能失效。

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

- **Claude 不能自己点发布、不能自己回评论。** `autopilot.ps1` 用 `--disallowedTools` 禁掉了它调用 `runner.js`、`publish.js`、`comments.js reply/post`。它只能把要发的东西写进 `queue/`，真正发出去的是不带 AI 的脚本。
- **限速写在代码里，不写在提示词里。** 回复每小时最多 6 条、每天最多 30 条，两条之间至少 90 秒，每轮条与条之间随机隔 2～5 分钟；每天最多发 2 条视频。
- **回复先过一道 AI 腔拦截。** 超过 30 字、带冒号、以问号结尾、出现「感谢」「其实」「确实」「说得好」的回复直接不发，挪到 `rejected/` 留着复盘。
- **不搞反检测。** 不另开无头浏览器、不搬 cookie，直接接管你自己已经登录的 Edge 标签页操作；上游 social-auto-upload 的 stealth、伪造鼠标事件都关掉了。遇到平台要求验证就停下来等人。
- **只动自己的账号。** 只回自己作品下的评论，不去别人视频下评论，不批量关注、点赞、私信。
- **发布前自检。** 封面、标题、配乐、AI 声明任何一项不对就不点发布。

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
    runner.js                    执行队列（限速、AI 腔拦截、发置顶评论）
    publish.js                   发布入口：默认 sau_publish.py，备用 publish_own.js
    sau_publish.py               在 social-auto-upload 上打补丁：配乐、横竖封面、演练模式
    comments.js                  读评论 / 回复 / 发作者评论
    stats.js                     只读抓创作者中心的播放、2 秒跳出、逐秒留存、同类基准
    lib.js                       连 Edge、拟人等待、日志
example/猫依恋/render/            一条真实视频的工程：Canvas 2D 逐帧画面 + 音效 + 封面
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

`scan.sh` 用 monid 调 TikHub 的抖音接口抓话题视频，`ch_id` 是 #vibe知识大赏 的，换成你自己的话题。

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
  "video": "猫依恋/output/猫依恋_上传用.mp4",
  "title": "Vibe知识大赏｜…",
  "desc": ["…"],
  "tags": ["vibe知识大赏"],
  "coverH": "猫依恋/output/封面_横4x3.jpg",
  "coverV": "猫依恋/output/封面_竖3x4.jpg",
  "music": { "query": "千年之后 We Never", "name": "千年之后 (We Never)（剪辑版）" },
  "aiDecl": true
}
```

不带 `--go` 跑 `node publish.js <发布包>` 是演练：填好表单，停在发布按钮前。

## 改成你自己的号

提示词和 skill 是按「Hey」这个号写的（Vibe知识大赏话题、猫的反常识系列）。要换方向，主要改这几处：

- `.claude/skills/chupian/SKILL.md`：选题方向、视频规格。经验库是这个号 16 天的真实复盘，可以留着参考
- `_流水线/ops/prompts/produce.md`：每天几条、哪几条内容线
- `_流水线/ops/prompts/comments.md`：账号人设、回复风格
- `_流水线/scan.sh`：话题 id

## 没放进来的

账号登录态、cookie、数据和评论记录、日报、选题台账、配乐文件都不在仓库里。

**配乐要用你有权使用的音乐。** `example` 里的 `sfx.py` 需要你自己提供一个 wav。

## 风险

自动化操作可能违反平台规则，账号被限流或封禁的风险自己承担。别拿它刷量、批量评论别人或者发营销号内容。

## 致谢

- [dreammis/social-auto-upload](https://github.com/dreammis/social-auto-upload)（MIT）：发布用的上游
- [Azure12355/weilanx-claude-videos](https://github.com/Azure12355/weilanx-claude-videos)（MIT）：用 Claude 做知识视频的打法和工程细则，经验库里很多条来自这里

## License

MIT
