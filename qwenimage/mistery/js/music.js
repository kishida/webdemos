// 霧雨館殺人事件 — BGM と効果音（FM音源）
const Music = (() => {
  const chordsAt = (prog, unit, steps, len, opts = {}) => prog.flatMap((c, i) =>
    steps.flatMap((s) => FM.chord(c, opts.low || 60, opts.high || 72).map((m) => ({ step: i * unit + s, len, midi: m + (opts.shift || 0) }))));
  const rootsAt = (prog, unit, steps, len, oct = 2) => prog.flatMap((c, i) =>
    steps.map((s) => ({ step: i * unit + s, len, midi: FM.chordRoot(c, oct) })));
  const up = (ev, n) => ev.map((e) => ({ ...e, midi: e.midi + n }));

  // タイトル：嵐の夜のワルツ（3拍子 = 1小節12ステップ）
  function title() {
    const prog = ['Dm', 'Gm', 'A7', 'Dm', 'Bb', 'Gm', 'A', 'A7', 'F', 'C', 'Dm', 'A', 'Bb', 'Gm', 'A7', 'Dm'];
    const mel = FM.parseBars([
      'D5 - - - - - - - E5 - F5 -', 'G5 - - - - - Bb5 - - - A5 -', 'A5 - - - - - E5 - - - C#5 -', 'D5 - - - - - - - - - . .',
      'F5 - - - - - D5 - - - Bb4 -', 'G4 - - - Bb4 - D5 - - - G5 -', 'E5 - - - - - C#5 - - - A4 -', 'C#5 - - - - - - - - - . .',
      'A5 - - - G5 - F5 - - - E5 -', 'E5 - - - D5 - C5 - - - G4 -', 'F5 - - - E5 - D5 - - - A5 -', 'C#6 - - - - - A5 - - - E5 -',
      'D5 - - - F5 - Bb5 - - - A5 -', 'G5 - - - F5 - E5 - - - D5 -', 'C#5 - - - E5 - A5 - - - G5 -', 'D5 - - - - - - - - - . .',
    ], 12);
    return { bpm: 88, steps: 192, tracks: [
      { name: 'bass', patch: 'bass', ev: rootsAt(prog, 12, [0], 4), vel: 0.9 },
      { name: 'waltz', patch: 'organ', ev: chordsAt(prog, 12, [4, 8], 3), vel: 0.35, pan: -0.25 },
      { name: 'pad', patch: 'strings', ev: chordsAt(prog, 12, [0], 12, { low: 55, high: 67 }), vel: 0.3, pan: 0.25 },
      { name: 'lead', patch: 'epiano', ev: mel, vel: 0.9 },
      { name: 'bell', patch: 'bell', ev: up(mel, 12), vel: 0.18, pan: 0.4 },
    ] };
  }

  // 捜査：静かで不穏
  function invest() {
    const prog = ['Am', 'Am', 'F', 'E7', 'Dm', 'Am', 'Dm', 'E7'];
    const mel = FM.parseBars([
      'E5 - - - . . . . C5 - D5 - E5 - . .', 'A4 - - - - - - - . . . . . . . .',
      'F5 - - - . . E5 - D5 - - - C5 - . .', 'B4 - - - - - - - G#4 - - - . . . .',
      'D5 - - - . . F5 - A5 - - - G5 - F5 -', 'E5 - - - - - - - C5 - - - A4 - . .',
      'F5 - - - E5 - D5 - . . C5 - B4 - . .', 'G#4 - - - - - - - - - - - . . . .',
    ]);
    const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [2, 10], chordLen: 3 });
    return { bpm: 84, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.75 },
      { name: 'chords', patch: 'epiano', ev: acc.chords, vel: 0.32, pan: -0.3 },
      { name: 'lead', patch: 'epiano', ev: mel, vel: 0.75, pan: 0.15 },
      { name: 'echo', patch: 'bell', ev: up(mel, 12).map((e) => ({ ...e, step: (e.step + 3) % 128 })), vel: 0.12, pan: 0.5 },
      { name: 'drums', ev: FM.parseDrums('k . h . . . h . k . h . . . h h', 8), vel: 0.3 },
    ] };
  }

  // 推理・対決：緊迫
  function tension() {
    const prog = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A7'];
    const mel = FM.parseBars([
      'D5 - - - A4 - - - D5 - E5 - F5 - - -', 'E5 - - - D5 - - - A4 - - - - - - -',
      'Bb4 - - - F5 - - - Bb5 - - - A5 - G5 -', 'A5 - - - - - - - E5 - - - C#5 - - -',
      'D5 - - - A4 - - - D5 - E5 - F5 - G5 -', 'A5 - - - G5 - F5 - E5 - F5 - D5 - - -',
      'G5 - - - Bb5 - - - D6 - - - Bb5 - G5 -', 'A5 - - - - - - - C#6 - - - E6 - - -',
    ]);
    const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [0], chordLen: 16 });
    return { bpm: 138, steps: 128, tracks: [
      { name: 'bass', patch: 'slapbass', ev: acc.bass, vel: 0.85 },
      { name: 'pad', patch: 'strings', ev: acc.chords, vel: 0.35, pan: -0.3 },
      { name: 'stab', patch: 'brass', ev: chordsAt(prog, 16, [6, 14], 1), vel: 0.25, pan: 0.3 },
      { name: 'lead', patch: 'brass', ev: mel, vel: 0.8 },
      { name: 'drums', ev: FM.parseDrums('k . h . s . h . k k h . s . h h', 8), vel: 0.55 },
    ] };
  }

  // 異変：張りつめた静けさ（心音のようなキック）
  function suspense() {
    const prog = ['Cm', 'Ab', 'Fm', 'G'];
    const bell = [['G6', 0], ['Eb6', 12], ['C6', 20], ['Ab5', 32], ['F6', 40], ['B5', 48], ['D6', 60]]
      .map(([n, s]) => ({ step: s, len: 3, midi: FM.noteToMidi(n) }));
    return { bpm: 66, steps: 64, tracks: [
      { name: 'pad', patch: 'strings', ev: chordsAt(prog, 16, [0], 16, { low: 55, high: 67 }), vel: 0.45 },
      { name: 'bass', patch: 'bass', ev: rootsAt(prog, 16, [0, 8], 7, 1), vel: 0.7 },
      { name: 'bell', patch: 'bell', ev: bell, vel: 0.25, pan: 0.4 },
      { name: 'beat', ev: FM.parseDrums('k . . k . . . . . . . . . . . .', 4), vel: 0.5 },
    ] };
  }

  // どんでん返しの瞬間
  function shock() {
    const dim = FM.chord('Cdim', 60, 72);
    return { bpm: 120, steps: 32, once: true, tracks: [
      { patch: 'brass', ev: dim.flatMap((m) => [{ step: 0, len: 2, midi: m }, { step: 4, len: 26, midi: m - 1 }]), vel: 0.8 },
      { patch: 'strings', ev: dim.map((m) => ({ step: 4, len: 28, midi: m + 11 })), vel: 0.5 },
      { patch: 'bass', ev: [{ step: 0, len: 2, midi: 36 }, { step: 4, len: 28, midi: 35 }] },
      { ev: [{ step: 0, drum: 'k' }, { step: 0, drum: 's' }, { step: 4, drum: 'k' }, { step: 4, drum: 't' }] },
    ] };
  }

  // 告白：哀しみ
  function sad() {
    const prog = ['Am', 'F', 'C', 'G', 'F', 'C', 'Dm', 'E7'];
    const mel = FM.parseBars([
      'E5 - - - - - D5 - C5 - - - B4 - A4 -', 'A4 - - - - - - - C5 - - - F5 - - -',
      'E5 - - - - - G5 - - - E5 - C5 - - -', 'D5 - - - - - - - - - - - . . . .',
      'C5 - - - - - A4 - F5 - - - E5 - D5 -', 'E5 - - - - - - - G4 - - - C5 - - -',
      'D5 - - - F5 - - - A5 - - - G5 - F5 -', 'E5 - - - - - - - G#4 - - - B4 - - -',
    ]);
    const acc = FM.accomp(prog, { bassStep: 8, bassOct: false, chordSteps: [0, 4, 8, 12], chordLen: 4 });
    return { bpm: 68, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.6 },
      { name: 'chords', patch: 'epiano', ev: acc.chords, vel: 0.28, pan: -0.3 },
      { name: 'lead', patch: 'strings', ev: mel, vel: 0.85, pan: 0.1 },
      { name: 'bell', patch: 'bell', ev: up(mel, 12), vel: 0.1, pan: 0.4 },
    ] };
  }

  // エンディング：夜明け
  function ending() {
    const prog = ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G'];
    const mel = FM.parseBars([
      'E5 - - - G5 - - - C6 - - - B5 - G5 -', 'D5 - - - - - - - G5 - - - - - - -',
      'C5 - - - E5 - A5 - - - G5 - E5 - - -', 'B4 - - - - - - - G4 - - - . . . .',
      'A4 - - - C5 - F5 - - - E5 - D5 - C5 -', 'E5 - - - - - - - G5 - - - C6 - - -',
      'A5 - - - G5 - F5 - - - E5 - D5 - - -', 'D5 - - - - - - - - - - - . . . .',
    ]);
    const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [0], chordLen: 16 });
    return { bpm: 96, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.7 },
      { name: 'pad', patch: 'strings', ev: acc.chords, vel: 0.35, pan: -0.3 },
      { name: 'arp', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 1, 2, 1], octave: 12 }), vel: 0.2, pan: 0.4 },
      { name: 'lead', patch: 'epiano', ev: mel, vel: 0.85 },
      { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . h . s . h .', 8), vel: 0.3 },
    ] };
  }

  function gameover() {
    return { bpm: 72, steps: 32, once: true, tracks: [
      { patch: 'strings', ev: FM.parseBars(['A4 - - - G#4 - - - G4 - - - F#4 - - -', 'F4 - - - - - - - - - - - - - . .']) },
      { patch: 'bass', ev: [{ step: 0, len: 16, midi: 45 }, { step: 16, len: 14, midi: 40 }] },
    ] };
  }

  const SONGS = { title, invest, tension, suspense, shock, sad, ending, gameover };
  const cache = {};
  let current = null;
  let started = false;

  async function init() {
    if (started) return;
    started = true;
    await FM.init({ musicVoices: 24, sfxVoices: 12, echo: 0.25 });
    FM.defineSfx('thunder', [['bigboom', 70, 0, 2.2, 1, 0.4], ['noise', 900, 0, 1.4, 0.5, 0.3], ['boom', 140, 0.25, 1.4, 0.8, 0.5]]);
    FM.defineSfx('door', [['clank', 300, 0, 0.15, 0.7, 0.6], ['boom', 120, 0.05, 0.3, 0.5, 0.5]]);
    FM.defineSfx('tape', [['clank', 1400, 0, 0.05, 0.6, 0], ['clank', 900, 0.09, 0.05, 0.5, 0], ['noise', 3000, 0.15, 0.6, 0.15, 1]]);
    FM.defineSfx('power', [['zap', 120, 0, 0.5, 0.6, 3], ['bell', 'C7', 0.35, 0.25, 0.4, 0]]);
    FM.defineSfx('reveal', [['bigboom', 100, 0, 0.8, 0.9, 0.3], ['brass', 'D5', 0, 0.6, 1, 0], ['brass', 'A5', 0, 0.6, 0.9, 0], ['brass', 'D6', 0, 0.6, 0.8, 0]]);
    FM.defineSfx('page', [['blip', 1200, 0, 0.04, 0.3, 0.8]]);
    FM.defineSfx('step', [['boom', 90, 0, 0.12, 0.5, 0.6], ['boom', 80, 0.35, 0.12, 0.45, 0.6]]);
  }

  function play(name) {
    if (!FM.ready) { current = name; return; }
    if (name === current && FM.song && !FM.song.once) return;
    current = name;
    if (!name) { FM.stop(); return; }
    cache[name] = cache[name] || SONGS[name]();
    FM.play(cache[name]);
  }
  function se(name) { if (FM.ready) FM.play_sfx(name); }
  return { init, play, se, SONGS, get current() { return current; } };
})();
