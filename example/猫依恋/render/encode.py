# 帧 + 音轨 → 上传用 mp4（-13 LUFS 两遍 loudnorm；H.264 level 4.1、yuv420p、双声道、faststart）
# python encode.py <帧目录> <mix.wav> <out.mp4>
import subprocess, sys, json, re
fr, wav, out = sys.argv[1:4]
r = subprocess.run(['ffmpeg', '-hide_banner', '-i', wav, '-af', 'loudnorm=I=-13:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr).group(0)); print('measured', m['input_i'], m['input_tp'])
af = f"loudnorm=I=-13:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
cmd = ['ffmpeg', '-v', 'error', '-y', '-framerate', '30', '-i', fr + '/%04d.jpg', '-i', wav, '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-af', af + ',alimiter=limit=0.79:level=false', '-ar', '44100', '-ac', '2',
       '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M',
       '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out]
print(subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace').stderr[-1500:])
print(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,profile,level,pix_fmt,width,height,channels,sample_rate:format=duration,size', '-of', 'compact', out], capture_output=True, text=True).stdout)
r = subprocess.run(['ffmpeg', '-hide_banner', '-i', out, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr).group(0)); print('final LUFS', m['input_i'], 'TP', m['input_tp'])
with open(out, 'rb') as f: head = f.read(64 * 1024)
print('faststart(moov before mdat):', head.find(b'moov') != -1 and (head.find(b'mdat') == -1 or head.find(b'moov') < head.find(b'mdat')))
