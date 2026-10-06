// DIESEL STRIKE - FM 曲データ（ディーゼルパンク: brass + organ + 工業的ドラム）
// 各 builder は Song オブジェクトを返す（遅延ビルドで parseBars の警告を捕捉可能にする）。
'use strict';

(() => {
  const padEv = (list) => list.flatMap(([c, s, l]) => FM.chord(c).map((m) => ({ step: s, len: l, midi: m })));

  // タイトル: ゆっくりした蒸気オルガンの雰囲気（E minor）
  function title() {
    const prog = ['Em', 'Em', 'C', 'D', 'Em', 'C', 'G', 'D'];
    const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [2, 6, 10, 14], chordLen: 2 });
    const lead = FM.parseBars([
      'G4 - - - G4 - - - E4 - - - B4 - - -',
      'D5 - - . C5 - B4 A4 - - - G4 - - - -',
      'G4 - - - G4 - - - E4 - - - B4 - - -',
      'D5 - - - C5 - - B4 - A4 - - . - - -',
      'G4 - - - G4 - - - E4 - - - B4 - - -',
      'D5 - - . C5 - B4 A4 - - - G4 - - - -',
      'E5 - - - D5 - C5 B4 - - - A4 - - - -',
      'G4 - - . E4 - - - C4 - - - . - - -',
    ]);
    return {
      bpm: 84, steps: 128, tracks: [
        { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.85 },
        { name: 'org', patch: 'organ', ev: acc.chords, vel: 0.75, pan: -0.2 },
        { name: 'lead', patch: 'brass', ev: lead, vel: 0.9 },
        { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . h . s . h .', 8), vel: 0.7 },
      ],
    };
  }

  // 道中: ドライブする 8 分ベース + 時計仕掛けのアルペジオ（A minor）
  function stage() {
    const progA = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'];
    const progB = ['Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E'];
    const prog = progA.concat(progB);
    const acc = FM.accomp(prog, { bassStep: 2, bassOct: true, chordSteps: [4, 12], chordLen: 3 });
    const lead = FM.parseBars([
      'A4 - C5 - E5 - - C5 - A4 - - - - - -',
      'A4 - C5 - E5 - - C5 - A4 - - - - - -',
      'F4 - A4 - C5 - - A4 - F4 - - - - - -',
      'G4 - B4 - D5 - - B4 - G4 - - - - - -',
      'A4 - C5 - E5 - - C5 - A4 - - - - - -',
      'A4 - C5 - E5 - - C5 - A4 - - - - - -',
      'F4 - A4 - C5 - - A4 - C5 - . . . . .',
      'G4 - B4 - D5 - - B4 - G4 - . . . . .',
      'A4 - - . A4 - C5 - E5 - - . - - - -',
      'A4 - - . A4 - C5 - E5 - - . - - - -',
      'F4 - - . F4 - A4 - C5 - - . - - - -',
      'G4 - B4 - D5 - F5 - - D5 - B4 - . . -',
      'E4 - - . G4 - B4 - D5 - - . - - - -',
      'A4 - - . C5 - E5 - A5 - - . - - - -',
      'B4 - - . D5 - G5 - E5 - - . - - - -',
      'C5 - B4 A4 - G4 - E4 - . . . . . - -',
    ]);
    const drums = FM.parseDrums('k . h . s . h . k . h . s . h .', 8)
      .concat(FM.parseDrums('k h . h s h . h k h o h s h o h', 8));
    return {
      bpm: 132, steps: 256, tracks: [
        { name: 'bass', patch: 'slapbass', ev: acc.bass, vel: 0.95 },
        { name: 'org', patch: 'organ', ev: acc.chords, vel: 0.6, pan: -0.25 },
        { name: 'arp', patch: 'bell', ev: FM.arpeggio(prog, { pattern: [0, 2, 1, 2] }), vel: 0.2, pan: 0.35 },
        { name: 'lead', patch: 'brass', ev: lead, vel: 0.95, pan: 0.1 },
        { name: 'drums', ev: drums, vel: 0.9 },
      ],
    };
  }

  // ボス: 16 分ベースの重苦しい突撃（A minor）
  function boss() {
    const prog = ['Am', 'Am', 'G', 'E', 'Am', 'Am', 'D', 'E'];
    const acc = FM.accomp(prog, { bassStep: 1, bassOct: true, chordSteps: [0, 8], chordLen: 4 });
    const lead = FM.parseBars([
      'A4 . A4 A4 . A4 A4 E5 . A4 A4 . A4 A4 A4 .',
      'A4 . A4 A4 . A4 A4 E5 . A4 A4 . A4 A4 A4 .',
      'G4 . G4 G4 . G4 G4 D5 . G4 G4 . G4 G4 G4 .',
      'E4 . E4 E4 . E4 E4 B4 . E5 E4 . E4 E4 E4 .',
      'A4 . A4 A4 . A4 A4 E5 . A4 A4 . A4 A4 A4 .',
      'A4 . A4 A4 . A4 A4 E5 . A4 A4 . A4 A4 A4 .',
      'D4 . D4 D4 . D4 D4 A4 . D5 D4 . D4 D4 D4 .',
      'E4 . E4 E4 . E4 E4 B4 . E5 B4 . - - - -',
    ]);
    return {
      bpm: 152, steps: 128, tracks: [
        { name: 'bass', patch: 'slapbass', ev: acc.bass, vel: 0.95 },
        { name: 'org', patch: 'organ', ev: acc.chords, vel: 0.55, pan: -0.3 },
        { name: 'lead', patch: 'brass', ev: lead, vel: 1 },
        { name: 'drums', ev: FM.parseDrums('k h k h s h k h k h k h s h o h', 8), vel: 1 },
      ],
    };
  }

  // ゲームオーバー: 重い小節のジングル（E minor、1 回だけ）
  function gameover() {
    return {
      bpm: 132, steps: 64, once: true, tracks: [
        { name: 'org', patch: 'organ', ev: padEv([['Em', 0, 16], ['C', 16, 16], ['F', 32, 16], ['E', 48, 16]]), vel: 0.8 },
        { name: 'bass', ev: [{ step: 0, len: 16, midi: 40 }, { step: 16, len: 16, midi: 48 }, { step: 32, len: 16, midi: 41 }, { step: 48, len: 16, midi: 40 }] },
        { name: 'lead', patch: 'strings', ev: FM.parseBars([
          'A4 - - - E4 - - - C4 - - - B3 - - -',
          'C4 - - - A3 - - - F3 - - - E3 - - -',
          'F3 - - - A3 - - - C4 - - - D4 - - -',
          'E3 - - - B3 - - - E3 - - - . - - -',
        ]), vel: 0.9 },
      ],
    };
  }

  // クリア: 黄銅のファンファーレ（A major、1 回だけ）
  function victory() {
    return {
      bpm: 132, steps: 64, once: true, tracks: [
        { name: 'org', patch: 'organ', ev: padEv([['A', 0, 16], ['D', 16, 16], ['E', 32, 16], ['A', 48, 16]]), vel: 0.8 },
        { name: 'bass', ev: [{ step: 0, len: 16, midi: 45 }, { step: 16, len: 16, midi: 50 }, { step: 32, len: 16, midi: 52 }, { step: 48, len: 16, midi: 45 }] },
        { name: 'lead', patch: 'brass', ev: FM.parseBars([
          'A4 - C#5 - E5 - A5 - - - . . . - - -',
          'F#5 - E5 D#5 - D5 C#5 - - - - - - - - -',
          'E5 - C#5 - A4 - - - - - - F#4 - - - -',
          'A4 - - C#5 - E5 - A5 - - - - - - - .',
        ]), vel: 1 },
        { name: 'drums', ev: FM.parseDrums('k . h . s . h . k . h . s . h .', 3)
          .concat(FM.parseDrums('k h o h o h o h o h o h o h o h', 1)), vel: 0.9 },
      ],
    };
  }

  window.SONGS = { title, stage, boss, gameover, victory };
})();
