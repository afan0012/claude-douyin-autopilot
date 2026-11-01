#!/bin/bash
# 抓 #vibe知识大赏 最新发布的视频（sort_type=2），翻 N 页，存到 scan/<时间>/
export MSYS_NO_PATHCONV=1
N=${1:-12}; D=scan/$(date +%m%d_%H%M); mkdir -p $D; cur=0
for i in $(seq 1 $N); do
  monid run -p tikhub -e /api/v1/douyin/app/v3/fetch_hashtag_video_list --query "{\"ch_id\":\"7690834868800620595\",\"sort_type\":2,\"cursor\":$cur,\"count\":10}" -w 60 -j -o $D/p$i.json >/dev/null 2>&1
  cur=$(python -X utf8 -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8'));
def f(o):
  if isinstance(o,dict):
    if 'cursor' in o and 'has_more' in o: return o['cursor']
    for v in o.values():
      r=f(v)
      if r is not None: return r
print(f(d) or 0)" $D/p$i.json)
  echo "page $i -> cursor $cur"; [ "$cur" = "0" ] && break
done
echo $D
