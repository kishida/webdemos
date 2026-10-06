// ===== BGM・効果音（FM音源＋PCMドラム＋リバーブ） =====
'use strict';

const Sound = (() => {
  let ready = false;
  let current = null;

  // ドラム譜：1トークン=1ステップ（1小節16）。k キック s スネア h ハット o オープンハット t ティンパニ c クラッシュ
  // 同時打ちは "KC" のように並べる。大文字はアクセント、小文字は弱く（ロールやゴーストノート）
  function drums(bars) {
    const ev = [];
    bars.forEach((bar, b) => {
      const toks = bar.trim().split(/\s+/);
      if (toks.length !== 16) console.warn(`drums: bar ${b + 1} has ${toks.length} steps: ${bar}`);
      toks.forEach((tok, i) => {
        for (const ch of tok) {
          const d = ch.toLowerCase();
          if (FM.DRUM_MAP[d]) ev.push({ step: b * 16 + i, drum: d, vel: ch === d ? 0.55 : 1 });
        }
      });
    });
    return ev;
  }
  // オーケストラヒット [step, 音名]
  const hits = (list) => list.map(([step, n]) => ({ step, len: 4, midi: FM.noteToMidi(n) }));

  function blueTheme() {
    const prog = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G', 'Am', 'G'];
    const lead = FM.parseBars([
      'C5 - - G4 C5 - E5 - G5 - - - E5 - C5 -',
      'D5 - - B4 D5 - G5 - B5 - - - A5 - G5 -',
      'A5 - - E5 A5 - C6 - B5 - A5 - E5 - - -',
      'F5 - - - A5 - - - C6 - - - A5 - F5 -',
      'E5 - - C5 E5 - G5 - C6 - - - G5 - E5 -',
      'D5 - - B4 D5 - G5 - B5 - - - D6 - B5 -',
      'C6 - - - A5 - F5 - A5 - C6 - F6 - - -',
      'D6 - - - - - - - B5 - - - G5 - - -',
      'A4 - - - C5 - E5 - A5 - - - G5 - E5 -',
      'G4 - - - B4 - E5 - G5 - - - - - - -',
      'F5 - - - E5 - D5 - C5 - - - A4 - C5 -',
      'E5 - - - - - D5 - C5 - - - G4 - - -',
      'D5 - - - F5 - A5 - D6 - - - C6 - A5 -',
      'B5 - - - - - G5 - D5 - - - B4 - D5 -',
      'C5 - - - E5 - A5 - C6 - - - B5 - A5 -',
      'B5 - - - - - - - D6 - - - - - - -',
    ]);
    const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [2, 6, 10, 14], chordLen: 2 });
    // 軍楽隊風：4小節ごとにスネアロール、セクション頭でクラッシュ＋ティンパニ
    const A = 'KCT . h . S . h s K . h . S . s s', N = 'K . h . S . h s K . h . S . s s';
    const R = 'K . h . S . h . S s S s S s S S', F = 'S s S s S s S s S s S s S S S S';
    return { bpm: 120, steps: 256, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass },
      { name: 'chords', patch: 'strings', ev: acc.chords, pan: -0.3, vel: 0.7 },
      { name: 'lead', patch: 'brass', ev: lead, pan: 0.1 },
      { name: 'hits', patch: 'orchhit', ev: hits([[0, 'C4'], [120, 'G3'], [124, 'G3'], [128, 'A3'], [248, 'G3'], [252, 'G3']]), vel: 0.9 },
      { name: 'drums', ev: drums([A, N, N, R, N, N, N, R, A, N, N, R, N, N, N, F]), vel: 0.85 },
    ] };
  }

  function redTheme() {
    const prog = ['Am', 'Am', 'F', 'E', 'Am', 'Am', 'Dm', 'E'];
    const lead = FM.parseBars([
      'A4 - . A4 C5 - . A4 E5 - D5 - C5 - B4 -',
      'A4 - - - - - - - . . E4 - A4 - B4 -',
      'C5 - . C5 F5 - . C5 A5 - G5 - F5 - E5 -',
      'E5 - - - - - - - G#4 - - - B4 - - -',
      'A5 - . A5 G5 - . E5 F5 - E5 - D5 - C5 -',
      'B4 - C5 - D5 - E5 - . . . . A4 - - -',
      'D5 - . D5 F5 - . D5 A5 - G5 - F5 - D5 -',
      'E5 - - - - - - - G#5 - - - B5 - - -',
    ]);
    const acc = FM.accomp(prog, { bassStep: 1, bassOct: true, chordSteps: [0, 3, 6, 10, 12], chordLen: 2 });
    const arp = FM.arpeggio(prog, { pattern: [0, 1, 2, 1], octave: 12 });
    const A = 'KC . h k S . h . K k h . S . h O', N = 'K . h k S . h . K k h . S . h O';
    const F = 'K . S . S . S s S s T t T t S S';
    return { bpm: 138, steps: 128, tracks: [
      { name: 'bass', patch: 'slapbass', ev: acc.bass },
      { name: 'chords', patch: 'organ', ev: acc.chords, pan: -0.35, vel: 0.55 },
      { name: 'arp', patch: 'bell', ev: arp, vel: 0.25, pan: 0.4 },
      { name: 'lead', patch: 'lead', ev: lead, pan: 0.1 },
      { name: 'hits', patch: 'orchhit', ev: hits([[0, 'A3'], [48, 'E3'], [64, 'A3'], [112, 'E3']]), vel: 0.8 },
      { name: 'drums', ev: drums([A, N, N, N, A, N, N, F]), vel: 0.9 },
    ] };
  }

  function victory() {
    return { bpm: 140, steps: 48, once: true, tracks: [
      { patch: 'brass', ev: FM.parseBars([
        'G4 - G4 - G4 - C5 - - - - - E5 - G5 -',
        'C6 - - - - - A5 - B5 - - - G5 - - -',
        'C6 - - - - - - - - - - - . . . .']) },
      { patch: 'strings', vel: 0.7, ev: [['C', 0, 12], ['F', 16, 8], ['G', 24, 8], ['C', 32, 14]]
        .flatMap(([c, s, l]) => FM.chord(c).map((m) => ({ step: s, len: l, midi: m + 12 }))) },
      { patch: 'bass', ev: [{ step: 0, len: 12, midi: 36 }, { step: 16, len: 8, midi: 41 }, { step: 24, len: 8, midi: 43 }, { step: 32, len: 14, midi: 36 }] },
      { patch: 'orchhit', ev: hits([[16, 'F3'], [24, 'G3'], [32, 'C4']]) },
      { ev: drums(['S s s s S s s s S s s s S s S s', 'KC . . . S . . . KC . . . S . S S', 'KCT . . . . . . . . . . . . . . .']) },
    ] };
  }

  function defeat() {
    return { bpm: 80, steps: 32, once: true, tracks: [
      { patch: 'strings', ev: FM.parseBars(['E5 - - - D5 - - - C5 - - - B4 - - -', 'A4 - - - - - - - - - - - . . . .']) },
      { patch: 'organ', vel: 0.6, ev: [['Am', 0, 8], ['E', 8, 8], ['Am', 16, 14]].flatMap(([c, s, l]) => FM.chord(c).map((m) => ({ step: s, len: l, midi: m }))) },
      { patch: 'bass', ev: [{ step: 0, len: 8, midi: 33 }, { step: 8, len: 8, midi: 28 }, { step: 16, len: 14, midi: 33 }] },
      { ev: drums(['t t t t t t t t t t t t t t t t', 'TC . . . . . . . . . . . . . . .']), vel: 0.7 },
    ] };
  }

  function defineSfx() {
    FM.defineSfx('mg', [0, 1, 2, 3, 4, 5].map((i) => ['noise', 1500, i * 0.075, 0.05, 0.5, 0.4]));
    FM.defineSfx('cannon', [['bigboom', 110, 0, 0.8, 1, 0.3], ['noise', 2600, 0, 0.15, 0.7, 0.3]]);
    FM.defineSfx('artfire', [['bigboom', 75, 0, 1.0, 1, 0.3], ['noise', 1800, 0, 0.25, 0.8, 0.3]]);
    FM.defineSfx('incoming', [['whistle', 2200, 0, 0.6, 0.45, 0.45]]);
    FM.defineSfx('flak', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ['boom', 520, i * 0.06, 0.06, 0.55, 0.5]));
    FM.defineSfx('missile', [['noise', 500, 0, 0.7, 0.55, 3], ['zap', 300, 0, 0.5, 0.35, 4]]);
    FM.defineSfx('bombdrop', [['whistle', 1600, 0, 0.7, 0.45, 0.4]]);
    FM.defineSfx('tread', [['noise', 70, 0, 0.55, 0.55, 1.4], ['clank', 280, 0.08, 0.04, 0.25, 0], ['clank', 260, 0.24, 0.04, 0.25, 0], ['clank', 300, 0.4, 0.04, 0.25, 0]]);
    FM.defineSfx('march', [0, 1, 2, 3].map((i) => ['tom', 110 + (i % 2) * 20, i * 0.13, 0.06, 0.45, 0.5]));
    FM.defineSfx('jet', [['noise', 350, 0, 0.9, 1, 3], ['noise', 1400, 0.25, 0.6, 0.7, 0.4], ['zap', 200, 0, 0.8, 0.3, 3]]);
    FM.defineSfx('capture', [['crash', 7000, 0.36, 1.2, 0.5, 0], ['brass', 'C5', 0, 0.12, 0.8, 0], ['brass', 'E5', 0.12, 0.12, 0.8, 0], ['brass', 'G5', 0.24, 0.12, 0.8, 0], ['brass', 'C6', 0.36, 0.5, 0.9, 0], ['bell', 'C7', 0.36, 0.5, 0.5, 0]]);
    FM.defineSfx('turn', [['orchhit', 'C4', 0.24, 0.5, 0.6, 0], ['brass', 'G4', 0, 0.1, 0.7, 0], ['brass', 'G4', 0.12, 0.1, 0.7, 0], ['brass', 'C5', 0.24, 0.45, 0.85, 0], ['brass', 'E5', 0.24, 0.45, 0.6, 0]]);
    FM.defineSfx('build', [['clank', 600, 0, 0.05, 0.5, 0], ['clank', 800, 0.08, 0.05, 0.5, 0], ['bell', 'E6', 0.16, 0.3, 0.8, 0], ['bell', 'B6', 0.24, 0.4, 0.6, 0]]);
    FM.defineSfx('destroy', [['bigboom', 100, 0, 1.4, 1, 0.2], ['boom', 260, 0.12, 0.6, 0.8, 0.25, -1], ['boom', 160, 0.3, 0.7, 0.8, 0.25, 1], ['noise', 900, 0.05, 0.8, 0.5, 0.3]]);
    FM.defineSfx('cursor', [['blip', 1200, 0, 0.03, 0.25, 0]]);
  }

  const SONGS = { blue: blueTheme, red: redTheme, victory, defeat };
  const built = {};

  return {
    get ready() { return ready; },
    async init() {
      if (ready) return;
      await FM.init({ musicVoices: 20, sfxVoices: 16, echo: 0.1 });
      FM.setVolume({ music: 0.55, sfx: 0.9 });
      // PCM を切ったとき用の FM 版クラッシュ／オケヒット
      const oh = FM.PATCHES.ohat;
      FM.addPatches({
        crash: { ...oh, vol: 0.12, ops: oh.ops.map((o, i) => (i === 3 ? { ...o, dr: 1.2, rr: 0.5 } : o)) },
        orchhit: { ...FM.PATCHES.brass, vol: 0.3 },
      });
      FM.DRUM_MAP.c = ['crash', 7000, 1.5, 0];
      await PCM.init({ reverbMusic: 0.3, reverbSfx: 0.16 });
      defineSfx();
      ready = true;
    },
    bgm(name, opts) {
      if (!ready) return;
      const key = name + JSON.stringify(opts || {});
      if (current === key) return;
      current = key;
      built[name] = built[name] || SONGS[name]();
      FM.play(built[name], opts);
    },
    stop() { current = null; if (ready) FM.stop(); },
    sfx(name, x) { if (ready) FM.play_sfx(name, x == null ? {} : { x, width: 1 }); },
    togglePcm() { PCM.enabled = !PCM.enabled; return PCM.enabled; },
    toggleMute() { return ready ? FM.toggleMute() : false; },
  };
})();
