# 并行渲染全部帧：python render_all.py <html> <帧目录> <秒数> [路数]
import subprocess, sys, os
html, out, dur = sys.argv[1:4]; P = int(sys.argv[4]) if len(sys.argv) > 4 else 3
here = os.path.dirname(os.path.abspath(__file__)); n = round(30 * float(dur)); step = -(-n // P)
ps = [subprocess.Popen(['node', here + '/cap.js', html, out, '30', dur, '', str(i * step), str(min(n, (i + 1) * step))]) for i in range(P)]
print('exit codes', [p.wait() for p in ps]); print('frames', len([f for f in os.listdir(out) if f.endswith('.jpg')]))
