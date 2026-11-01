// 调试：给已打开的发布页截图，列出可见弹窗的文字。node snap.js [截图名]
const { run, shot } = require('./lib');
run(async ({ ctx, args }) => {
  const p = ctx.pages().filter(p => /content\/(post|publish|upload)/.test(p.url())).pop();
  if (!p) return { pages: ctx.pages().map(p => p.url()) };
  await p.bringToFront(); await shot(p, args[0] || 'snap');
  const modals = await p.locator('[class*="modal"]:visible, .semi-modal-content:visible').evaluateAll(es => es.map(e => e.innerText.slice(0, 300)).filter(Boolean));
  return { url: p.url(), modals };
});
