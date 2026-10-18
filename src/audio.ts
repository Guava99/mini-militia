// Procedural sound effects (no copyrighted audio needed).
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('mm_muted') === '1'; } catch { /* storage may be blocked */ }

export const audio = {
  get muted() { return muted; },
  setMuted(m: boolean) {
    muted = m;
    try { localStorage.setItem('mm_muted', m ? '1' : '0'); } catch { /* ignore */ }
  },
  toggleMute() { this.setMuted(!muted); return muted; },
};

function getCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

function noise(dur: number, vol: number) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(c.destination);
  s.start();
}

export const sfx = {
  shoot: (heavy = false) => (heavy ? (noise(0.15, 0.3), tone(120, 0.15, 'square', 0.2, 50)) : tone(600, 0.07, 'square', 0.08, 200)),
  explode: () => (noise(0.5, 0.5), tone(90, 0.4, 'sawtooth', 0.3, 30)),
  hit: () => tone(200, 0.08, 'sawtooth', 0.1, 100),
  reload: () => tone(300, 0.1, 'triangle', 0.1, 500),
  pickup: () => tone(500, 0.15, 'triangle', 0.12, 900),
  die: () => tone(300, 0.4, 'sawtooth', 0.15, 50),
};
