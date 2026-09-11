// GENERATED from node/tokenizer.ts by scripts/build_web.ts — do not edit
// Byte-level BPE tokenizer (Qwen2/3 style) built from GGUF metadata.
export class Tokenizer {
  tokens          ;
  vocab = new Map                ();
  ranks = new Map                ();
  specials           = [];
  specialRe                = null;
  byteEnc           = [];
  byteDec = new Map                ();
  cache = new Map                  ();
  // Qwen2 pre-tokenizer pattern ((?i:...) expanded since JS has no inline flags)
  pre = /'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

  constructor(meta                     ) {
    this.tokens = meta['tokenizer.ggml.tokens'];
    const types           = meta['tokenizer.ggml.token_type'] ?? [];
    this.tokens.forEach((t, i) => { this.vocab.set(t, i); if (types[i] === 3 || types[i] === 4) this.specials.push(t); });
    (meta['tokenizer.ggml.merges']            ).forEach((m, i) => this.ranks.set(m, i));
    if (this.specials.length) {
      const esc = [...this.specials].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this.specialRe = new RegExp(`(${esc.join('|')})`, 'g');
    }
    const bs           = [];
    for (let b = 33; b <= 126; b++) bs.push(b);
    for (let b = 161; b <= 172; b++) bs.push(b);
    for (let b = 174; b <= 255; b++) bs.push(b);
    const cs = [...bs];
    let n = 0;
    for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
    bs.forEach((b, i) => { this.byteEnc[b] = String.fromCodePoint(cs[i]); this.byteDec.set(String.fromCodePoint(cs[i]), b); });
  }

  bpe(word        )           {
    const c = this.cache.get(word);
    if (c) return c;
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(parts[i] + ' ' + parts[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      const a = parts[best], b = parts[best + 1];
      const np           = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) { np.push(a + b); i++; }
        else np.push(parts[i]);
      }
      parts = np;
    }
    const ids = parts.map((p) => {
      const id = this.vocab.get(p);
      if (id === undefined) throw new Error('bpe: unknown piece ' + p);
      return id;
    });
    this.cache.set(word, ids);
    return ids;
  }

  encode(text        )           {
    const out           = [];
    const chunks = this.specialRe ? text.split(this.specialRe) : [text];
    const enc = new TextEncoder();
    for (const ch of chunks) {
      if (!ch) continue;
      if (this.specialRe && this.vocab.has(ch) && this.specials.includes(ch)) { out.push(this.vocab.get(ch) ); continue; }
      for (const m of ch.matchAll(this.pre)) {
        const w = Array.from(enc.encode(m[0]), (b) => this.byteEnc[b]).join('');
        out.push(...this.bpe(w));
      }
    }
    return out;
  }

  decode(ids          )         {
    const bytes           = [];
    for (const id of ids) {
      const t = this.tokens[id];
      if (this.specials.includes(t)) { bytes.push(...new TextEncoder().encode(t)); continue; }
      for (const ch of t) { const b = this.byteDec.get(ch); if (b !== undefined) bytes.push(b); }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}
