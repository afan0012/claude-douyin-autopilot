# 读 scan 目录，按“每小时点赞”排序，列出正在涨的新视频
import json, glob, sys, time
def walk(o):
    if isinstance(o, dict):
        if 'aweme_id' in o and 'statistics' in o: yield o
        else:
            for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
seen = {}
for f in glob.glob(sys.argv[1] + '/*.json'):
    for a in walk(json.load(open(f, encoding='utf-8'))): seen[a['aweme_id']] = a
now = time.time(); rows = []
for a in seen.values():
    s = a['statistics']; h = max(0.5, (now - a.get('create_time', now)) / 3600)
    au = a.get('author', {})
    rows.append((s.get('digg_count', 0) / h, h, s.get('digg_count', 0), s.get('comment_count', 0), s.get('share_count', 0),
                 s.get('collect_count', 0), au.get('follower_count', 0), a.get('duration', 0) // 1000, a['aweme_id'], (a.get('desc') or '')[:60].replace('\n', ' ')))
rows.sort(reverse=True)
print(len(rows), 'videos; oldest h =', round(max(r[1] for r in rows)))
print('赞/时\t小时\t赞\t评\t转\t藏\t粉丝\t秒\tid\t标题')
for r in rows[:30]: print(f'{r[0]:.0f}\t{r[1]:.1f}\t' + '\t'.join(map(str, r[2:])))
