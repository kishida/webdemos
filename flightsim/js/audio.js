// サウンド: 連続音（エンジン・風・タイヤ）は Web Audio のオシレータで FM 合成し、
// 単発の効果音・警報・ジングル・BGM は FM 音源エンジン（window.FM）で鳴らす。
const FM = window.FM;

export const Audio = {
  ready: false,
  async init() {
    if (this.ready) { await FM.init(); return; }
    await FM.init({ musicVoices: 16, sfxVoices: 16, echo: 0.18 });
    this.ctx = FM.ctx;
    this.definePatches();
    this.buildEngine();
    this.ready = true;
  },

  definePatches() {
    const op = FM.op, OFF = FM.OFF;
    FM.addPatches({
      // タイヤのスキール（高い帰還でノイズ寄りの金属音）
      screech: { alg: 4, fb: 7.5, vol: 0.35, ops: [op(1, 1.4, 0.002, 0.25, 0.3, 0.1), op(1, 0.8, 0.003, 0.3, 0.4, 0.1), op(2.7, 0.9, 0.002, 0.2, 0.3, 0.1), op(1, 0.6, 0.004, 0.35, 0.2, 0.1)] },
      thump: { alg: 7, fb: 6, vol: 0.9, ops: [op(1, 0.4, 0.001, 0.05, 0, 0.03), OFF, OFF, op(1, 1, 0.001, 0.25, 0, 0.08)] },
      motor: { alg: 4, fb: 3, vol: 0.12, ops: [op(3, 0.5, 0.15, 1, 0.8, 0.2), op(1, 0.6, 0.15, 1, 0.9, 0.2), op(2, 0.4, 0.15, 1, 0.8, 0.2, 0.004), op(1, 0.5, 0.15, 1, 0.9, 0.2)] },
      horn: { alg: 4, fb: 4, vol: 0.14, ops: [op(2, 0.7, 0.01, 0.2, 0.9, 0.05), op(1, 0.8, 0.01, 0.2, 0.95, 0.05), op(3, 0.4, 0.01, 0.2, 0.9, 0.05), op(1, 0.6, 0.01, 0.2, 0.95, 0.05)] },
      beep: { alg: 7, fb: 0, vol: 0.14, ops: [OFF, OFF, OFF, op(1, 1, 0.003, 0.2, 1, 0.02)] },
      chime: { alg: 4, fb: 0, vol: 0.22, ops: [op(1, 0.35, 0.001, 0.8, 0.1, 0.8), op(1, 0.8, 0.002, 2.2, 0.0, 1.2), op(4, 0.15, 0.001, 0.5, 0.0, 0.5), op(1, 0.5, 0.002, 2.0, 0.0, 1.2, 0.002)] },
      shaker: { alg: 7, fb: 8.8, vol: 0.4, ops: [op(1, 0.5, 0.001, 0.04, 0, 0.02), OFF, OFF, op(1, 0.7, 0.001, 0.05, 0, 0.02)] },
      whoop: { alg: 4, fb: 2, vol: 0.16, ops: [op(1, 0.4, 0.01, 0.3, 0.8, 0.05), op(1, 0.9, 0.01, 0.3, 0.9, 0.05), op(2, 0.2, 0.01, 0.3, 0.8, 0.05), op(1, 0.7, 0.01, 0.3, 0.9, 0.05)] },
      pad: { alg: 5, fb: 1, vol: 0.09, vib: 0.006, ops: [op(1, 0.4, 0.6, 2, 0.8, 1.2), op(1, 0.6, 0.5, 2, 0.9, 1.2, 0.004), op(2, 0.25, 0.5, 2, 0.9, 1.2, -0.004), op(1, 0.6, 0.5, 2, 0.9, 1.2)] },
    });
    FM.defineSfx('touchdown', [['screech', 2400, 0, 0.32, 0.9, 0.55], ['thump', 70, 0, 0.3, 1, 0.5], ['screech', 1900, 0.06, 0.25, 0.6, 0.6, -1]]);
    FM.defineSfx('hardlanding', [['thump', 55, 0, 0.5, 1, 0.4], ['clank', 300, 0.02, 0.3, 1, 0.5], ['screech', 2100, 0, 0.45, 1, 0.5]]);
    FM.defineSfx('gear', [['motor', 120, 0, 2.6, 0.9, 1.25], ['clank', 240, 2.6, 0.18, 0.9, 0.6], ['thump', 90, 2.6, 0.2, 0.6, 0.6]]);
    FM.defineSfx('flap', [['motor', 260, 0, 1.2, 0.6, 1.15], ['clank', 600, 1.2, 0.06, 0.4, 0]]);
    FM.defineSfx('click', [['clank', 1800, 0, 0.03, 0.4, 0]]);
    FM.defineSfx('cabin', [['chime', 'A5', 0, 1.2, 0.9, 0], ['chime', 'F#5', 0.45, 1.6, 0.9, 0]]);
    FM.defineSfx('caution', [['chime', 'C6', 0, 0.5, 0.8, 0]]);
    FM.defineSfx('ab', [['boom', 140, 0, 0.6, 0.7, 0.5]]);
    FM.defineSfx('crash', [['bigboom', 110, 0, 1.6, 1, 0.2], ['boom', 260, 0.12, 0.8, 0.9, 0.25, -1], ['boom', 170, 0.35, 0.9, 0.9, 0.2], ['clank', 420, 0.05, 0.4, 0.9, 0.4], ['clank', 260, 0.3, 0.5, 0.7, 0.4, -1]]);
    FM.defineSfx('success', [0, 4, 7, 12, 16, 19, 24].map((n, i) => ['bell', FM.mtof(72 + n), i * 0.07, 0.5, 0.8, 0]));
    FM.defineSfx('liftoff', [['bell', 'E6', 0, 0.3, 0.6, 0], ['bell', 'B6', 0.09, 0.5, 0.6, 0]]);
    FM.defineSfx('outer', [['beep', 400, 0, 0.3, 1, 0], ['beep', 400, 0.4, 0.3, 1, 0], ['beep', 400, 0.8, 0.3, 1, 0]]);
    FM.defineSfx('middle', [['beep', 1300, 0, 0.3, 1, 0], ['beep', 1300, 0.4, 0.1, 1, 0], ['beep', 1300, 0.6, 0.3, 1, 0], ['beep', 1300, 1.0, 0.1, 1, 0]]);
    FM.defineSfx('inner', [0, 1, 2, 3, 4, 5].map((i) => ['beep', 3000, i * 0.17, 0.08, 1, 0]));
    FM.defineSfx('pullup', [['whoop', 330, 0, 0.45, 1, 1.9], ['whoop', 330, 0.55, 0.45, 1, 1.9]]);
  },

  // ---- 連続音のグラフ ----
  buildEngine() {
    const ctx = this.ctx;
    const out = this.out = ctx.createGain(); out.gain.value = 0; out.connect(FM.sfxGain);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.connect(out); // コックピットでこもらせる
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.0; }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, Q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = Q; return x; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    const N = this.nodes = {};
    // プロペラ: FM（キャリア:モジュレータ = 1:0.5）でピストンのうなり
    N.pCar = osc('sine', 60); N.pMod = osc('sine', 30); N.pIdx = gain(150);
    N.pMod.connect(N.pIdx); N.pIdx.connect(N.pCar.frequency);
    N.pCar2 = osc('sine', 120); N.pMod2 = osc('sine', 60); N.pIdx2 = gain(200); N.pMod2.connect(N.pIdx2); N.pIdx2.connect(N.pCar2.frequency);
    N.pChop = gain(0.5); N.pLfo = osc('sine', 40); N.pLfoG = gain(0.4); N.pLfo.connect(N.pLfoG); N.pLfoG.connect(N.pChop.gain);
    N.pLp = filt('lowpass', 900, 1.2); N.pG = gain(0);
    N.pCar.connect(N.pChop); N.pCar2.connect(N.pChop); N.pChop.connect(N.pLp); N.pLp.connect(N.pG); N.pG.connect(this.lp);
    N.pEx = noise(); N.pExF = filt('bandpass', 250, 1.2); N.pExG = gain(0); N.pEx.connect(N.pExF); N.pExF.connect(N.pExG); N.pExG.connect(this.lp);
    // ジェット: 轟音（バンドパスノイズ）+ 低音 + FM のファン音
    N.jN = noise(); N.jBp = filt('bandpass', 600, 0.5); N.jG = gain(0); N.jN.connect(N.jBp); N.jBp.connect(N.jG); N.jG.connect(this.lp);
    N.jLo = filt('lowpass', 160, 0.8); N.jLoG = gain(0); N.jN.connect(N.jLo); N.jLo.connect(N.jLoG); N.jLoG.connect(this.lp);
    N.wCar = osc('sine', 2000); N.wMod = osc('sine', 3000); N.wIdx = gain(300); N.wMod.connect(N.wIdx); N.wIdx.connect(N.wCar.frequency);
    N.wG = gain(0); N.wCar.connect(N.wG); N.wG.connect(this.lp);
    N.bz = osc('sawtooth', 120); N.bzF = filt('bandpass', 800, 2); N.bzG = gain(0); N.bz.connect(N.bzF); N.bzF.connect(N.bzG); N.bzG.connect(this.lp);
    // アフターバーナー: 低域ノイズ + ランダムな破裂（クラックル）
    N.abN = noise(); N.abF = filt('lowpass', 500, 0.6); N.abG = gain(0); N.abN.connect(N.abF); N.abF.connect(N.abG); N.abG.connect(this.lp);
    // 風切り音
    N.wiN = noise(); N.wiF = filt('bandpass', 900, 0.6); N.wiG = gain(0); N.wiN.connect(N.wiF); N.wiF.connect(N.wiG); N.wiG.connect(out);
    // タイヤの転がり音
    N.tN = noise(); N.tF = filt('lowpass', 220, 1); N.tG = gain(0); N.tN.connect(N.tF); N.tF.connect(N.tG); N.tG.connect(out);
  },

  setEngineType(type) { this.type = type; },

  // 毎フレーム呼ぶ
  update(st, spec, view) {
    if (!this.ready) return;
    const N = this.nodes, t = this.ctx.currentTime, k = 0.08;
    const set = (param, v) => param.setTargetAtTime(v, t, k);
    const n = st.engineOn ? st.engineN : st.engineN * 0.5;
    const dop = view.doppler || 1;
    const vol = (view.cockpit ? 0.55 : 1) * (view.distGain ?? 1) * (st.crashed ? 0 : 1);
    set(this.out.gain, vol);
    set(this.lp.frequency, view.cockpit ? 1600 : 18000);
    const isProp = spec.engine === 'prop', isJet = spec.engine !== 'prop', isF = spec.engine === 'fighter';
    // プロペラ
    const rpm = 700 + n * 2000, f0 = (rpm / 60) * 2 * dop;
    set(N.pCar.frequency, f0); set(N.pMod.frequency, f0 * 0.5); set(N.pIdx.gain, f0 * (1.5 + n * 2));
    set(N.pCar2.frequency, f0 * 2); set(N.pMod2.frequency, f0); set(N.pIdx2.gain, f0 * 2.5);
    set(N.pLfo.frequency, f0 * 0.5);
    set(N.pLp.frequency, (500 + n * 2200) * dop);
    set(N.pG.gain, isProp ? 0.12 + n * 0.22 : 0);
    set(N.pExG.gain, isProp ? 0.05 + n * 0.12 : 0);
    // ジェット
    const jn = Math.max(0, (n - 0.2) / 0.8);
    set(N.jBp.frequency, (350 + jn * 1100) * dop);
    set(N.jG.gain, isJet ? (0.05 + Math.pow(jn, 1.5) * (isF ? 0.75 : 0.5)) : 0);
    set(N.jLoG.gain, isJet ? (0.05 + jn * (isF ? 0.5 : 0.3)) : 0);
    const whine = (isF ? 1400 : 1700) + jn * (isF ? 2600 : 3800);
    set(N.wCar.frequency, whine * dop); set(N.wMod.frequency, whine * 1.5 * dop); set(N.wIdx.gain, whine * 0.15);
    set(N.wG.gain, isJet ? (0.012 + jn * 0.03) * (view.cockpit ? 0.5 : 1) : 0);
    set(N.bz.frequency, (60 + jn * 140) * dop); set(N.bzF.frequency, (500 + jn * 1500) * dop);
    set(N.bzG.gain, isJet && !isF && jn > 0.55 ? (jn - 0.55) * 0.12 : 0);
    // AB
    set(N.abG.gain, st.ab ? 0.6 + Math.random() * 0.5 : 0);
    // 風・タイヤ
    const v = st.V || 0;
    set(N.wiF.frequency, 500 + v * 8); set(N.wiG.gain, Math.min(0.5, (v / 120) ** 2 * (view.cockpit ? 0.35 : 0.25)));
    const gs = Math.hypot(st.vel.x, st.vel.z);
    set(N.tG.gain, st.onGround ? Math.min(0.35, gs / 120) : 0);
  },

  silence() { if (this.ready) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); },

  sfx(name, vel = 1) { if (FM.ready) FM.play_sfx(name, { vel }); },
  note(patch, f, opts) { if (FM.ready) FM.note('sfx', patch, f, opts); },

  // 発話（旅客機の電波高度コールアウト）
  say(text) {
    if (!window.speechSynthesis || FM.muted) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.15; u.pitch = 0.75; u.volume = 0.9;
    const v = speechSynthesis.getVoices().find((x) => /en-US/.test(x.lang) && /male|David|Guy|Mark/i.test(x.name)) || speechSynthesis.getVoices().find((x) => /en/.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  },

  // ---- タイトル BGM ----
  playTitle() {
    if (!FM.ready) return;
    const bars = FM.parseBars([
      'E5 - - - - - D5 - E5 - G5 - - - A5 -',
      'G5 - - - - - E5 - D5 - - - - - . .',
      'C5 - - - - - D5 - E5 - G5 - - - E5 -',
      'D5 - - - - - - - - - - - . . . .',
      'E5 - - - - - D5 - E5 - G5 - - - A5 -',
      'B5 - - - A5 - G5 - A5 - - - E5 - - -',
      'F5 - - - E5 - D5 - C5 - - - D5 - E5 -',
      'D5 - - - - - - - - - - - . . . .',
    ]);
    const prog = ['Cmaj7', 'Am7', 'Fmaj7', 'G', 'Cmaj7', 'Em7', 'Fmaj7', 'Gsus4'];
    const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [0, 8], chordLen: 8 });
    const arp = FM.arpeggio(prog, { pattern: [0, 1, 2, 3, 2, 1, 2, 3], octave: 12 });
    const song = {
      bpm: 84, steps: 128,
      tracks: [
        { name: 'lead', patch: 'epiano', ev: bars, vel: 0.75, pan: 0.1 },
        { name: 'pad', patch: 'pad', ev: acc.chords, vel: 0.8, pan: -0.2 },
        { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.55 },
        { name: 'arp', patch: 'bell', ev: arp.map((e) => ({ ...e, len: 1 })), vel: 0.22, pan: 0.35 },
        { name: 'drums', ev: FM.parseDrums('k . h . . . h . s . h . . . h k', 8), vel: 0.35 },
      ],
    };
    FM.play(song);
  },
  stopMusic() { if (FM.ready) FM.stop(); },
  toggleMute() { return FM.toggleMute(); },
};
