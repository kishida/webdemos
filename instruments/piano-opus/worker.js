/* Background renderer: runs the physical model ahead of playback and streams chunks. */
importScripts('engine.js');

let events = null, duration = 0;
let job = null, jobId = 0, playPos = 0, waiting = false;
const LEAD = 8, CHUNK = 0.5;

onmessage = (e) => {
  const d = e.data;
  if (d.cmd === 'score') { events = d.events; duration = d.duration; }
  else if (d.cmd === 'start') {
    job = new self.PianoPhysics.Job(d.fs, events, d.from, d.params);
    jobId = d.id; playPos = d.from; waiting = false;
    const id = jobId; setTimeout(() => step(id), 0);
  } else if (d.cmd === 'pos') {
    playPos = d.t;
    if (waiting && job) { waiting = false; const id = jobId; setTimeout(() => step(id), 0); }
  } else if (d.cmd === 'params') { if (job) job.engine.setParams(d.params); }
  else if (d.cmd === 'stop') { job = null; jobId = -1; }
};

function step(id) {
  if (!job || id !== jobId) return;
  if (job.time >= duration) return;
  if (job.time - playPos > LEAD) { waiting = true; return; }
  const n = Math.round(CHUNK * job.fs);
  const c = job.renderChunk(n);
  postMessage({ id, startSec: c.startSec, L: c.L, R: c.R, voices: c.activeVoices }, [c.L.buffer, c.R.buffer]);
  setTimeout(() => step(id), 0);
}

postMessage({ ready: true });
