// Browser GGUF reader. Source = File (input[type=file]) or URL (HTTP Range requests).

export const BLOCK = { // type -> [elements per block, bytes per block]
  0: [1, 4], 1: [1, 2], 30: [1, 2], 8: [32, 34],
  10: [256, 84], 11: [256, 110], 12: [256, 144], 13: [256, 176], 14: [256, 210],
};
export const TYPE_NAME = { 0: 'F32', 1: 'F16', 30: 'BF16', 8: 'Q8_0', 10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K' };

export function fileSource(file) {
  return { name: file.name, size: file.size, read: async (off, len) => file.slice(off, off + len).arrayBuffer() };
}
export function urlSource(url) {
  return {
    name: url.split('/').pop(),
    read: async (off, len) => {
      // no-store: never let the browser keep gigabytes of model data in its HTTP cache
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` }, cache: 'no-store' });
      if (r.status !== 206 && r.status !== 200) throw new Error(`fetch ${url}: ${r.status}`);
      return r.arrayBuffer();
    },
  };
}

class Reader {
  constructor(src) { this.src = src; this.buf = new Uint8Array(0); this.base = 0; this.pos = 0; }
  async ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    const keep = this.buf.subarray(this.pos);
    const chunk = Math.max(n, 8 << 20);
    const more = new Uint8Array(await this.src.read(this.base + this.pos + keep.length, chunk));
    const nb = new Uint8Array(keep.length + more.length);
    nb.set(keep); nb.set(more, keep.length);
    this.base += this.pos; this.buf = nb; this.pos = 0;
    this.dv = new DataView(nb.buffer);
  }
  get tell() { return this.base + this.pos; }
  async u32() { await this.ensure(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  async u64() { await this.ensure(8); const v = Number(this.dv.getBigUint64(this.pos, true)); this.pos += 8; return v; }
  async str() {
    const n = await this.u64(); await this.ensure(n);
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s;
  }
  async val(t) {
    const sz = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }[t];
    if (t === 8) return this.str();
    if (t === 9) {
      const at = await this.u32(), n = await this.u64(), a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = await this.val(at);
      return a;
    }
    await this.ensure(sz);
    const d = this.dv, p = this.pos; this.pos += sz;
    switch (t) {
      case 0: return d.getUint8(p); case 1: return d.getInt8(p); case 2: return d.getUint16(p, true); case 3: return d.getInt16(p, true);
      case 4: return d.getUint32(p, true); case 5: return d.getInt32(p, true); case 6: return d.getFloat32(p, true);
      case 7: return d.getUint8(p) !== 0; case 10: return Number(d.getBigUint64(p, true)); case 11: return Number(d.getBigInt64(p, true));
      case 12: return d.getFloat64(p, true);
    }
    throw new Error('gguf value type ' + t);
  }
}

export async function openGGUF(src) {
  const r = new Reader(src);
  if ((await r.u32()) !== 0x46554747) throw new Error('not a GGUF file');
  const version = await r.u32();
  const nT = await r.u64(), nKV = await r.u64();
  const meta = {};
  for (let i = 0; i < nKV; i++) { const k = await r.str(); const t = await r.u32(); meta[k] = await r.val(t); }
  const tensors = new Map();
  const infos = [];
  for (let i = 0; i < nT; i++) {
    const name = await r.str(); const nd = await r.u32(); const dims = [];
    for (let d = 0; d < nd; d++) dims.push(await r.u64());
    const type = await r.u32(); const offset = await r.u64();
    if (!BLOCK[type]) throw new Error(`unsupported tensor type ${type} (${name})`);
    const n = dims.reduce((a, b) => a * b, 1);
    const [be, bb] = BLOCK[type];
    infos.push({ name, dims, type, offset, nbytes: (n / be) * bb });
  }
  const align = meta['general.alignment'] ?? 32;
  const dataStart = Math.ceil(r.tell / align) * align;
  for (const t of infos) { t.offset += dataStart; tensors.set(t.name, t); }
  return { src, version, meta, tensors };
}

export async function readTensor(g, t) {
  return new Uint8Array(await g.src.read(t.offset, t.nbytes));
}

// ---------- safetensors (projector) ----------
export async function openSafetensors(src) {
  const hb = new DataView(await src.read(0, 8));
  const hlen = Number(hb.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(await src.read(8, hlen)));
  const meta = header.__metadata__ ?? {};
  const tensors = new Map();
  const TY = { F32: 0, F16: 1, BF16: 30 };
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const [a, b] = info.data_offsets;
    tensors.set(name, { name, type: TY[info.dtype], shape: info.shape, offset: 8 + hlen + a, nbytes: b - a });
  }
  return { src, meta, tensors };
}
