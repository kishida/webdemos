// FM BGM and sound effects (uses global FM from fm-audio.js).
const FM = window.FM;

// 16th-note driving bass: root on beats, octave in between
function bass16(prog, oct = 36, pattern = [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12]) {
  const ev = [];
  prog.forEach((c, bar) => {
    const root = FM.chord(c)[0] % 12 + oct;
    pattern.forEach((o, i) => ev.push({ step: bar * 16 + i, len: 1, midi: root + o, vel: i % 4 === 0 ? 1 : 0.75 }));
  });
  return ev;
}
const pads = (prog, len = 16) => prog.flatMap((c, i) => FM.chord(c).map((m) => ({ step: i * 16, len, midi: m })));

export function buildSongs() {
  const S = {};

  // ---- title / ending ----
  {
    const prog = ['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'C'];
    const lead = FM.parseBars([
      'C5 - - - - - G4 - C5 - E5 - G5 - - -',
      'G5 - - - F5 - E5 - D5 - - - B4 - - -',
      'C5 - - - E5 - A5 - - - G5 - E5 - C5 -',
      'F5 - - - - - E5 - D5 - C5 - A4 - - -',
      'C5 - - - - - G4 - C5 - E5 - G5 - C6 -',
      'A5 - - - - - G5 - F5 - E5 - F5 - A5 -',
      'G5 - - - - - - - D5 - E5 - F5 - D5 -',
      'C5 - - - - - - - - - - - . . . .',
    ]);
    const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [0, 8], chordLen: 8 });
    S.title = { bpm: 92, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass },
      { name: 'pad', patch: 'strings', ev: pads(prog), vel: 0.5, pan: -0.2 },
      { name: 'arp', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 1, 2, 1], octave: 12 }), vel: 0.25, pan: 0.4 },
      { name: 'lead', patch: 'brass', ev: lead, pan: 0.1 },
      { name: 'drums', ev: FM.parseDrums('k . . . t . . . k . k . t . t .', 8), vel: 0.7 },
    ] };
  }

  // ---- town ----
  {
    const prog = ['F', 'C', 'Dm', 'A#', 'F', 'C', 'A#', 'C'];
    const lead = FM.parseBars([
      'A4 - C5 - F5 - - - E5 - D5 - C5 - - -',
      'G4 - - - C5 - E5 - G5 - - - E5 - - -',
      'F5 - - - E5 - D5 - A4 - - - D5 - - -',
      'D5 - - - C5 - A#4 - - - A4 - A#4 - D5 -',
      'C5 - - - F5 - A5 - - - G5 - F5 - - -',
      'E5 - - - G5 - - - C5 - - - E5 - G5 -',
      'F5 - - - D5 - - - A#4 - - - D5 - F5 -',
      'E5 - - - - - - - G5 - - - - - - -',
    ]);
    const acc = FM.accomp(prog, { bassStep: 4, bassOct: true, chordSteps: [4, 12], chordLen: 3 });
    S.town = { bpm: 104, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.8 },
      { name: 'chords', patch: 'epiano', ev: acc.chords, vel: 0.55, pan: -0.3 },
      { name: 'arp', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 2, 1, 2], octave: 12 }), vel: 0.22, pan: 0.45 },
      { name: 'lead', patch: 'epiano', ev: lead, pan: 0.1 },
      { name: 'drums', ev: FM.parseDrums('k . h . . . h . k . h . . . h h', 8), vel: 0.5 },
    ] };
  }

  // ---- field ----
  {
    const prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bm', 'A'];
    const lead = FM.parseBars([
      'D5 - - A4 D5 - F#5 - A5 - - - F#5 - D5 -',
      'E5 - - - C#5 - A4 - E5 - - - - - . .',
      'F#5 - - D5 F#5 - B5 - A5 - - - F#5 - D5 -',
      'G5 - - - F#5 - E5 - D5 - - - B4 - . .',
      'D5 - - A4 D5 - F#5 - A5 - - - D6 - - -',
      'C#6 - - - B5 - A5 - E5 - - - A5 - - -',
      'B5 - - - A5 - G5 - F#5 - - - E5 - G5 -',
      'A5 - - - - - - - E5 - F#5 - G5 - E5 -',
      'D5 - - - - - B4 - G5 - - - F#5 - E5 -',
      'E5 - - - - - C#5 - A5 - - - G5 - F#5 -',
      'F#5 - - - - - C#5 - F#5 - A5 - C#6 - - -',
      'B5 - - - - - - - F#5 - - - D5 - - -',
      'G5 - - - - - D5 - B5 - - - A5 - G5 -',
      'A5 - - - - - E5 - C#6 - - - B5 - A5 -',
      'B5 - - - A5 - F#5 - D5 - - - F#5 - - -',
      'E5 - - - - - - - C#5 - D5 - E5 - . .',
    ]);
    const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [2, 6, 10, 14], chordLen: 2 });
    S.field = { bpm: 136, steps: 256, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass },
      { name: 'chords', patch: 'strings', ev: acc.chords, vel: 0.5, pan: -0.3 },
      { name: 'lead', patch: 'brass', ev: lead, pan: 0.1 },
      { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . k h s . h o', 16), vel: 0.75 },
    ] };
  }

  // ---- orc camp ----
  {
    const prog = ['Dm', 'Dm', 'A#', 'A', 'Dm', 'Gm', 'A', 'Dm'];
    const lead = FM.parseBars([
      'D4 - - - - - F4 - E4 - - - D4 - - -',
      'A4 - - - - - G4 - F4 - E4 - D4 - - -',
      'D4 - - - F4 - - - A#4 - - - A4 - - -',
      'A4 - - - - - - - C#5 - - - E5 - - -',
      'D5 - - - - - C5 - A#4 - - - A4 - - -',
      'G4 - - - A#4 - D5 - G5 - - - F5 - E5 -',
      'E5 - - - C#5 - - - A4 - - - E4 - - -',
      'D4 - - - - - - - - - - - . . . .',
    ]);
    S.camp = { bpm: 92, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: bass16(prog, 26).filter((e) => [0, 4, 8, 10, 12].includes(e.step % 16)).map((e) => ({ ...e, len: 2, midi: e.midi % 12 + 26 })) },
      { name: 'pad', patch: 'organ', ev: pads(prog), vel: 0.4, pan: -0.25 },
      { name: 'lead', patch: 'strings', ev: lead, pan: 0.15 },
      { name: 'drums', ev: FM.parseDrums('t . . . t . . . t . t . t . . .', 8), vel: 0.8 },
    ] };
  }

  // ---- battle ----
  {
    const prog = ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E'];
    const lead = FM.parseBars([
      'A4 - C5 - E5 - A5 - G5 - E5 - C5 - D5 -',
      'E5 - - - - - - - . . A4 - B4 - C5 -',
      'F5 - - - E5 - D5 - C5 - - - A4 - - -',
      'G4 - - - B4 - D5 - G5 - - - F5 - D5 -',
      'A5 - - - G5 - E5 - A5 - - - B5 - C6 -',
      'B5 - - - A5 - G5 - E5 - - - - - - -',
      'F5 - A5 - C6 - - - B5 - A5 - F5 - - -',
      'E5 - - - G#5 - - - B5 - - - E6 - - -',
    ]);
    const acc = FM.accomp(prog, { chordSteps: [2, 6, 10, 14], chordLen: 2 });
    S.battle = { bpm: 164, steps: 128, tracks: [
      { name: 'bass', patch: 'slapbass', ev: bass16(prog, 33) },
      { name: 'chords', patch: 'organ', ev: acc.chords, vel: 0.45, pan: -0.3 },
      { name: 'lead', patch: 'lead', ev: lead, pan: 0.15 },
      { name: 'drums', ev: FM.parseDrums('k . h k s . h . k . k h s . h s', 8), vel: 0.8 },
    ] };
  }

  // ---- boss ----
  {
    const prog = ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B'];
    const lead = FM.parseBars([
      'E5 - - - B4 - E5 - G5 - - - F#5 - E5 -',
      'G5 - - - - - E5 - C5 - - - E5 - G5 -',
      'F#5 - - - A5 - - - D6 - - - C6 - A5 -',
      'B5 - - - - - - - D#5 - F#5 - B5 - A5 -',
      'G5 - - - F#5 - E5 - B5 - - - A5 - G5 -',
      'E5 - - - G5 - C6 - - - B5 - G5 - E5 -',
      'A5 - - - C6 - - - E6 - - - D6 - C6 -',
      'B5 - - - - - - - D#6 - - - F#6 - - -',
    ]);
    const acc = FM.accomp(prog, { chordSteps: [0, 3, 6, 10, 12], chordLen: 2 });
    S.boss = { bpm: 176, steps: 128, tracks: [
      { name: 'bass', patch: 'bass', ev: bass16(prog, 28, [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 12]) },
      { name: 'chords', patch: 'brass', ev: acc.chords, vel: 0.4, pan: -0.3 },
      { name: 'lead', patch: 'lead', ev: lead, pan: 0.15 },
      { name: 'lead2', patch: 'brass', ev: lead.map((e) => ({ ...e, midi: e.midi - 12 })), vel: 0.45, pan: -0.15 },
      { name: 'drums', ev: FM.parseDrums('k . s k k . s . k k s . k . s s', 8), vel: 0.85 },
    ] };
  }

  // ---- jingles ----
  S.victory = { bpm: 140, steps: 36, once: true, tracks: [
    { patch: 'brass', ev: FM.parseBars(['G4 - G4 - G4 - C5 - - - - - E5 - - -', 'D5 - E5 - F5 - G5 - - - - - - - . .']) },
    { patch: 'strings', ev: [{ step: 0, len: 12, midi: 60 }, { step: 0, len: 12, midi: 64 }, { step: 12, len: 4, midi: 65 }, { step: 16, len: 16, midi: 67 }, { step: 16, len: 16, midi: 71 }, { step: 16, len: 16, midi: 74 }], vel: 0.5 },
    { patch: 'bass', ev: [{ step: 0, len: 12, midi: 36 }, { step: 12, len: 4, midi: 41 }, { step: 16, len: 14, midi: 43 }] },
    { ev: FM.parseDrums('k . . . s . . . k . k . s . s s', 1).concat([{ step: 16, drum: 'k' }, { step: 16, drum: 'o' }]) },
  ] };
  S.levelup = { bpm: 160, steps: 20, once: true, tracks: [
    { patch: 'bell', ev: FM.parseBars(['C5 E5 G5 C6 - - G5 - C6 - - - - - . .']) },
    { patch: 'brass', ev: FM.parseBars(['C4 E4 G4 C5 - - G4 - C5 - - - - - . .']), vel: 0.6 },
  ] };
  S.inn = { bpm: 88, steps: 36, once: true, tracks: [
    { patch: 'epiano', ev: FM.parseBars(['C5 - E5 - G5 - - - F5 - A5 - C6 - - -', 'B5 - - - G5 - - - C6 - - - - - - -']) },
    { patch: 'strings', ev: pads(['C', 'F']).concat(pads(['G'], 8).map((e) => ({ ...e, step: 24 }))), vel: 0.4 },
    { patch: 'bass', ev: [{ step: 0, len: 8, midi: 36 }, { step: 8, len: 8, midi: 41 }, { step: 16, len: 8, midi: 43 }, { step: 24, len: 8, midi: 36 }] },
  ] };
  S.gameover = { bpm: 70, steps: 36, once: true, tracks: [
    { patch: 'strings', ev: FM.parseBars(['A4 - - - G4 - - - F4 - - - E4 - - -', 'D4 - - - - - - - A3 - - - - - - -']) },
    { patch: 'organ', ev: pads(['Am', 'Dm']), vel: 0.35 },
    { patch: 'bass', ev: [{ step: 0, len: 16, midi: 33 }, { step: 16, len: 16, midi: 26 }] },
  ] };
  S.fanfare = { bpm: 120, steps: 48, once: true, tracks: [
    { patch: 'brass', ev: FM.parseBars(['C5 - C5 C5 G5 - - - E5 - - - G5 - - -', 'C6 - - - - - - - B5 - A5 - G5 - - -', 'C6 - - - - - - - - - - - . . . .']) },
    { patch: 'strings', ev: pads(['C', 'F', 'C']), vel: 0.45 },
    { patch: 'bass', ev: FM.accomp(['C', 'F', 'C'], { bassStep: 4, bassOct: true }).bass },
    { ev: FM.parseDrums('k . . . s . . . k . k . s . s s', 2).concat([{ step: 32, drum: 'k' }, { step: 32, drum: 'o' }]) },
  ] };
  return S;
}

export function defineSfx() {
  FM.defineSfx('encounter', [['zap', 300, 0, 0.18, 0.7, 3], ['zap', 450, 0.09, 0.18, 0.7, 3], ['zap', 600, 0.18, 0.25, 0.8, 3], ['brass', 'A5', 0.3, 0.25, 0.7, 0], ['brass', 'E5', 0.3, 0.25, 0.6, 0]]);
  FM.defineSfx('slash', [['noise', 4000, 0, 0.12, 0.6, 0.3], ['hat', 7000, 0, 0.06, 0.5, 0]]);
  FM.defineSfx('fire', [['noise', 900, 0, 0.5, 0.75, 0.25], ['zap', 1200, 0, 0.3, 0.4, 0.4], ['boom', 220, 0.15, 0.4, 0.6, 0.5]]);
  FM.defineSfx('blaze', [['noise', 1200, 0, 0.8, 0.9, 0.2], ['bigboom', 160, 0.2, 0.7, 0.9, 0.4], ['zap', 1500, 0, 0.5, 0.5, 0.3]]);
  FM.defineSfx('thunder', [['zap', 2400, 0, 0.12, 0.7, 0.2], ['noise', 5000, 0.05, 0.25, 0.8, 0.3], ['bigboom', 90, 0.1, 0.8, 1, 0.5]]);
  FM.defineSfx('heal', [['bell', 'C6', 0, 0.2, 0.6, 0], ['bell', 'E6', 0.07, 0.2, 0.6, 0], ['bell', 'G6', 0.14, 0.2, 0.6, 0], ['bell', 'C7', 0.21, 0.4, 0.6, 0]]);
  FM.defineSfx('chest', [['clank', 300, 0, 0.12, 0.6, 0], ['bell', 'G5', 0.12, 0.15, 0.6, 0], ['bell', 'C6', 0.2, 0.15, 0.6, 0], ['bell', 'E6', 0.28, 0.15, 0.6, 0], ['bell', 'G6', 0.36, 0.4, 0.7, 0]]);
  FM.defineSfx('roar', [['noise', 200, 0, 0.7, 0.9, 0.6], ['brass', 110, 0, 0.7, 0.8, 0.7], ['brass', 116, 0, 0.7, 0.7, 0.7]]);
  FM.defineSfx('menu', [['bell', 'E6', 0, 0.07, 0.4, 0], ['bell', 'B6', 0.05, 0.12, 0.45, 0]]);
  FM.defineSfx('miss', [['whistle', 900, 0, 0.15, 0.4, 0.5]]);
  FM.defineSfx('bump', [['tom', 120, 0, 0.08, 0.5, 0.6]]);
  FM.defineSfx('crit', [['noise', 5000, 0, 0.1, 0.7, 0.3], ['clank', 700, 0.04, 0.2, 0.8, 0], ['boom', 300, 0.06, 0.3, 0.8, 0.4]]);
}
