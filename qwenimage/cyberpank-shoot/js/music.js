// Music & SFX data for OSTEOMORPH. Pure data + FM helpers, no DOM.
// Usage: const SONGS = MUSIC.build(FM);  (after fm-audio.js is loaded)
'use strict';
window.MUSIC = (function () {
  function build(FM) {
    const op = FM.op;

    // ---- custom patches (pass to FM.addPatches after init) ----
    const patches = {
      growl: { alg: 0, fb: 7, vol: 0.24, ops: [
        op(1, 0.5, 0.01, 0.15, 0.5, 0.08), op(1, 0.55, 0.01, 0.15, 0.5, 0.08),
        op(2, 0.45, 0.01, 0.12, 0.4, 0.06), op(1, 1, 0.01, 0.25, 0.6, 0.08)] },
      rite: { alg: 7, fb: 2, vol: 0.10, vib: 0.009, ops: [
        op(1, 0.4, 0.4, 1.2, 0.85, 0.5), op(1, 0.5, 0.35, 1.2, 0.9, 0.5, 0.004),
        op(2, 0.25, 0.3, 1.0, 0.85, 0.5, -0.004), op(1, 0.5, 0.3, 1.2, 0.9, 0.5)] },
      moan: { alg: 4, fb: 6, vol: 0.13, vib: 0.02, ops: [
        op(1, 1.2, 0.05, 0.6, 0.9, 0.3), op(1, 0.7, 0.05, 0.7, 0.9, 0.3),
        op(1.5, 0.4, 0.06, 0.6, 0.8, 0.3), op(1, 1, 0.08, 1.5, 0.95, 0.4)] },
    };

    // ---- custom SFX (pass to FM.defineSfx) ----
    const sfx = {
      acid: [['blip', 430, 0, 0.22, 0.55, 0.35], ['noise', 700, 0, 0.14, 0.3, 0.25]],
      spit: [['zap', 1200, 0, 0.10, 0.5, 0.3]],
      hatch: [['clank', 700, 0, 0.12, 0.5, 0.6], ['blip', 300, 0.05, 0.2, 0.5, 2.2]],
      jaw:  [['clank', 320, 0, 0.30, 0.9, 0.4], ['boom', 190, 0, 0.45, 0.8, 0.3]],
      roar: [['boom', 130, 0, 1.1, 1, 0.35], ['noise', 300, 0.05, 1.3, 0.7, 0.5],
             ['siren', 200, 0.25, 1.1, 0.8, 1.5]],
    };

    // ---- title: ritual drone (plays with lead muted) ----
    const progT = ['Am', 'Am', 'F', 'E'];
    const tD = FM.accomp(progT, { bassStep: 8, bassOct: false, chordSteps: [] });
    const tP = FM.accomp(progT, { bassStep: 16, chordSteps: [0], chordLen: 14 });
    const title = {
      id: 'title', bpm: 92, steps: 64,
      tracks: [
        { name: 'drone', patch: 'bass', ev: tD.bass, vel: 0.9 },
        { name: 'pad', patch: 'rite', ev: tP.chords, vel: 0.9 },
        { name: 'bell', patch: 'bell', ev: FM.arpeggio(progT, { pattern: [0, 2, 4, 2], octave: 12 }), vel: 0.7, pan: -0.2 },
        { name: 'drums', ev: FM.parseDrums('k . . . t . . . . . . . t . . .', 4), vel: 0.9 },
      ],
    };

    // ---- stage theme: industrial march, 16 bars ----
    const progS = ['Cm', 'Cm', 'Ab', 'Ab', 'Bb', 'Ab', 'G', 'G',
                   'Fm', 'Fm', 'Ab', 'Ab', 'G', 'G', 'G', 'G'];
    const sB = FM.accomp(progS, { bassStep: 2, bassOct: true });
    const sK = FM.accomp(progS, { bassStep: 16, chordSteps: [6, 14], chordLen: 2 });
    const leadA = FM.parseBars([
      'C5 - . Eb5 . . D5 . C5 . . . Ab4 - . .',
      'F5 - . Eb5 . . D5 . C5 . . . . . . .',
      'Ab5 - . G5 . . Ab5 . G5 . . Eb5 - . . .',
      'Eb5 - . . . . . . . . . . . . . .',
      'Bb5 - . Ab5 . . Bb5 . C6 . . Bb5 - . . .',
      'Ab5 - . G5 . . F5 . Eb5 . . . . . . .',
      'G5 - . B4 . . D5 . G5 - . . . . . .',
      'D5 - - - . . . . D5 - . . . . . .',
    ], 16);
    const leadB = FM.parseBars([
      'C6 - . Bb5 . . Ab5 . F5 . . Ab5 - . . .',
      'C6 . . Bb5 . . Ab5 . F5 . . . . . . .',
      'Ab5 - . Eb5 . . Ab5 . C6 - . . Bb5 - . .',
      'Ab5 . . . . . . . G5 . . . . . . .',
      'B4 . D5 . G5 . B5 . D6 . B5 . G5 . D5 .',
      'G5 - - - . . . . D5 . . . . . . .',
      'G5 . B4 . D5 . G5 - - - . . . . . .',
      '. . . . . . . . D5 - . . B4 - . .',
    ], 16, 128);
    const stage = {
      id: 'stage', bpm: 134, steps: 256,
      tracks: [
        { name: 'bass', patch: 'bass', ev: sB.bass, vel: 0.95 },
        { name: 'stab', patch: 'brass', ev: sK.chords, vel: 0.75, pan: 0.3 },
        { name: 'lead', patch: 'lead', ev: leadA.concat(leadB), vel: 0.9 },
        { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . k h s . h .', 16) },
      ],
    };

    // ---- boss theme: faster, 16th chromatic ----
    const progX = ['Dm', 'Dm', 'Bb', 'Bb', 'A', 'A', 'Gm', 'A'];
    const xB = FM.accomp(progX, { bassStep: 1, bassOct: false });
    const xK = FM.accomp(progX, { bassStep: 16, chordSteps: [0], chordLen: 15 });
    const bossLead = FM.parseBars([
      'D5 D5 . A4 . D5 . F5 . E5 . Eb5 . D5 . .',
      'D5 . A4 . F5 . E5 . D5 - - . . . . .',
      'Bb4 . D5 . F5 . Bb5 - . A5 . Ab5 . G5 . .',
      'F5 - . . E5 . Eb5 . D5 - - - . . . .',
      'D5 D5 . A4 . D5 . F5 . G5 . Ab5 . A5 . Bb5',
      'A5 - - . . . . . Ab5 . G5 . F5 . . .',
      'D5 . . . A4 . . . D5 . . . F5 . . .',
      'F5 - E5 - D5 - - . . . . . . . . .',
    ], 16);
    const boss = {
      id: 'boss', bpm: 152, steps: 128,
      tracks: [
        { name: 'bass', patch: 'growl', ev: xB.bass, vel: 0.8 },
        { name: 'pad', patch: 'moan', ev: xK.chords, vel: 0.55 },
        { name: 'lead', patch: 'lead', ev: bossLead, vel: 0.95 },
        { name: 'drums', ev: FM.parseDrums('k k h s h k s h k k h s h k s s', 8), vel: 0.9 },
      ],
    };

    // ---- jingles ----
    const cB = FM.accomp(['Cm', 'Cm'], { bassStep: 8, bassOct: true });
    const clear = {
      id: 'clear', bpm: 112, steps: 32, once: true,
      tracks: [
        { name: 'bell', patch: 'bell', ev: FM.arpeggio(['Cm', 'Cm'], { pattern: [0, 1, 2, 3, 2, 1], octave: 12 }), vel: 0.9 },
        { name: 'bass', patch: 'bass', ev: cB.bass, vel: 0.9 },
        { name: 'drums', ev: FM.parseDrums('k . . . . . . o', 4), vel: 0.8 },
      ],
    };
    const over = {
      id: 'over', bpm: 80, steps: 64, once: true,
      tracks: [
        { name: 'bass', patch: 'bass', vel: 1, ev: FM.parseBars([
          'C2 - - - - - - - - - - - - - - -',
          'B1 - - - - - - - - - - - - - - -',
          'Bb1 - - - - - - - - - - - - - - -',
          'A1 - - - - - - - - - - - - - - -',
        ], 16) },
        { name: 'pad', patch: 'rite', vel: 0.8, ev: FM.accomp(['Cdim', 'Cdim', 'Cdim', 'Cdim'], { bassStep: 16, chordSteps: [0], chordLen: 15, bassOct: false }).chords },
        { name: 'drums', ev: FM.parseDrums('t . . . . . . . . . . . k . . .', 4), vel: 0.8 },
      ],
    };

    return { patches, sfx, title, stage, boss, clear, over };
  }
  return { build };
})();
