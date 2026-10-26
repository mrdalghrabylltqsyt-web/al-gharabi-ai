/**
 * إيقاع غرفة العقل الحية (2026-10-26).
 *
 * موسيقى تُولَّد لحظياً في المتصفح عبر Web Audio — لا ملفات صوتية، لا شبكة، لا حقوق
 * نشر، ولا أي استهلاك لحصص الخادم أو Gemini. الإيقاع يتفاعل مع النظام الحقيقي:
 *  - كل حدث حقيقي يصل للغرفة يُعزف نغمةً على السلّم نفسه (معلومة / تحذير / خطأ بنغمات مختلفة).
 *  - «الطاقة» (نشاط الأحداث في الدقيقة + أخطر حالة قائمة) تفتح المرشّح وتكثّف الإيقاع.
 *  - كل ضربة طبل تُبلَّغ للواجهة (onBeat) فينبض قلب العقل المركزي معها.
 * محرّك واحد مشترك (singleton) — غرفة التبويب والشاشة الحية تتحكمان بالصوت نفسه، فلا يُعزف مرتين.
 * يبدأ فقط بنقرة من المالك (سياسة المتصفحات)، ويُحفظ اختياره محلياً.
 */

export type SoundMode = 'pulse' | 'drive' | 'calm';
export type PingLevel = 'ok' | 'info' | 'warn' | 'error';

export const SOUND_MODES: Array<{ id: SoundMode; label: string; bpm: number }> = [
  { id: 'drive', label: 'حماسي', bpm: 124 },
  { id: 'pulse', label: 'نبض', bpm: 96 },
  { id: 'calm', label: 'هادئ', bpm: 80 },
];

const PREF_ON = 'gharabi.live.music';
const PREF_MODE = 'gharabi.live.music.mode';
const PREF_VOL = 'gharabi.live.music.vol';
const readPref = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* اختياري */ } };

// لا مينور (A): Am – F – C – G — تقدّم ملحمي متصاعد.
const CHORDS: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const SCALE = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export interface SoundState { playing: boolean; mode: SoundMode; volume: number; supported: boolean }
type Listener = (s: SoundState) => void;

class LiveSoundtrack {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private energy = 0.4;
  private alarm: 'ok' | 'warn' | 'critical' = 'ok';
  private listeners = new Set<Listener>();
  private beatListeners = new Set<() => void>();
  private lastPing = 0;
  state: SoundState;

  constructor() {
    const m = readPref(PREF_MODE) as SoundMode | null;
    const v = Number(readPref(PREF_VOL));
    this.state = {
      playing: false,
      mode: m && SOUND_MODES.some((x) => x.id === m) ? m : 'drive',
      volume: Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.45,
      supported: typeof window !== 'undefined' && Boolean((window as any).AudioContext || (window as any).webkitAudioContext),
    };
  }

  /** هل اختار المالك التشغيل سابقاً؟ (تُستأنف الموسيقى تلقائياً إن سمح المتصفح). */
  get wanted(): boolean { return readPref(PREF_ON) === '1'; }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  onBeat(fn: () => void): () => void { this.beatListeners.add(fn); return () => { this.beatListeners.delete(fn); }; }
  private emit() { this.state = { ...this.state }; this.listeners.forEach((f) => f(this.state)); }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const ctx: AudioContext = new Ctx();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.bus = ctx.createGain(); this.bus.gain.value = 1;
    // صدى إيقاعي (3/16 من الضربة) يعطي المساحة والحيوية.
    const delay = ctx.createDelay(1); const fb = ctx.createGain(); const wet = ctx.createGain(); const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 2600; fb.gain.value = 0.32; wet.gain.value = 0.28;
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 1;
    this.delaySend.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(wet); wet.connect(this.bus);
    (this as any)._delay = delay;
    this.bus.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);
    // ضوضاء بيضاء لصنجات الإيقاع والتصفيق.
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    return ctx;
  }

  private get bpm(): number { return SOUND_MODES.find((m) => m.id === this.state.mode)!.bpm; }
  private get sixteenth(): number { return 60 / this.bpm / 4; }

  async start(): Promise<boolean> {
    const ctx = this.ensure();
    if (!ctx) return false;
    try { if (ctx.state !== 'running') await ctx.resume(); } catch { /* */ }
    if (ctx.state !== 'running') return false; // المتصفح لم يسمح بعد — ينتظر نقرة
    writePref(PREF_ON, '1');
    if (this.state.playing) return true;
    ((this as any)._delay as DelayNode).delayTime.value = this.sixteenth * 3;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.state.volume, t + 1.2);
    this.step = 0; this.nextTime = t + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.state.playing = true; this.emit();
    return true;
  }

  stop(remember = true): void {
    if (remember) writePref(PREF_ON, '0');
    if (!this.ctx || !this.state.playing) { this.state.playing = false; this.emit(); return; }
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.6);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.state.playing = false; this.emit();
  }

  toggle(): void { if (this.state.playing) this.stop(); else void this.start(); }

  setMode(mode: SoundMode): void {
    this.state.mode = mode; writePref(PREF_MODE, mode);
    if (this.ctx) ((this as any)._delay as DelayNode).delayTime.value = this.sixteenth * 3;
    this.emit();
  }

  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v));
    this.state.volume = vol; writePref(PREF_VOL, String(vol));
    if (this.ctx && this.state.playing) this.master.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.08);
    this.emit();
  }

  /** طاقة النظام الحقيقية: أحداث/دقيقة وأخطر حالة قائمة. */
  setEnergy(eventsPerMinute: number, alarm: 'ok' | 'warn' | 'critical'): void {
    const e = Math.min(1, 0.35 + Math.log2(1 + Math.max(0, eventsPerMinute)) / 6);
    this.energy = alarm === 'critical' ? Math.max(e, 0.8) : e;
    this.alarm = alarm;
  }

  /** نغمة لحدث حقيقي — على سلّم الموسيقى نفسها فتندمج معها. */
  ping(level: PingLevel): void {
    if (!this.ctx || !this.state.playing) return;
    const now = this.ctx.currentTime;
    // تُكمَّم على أقرب ثُمن قادم لتقع على الإيقاع، ولا تتراكم أكثر من نغمة كل 120ms.
    const grid = this.sixteenth * 2;
    let t = Math.ceil(now / grid) * grid;
    if (t < this.lastPing + 0.12) t = this.lastPing + grid;
    this.lastPing = t;
    if (level === 'error') {
      this.pluck(hz(76), t, 0.5, 'square', 0.18); this.pluck(hz(71), t + grid, 0.5, 'square', 0.18);
    } else if (level === 'warn') {
      this.pluck(hz(72), t, 0.4, 'triangle', 0.22); this.pluck(hz(76), t + grid / 2, 0.4, 'triangle', 0.2);
    } else {
      const n = SCALE[7 + Math.floor(Math.random() * 5)];
      this.pluck(hz(n + 12), t, 0.6, 'sine', 0.26); this.pluck(hz(n + 19), t + 0.04, 0.5, 'sine', 0.1);
    }
  }

  // ——— المُجدوِل: يجدول النغمات قبل وقتها بـ120ms (توقيت دقيق بلا تقطّع) ———
  private schedule(): void {
    const ctx = this.ctx; if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.sixteenth;
      this.step = (this.step + 1) % 64; // 4 مقاطع × 16
    }
  }

  private playStep(s: number, t: number): void {
    const mode = this.state.mode;
    const bar = Math.floor(s / 16), i = s % 16;
    const chord = CHORDS[bar];
    const E = this.energy;
    const beat = i % 4 === 0;

    if (mode === 'drive') {
      if (beat) { this.kick(t, 1); this.beatAt(t); }
      if (i === 4 || i === 12) this.clap(t, 0.55);
      if (i % 4 === 2) this.hat(t, 0.32, false);
      if (E > 0.55 && i % 2 === 1) this.hat(t, 0.12, false);
      if (i % 2 === 0) this.bass(hz(chord[0] - 24 + (i % 8 === 6 ? 12 : 0)), t, this.sixteenth * 1.6, E);
      const arp = [0, 1, 2, 1, 2, 0, 2, 1];
      if (E > 0.45 || i % 2 === 0) this.pluck(hz(chord[arp[i % 8]] + 12), t, this.sixteenth * 1.4, 'sawtooth', 0.07 + E * 0.05, true);
    } else if (mode === 'pulse') {
      // نبضة قلب: «دُق-دُق» في أول كل ضربتين.
      if (i === 0 || i === 8) { this.kick(t, 1); this.beatAt(t); }
      if (i === 2 || i === 10) this.kick(t, 0.55);
      if (i % 4 === 2 && E > 0.5) this.hat(t, 0.18, false);
      if (i === 0 || i === 8) this.bass(hz(chord[0] - 24), t, this.sixteenth * 6, E * 0.8);
      if (i % 4 === 0) this.pluck(hz(chord[(i / 4) % 3] + 12), t, this.sixteenth * 3, 'triangle', 0.08, true);
    } else {
      if (i === 0) this.beatAt(t);
      if (i % 4 === 0) this.pluck(hz(chord[(i / 4) % 3] + 12 + (i === 12 ? 12 : 0)), t, this.sixteenth * 4, 'sine', 0.1, true);
      if (i === 0 || i === 8) this.bass(hz(chord[0] - 12), t, this.sixteenth * 8, 0.25);
    }
    if (i === 0) this.pad(chord, t, this.sixteenth * 16, mode === 'drive' ? 0.05 + E * 0.03 : 0.07);
    // عند وجود حالة حرجة: جرس خافت كل مقطعين يذكّر بلا إزعاج.
    if (this.alarm === 'critical' && i === 14 && bar % 2 === 1) { this.pluck(hz(81), t, 0.3, 'square', 0.06); this.pluck(hz(77), t + this.sixteenth, 0.3, 'square', 0.06); }
  }

  private beatAt(t: number): void {
    const ctx = this.ctx!; const ms = Math.max(0, (t - ctx.currentTime) * 1000);
    window.setTimeout(() => this.beatListeners.forEach((f) => f()), ms);
  }

  // ——— الآلات ———
  private kick(t: number, amp: number): void {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.95 * amp, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.45);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, amp: number, dur: number, send = 0): void {
    const ctx = this.ctx!; const src = ctx.createBufferSource(); const f = ctx.createBiquadFilter(); const g = ctx.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.delaySend); }
    src.start(t); src.stop(t + dur + 0.02);
  }
  private hat(t: number, amp: number, open: boolean): void { this.noiseHit(t, 'highpass', 7500, amp, open ? 0.25 : 0.05); }
  private clap(t: number, amp: number): void { this.noiseHit(t, 'bandpass', 1600, amp, 0.16, 0.25); }

  private bass(f: number, t: number, dur: number, e: number): void {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const flt = ctx.createBiquadFilter(); const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    flt.type = 'lowpass'; flt.Q.value = 6;
    flt.frequency.setValueAtTime(180 + e * 700, t); flt.frequency.exponentialRampToValueAtTime(140, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt); flt.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, dur: number, type: OscillatorType, amp: number, send = false): void {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const flt = ctx.createBiquadFilter(); const g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    flt.type = 'lowpass'; flt.frequency.setValueAtTime(1200 + this.energy * 3800, t); flt.frequency.exponentialRampToValueAtTime(500, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt); flt.connect(g); g.connect(this.bus);
    if (send) g.connect(this.delaySend);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private pad(chord: number[], t: number, dur: number, amp: number): void {
    const ctx = this.ctx!; const flt = ctx.createBiquadFilter(); const g = ctx.createGain();
    flt.type = 'lowpass'; flt.frequency.value = 500 + this.energy * 900; flt.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    flt.connect(g); g.connect(this.bus); g.connect(this.delaySend);
    for (const n of chord) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
      o.connect(flt); o.start(t); o.stop(t + dur + 0.05);
    }
  }
}

let instance: LiveSoundtrack | null = null;
export function getSoundtrack(): LiveSoundtrack {
  if (!instance) instance = new LiveSoundtrack();
  return instance;
}
