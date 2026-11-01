# 把 stills/still_<秒>.jpg 拼成联系表：python sheet.py <stills目录> <输出.jpg> [列数]
import subprocess, sys, os, glob
d, out = sys.argv[1], sys.argv[2]; cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
fs = sorted(glob.glob(os.path.join(d, 'still_*.jpg')), key=lambda f: float(os.path.basename(f)[6:-4]))
args = []
for f in fs: args += ['-i', f]
n = len(fs)
filt = ''.join(f"[{i}:v]scale=640:-1,drawtext=text='{os.path.basename(fs[i])[6:-4]}':x=10:y=10:fontsize=28:fontcolor=yellow[v{i}];" for i in range(n))
lay = '|'.join(f'{(i % cols) * 640}_{(i // cols) * 360}' for i in range(n))
filt += ''.join(f'[v{i}]' for i in range(n)) + f'xstack=inputs={n}:layout={lay}:fill=black'
subprocess.run(['ffmpeg', '-v', 'error', '-y', *args, '-filter_complex', filt, out], check=True)
print(out, n)
