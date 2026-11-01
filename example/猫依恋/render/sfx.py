# Vibe知识大赏经典曲《千年之后》+ 音效 → mix.wav：python sfx.py mix.wav [配乐.wav]
# 原曲 17.08 大重拍对齐片中 6.0（「回来了」砸下），即从原曲 11.08 秒开始用；画面转场都卡在 6.0 + n×0.5317 的拍点上
import numpy as np, subprocess, wave, sys
SRC = sys.argv[2] if len(sys.argv) > 2 else '_素材/音乐/bgm.wav'   # 配乐不随仓库提供，用你有权使用的音乐
SR = 44100; D = 32.0
Q = 2.12675 / 4; HIT1 = 6.0; START = 17.08 - HIT1
T = [0, 3.34, 6.0, 11.32, 15.04, 17.17, 21.42, 25.14, 28.86, 32]
n = int(D * SR)

raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(START), '-i', SRC, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
music = np.frombuffer(raw, np.float32).astype(np.float64)[:n]; music = np.pad(music, (0, n - len(music)))
music[:int(0.3 * SR)] *= np.linspace(0, 1, int(0.3 * SR))          # 开头 0.3 秒淡入
music[-int(1.8 * SR):] *= np.linspace(1, 0, int(1.8 * SR)) ** 1.5   # 片尾淡出

sfx = np.zeros(n); rng = np.random.default_rng(7)
def put(sig, t, gain):
    i = int(t * SR); j = min(n, i + len(sig))
    if 0 <= i < n: sfx[i:j] += sig[:j - i] * gain
x_ = lambda d: np.arange(int(d * SR)) / SR
def whoosh(d=0.35):
    x = x_(d); nz = rng.standard_normal(len(x)); return np.convolve(nz, np.ones(12) / 12, 'same') * np.sin(np.pi * x / d) ** 2
def click(): x = x_(0.05); return rng.standard_normal(len(x)) * np.exp(-x * 120) + np.sin(2 * np.pi * 2600 * x) * np.exp(-x * 90) * 0.5
def pop(): x = x_(0.12); f = 500 + 900 * np.exp(-x * 40); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 30)
def sniff():
    x = x_(0.12); nz = rng.standard_normal(len(x)); return (nz - np.convolve(nz, np.ones(6) / 6, 'same')) * np.sin(np.pi * x / 0.12)
def glow(): x = x_(0.9); return (np.sin(2 * np.pi * 880 * x) + 0.5 * np.sin(2 * np.pi * 1320 * x)) * np.exp(-x * 4) * np.minimum(1, x * 30)

put(pop(), 0.35, 0.4); put(pop(), 0.9, 0.4)                          # 两个标签
for c in T[1:9]: put(whoosh(), c - 0.15, 0.25)
put(pop(), HIT1, 0.55)                                               # 回来了 砸下
put(whoosh(0.5), HIT1 + 0.15, 0.35)                                  # 扑上腿
put(pop(), HIT1 + 2.66, 0.45)                                        # 焦虑型
put(pop(), T[3] + 0.9, 0.35)                                         # 爱心
put(pop(), T[4] + 0.4, 0.4)                                          # 回避型
for x in (T[5] + 0.3, T[5] + 1.36, T[6] + 0.2): put(click(), x, 0.3)  # 三根条
put(pop(), T[6] + 1.6, 0.5)                                          # 几乎一样
put(pop(), T[8], 0.4)
mix = music * 0.85 + sfx * 0.5
mix /= max(1e-9, np.abs(mix).max()) / 0.9
pcm = (np.stack([mix, mix], 1) * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', sys.argv[1], D, 'music from', START)
