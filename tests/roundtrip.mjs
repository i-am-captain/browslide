import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 1+2 behavioral tests for browslide.html. Run: npm install && npm test
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'browslide.html');
const html = fs.readFileSync(SRC, 'utf-8');
let failures = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures++;
}
// ---------- 0. structural: exactly the two real </script> closers, nothing inside JS strings ----------
// (a literal </script> inside app JS would terminate the script block in a real browser)
check('no stray closing-script literals in source', (html.match(/<\/script/gi) || []).length === 2);
// ---------- 0b. agent-map anchors resolve (each: map line + target) ----------
['<title>Browslide</title>', '/* ================= CSS', '<header id="toolbar">',
 '<div id="main">', 'id="present-overlay"', 'id="open-file"', 'id="slider-data"',
 'UTIL =================', 'MODEL =================', 'optional lossless compression',
 'resources table: slides store', 'STORE (IndexedDB', 'RENDER =================',
 'EDIT =================', 'PRESENT =================', 'EXPORT VIEWER',
 'SAVE / OPEN / NEW', 'SIZE METER', 'EVENTS + BOOT', 'function boot(){'
].forEach((a) => {
  const n = html.split('\n').filter((l) => l.includes(a)).length;
  check(`anchor resolves: ${a}`, n === 2, `${n} hit(s)`);
});
// stage centering must not rely on flex justify-content (overflowing flex items get
// cut off on the left and look "shifted"); block + auto margins with definite widths.
const headCss = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const stageWrap = (headCss.match(/#stage-wrap\{[^}]*\}/) || [''])[0];
check('stage centers without flex overflow cut',
  stageWrap.includes('overflow:auto') && !stageWrap.includes('justify-content') &&
  /(?:^|\n)\.slide\{width:100%[^}]*margin:auto/.test(headCss) && /#stage\{[^}]*height:100%/.test(headCss));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom(source, runScripts = true) {
  return new JSDOM(source, {
    url: 'file:///browslide.html',
    runScripts: runScripts ? 'dangerously' : 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.__savedBlob = null;
      window.__clickedAnchor = null;
      window.URL.createObjectURL = (blob) => { window.__savedBlob = blob; return 'blob:fake'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { window.__clickedAnchor = this.href; };
      window.__confirms = [];
      window.__alerts = [];
      window.confirm = (msg) => { window.__confirms.push(msg); return true; };
      window.alert = (msg) => { window.__alerts.push(msg); };
    },
  });
}

async function blobToText(blob, window) {
  try { return await blob.text(); } catch (e) {
    return await new Promise((res, rej) => {
      const r = new window.FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = rej;
      r.readAsText(blob);
    });
  }
}
function dataModel(doc) {
  return JSON.parse(doc.querySelector('#slider-data').textContent);
}

// ---------- 1. boot ----------
const dom = makeDom(html);
await wait(400);
const W = dom.window, D = W.document;
check('boot renders 3 slides', D.querySelectorAll('#filmstrip-list li').length === 3);
check('deck title loaded', D.querySelector('#deck-title').value === 'My Talk');
check('stage shows first slide', !!D.querySelector('#stage .slide.layout-title'));
check('clean flag on boot', D.querySelector('#dirty-flag').textContent === 'Saved');
check('no alerts on boot', W.__alerts.length === 0, W.__alerts.join(';'));

// ---------- 2. edit: add + type malicious HTML ----------
D.querySelector('#btn-add').click();
await wait(100);
check('add slide -> 4 in filmstrip', D.querySelectorAll('#filmstrip-list li').length === 4);
check('counter updated', D.querySelector('#pos-flag').textContent === '2 / 4');
const sec = D.querySelector('#stage .slide');
sec.innerHTML = '<h1>Edited</h1><script>evil()<\/script><p onclick="x()">hi <a href="javascript:y()">z</a></p>';
sec.dispatchEvent(new W.Event('input', { bubbles: true }));
await wait(800);
check('dirty flag set', D.querySelector('#dirty-flag').textContent.includes('Unsaved'));
check('filmstrip label follows h1', D.querySelector('#filmstrip-list li.active .lbl').textContent === 'Edited');

// ---------- 3. layout switch keeps contenteditable alive ----------
D.querySelector('#layout-select').value = 'two-col';
D.querySelector('#layout-select').dispatchEvent(new W.Event('change', { bubbles: true }));
check('layout class applied', !!D.querySelector('#stage .slide.layout-two-col'));
check('content kept on layout switch', D.querySelector('#stage .slide').innerHTML.includes('Edited'));

// ---------- 4. save ----------
D.querySelector('#btn-save').click();
await wait(100);
check('save produced a blob', !!W.__savedBlob, typeof W.__savedBlob);
check('save used .html filename', (W.__clickedAnchor || '').length > 0);
const savedText = await blobToText(W.__savedBlob, W);
check('saved file has doctype', savedText.startsWith('<!doctype html>'));
const savedDoc = new JSDOM(savedText).window.document;
let saved;
try { saved = dataModel(savedDoc); check('saved data block parses', true); }
catch (e) { check('saved data block parses', false, String(e)); }
check('saved deck has 4 slides', saved && saved.slideOrder.length === 4);
const editedHtml = saved && saved.slides[saved.slideOrder[1]].html;
check('slide title derived', saved && saved.slides[saved.slideOrder[1]].title === 'Edited');
check('script tag stripped on save', editedHtml && !/script/i.test(editedHtml), editedHtml);
check('on* attr stripped on save', editedHtml && !/onclick/i.test(editedHtml), editedHtml);
check('javascript: href stripped on save', editedHtml && !/javascript:/i.test(editedHtml), editedHtml);
check('dirty flag cleared after save', D.querySelector('#dirty-flag').textContent === 'Saved');
check('size meter shows estimate', /Est\. save size:/.test(D.querySelector('#size-meter').textContent),
  D.querySelector('#size-meter').textContent);

// ---------- 5. reopen saved copy (full boot with scripts) ----------
const dom2 = makeDom(savedText);
await wait(400);
const W2 = dom2.window, D2 = W2.document;
check('reopen renders 4 slides', D2.querySelectorAll('#filmstrip-list li').length === 4);
check('reopen keeps edited title', D2.querySelector('#filmstrip-list li:nth-child(2) .lbl').textContent === 'Edited');
check('reopen is clean', D2.querySelector('#dirty-flag').textContent === 'Saved');

// ---------- 6. presenter ----------
D2.querySelector('#btn-present').click();
await wait(100);
check('overlay opens', D2.querySelector('#present-overlay').hidden === false);
check('present counter 1/4', D2.querySelector('#present-count').textContent === '1 / 4');
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'ArrowRight' }));
check('right advances', D2.querySelector('#present-count').textContent === '2 / 4');
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
check('left goes back', D2.querySelector('#present-count').textContent === '1 / 4');
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'Escape' }));
await wait(100);
check('esc closes overlay', D2.querySelector('#present-overlay').hidden === true);

// ---------- 7. delete + model validation unit checks ----------
const n0 = D2.querySelectorAll('#filmstrip-list li').length;
D2.querySelector('#btn-delete').click();
await wait(100);
check('delete removes slide', D2.querySelectorAll('#filmstrip-list li').length === n0 - 1);
check('delete asked for confirm', W2.__confirms.length > 0);
const NM = W2.normalizeModel;
check('normalizeModel rejects garbage', NM(null) === null && NM({}) === null && NM({ app: 'browslide', version: 99 }) === null && NM({ app: 'browslide', version: 1 }) === null);
check('normalizeModel rejects empty slides', NM({ app: 'browslide', version: 1, slides: {}, slideOrder: [] }) === null);
const dirty = NM({ app: 'browslide', version: 2, title: 'T', theme: 'nope', slideOrder: ['s9'],
  slides: { s9: { layout: 'bogus', transition: 'bogus', html: '<h1>H</h1><script>e()<\/script>', notes: 1 } } });
check('normalizeModel repairs bad enums', dirty && dirty.theme === 'dark' && dirty.slides.s9.layout === 'title-body');
check('normalizeModel sanitizes html', dirty && !/script/i.test(dirty.slides.s9.html));

// ---------- 8. reorder + keyboard (Phase 2) ----------
const idsOf = () => Array.prototype.map.call(D2.querySelectorAll('#filmstrip-list li'), (li) => li.dataset.id);
check('filmstrip items are draggable', Array.prototype.every.call(D2.querySelectorAll('#filmstrip-list li'), (li) => li.draggable === true));
const activeBefore = D2.querySelector('#filmstrip-list li.active').dataset.id;
const stageBefore = D2.querySelector('#stage .slide').innerHTML;
const orderIds = idsOf();
const firstId = orderIds[0], lastId = orderIds[orderIds.length - 1];
check('moveSlideBefore reorders', W2.moveSlideBefore(lastId, firstId) === true && idsOf()[0] === lastId);
check('reorder keeps active slide + stage', D2.querySelector('#filmstrip-list li.active').dataset.id === activeBefore &&
  D2.querySelector('#stage .slide').innerHTML === stageBefore);
check('moveSlideBefore same-id is no-op', W2.moveSlideBefore(firstId, firstId) === false);
check('moveSlideBefore unknown id is no-op', W2.moveSlideBefore('s999', firstId) === false);
W2.gotoSlide(idsOf()[0]);
await wait(50);
D2.querySelector('#filmstrip-list li button').focus();
D2.querySelector('#filmstrip-list').dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
await wait(50);
check('filmstrip ArrowDown moves active', D2.querySelector('#filmstrip-list li.active').dataset.id === idsOf()[1]);
D2.querySelector('#notes').focus();
const guarded = D2.querySelector('#filmstrip-list li.active').dataset.id;
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
await wait(50);
check('PageDown ignored while editing notes', D2.querySelector('#filmstrip-list li.active').dataset.id === guarded);
// anything focused inside the contenteditable stage counts as editing too
const tmpInput = D2.createElement('input');
D2.querySelector('#stage .slide').appendChild(tmpInput);
tmpInput.focus();
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
await wait(50);
check('PageDown ignored for focus inside stage', D2.querySelector('#filmstrip-list li.active').dataset.id === guarded);
tmpInput.remove();
D2.querySelector('#btn-present').focus();
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
await wait(50);
check('PageDown navigates when not editing', D2.querySelector('#filmstrip-list li.active').dataset.id === idsOf()[2]);
D2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
await wait(50);
check('Home jumps to first slide', D2.querySelector('#filmstrip-list li.active').dataset.id === idsOf()[0]);

// ---------- 9. resources: dedup, sizes, cleanup, v1 migration (Phase 3) ----------
const dom3 = makeDom(html);
await wait(400);
const W3 = dom3.window, D3 = W3.document;
check('template starter is v2 with empty resources',
  W3.App.model.version === 2 && Object.keys(W3.App.model.resources).length === 0);
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
W3.insertFile(new W3.File([pngBytes], 'a.png', { type: 'image/png' }), 'image');
await wait(500);
const rids3 = () => Object.keys(W3.App.model.resources);
check('insert creates one resource', rids3().length === 1, rids3().join(','));
const r1 = W3.App.model.resources[rids3()[0]];
check('resource record has mime/size/hash', r1 && r1.mime === 'image/png' && r1.size > 0 && !!r1.hash);
check('slide html stores res:// ref', W3.activeSlide().html.includes('res://' + rids3()[0]));
const stageImg = D3.querySelector('#stage img');
check('stage expands ref to data: URI', !!stageImg && stageImg.src.startsWith('data:image/png'));
W3.updateSize();
check('sizes panel lists the file', D3.querySelector('#sizes-body').textContent.includes('a.png'),
  D3.querySelector('#sizes-body').textContent.slice(0, 120));
D3.querySelector('#btn-add').click();
await wait(100);
W3.insertFile(new W3.File([pngBytes], 'copy-of-a.png', { type: 'image/png' }), 'image');
await wait(500);
check('identical file deduplicated to one resource', rids3().length === 1);
check('both slides share the same ref', W3.App.model.slideOrder.slice(0, 2).every((id) => W3.App.model.slides[id].html.includes('res://' + rids3()[0])));
D3.querySelector('#btn-save').click();
await wait(100);
const t3 = await blobToText(W3.__savedBlob, W3);
const dom4 = makeDom(t3);
await wait(400);
const W4 = dom4.window, D4 = W4.document;
check('reopen preserves resources', Object.keys(W4.App.model.resources).length === 1);
W4.gotoSlide(W4.App.model.slideOrder[1]);
await wait(50);
const reImg = D4.querySelector('#stage img');
check('reopen renders shared image', !!reImg && reImg.src.startsWith('data:image/png'));
// delete both image slides -> resource unused -> cleanup
D4.querySelector('#btn-delete').click();
await wait(100);
D4.querySelector('#btn-delete').click();
await wait(100);
W4.updateSize();
check('sizes panel flags unused file', /UNUSED/.test(D4.querySelector('#sizes-body').textContent));
check('removeUnusedMedia drops it', W4.removeUnusedMedia() === 1 && Object.keys(W4.App.model.resources).length === 0);
check('cleanup is a no-op when clean', W4.removeUnusedMedia() === 0);
// malformed v2 resource entries are dropped, counter repaired
const bad2 = { app: 'browslide', version: 2, title: 'B', theme: 'default', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  slides: { s1: { title: 'B', layout: 'blank', transition: 'none', html: '<p>x</p>', notes: '' } },
  resources: { r1: { name: 'evil', data: 'not-a-data-url' }, nope: { name: 'n', data: 'data:image/png;base64,AAA=' }, r5: { name: 'ok.png', data: 'data:image/png;base64,AAA=' } } };
const fixed = W3.normalizeModel(JSON.parse(JSON.stringify(bad2)));
check('malformed resources dropped', fixed && Object.keys(fixed.resources).length === 1 && !!fixed.resources.r5);
check('resource counter repaired', fixed && fixed.nextResId === 6);
// large-video guidance
let asked = [];
W3.confirm = (m) => { asked.push(m); return false; };
W3.insertFile(new W3.File([new Uint8Array(9 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' }), 'video');
check('big video asks with size info', asked.length === 1 && /video/i.test(asked[0]) && /MB/.test(asked[0]), asked[0] || '');
check('declined insert adds nothing', !D3.querySelector('#stage video') && rids3().length === 1);
W3.confirm = () => true;
W3.insertFile(new W3.File([new Uint8Array(9 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' }), 'video');
await wait(800);
check('accepted big video embeds once', !!D3.querySelector('#stage video') && rids3().length === 2);
W3.updateSize();
check('sizes panel flags large file', /large/.test(D3.querySelector('#sizes-body').textContent));

// ---------- 10. viewer export (Phase 4) ----------
const dom5 = makeDom(html);
await wait(400);
const W5 = dom5.window, D5 = W5.document;
W5.insertFile(new W5.File([pngBytes], 'pic.png', { type: 'image/png' }), 'image');
await wait(500);
let dlName = '';
const origDl = W5.downloadBlob;
W5.downloadBlob = (b, n) => { dlName = n; origDl(b, n); };
D5.querySelector('#btn-export').click();
await wait(100);
check('export produced a blob', !!W5.__savedBlob);
check('export filename ends -viewer.html', /-viewer\.html$/.test(dlName), dlName);
const exText = await blobToText(W5.__savedBlob, W5);
const exDoc = new JSDOM(exText).window.document;
check('export has deck with all slides', exDoc.querySelectorAll('#deck .slide').length === 3);
const exImg = exDoc.querySelector('#deck img');
check('export inlines image as data:', !!exImg && exImg.src.startsWith('data:image/png'));
check('export has player bar', !!exDoc.querySelector('#bar #prev') && !!exDoc.querySelector('#bar #next') &&
  !!exDoc.querySelector('#bar #count') && !!exDoc.querySelector('#bar #fs'));
check('export excludes editor shell', !exDoc.querySelector('#filmstrip') && !exDoc.querySelector('#toolbar') &&
  !exDoc.querySelector('#stage') && !exDoc.querySelector('#slider-data'));
const exScripts = Array.prototype.map.call(exDoc.querySelectorAll('script'), (s) => s.textContent).join('\n');
check('export excludes editor code', !/slider-data|contentEditable|normalizeModel|renderFilmstrip|syncStageToModel/.test(exScripts) && exScripts.length < 4096, exScripts.length + ' chars player JS');
check('export carries theme', exDoc.querySelector('body').getAttribute('data-theme') === 'dark');
check('export keeps dirty state', D5.querySelector('#dirty-flag').textContent.includes('Unsaved'));
const dom6 = makeDom(exText);
await wait(400);
const W6 = dom6.window, D6 = W6.document;
check('viewer boots on slide 1', D6.querySelector('#count').textContent === '1 / 3');
D6.dispatchEvent(new W6.KeyboardEvent('keydown', { key: 'ArrowRight' }));
check('viewer ArrowRight advances', D6.querySelector('#count').textContent === '2 / 3');
D6.dispatchEvent(new W6.KeyboardEvent('keydown', { key: ' ' }));
check('viewer Space advances', D6.querySelector('#count').textContent === '3 / 3');
D6.dispatchEvent(new W6.KeyboardEvent('keydown', { key: 'ArrowRight' }));
check('viewer clamps at end', D6.querySelector('#count').textContent === '3 / 3');
D6.dispatchEvent(new W6.KeyboardEvent('keydown', { key: 'Home' }));
check('viewer Home works', D6.querySelector('#count').textContent === '1 / 3');
D6.querySelector('#deck').dispatchEvent(new W6.MouseEvent('click', { bubbles: true }));
check('viewer click advances', D6.querySelector('#count').textContent === '2 / 3');
D6.querySelector('#prev').click();
check('viewer Prev button works', D6.querySelector('#count').textContent === '1 / 3');
D6.querySelector('#next').click();
check('viewer Next button works', D6.querySelector('#count').textContent === '2 / 3');
D6.dispatchEvent(new W6.KeyboardEvent('keydown', { key: 'f' }));
check('viewer F key does not throw', D6.querySelector('#count').textContent === '2 / 3');

// ---------- 11. compression plumbing with injected backend (Phase 5) ----------
// Real native interop is proven by tests/codec.mjs; here the save/load plumbing,
// using a tiny reversible RLE stand-in (shrinks runs, like deflate does).
function rlePack(u8){
  const out = [];
  for (let i = 0; i < u8.length;) {
    let j = i + 1;
    while (j < u8.length && u8[j] === u8[i] && j - i < 255) j++;
    const run = j - i;
    if (run >= 4) out.push(255, run, u8[i]);
    else for (let k = i; k < j; k++) { if (u8[k] === 255) out.push(255, 0); else out.push(u8[k]); }
    i = j;
  }
  return new Uint8Array(out);
}
function rleUnpack(u8){
  const out = [];
  for (let i = 0; i < u8.length;) {
    if (u8[i] === 255) {
      if (u8[i + 1] === 0) { out.push(255); i += 2; }
      else { for (let k = 0; k < u8[i + 1]; k++) out.push(u8[i + 2]); i += 3; }
    } else { out.push(u8[i]); i++; }
  }
  return new Uint8Array(out);
}
const dom7 = makeDom(html);
await wait(400);
const W7 = dom7.window, D7 = W7.document;
W7.Codec.backend = { compress: (b) => rlePack(b), decompress: (b) => rleUnpack(b) };
check('backend makes codec supported', W7.Codec.supported() === true);
const rawS = new Uint8Array(3000); rawS.fill(65);
const c7 = await W7.Codec.compress(rawS, 'deflate-raw');
const b7 = await W7.Codec.decompress(c7, 'deflate-raw');
check('backend round-trip through Codec', c7.length < rawS.length && b7.length === rawS.length && b7.every((v, i) => v === rawS[i]), `${rawS.length} -> ${c7.length}`);
// synthetic compressible resource straight into the model
const txtB64 = Buffer.from('A'.repeat(3000)).toString('base64');
const txtUri = 'data:text/plain;base64,' + txtB64;
const tid = W7.ensureResource(W7.App.model, txtUri, 'big.txt');
D7.querySelector('#btn-save').click();
await wait(500);
const t7 = await blobToText(W7.__savedBlob, W7);
const savedJson = JSON.parse(new JSDOM(t7).window.document.querySelector('#slider-data').textContent);
check('compressible resource stored deflated', savedJson.resources[tid].encoding === 'deflate-raw' && !savedJson.resources[tid].data.startsWith('data:'));
check('deflated payload smaller', savedJson.resources[tid].data.length < txtB64.length, savedJson.resources[tid].data.length + ' < ' + txtB64.length);
check('save stats reported', /compressed/.test(D7.querySelector('#compress-stats').textContent), D7.querySelector('#compress-stats').textContent);
// manual normalize + decode of the saved file
const savedModel = W7.normalizeModel(JSON.parse(JSON.stringify(savedJson)));
check('saved model keeps deflated entry pre-decode', savedModel.resources[tid].encoding === 'deflate-raw');
await W7.decodeModelResources(savedModel);
check('decode restores raw data URI', savedModel.resources[tid].encoding === 'raw' && savedModel.resources[tid].data === txtUri);
// full openFile path decodes too
W7.openFile(new W7.File([t7], 're.html', { type: 'text/html' }));
await wait(800);
check('openFile decodes compressed entries', W7.App.model.resources[tid] && W7.App.model.resources[tid].encoding === 'raw' && W7.App.model.resources[tid].data === txtUri);
// unsupported browser drops undecodable entries instead of crashing
W7.Codec.backend = null;
check('codec unsupported without backend or API', W7.Codec.supported() === false);
const encModel = { app: 'browslide', version: 2, title: 'E', theme: 'default', slideOrder: ['s1'], nextId: 2, nextResId: 2,
  settings: { compress: true, downscale: false, maxDim: 1920 },
  slides: { s1: { title: 'E', layout: 'blank', transition: 'none', html: '<p><img src="res://r1"></p>', notes: '' } },
  resources: { r1: { name: 't', mime: 'text/plain', size: 4, hash: 'h', data: 'QUJD', encoding: 'deflate-raw' } } };
const nmE = W7.normalizeModel(JSON.parse(JSON.stringify(encModel)));
check('compressed entry survives normalize', nmE && nmE.resources.r1.encoding === 'deflate-raw');
await W7.decodeModelResources(nmE);
check('unsupported browser drops undecodable entries', nmE && Object.keys(nmE.resources).length === 0);
W7.Codec.backend = { compress: (b) => rlePack(b), decompress: (b) => rleUnpack(b) };
// policy: png stays raw even with a backend; per-file override works
W7.insertFile(new W7.File([pngBytes], 'p.png', { type: 'image/png' }), 'image');
await wait(500);
W7.updateSize();
const sizeBtns = D7.querySelectorAll('#sizes-body button');
check('only compressible rows get override button', sizeBtns.length === 1, sizeBtns.length + ' button(s)');
const sizeBtnText = () => D7.querySelector('#sizes-body button').textContent;
D7.querySelector('#sizes-body button').click();
check('override button toggles to raw', sizeBtnText().includes('raw'), sizeBtnText());
D7.querySelector('#btn-save').click();
await wait(500);
const t7b = await blobToText(W7.__savedBlob, W7);
const sj2 = JSON.parse(new JSDOM(t7b).window.document.querySelector('#slider-data').textContent);
const pngId = Object.keys(sj2.resources).find((id) => sj2.resources[id].mime === 'image/png');
check('png skipped by policy (stays raw)', sj2.resources[pngId].encoding === 'raw');
check('noCompress override respected', sj2.resources[tid].encoding === 'raw');
D7.querySelector('#sizes-body button').click();
check('override button toggles back to auto', sizeBtnText().includes('auto'), sizeBtnText());
// downscale decisions + wiring (canvas itself is browser-only; seam-tested here)
const mk = (n, t) => new W7.File([new Uint8Array([1, 2, 3])], n, { type: t });
W7.App.model.settings.downscale = false;
check('downscale off by default', W7.shouldDownscale(mk('p.png', 'image/png')) === false);
W7.App.model.settings.downscale = true;
check('downscale decision matrix',
  W7.shouldDownscale(mk('p.png', 'image/png')) === true &&
  W7.shouldDownscale(mk('p.jpg', 'image/jpeg')) === true &&
  W7.shouldDownscale(mk('a.gif', 'image/gif')) === false &&
  W7.shouldDownscale(mk('v.svg', 'image/svg+xml')) === false &&
  W7.shouldDownscale(mk('m.mp4', 'video/mp4')) === false);
W7.downscaleImage = (url) => Promise.resolve('data:image/png;base64,DOWNSCALEDSTUB');
W7.insertFile(new W7.File([pngBytes], 'big.png', { type: 'image/png' }), 'image');
await wait(500);
check('insert uses downscale result', Object.values(W7.App.model.resources).some((r) => r.data.includes('DOWNSCALEDSTUB')));
// settings persist through save + boot
D7.querySelector('#opt-compress').checked = false;
D7.querySelector('#opt-compress').dispatchEvent(new W7.Event('change', { bubbles: true }));
D7.querySelector('#opt-downscale').checked = true;
D7.querySelector('#opt-downscale').dispatchEvent(new W7.Event('change', { bubbles: true }));
D7.querySelector('#opt-maxdim').value = '1280';
D7.querySelector('#opt-maxdim').dispatchEvent(new W7.Event('change', { bubbles: true }));
D7.querySelector('#btn-save').click();
await wait(500);
const t7c = await blobToText(W7.__savedBlob, W7);
const sj3 = JSON.parse(new JSDOM(t7c).window.document.querySelector('#slider-data').textContent);
check('settings saved', sj3.settings.compress === false && sj3.settings.downscale === true && sj3.settings.maxDim === 1280, JSON.stringify(sj3.settings));
const dom9 = makeDom(t7c);
await wait(400);
const D9 = dom9.window.document;
check('settings restored to UI on boot', D9.querySelector('#opt-compress').checked === false && D9.querySelector('#opt-downscale').checked === true && D9.querySelector('#opt-maxdim').value === '1280');

// ---------- 12. media bytes stored exactly once in save/export (dup regression) ----------
const domD = makeDom(html);
await wait(400);
const WD = domD.window, DD = WD.document;
const photo = new Uint8Array(2048);
for (let i = 0; i < photo.length; i++) photo[i] = i % 251;
WD.insertFile(new WD.File([photo], 'photo.jpg', { type: 'image/jpeg' }), 'image');
await wait(500);
const payloadOf = () => Object.values(WD.App.model.resources)[0].data.split(',')[1];
const copiesIn = (text) => text.split(payloadOf()).length - 1;
DD.querySelector('#btn-save').click();
await wait(300);
const tD = await blobToText(WD.__savedBlob, WD);
check('save stores media bytes once', copiesIn(tD) === 1, copiesIn(tD) + ' copies');
check('save has no expanded stage DOM', !new JSDOM(tD).window.document.querySelector('#stage .slide'));
DD.querySelector('#btn-export').click();
await wait(300);
const xD = await blobToText(WD.__savedBlob, WD);
check('export stores media bytes once', xD.split(payloadOf()).length - 1 === 1);
const domE = makeDom(tD);
await wait(400);
const WE = domE.window, DE = WE.document;
const dupImg = DE.querySelector('#stage img');
check('dup-free save reopens with image', !!dupImg && dupImg.src.startsWith('data:image/jpeg'));
DE.querySelector('#btn-save').click();
await wait(300);
const tE = await blobToText(WE.__savedBlob, WE);
check('re-save stays single-copy', tE.split(payloadOf()).length - 1 === 1);
WD.updateSize();
check('sizes row explains skipping', /already compressed format/.test(DD.querySelector('#sizes-body').textContent));
// large photo + no backend: stats must point at downscale, not compression
WD.insertFile(new WD.File([new Uint8Array(1500000)], 'big.png', { type: 'image/png' }), 'image');
await wait(500);
DD.querySelector('#btn-save').click();
await wait(300);
check('stats suggest downscale for big photos', /Downscale/.test(DD.querySelector('#compress-stats').textContent), DD.querySelector('#compress-stats').textContent);

// ---------- 13. responsive sizing + aspect ratio ----------
const domF = makeDom(html);
await wait(400);
const WF = domF.window, DF = WF.document;
const stSec = () => DF.querySelector('#stage .slide');
check('default aspect 16:9', JSON.stringify(WF.App.model.aspect) === JSON.stringify({ w: 16, h: 9 }));
check('stage slide has fitted px size', stSec().style.width === '200px' && stSec().style.height === '112px', stSec().style.width + 'x' + stSec().style.height);
check('stage slide aspect + scaled type', stSec().style.aspectRatio === '16 / 9' && stSec().style.fontSize === '10px', stSec().style.aspectRatio + ' / ' + stSec().style.fontSize);
DF.querySelector('#aspect-select').value = '4:3';
DF.querySelector('#aspect-select').dispatchEvent(new WF.Event('change', { bubbles: true }));
check('4:3 applies to model + stage', WF.App.model.aspect.w === 4 && WF.App.model.aspect.h === 3 && stSec().style.height === '150px' && DF.querySelector('#aspect-select').value === '4:3');
DF.querySelector('#aspect-w').value = '7';
DF.querySelector('#aspect-w').dispatchEvent(new WF.Event('change', { bubbles: true }));
DF.querySelector('#aspect-h').value = '5';
DF.querySelector('#aspect-h').dispatchEvent(new WF.Event('change', { bubbles: true }));
check('custom aspect via inputs', WF.App.model.aspect.w === 7 && WF.App.model.aspect.h === 5 && DF.querySelector('#aspect-select').value === 'custom' && DF.querySelector('#aspect-custom').hidden === false);
DF.querySelector('#aspect-w').value = '';
DF.querySelector('#aspect-w').dispatchEvent(new WF.Event('change', { bubbles: true }));
check('invalid aspect ignored', WF.App.model.aspect.w === 7);
const NM2 = WF.normalizeModel;
const baseM = { app: 'browslide', version: 2, title: 'T', theme: 'default', slideOrder: ['s1'], nextId: 2, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', html: '<p>x</p>', notes: '' } } };
check('bad aspect falls back to 16:9', JSON.stringify(NM2(Object.assign({}, baseM, { aspect: { w: 0, h: 300 } })).aspect) === JSON.stringify({ w: 16, h: 9 }));
check('valid aspect kept', JSON.stringify(NM2(Object.assign({}, baseM, { aspect: { w: 4, h: 3 } })).aspect) === JSON.stringify({ w: 4, h: 3 }));
check('missing aspect defaults', JSON.stringify(NM2(baseM).aspect) === JSON.stringify({ w: 16, h: 9 }));
DF.querySelector('#btn-present').click();
await wait(100);
const pSec = DF.querySelector('#present-slide .slide');
check('present slide fitted, overlay open', !!pSec && !!pSec.style.width && DF.querySelector('#present-overlay').hidden === false, pSec && pSec.style.width);
DF.dispatchEvent(new WF.KeyboardEvent('keydown', { key: 'Escape' }));
await wait(100);
DF.querySelector('#btn-export').click();
await wait(100);
const exT = await blobToText(WF.__savedBlob, WF);
check('export bakes aspect css', exT.includes('#deck .slide{aspect-ratio:7/5}'));
check('export player gets AR constants', exT.includes('AR_W=7') && exT.includes('AR_H=5') && !exT.includes('@AR_'));
const domG = makeDom(exT);
await wait(400);
check('exported viewer fits slide', !!domG.window.document.querySelector('#deck .slide').style.width);

// custom preset reveals inputs without snapping back (regression)
const domH = makeDom(html);
await wait(400);
const WH = domH.window, DH = WH.document;
DH.querySelector('#aspect-select').value = 'custom';
DH.querySelector('#aspect-select').dispatchEvent(new WH.Event('change', { bubbles: true }));
check('custom reveals inputs, keeps preset model', DH.querySelector('#aspect-select').value === 'custom' && DH.querySelector('#aspect-custom').hidden === false && WH.App.model.aspect.w === 16 && WH.App.model.aspect.h === 9);
DH.querySelector('#aspect-w').value = '7';
DH.querySelector('#aspect-w').dispatchEvent(new WH.Event('change', { bubbles: true }));
DH.querySelector('#aspect-h').value = '5';
DH.querySelector('#aspect-h').dispatchEvent(new WH.Event('change', { bubbles: true }));
check('custom inputs apply', WH.App.model.aspect.w === 7 && WH.App.model.aspect.h === 5 && DH.querySelector('#aspect-select').value === 'custom');

// ---------- 14. dark default + present toolbar toggle ----------
const domK = makeDom(html);
await wait(400);
const WK = domK.window, DK = WK.document;
check('dark is the default theme', DK.body.getAttribute('data-theme') === 'dark' && WK.App.model.theme === 'dark');
check('toolbar shown by default', WK.App.model.settings.showBar === true && DK.querySelector('#opt-showbar').checked === true);
DK.querySelector('#opt-showbar').checked = false;
DK.querySelector('#opt-showbar').dispatchEvent(new WK.Event('change', { bubbles: true }));
DK.querySelector('#btn-present').click();
await wait(100);
check('toolbar hidden in presentation', DK.querySelector('#present-bar').style.display === 'none' && !!DK.querySelector('#present-slide .slide').style.width);
DK.dispatchEvent(new WK.KeyboardEvent('keydown', { key: 'Escape' }));
await wait(100);
DK.querySelector('#opt-showbar').checked = true;
DK.querySelector('#opt-showbar').dispatchEvent(new WK.Event('change', { bubbles: true }));
DK.querySelector('#btn-export').click();
await wait(100);
const exK = await blobToText(WK.__savedBlob, WK);
check('export keeps toolbar when enabled', !!new JSDOM(exK).window.document.querySelector('#bar #count'));
DK.querySelector('#opt-showbar').checked = false;
DK.querySelector('#opt-showbar').dispatchEvent(new WK.Event('change', { bubbles: true }));
DK.querySelector('#btn-export').click();
await wait(100);
const exK2 = await blobToText(WK.__savedBlob, WK);
check('export omits toolbar when disabled', !new JSDOM(exK2).window.document.querySelector('#bar'));
const domL = makeDom(exK2);
await wait(400);
const WL = domL.window, DL = WL.document;
DL.dispatchEvent(new WL.KeyboardEvent('keydown', { key: 'ArrowRight' }));
const vSecs = DL.querySelectorAll('#deck .slide');
check('toolbar-less viewer still navigates', vSecs[0].hidden === true && vSecs[1].hidden === false);
const NMK = WK.normalizeModel;
const noSet = { app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', html: '<p>x</p>', notes: '' } } };
check('showBar defaults true', NMK(JSON.parse(JSON.stringify(noSet))).settings.showBar === true);
noSet.settings = { showBar: false };
check('showBar false preserved', NMK(JSON.parse(JSON.stringify(noSet))).settings.showBar === false);

// ---------- 15. maximum fullscreen toggle ----------
const domM = makeDom(html);
await wait(400);
const WM = domM.window, DM = WM.document;
check('tight defaults off', WM.App.model.settings.tight === false && DM.querySelector('#opt-tight').checked === false);
check('present settings group exists', !!DM.querySelector('#present-settings summary') && !!DM.querySelector('#opt-showbar') && !!DM.querySelector('#opt-tight'));
DM.querySelector('#btn-export').click();
await wait(300);
check('export bakes TIGHT=0 by default', (await blobToText(WM.__savedBlob, WM)).includes('TIGHT=0'));
DM.querySelector('#opt-tight').checked = true;
DM.querySelector('#opt-tight').dispatchEvent(new WM.Event('change', { bubbles: true }));
DM.querySelector('#btn-save').click();
await wait(300);
const tM = await blobToText(WM.__savedBlob, WM);
check('tight persists in save', JSON.parse(new JSDOM(tM).window.document.querySelector('#slider-data').textContent).settings.tight === true);
DM.querySelector('#btn-export').click();
await wait(300);
const exM = await blobToText(WM.__savedBlob, WM);
check('export bakes TIGHT=1 and no tokens left', exM.includes('TIGHT=1') && !exM.includes('@TIGHT@') && !exM.includes('@AR_'));
const domN = makeDom(exM);
await wait(400);
check('tight viewer boots fitted', !!domN.window.document.querySelector('#deck .slide').style.width);
const NMT = WM.normalizeModel;
const nsM = { app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', html: '<p>x</p>', notes: '' } } };
check('tight defaults false in model', NMT(JSON.parse(JSON.stringify(nsM))).settings.tight === false);

// ---------- 16. filmstrip add/delete buttons + settings placement ----------
const domP = makeDom(html);
await wait(400);
const WP = domP.window, DP = WP.document;
const liCount = () => DP.querySelectorAll('#filmstrip-list li').length;
check('filmstrip add + per-slide delete buttons exist', !!DP.querySelector('#btn-add-end') && DP.querySelectorAll('#filmstrip-list li button.del').length === 3);
DP.querySelector('#btn-add-end').click();
await wait(100);
check('plus appends at end and selects', liCount() === 4 && DP.querySelector('#pos-flag').textContent === '4 / 4' && WP.App.model.slideOrder[3] === WP.App.activeId);
DP.querySelector('#filmstrip-list li:first-child button.del').click();
await wait(100);
check('row delete removes that slide', liCount() === 3 && WP.App.model.slideOrder[0] === 's2');
DP.querySelector('#filmstrip-list li:first-child button.del').click();
await wait(100);
DP.querySelector('#filmstrip-list li:first-child button.del').click();
await wait(100);
DP.querySelector('#filmstrip-list li:first-child button.del').click();
await wait(100);
check('last slide cannot be row-deleted', liCount() === 1 && WP.__alerts.length > 0);
check('compress lives in sizes menu', !!DP.querySelector('#sizes-wrap #opt-compress') && !!DP.querySelector('#sizes-wrap #compress-stats'));
check('downscale lives in insert menu', !!DP.querySelector('#insert-wrap #opt-downscale') && !!DP.querySelector('#insert-wrap #opt-maxdim'));
check('save-opts removed', !DP.querySelector('#save-opts'));

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
