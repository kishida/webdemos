// NAM の AudioWorklet。A2 は TONE3000 のエンジン（SIMD・軽量サイズ対応）、
// それ以外（A1 など）は @opendaw/nam-wasm で動かす。WASMはスコープごとに1回だけ生成する
import createOpendaw from './nam.js?v=2';
import createT3k from './t3k-engine.js?v=2';

const QUANTUM = 128;
const FADE_FRAMES = 1024; // モデル差し替え直後のフェードイン
const T3K_LOUDNESS = -18; // TONE3000 エンジンはラウドネス付きモデルをこの値に揃えて出す
let opendawPromise = null, t3kPromise = null;

class NamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasm = null;
    this.engine = null; // 'od' | 't3k' | null
    this.od = null; this.odId = 0;
    this.t3k = null; this.t3kId = 0;
    this.active = false; this.fade = 0; this.slim = 1;
    this.heap = null; this.inView = null; this.outView = null;
    let queue = Promise.resolve();
    this.port.onmessage = e => { queue = queue.then(() => this.handle(e.data)).catch(console.error); };
  }
  async handle(msg) {
    if (msg.wasm) {
      this.wasm = msg.wasm;
    } else if (msg.json !== undefined) {
      this.port.postMessage({ slotToken: msg.token, ...await this.load(msg.json) });
    } else if (msg.unload) {
      this.unload();
    } else if (msg.slim !== undefined) {
      this.slim = msg.slim;
      if (this.engine === 't3k') { this.t3k._nam_setSlimmableSize(this.t3kId, this.slim); this.fade = FADE_FRAMES; }
    } else if (msg.active !== undefined) {
      this.active = msg.active;
    }
  }
  unload() {
    if (this.engine === 'od') this.od._nam_unloadModel(this.odId);
    if (this.engine === 't3k') this.t3k._nam_unloadModel(this.t3kId);
    this.engine = null;
  }
  async ensureT3k() {
    if (this.t3k) return;
    t3kPromise ??= createT3k({ wasmBinary: this.wasm.t3k, locateFile: p => p });
    this.t3k = await t3kPromise;
    this.t3kId = this.t3k._nam_createInstance(sampleRate, QUANTUM);
  }
  async ensureOd() {
    if (this.od) return;
    opendawPromise ??= createOpendaw({ wasmBinary: this.wasm.od, locateFile: p => p });
    this.od = await opendawPromise;
    this.od._nam_setSampleRate(sampleRate);
    this.odId = this.od._nam_createInstance();
    this.odIn = this.od._malloc(QUANTUM * 4);
    this.odOut = this.od._malloc(QUANTUM * 4);
  }
  // WASM の文字列として渡して読み込む。非対応モデルはWASM側の例外になる
  callLoad(m, json, fn) {
    const size = m.lengthBytesUTF8(json) + 1, ptr = m._malloc(size);
    m.stringToUTF8(json, ptr, size);
    try {
      return !!fn(ptr);
    } catch (err) {
      return false;
    } finally {
      m._free(ptr);
    }
  }
  async load(json) {
    this.unload();
    let architecture = '';
    try { architecture = JSON.parse(json).architecture; } catch (err) { return { ok: false }; }
    this.heap = null;
    this.fade = FADE_FRAMES;
    if (architecture === 'SlimmableContainer' || /^A2|WaveNetA2/i.test(architecture)) {
      await this.ensureT3k();
      const m = this.t3k;
      if (this.callLoad(m, json, ptr => m._nam_loadModel(this.t3kId, ptr, this.slim))) {
        this.engine = 't3k';
        return {
          ok: true, engine: 'A2', slimmable: m._nam_isSlimmable(this.t3kId) === 1,
          loudness: m._nam_hasLoudness(this.t3kId) === 1 ? T3K_LOUDNESS : null,
        };
      }
    }
    await this.ensureOd();
    const m = this.od;
    if (!this.callLoad(m, json, ptr => m._nam_loadModel(this.odId, ptr))) return { ok: false };
    this.engine = 'od';
    return {
      ok: true, engine: 'A1', slimmable: false,
      loudness: m._nam_hasModelLoudness(this.odId) ? m._nam_getModelLoudness(this.odId) : null,
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0][0], out = outputs[0][0];
    if (!inp) { out.fill(0); return true; }
    if (!this.engine) { out.set(inp); return true; } // モデルなしは素通し
    if (!this.active) { out.fill(0); return true; } // 使わない系統はCPUを使わない
    if (this.engine === 't3k') {
      const m = this.t3k;
      if (this.heap !== m.HEAPF32) { // メモリ拡張でビューが無効になったら作り直す
        this.heap = m.HEAPF32;
        const p = m._nam_getBuffer(this.t3kId) >> 2;
        this.inView = this.outView = this.heap.subarray(p, p + QUANTUM);
      }
      this.inView.set(inp);
      m._nam_process(this.t3kId, QUANTUM);
    } else {
      const m = this.od;
      if (this.heap !== m.HEAPF32) {
        this.heap = m.HEAPF32;
        this.inView = this.heap.subarray(this.odIn >> 2, (this.odIn >> 2) + QUANTUM);
        this.outView = this.heap.subarray(this.odOut >> 2, (this.odOut >> 2) + QUANTUM);
      }
      this.inView.set(inp);
      m._nam_process(this.odId, this.odIn, this.odOut, QUANTUM);
    }
    out.set(this.outView);
    for (let i = 0; i < QUANTUM && this.fade > 0; i++) out[i] *= 1 - this.fade-- / FADE_FRAMES;
    return true;
  }
}
registerProcessor('vs-nam', NamProcessor);
