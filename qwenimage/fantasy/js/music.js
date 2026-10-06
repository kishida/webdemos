// BGM / ジングル / 効果音の定義（FM 音源）
'use strict';

const Music = (() => {
  const P = (bars, spb = 16) => FM.parseBars(bars, spb);
  const chordsEv = (prog, steps, len, unit = 16) => prog.flatMap((c, i) =>
    steps.flatMap((s) => FM.chord(c).map((m) => ({ step: i * unit + s, len, midi: m }))));
  const bassLine = (prog, stepEvery, oct = true, octave = 2, unit = 16) =>
    FM.accomp(prog, { unit, bassStep: stepEvery, bassOct: oct, bassOctave: octave, chordSteps: [] }).bass;

  function addPatches() {
    FM.addPatches({
      flute: { alg: 4, fb: 3, vol: 0.16, vib: 0.009, ops: [
        FM.op(1, 0.12, 0.04, 0.5, 0.7, 0.15), FM.op(1, 0.7, 0.04, 0.6, 0.85, 0.2),
        FM.op(2, 0.15, 0.04, 0.5, 0.6, 0.15), FM.op(1, 0.45, 0.04, 0.6, 0.85, 0.2, 0.003)] },
      harp: { alg: 4, fb: 0, vol: 0.2, ops: [
        FM.op(2, 0.5, 0.001, 0.4, 0, 0.3), FM.op(1, 0.8, 0.001, 1.4, 0, 0.6),
        FM.op(4, 0.2, 0.001, 0.2, 0, 0.2), FM.op(1, 0.5, 0.001, 1.0, 0, 0.5, 0.002)] },
      pad: { alg: 7, fb: 0, vol: 0.07, vib: 0.006, ops: [
        FM.op(1, 0.4, 0.6, 1, 0.9, 0.8), FM.op(1, 0.4, 0.6, 1, 0.9, 0.8, 0.004),
        FM.op(2, 0.2, 0.6, 1, 0.9, 0.8, -0.004), FM.op(0.5, 0.3, 0.6, 1, 0.9, 0.8)] },
    });
  }

  const SONGS = {
    // タイトル：ハ長調の勇壮な曲
    title() {
      const prog = ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G'];
      return { bpm: 100, steps: 128, tracks: [
        { name: 'lead', patch: 'brass', ev: P([
          'C5 - - - - - G4 - C5 - D5 - E5 - - -',
          'D5 - - - - - B4 - G4 - - - - - - -',
          'C5 - - - E5 - - - A5 - - - G5 - E5 -',
          'G5 - - - - - - - B4 - - - E5 - - -',
          'F5 - - - E5 - - - D5 - - - C5 - - -',
          'E5 - - - - - - - G5 - - - C6 - - -',
          'D5 - - - F5 - - - A5 - - - F5 - D5 -',
          'G5 - - - - - - - - - - - . . . .']), pan: 0.1 },
        { name: 'str', patch: 'strings', ev: chordsEv(prog, [0], 16), pan: -0.3 },
        { name: 'arp', patch: 'harp', ev: FM.arpeggio(prog, { pattern: [0, 1, 2, 3, 2, 1, 0, 1], octave: 0 }).filter((e) => e.step % 2 === 0).map((e) => ({ ...e, len: 2 })), vel: 0.4, pan: 0.35 },
        { name: 'bass', patch: 'bass', ev: bassLine(prog, 4), vel: 0.8 },
        { name: 'drums', ev: FM.parseDrums('k . . . t . . . k . k . t . t t', 8), vel: 0.6 },
      ] };
    },
    // フィールド：ニ長調の冒険曲
    field() {
      const prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'Bm', 'G', 'A', 'D', 'Bm', 'G', 'E', 'A'];
      const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [2, 6, 10, 14], chordLen: 2 });
      return { bpm: 138, steps: 256, tracks: [
        { name: 'lead', patch: 'brass', ev: P([
          'D5 - - - A4 - D5 - F#5 - - - E5 - D5 -',
          'E5 - - - - - C#5 - A4 - - - - - - -',
          'B4 - - - D5 - F#5 - B5 - - - A5 - F#5 -',
          'G5 - - - - - F#5 - E5 - - - D5 - E5 -',
          'F#5 - - - A5 - - - D6 - - - C#6 - B5 -',
          'A5 - - - - - E5 - C#5 - - - E5 - - -',
          'D5 - - - B4 - D5 - G5 - - - F#5 - E5 -',
          'E5 - - - - - - - . . . . A4 - C#5 -',
          'D5 - - - - - C#5 - B4 - - - F#4 - - -',
          'G4 - - - B4 - D5 - G5 - - - F#5 - E5 -',
          'E5 - - - - - C#5 - A4 - - - C#5 - E5 -',
          'F#5 - - - - - - - D5 - - - . . . .',
          'B5 - - - A5 - F#5 - D5 - - - F#5 - B5 -',
          'D6 - - - B5 - G5 - D5 - - - G5 - B5 -',
          'G#5 - - - - - E5 - B4 - - - E5 - G#5 -',
          'A5 - - - - - - - E5 - - - C#5 - - -']), pan: 0.1 },
        { name: 'bass', patch: 'bass', ev: acc.bass },
        { name: 'chords', patch: 'strings', ev: chordsEv(prog, [0, 8], 7), vel: 0.8, pan: -0.3 },
        { name: 'arp', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 1, 2, 1], octave: 12 }).filter((e) => e.step % 2 === 1), vel: 0.22, pan: 0.4 },
        { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . k h s . h o', 16), vel: 0.8 },
      ] };
    },
    // 城：ヘ長調のおごそかなメヌエット
    castle() {
      const prog = ['F', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'F'];
      return { bpm: 92, steps: 128, tracks: [
        { name: 'lead', patch: 'flute', ev: P([
          'F5 - - - - - - - A5 - - - C6 - - -',
          'D6 - - - C6 - Bb5 - A5 - - - G5 - - -',
          'A5 - - - - - G5 - F5 - - - A5 - - -',
          'G5 - - - - - - - - - - - . . . .',
          'F5 - - - - - E5 - D5 - - - A5 - - -',
          'Bb5 - - - A5 - G5 - F5 - - - D5 - - -',
          'E5 - - - - - G5 - C6 - - - Bb5 - G5 -',
          'F5 - - - - - - - - - - - . . . .']), pan: 0.15 },
        { name: 'org', patch: 'organ', ev: chordsEv(prog, [0, 8], 6), vel: 0.9, pan: -0.25 },
        { name: 'harp', patch: 'harp', ev: FM.arpeggio(prog, { pattern: [0, 1, 2, 3], octave: 0 }).filter((e) => e.step % 2 === 0).map((e) => ({ ...e, len: 2 })), vel: 0.35, pan: 0.4 },
        { name: 'bass', patch: 'bass', ev: bassLine(prog, 8, false), vel: 0.7 },
      ] };
    },
    // 街：ト長調の陽気な曲
    town() {
      const prog = ['G', 'C', 'D', 'G', 'Em', 'C', 'D7', 'G'];
      const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [4, 12], chordLen: 2 });
      return { bpm: 116, steps: 128, tracks: [
        { name: 'lead', patch: 'epiano', ev: P([
          'B4 - D5 - G5 - D5 - B4 - D5 - G5 - - -',
          'E5 - - - G5 - - - E5 - C5 - - - - -',
          'F#5 - - - A5 - - - F#5 - D5 - A4 - - -',
          'G5 - - - - - - - . . . . D5 - - -',
          'E5 - G5 - B5 - - - G5 - E5 - - - B4 -',
          'C5 - E5 - G5 - - - E5 - C5 - - - - -',
          'D5 - - - F#5 - A5 - C6 - - - B5 - A5 -',
          'G5 - - - - - - - . . . . . . . .']), pan: 0.1 },
        { name: 'flute', patch: 'flute', ev: P([
          '. . . . . . . . . . . . . . . .', '. . . . . . . . . . . . . . . .',
          '. . . . . . . . . . . . . . . .', '. . . . . . . . B5 - A5 - G5 - F#5 -',
          '. . . . . . . . . . . . . . . .', '. . . . . . . . . . . . . . . .',
          '. . . . . . . . . . . . . . . .', '. . . . B5 - A5 - G5 - - - - - - -']), vel: 0.7, pan: -0.3 },
        { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.85 },
        { name: 'chords', patch: 'harp', ev: acc.chords, vel: 0.45, pan: -0.2 },
        { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . h . s . h h', 8), vel: 0.55 },
      ] };
    },
    // 洞窟：ニ短調の重い曲
    cave() {
      const prog = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A'];
      return { bpm: 84, steps: 128, tracks: [
        { name: 'lead', patch: 'flute', ev: P([
          'D5 - - - - - - - F5 - - - E5 - - -',
          'D5 - - - - - - - - - - - . . . .',
          'G4 - - - Bb4 - - - D5 - - - C5 - - -',
          'C#5 - - - - - - - - - - - . . . .',
          'A5 - - - - - - - G5 - - - F5 - - -',
          'F5 - - - - - D5 - - - - - . . . .',
          'Bb4 - - - D5 - - - G5 - - - F5 - - -',
          'E5 - - - - - - - C#5 - - - A4 - - -']), vel: 0.8 },
        { name: 'pad', patch: 'pad', ev: chordsEv(prog, [0], 16), pan: -0.2 },
        { name: 'bell', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 2, 1, 2], octave: 12 }).filter((e) => e.step % 4 === 2), vel: 0.18, pan: 0.45 },
        { name: 'bass', patch: 'bass', ev: bassLine(prog, 8, true, 1), vel: 0.9 },
        { name: 'drums', ev: FM.parseDrums('k . . . . . . . t . . . . . . .', 8), vel: 0.5 },
      ] };
    },
    // 通常戦闘：ホ短調の速い曲
    battle() {
      const prog = ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B'];
      const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [2, 6, 10, 14], chordLen: 1 });
      return { bpm: 168, steps: 128, tracks: [
        { name: 'lead', patch: 'lead', ev: P([
          'E5 - - - B4 - E5 - G5 - - - F#5 - E5 -',
          'G5 - - - - - E5 - C5 - - - E5 - G5 -',
          'F#5 - - - - - D5 - A4 - - - D5 - F#5 -',
          'D#5 - - - - - - - B4 - - - D#5 - F#5 -',
          'G5 - - - F#5 - G5 - B5 - - - A5 - G5 -',
          'E5 - - - - - G5 - C6 - - - B5 - A5 -',
          'A5 - - - - - E5 - C5 - - - E5 - A5 -',
          'B5 - - - - - - - D#5 - F#5 - B4 - - -']), pan: 0.1 },
        { name: 'bass', patch: 'slapbass', ev: acc.bass, vel: 0.9 },
        { name: 'chords', patch: 'brass', ev: acc.chords, vel: 0.35, pan: -0.3 },
        { name: 'drums', ev: FM.parseDrums('k . h k s . h . k . k h s . h o', 8), vel: 0.85 },
      ] };
    },
    // ボス戦：ハ短調
    boss() {
      const prog = ['Cm', 'Ab', 'Bb', 'G', 'Cm', 'Ab', 'Fm', 'G'];
      return { bpm: 176, steps: 128, tracks: [
        { name: 'lead', patch: 'lead', ev: P([
          'C5 - - C5 - - Eb5 - G5 - - - Gb5 - G5 -',
          'Ab5 - - - G5 - Eb5 - C5 - - - Eb5 - Ab5 -',
          'Bb5 - - - Ab5 - F5 - D5 - - - F5 - Bb5 -',
          'B5 - - - - - - - G5 - - - B4 - D5 -',
          'C6 - - - Bb5 - G5 - Eb5 - - - G5 - C6 -',
          'Eb6 - - - C6 - Ab5 - Eb5 - - - C6 - Ab5 -',
          'F5 - - - Ab5 - C6 - F6 - - - Eb6 - C6 -',
          'D6 - - - - - B5 - G5 - - - F5 - D5 -']), pan: 0.1 },
        { name: 'bass', patch: 'bass', ev: bassLine(prog, 1, true) },
        { name: 'org', patch: 'organ', ev: chordsEv(prog, [0, 6, 12], 3), vel: 0.8, pan: -0.3 },
        { name: 'drums', ev: FM.parseDrums('k h s h k h s h k h s h k s s s', 8), vel: 0.85 },
      ] };
    },
    // エンディング：タイトル曲のゆったりアレンジ
    ending() {
      const s = SONGS.title(); s.bpm = 84;
      s.tracks[0].patch = 'flute';
      s.tracks.push({ name: 'bell', patch: 'bell', ev: s.tracks[0].ev.map((e) => ({ ...e, midi: e.midi + 12 })), vel: 0.18, pan: -0.4 });
      s.tracks = s.tracks.filter((t) => t.name !== 'drums');
      return s;
    },
    // ---- ジングル（1回再生） ----
    victory() {
      return { bpm: 150, steps: 32, once: true, tracks: [
        { patch: 'brass', ev: P(['G4 - C5 - E5 - G5 - - - E5 - G5 - - -', 'C6 - - - - - - - - - - - . . . .']) },
        { patch: 'strings', ev: chordsEv(['C', 'C'], [0], 14) },
        { patch: 'bass', ev: [{ step: 0, len: 8, midi: 36 }, { step: 8, len: 6, midi: 43 }, { step: 16, len: 12, midi: 36 }] },
      ] };
    },
    levelup() {
      return { bpm: 160, steps: 24, once: true, tracks: [
        { patch: 'brass', ev: P(['C5 E5 G5 C6 E6 - - - G6 - - - - - - -', '. . . . . . . .'], 0) },
        { patch: 'bell', ev: P(['C6 E6 G6 C7 E7 - - - G7 - - - - - - -', '. . . . . . . .'], 0), vel: 0.4 },
      ] };
    },
    inn() {
      return { bpm: 90, steps: 40, once: true, tracks: [
        { patch: 'flute', ev: P(['E5 - - - G5 - - - C6 - - - B5 - - -', 'C6 - - - - - - - - - - - . . . .', '. . . . . . . .'], 0) },
        { patch: 'strings', ev: chordsEv(['C', 'C'], [0], 14) },
      ] };
    },
    itemget() {
      return { bpm: 150, steps: 24, once: true, tracks: [
        { patch: 'brass', ev: P(['G5 - A5 - B5 - D6 - - - - - - - - -', '. . . . . . . .'], 0) },
        { patch: 'strings', ev: chordsEv(['G'], [6], 10) },
      ] };
    },
    gameover() {
      return { bpm: 70, steps: 40, once: true, tracks: [
        { patch: 'flute', ev: P(['A4 - - - G4 - - - F4 - - - E4 - - -', 'D4 - - - - - - - - - - - . . . .', '. . . . . . . .'], 0) },
        { patch: 'pad', ev: chordsEv(['Am', 'Dm'], [0], 14) },
      ] };
    },
  };

  function defineSfx() {
    FM.defineSfx('cursor', [['blip', 900, 0, 0.04, 0.35, 0]]);
    FM.defineSfx('attack', [['noise', 3000, 0, 0.12, 0.7, 0.3], ['clank', 900, 0.03, 0.08, 0.5, 0]]);
    FM.defineSfx('enemyhit', [['clank', 700, 0, 0.1, 0.8, 0.5], ['boom', 260, 0, 0.2, 0.5, 0.4]]);
    FM.defineSfx('crit', [['zap', 1200, 0, 0.1, 0.8, 2], ['boom', 220, 0.05, 0.35, 0.9, 0.3], ['clank', 1400, 0.05, 0.12, 0.7, 0]]);
    FM.defineSfx('magic', [['zap', 300, 0, 0.45, 0.6, 5], ['bell', 'E6', 0.1, 0.25, 0.5, 0], ['bell', 'B6', 0.2, 0.3, 0.5, 0]]);
    FM.defineSfx('fire', [['noise', 900, 0, 0.6, 0.9, 0.4], ['boom', 300, 0.1, 0.5, 0.7, 0.4]]);
    FM.defineSfx('heal', [0, 4, 7, 12].map((n, i) => ['bell', FM.mtof(79 + n), i * 0.06, 0.3, 0.6, 0]));
    FM.defineSfx('door', [['clank', 300, 0, 0.2, 0.7, 0.6], ['tom', 120, 0.05, 0.3, 0.6, 0.6]]);
    FM.defineSfx('stairs', [0, 1, 2, 3].map((i) => ['tom', 200 - i * 25, i * 0.09, 0.12, 0.6, 0.7]));
    FM.defineSfx('bump', [['tom', 110, 0, 0.1, 0.5, 0.6]]);
    FM.defineSfx('run', [['noise', 1500, 0, 0.12, 0.5, 2], ['noise', 1500, 0.12, 0.12, 0.5, 2], ['noise', 1500, 0.24, 0.12, 0.5, 2]]);
    FM.defineSfx('encounter', [['zap', 200, 0, 0.5, 0.7, 6], ['zap', 300, 0.15, 0.5, 0.6, 6]]);
    FM.defineSfx('roar', [['bigboom', 70, 0, 1.4, 1, 0.5], ['noise', 400, 0, 1.2, 0.7, 0.4]]);
    FM.defineSfx('miss', [['blip', 400, 0, 0.12, 0.5, 0.6]]);
  }

  let current = null;
  return {
    init() { addPatches(); defineSfx(); },
    play(name) {
      if (!FM.ready || current === name) return;
      current = name;
      FM.play(SONGS[name]());
    },
    jingle(name, then) {
      if (!FM.ready) { if (then) then(); return; }
      current = null;
      FM.onSongEnd = () => { FM.onSongEnd = null; if (then) then(); };
      FM.play(SONGS[name]());
    },
    stop() { current = null; if (FM.ready) FM.stop(); },
    get current() { return current; },
    SONGS,
  };
})();
