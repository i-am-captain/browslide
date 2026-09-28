import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Behavioral tests for browslide.html (jsdom round-trip + units). Run: npm install && npm test
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
['<title>Browslide</title>', '/* ================= CSS ================= */', '<header id="toolbar">',
 '<div id="main">', 'id="present-overlay"', 'id="open-file"', 'id="slider-data"',
 '/* ================= UTIL ================= */', '/* ================= MODEL ================= */',
 '/* ---- optional lossless compression: native deflate, zero dependencies ----',
 '/* ---- resources table: slides store res://id refs, binaries live once in model.resources ---- */',
 '/* ================= STORE (IndexedDB autosave) ================= */', '/* ================= RENDER ================= */',
 '/* ================= EDIT ================= */', '/* ================= PRESENT ================= */',
 '/* ================= EXPORT VIEWER =================', '/* ================= SAVE / OPEN / NEW ================= */',
 '/* ================= SIZE METER ================= */', '/* ================= EVENTS + BOOT ================= */',
 'function boot(){'
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
// ---------- 0c. anim settings: labels share a row with fields, wide sidebar ----------
const aline = (headCss.match(/#anim-rows \.aline\{[^}]*\}/) || [''])[0];
check('anim rows are label-left/field-right flex rows',
  aline.includes('display:flex') && aline.includes('flex-direction:row'));
const mainGrid = (headCss.match(/#main\{[^}]*\}/) || [''])[0];
check('sidebar fits label+field rows', /300px/.test(mainGrid));
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
check('export excludes editor code', !/slider-data|contentEditable|normalizeModel|renderFilmstrip|syncStageToModel/.test(exScripts) && exScripts.length < 16000, exScripts.length + ' chars player JS');
check('viewer player carries shape keyframes', /paintShape/.test(exScripts) && /slen/.test(exScripts));
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

// ---------- 11. compression plumbing with injected backend ----------
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
const repoA = DP.querySelector('#repo-link a');
check('repo link with icon at inspector bottom', !!repoA && repoA.href === 'https://github.com/i-am-captain/browslide' && !!repoA.querySelector('svg') && DP.querySelector('#inspector').lastElementChild.id === 'repo-link');

// ---------- 17. format bar (execCommand itself is browser-only; structure + units here) ----------
const domQ = makeDom(html);
await wait(400);
const WQ = domQ.window, DQ = WQ.document;
check('font select lists system fonts only', DQ.querySelectorAll('#font-select option').length === 9 &&
  Array.prototype.every.call(DQ.querySelectorAll('#font-select option'), (o) => !/google|http/i.test(o.value) && !/google|http/i.test(o.textContent)));
check('size select offers em steps', DQ.querySelectorAll('#size-select option').length === 16 &&
  DQ.querySelector('#size-select').value === '1em');
const cmds = Array.prototype.map.call(DQ.querySelectorAll('#formatbar button[data-cmd]'), (b) => b.dataset.cmd);
check('format buttons cover style/align/lists/clear', ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList', 'clear'].every((c) => cmds.includes(c)));
const mdEv = new WQ.MouseEvent('mousedown', { bubbles: true, cancelable: true });
DQ.querySelector('#formatbar button[data-cmd="bold"]').dispatchEvent(mdEv);
check('format mousedown keeps selection', mdEv.defaultPrevented === true);
DQ.querySelector('#formatbar button[data-cmd="bold"]').click();
await wait(100);
check('format click without editing API does not crash', WQ.__alerts.length === 0);
const secQ = DQ.querySelector('#stage .slide');
secQ.innerHTML = '<p>ab<font size="7">cd</font>ef</p>';
WQ.replaceFontTag(secQ.querySelector('font'));
check('font markers convert to styled spans', secQ.querySelectorAll('font').length === 0 &&
  secQ.querySelector('span').style.fontSize === '3em' && secQ.textContent === 'abcdef');
check('restoreSelection false outside stage', WQ.restoreSelection() === false);
WQ.updateFormatUI();
check('no active states outside stage', DQ.querySelectorAll('#formatbar button.active').length === 0);
const fmtM = { app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2,
  slides: { s1: { title: 'T', layout: 'blank', transition: 'none', notes: '',
    html: '<p><b>B</b><i>I</i><u>U</u><s>S</s><span style="font-size:2em">x</span><ul><li>y</li></ul></p>' } } };
const fmtH = WQ.normalizeModel(JSON.parse(JSON.stringify(fmtM))).slides.s1.html;
check('formatting tags survive sanitize', /<b>B<\/b>/.test(fmtH) && /<i>I<\/i>/.test(fmtH) && /<u>U<\/u>/.test(fmtH) &&
  /<s>S<\/s>/.test(fmtH) && /font-size:2em/.test(fmtH) && /<ul>/.test(fmtH));

// ---------- 18. format reflection + tiny sizes ----------
const domR = makeDom(html);
await wait(400);
const WR = domR.window, DR = WR.document;
check('size select goes down to 2px', DR.querySelectorAll('#size-select option').length === 16 &&
  DR.querySelector('#size-select option').value === '0.125em' && DR.querySelector('#size-select option').textContent === '2');
const rSec = DR.querySelector('#stage .slide');
rSec.innerHTML = '<p>plain <span style="font-family:Georgia,serif;font-size:2em">fancy</span> tail</p>';
const fancy = rSec.querySelector('span').firstChild;
const rng = DR.createRange();
rng.selectNodeContents(fancy);
DR.getSelection().addRange(rng);
WR.updateFormatUI();
check('font select follows cursor', DR.querySelector('#font-select').value.indexOf('Georgia') === 0, DR.querySelector('#font-select').value);
check('size select follows cursor', DR.querySelector('#size-select').value === '2em');
check('nearestStyleValue walks up', WR.nearestStyleValue(fancy, ['fontFamily']).indexOf('Georgia') === 0 &&
  WR.nearestStyleValue(fancy, ['fontSize']) === '2em' && WR.nearestStyleValue(rSec, ['fontSize']) === '');
check('primaryFamily normalizes', WR.primaryFamily('\'Times New Roman\', Times, serif') === 'times new roman' && WR.primaryFamily('Arial') === 'arial');
const rng2 = DR.createRange();
rng2.selectNodeContents(rSec.querySelector('p').firstChild);
DR.getSelection().removeAllRanges();
DR.getSelection().addRange(rng2);
WR.updateFormatUI();
check('plain text resets selects to slide default', DR.querySelector('#font-select').selectedIndex === 0 && DR.querySelector('#size-select').value === '1em');
// ---------- 19. font leftovers impossible + selection robustness ----------
secQ.innerHTML = '<p>a<font size="3">b</font>c<font>d</font>e<font face="Georgia">f</font></p>';
Array.prototype.forEach.call(secQ.querySelectorAll('font'), function(f){ WQ.replaceFontTag(f); });
check('any font tag converts without pending style', secQ.querySelectorAll('font').length === 0 &&
  /font-size:\s*1em/.test(secQ.innerHTML) && secQ.innerHTML.includes('Georgia') && secQ.textContent === 'abcdef');
secQ.innerHTML = '<p>x<font size="7">s</font></p>';
WQ.syncStageToModel();
check('sync path safety-net converts font tags', /font-size:\s*3em/.test(WQ.activeSlide().html) && !WQ.activeSlide().html.includes('<font'));
const trng = DR.createRange();
trng.selectNodeContents(rSec.querySelector('p').firstChild);
DR.getSelection().removeAllRanges();
DR.getSelection().addRange(trng);
DR.dispatchEvent(new WR.Event('selectionchange'));
await wait(250);
check('selectionchange tracks synchronously', WR.restoreSelection() === true);
WR.refocusStage();
check('refocus does not throw', WR.__alerts.length === 0);

// ---------- 20. pending type-ahead format ----------
const domS = makeDom(html);
await wait(400);
const WS = domS.window, DS = WS.document;
check('no pending initially', WS.pendingFormat === null);
DS.querySelector('#formatbar button[data-cmd="bold"]').click();
await wait(100);
check('failed apply leaves no pending', WS.pendingFormat === null);
WS.pendingFormat = { fontFamily: 'Georgia,serif', fontSize: '2em', cmds: { bold: true } };
WS.updateFormatUI();
check('pending paints controls', DS.querySelector('#font-select').value.indexOf('Georgia') === 0 &&
  DS.querySelector('#size-select').value === '2em' &&
  DS.querySelector('#formatbar button[data-cmd="bold"]').classList.contains('active'));
DS.getSelection().removeAllRanges();
DS.dispatchEvent(new WS.Event('selectionchange'));
await wait(250);
check('pending survives selection churn', DS.querySelector('#size-select').value === '2em');
DS.querySelector('#stage-wrap').dispatchEvent(new WS.MouseEvent('click', { bubbles: true }));
check('placement click clears pending', WS.pendingFormat === null);
WS.pendingFormat = { fontFamily: null, fontSize: null, cmds: {} };
WS.gotoSlide(WS.App.model.slideOrder[1]);
check('navigation clears pending', WS.pendingFormat === null);
const prng = DS.createRange();
prng.selectNodeContents(DS.querySelector('#stage .slide'));
DS.getSelection().removeAllRanges();
DS.getSelection().addRange(prng);
DS.dispatchEvent(new WS.Event('selectionchange'));
await wait(100);
WS.pendingFormat = { fontFamily: null, fontSize: '3em', cmds: {} };
WS.refocusStage();
check('refocus without editing API is safe', WS.pendingFormat.fontSize === '3em' && WS.__alerts.length === 0);

// ---------- 21. span wrapping, block styles, pending capture ----------
const domT = makeDom(html);
await wait(400);
const WT = domT.window, DT = WT.document;
check('style select offers paragraph + headings', Array.prototype.map.call(DT.querySelectorAll('#style-select option'), (o) => o.value).join(',') === 'p,h1,h2,h3');
const wSec = DT.querySelector('#stage .slide');
wSec.innerHTML = '<p>hello world</p>';
const wTxt = wSec.querySelector('p').firstChild;
const wrng = DT.createRange();
wrng.setStart(wTxt, 0);
wrng.setEnd(wTxt, 5);
DT.getSelection().removeAllRanges();
DT.getSelection().addRange(wrng);
check('wrapSelectionInSpan wraps with style', WT.wrapSelectionInSpan('fontSize', '2em') === true &&
  wSec.querySelectorAll('font').length === 0 &&
  wSec.querySelector('span').style.fontSize === '2em' &&
  wSec.textContent === 'hello world');
check('wrap keeps selection on the span', DT.getSelection().anchorNode === wSec.querySelector('span'));
const crng = DT.createRange();
crng.setStart(wTxt, 0);
crng.collapse(true);
DT.getSelection().removeAllRanges();
DT.getSelection().addRange(crng);
check('wrap refuses collapsed selection', WT.wrapSelectionInSpan('fontSize', '2em') === false);
const orng = DT.createRange();
orng.selectNodeContents(DT.querySelector('.brand'));
DT.getSelection().removeAllRanges();
DT.getSelection().addRange(orng);
check('wrap refuses outside-stage selection', WT.wrapSelectionInSpan('fontSize', '2em') === false);
check('emOfSize parses em/px', WT.emOfSize('1.5em') === 1.5 && WT.emOfSize('24px') === 1.5 && WT.emOfSize('bogus') === 0);
check('sizeOptionForEm matches/snaps', WT.sizeOptionForEm(2) === 12 && WT.sizeOptionForEm(0.3) === -1);
wSec.innerHTML = '<h2>Head <span style="font-family:Georgia,serif">g</span></h2><p>body</p>';
check('nearestBlock finds h2/p/none', WT.nearestBlock(wSec.querySelector('span').firstChild) === 'h2' &&
  WT.nearestBlock(wSec.querySelectorAll('p')[0].firstChild) === 'p' && WT.nearestBlock(wSec) === '');
const grng = DT.createRange();
grng.selectNodeContents(wSec.querySelector('span').firstChild);
DT.getSelection().removeAllRanges();
DT.getSelection().addRange(grng);
WT.pendingFormat = { fontFamily: null, fontSize: null, block: null, cmds: {} };
WT.capturePendingBase();
check('capture inherits surrounding style', WT.pendingFormat.fontFamily.indexOf('Georgia') === 0 && WT.pendingFormat.block === 'h2');
WT.pendingFormat = { fontFamily: null, fontSize: null, block: 'h3', cmds: {} };
WT.paintPending();
check('pending paints block select', DT.querySelector('#style-select').value === 'h3');
WT.pendingFormat = null;
WT.updateFormatUI();
check('reflection shows h2 block', DT.querySelector('#style-select').value === 'h2');
WT.applyBlock('h1');
check('applyBlock without editing API is safe', WT.pendingFormat === null);

// ---------- 22. selections never touch execCommand; paste cleanup ----------
const domU = makeDom(html);
await wait(400);
const WU = domU.window, DU = WU.document;
const execCalls = [];
DU.execCommand = function (cmd, ui, val) { execCalls.push([cmd, val]); return true; };
const uSec = DU.querySelector('#stage .slide');
uSec.innerHTML = '<p>hello world</p>';
const urng = DU.createRange();
urng.setStart(uSec.querySelector('p').firstChild, 0);
urng.setEnd(uSec.querySelector('p').firstChild, 5);
DU.getSelection().removeAllRanges();
DU.getSelection().addRange(urng);
WU.applySpanStyle('fontSize', '2em');
check('selection path never touches execCommand', execCalls.length === 0 && uSec.querySelectorAll('font').length === 0);
check('selection wrapped in sized span', Array.prototype.some.call(uSec.querySelectorAll('span'), (s) => s.style.fontSize === '2em'));
const srng = DU.createRange();
srng.setStart(uSec.querySelector('p').firstChild, 0);
srng.setEnd(DU.querySelector('.brand').firstChild, 1);
DU.getSelection().removeAllRanges();
DU.getSelection().addRange(srng);
WU.applySpanStyle('fontSize', '2em');
check('backward range collapses safely', execCalls.length === 0 && uSec.querySelectorAll('font').length === 0);
DU.getSelection().setBaseAndExtent(uSec.querySelector('p').firstChild, 0, DU.querySelector('.brand').firstChild, 1);
WU.applySpanStyle('fontSize', '2em');
check('spanning selection does nothing harmful', execCalls.length === 0 && uSec.querySelectorAll('font').length === 0 && WU.pendingFormat === null);
execCalls.length = 0;
const crngU = DU.createRange();
crngU.setStart(uSec.querySelector('p').firstChild, 0);
crngU.collapse(true);
DU.getSelection().removeAllRanges();
DU.getSelection().addRange(crngU);
DU.dispatchEvent(new WU.Event('selectionchange'));
WU.applySpanStyle('fontSize', '2em');
const pendSpans = uSec.querySelectorAll('span[data-bsw="pending"]');
check('collapsed path inserts span, never execs', execCalls.length === 0 && pendSpans.length === 1 &&
  pendSpans[0].style.fontSize === '2em' && DU.getSelection().anchorNode === pendSpans[0] &&
  WU.pendingFormat.fontSize === '2em', execCalls.length + ' exec call(s)');
uSec.innerHTML = '<p>past<font size="7">ed</font></p>';
uSec.dispatchEvent(new WU.Event('paste', { bubbles: true }));
await wait(150);
check('paste cleans font tags live', uSec.querySelectorAll('font').length === 0 && /font-size:\s*3em/.test(uSec.innerHTML));
check('paste cleanup reaches model', !WU.activeSlide().html.includes('<font'));
// ---------- 23. resume + loadModel validate like every other load path ----------
const domV = makeDom(html);
await wait(400);
const WV = domV.window, DV = WV.document;
const legacy = { app: 'browslide', version: 2, title: 'Old', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: { compress: true, downscale: false, maxDim: 1920, showBar: true, tight: false }, aspect: { w: 16, h: 9 },
  resources: {}, slides: { s1: { title: 'Old', layout: 'blank', transition: 'none', notes: '', html: '<p>old<font size="7">junk</font></p>' } } };
check('resumeModel accepts legacy autosave', WV.resumeModel(JSON.stringify(legacy)) === true);
await wait(300);
check('resume cleans font tags', !WV.activeSlide().html.includes('<font') && /font-size:\s*3em/.test(WV.activeSlide().html));
check('resume rejects garbage', WV.resumeModel('not json{{{') === false);
WV.loadModel({ app: 'browslide', version: 2, title: 'Raw', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: { compress: true, downscale: false, maxDim: 1920, showBar: true, tight: false }, aspect: { w: 16, h: 9 },
  resources: {}, slides: { s1: { title: 'Raw', layout: 'blank', transition: 'none', notes: '', html: '<p>raw<font size="4">junk</font></p>' } } });
check('loadModel backstop sanitizes', !WV.activeSlide().html.includes('<font') && DV.querySelectorAll('#stage font').length === 0);

// ---------- 24. explicit spans: normalize, insert-on-place, prune-on-move ----------
const domW = makeDom(html);
await wait(400);
const WW = domW.window, DW = WW.document;
const wSec2 = DW.querySelector('#stage .slide');
check('render normalizes bare blocks', (function(){
  const h = wSec2.querySelector('h1');
  return !!h && h.firstChild && h.firstChild.tagName === 'SPAN' && !!h.firstChild.style.fontSize;
})());
WW.ensureBlockSpan(DW.createElement('div')); // detached smoke (no crash)
const tDiv = DW.createElement('div');
tDiv.innerHTML = 'bare text';
WW.ensureBlockSpan(tDiv);
check('bare block gets default span', tDiv.firstChild.tagName === 'SPAN' && tDiv.firstChild.getAttribute('data-bsw') === 'block' &&
  !!tDiv.firstChild.style.fontSize && tDiv.textContent === 'bare text');
WW.ensureBlockSpan(tDiv);
check('normalization is idempotent', tDiv.querySelectorAll('span').length === 1);
const uDiv = DW.createElement('div');
uDiv.innerHTML = '<span style="font-size:2em">styled</span> tail';
WW.ensureBlockSpan(uDiv);
check('styled first child not rewrapped', uDiv.querySelectorAll('span').length === 1 && uDiv.firstChild.style.fontSize === '2em');
const lUl = DW.createElement('ul');
lUl.innerHTML = '<li>one</li><li>two</li>';
WW.ensureStyledSpans({ children: [lUl] });
check('list items normalized', lUl.querySelectorAll('li span[data-bsw="block"]').length === 2);
// insert-on-place at a collapsed caret
wSec2.innerHTML = '<h1>Head</h1><p>type here: </p>';
const caretTx = wSec2.querySelector('p').firstChild;
const crngW = DW.createRange();
crngW.setStart(caretTx, 11);
crngW.collapse(true);
DW.getSelection().removeAllRanges();
DW.getSelection().addRange(crngW);
DW.dispatchEvent(new WW.Event('selectionchange'));
const made = WW.insertPendingSpan('fontSize', '2em');
check('insert creates empty styled span at caret', !!made && made.getAttribute('data-bsw') === 'pending' &&
  made.style.fontSize === '2em' && DW.getSelection().anchorNode === made);
const made2 = WW.insertPendingSpan('fontFamily', 'Georgia,serif');
check('second pick restyles same span', made2 === made && made.style.fontFamily.indexOf('Georgia') === 0 &&
  wSec2.querySelectorAll('span[data-bsw="pending"]').length === 1);
// type into it, move away: kept; abandon empty one: pruned
made.textContent = 'big';
WW.updateFormatUI();
DW.getSelection().removeAllRanges();
const elsewhere = DW.createRange();
elsewhere.selectNodeContents(wSec2.querySelector('h1'));
DW.getSelection().addRange(elsewhere);
WW.updateFormatUI();
check('used span survives caret move', wSec2.textContent.includes('big'));
DW.getSelection().removeAllRanges();
const crngW2 = DW.createRange();
crngW2.setStart(caretTx, 0);
crngW2.collapse(true);
DW.getSelection().addRange(crngW2);
DW.dispatchEvent(new WW.Event('click', { bubbles: true }));
WW.pendingFormat = { fontFamily: null, fontSize: '2em', block: null, cmds: {}, node: made };
const fresh = WW.insertPendingSpan('fontSize', '3em');
check('fresh empty span inserted after move', !!fresh && fresh !== made);
WW.pendingFormat.node = fresh;
DW.getSelection().removeAllRanges();
DW.getSelection().addRange(elsewhere);
WW.updateFormatUI();
check('abandoned empty span pruned', !DW.contains(fresh) && WW.pendingFormat === null);

// ---------- 25. size spans split into siblings, never nest/compound ----------
const domX = makeDom(html);
await wait(400);
const WX = domX.window, DX = WX.document;
const xSec = DX.querySelector('#stage .slide');
function firstText(el) { let n = el; while (n && n.nodeType !== 3) n = n.firstChild; return n; }
function pickSize(from, to) {
  const tx = firstText(xSec.querySelector('p'));
  const r = DX.createRange();
  r.setStart(tx, from);
  r.setEnd(tx, to);
  DX.getSelection().removeAllRanges();
  DX.getSelection().addRange(r);
  WX.applySpanStyle('fontSize', '2em');
}
function cleanAbove(span, stopEl) {
  let n = span.parentNode, ok = true;
  while (n && n !== stopEl) { if (n.tagName === 'SPAN' && n.style.fontSize) ok = false; n = n.parentNode; }
  return ok;
}
xSec.innerHTML = '<p><span style="font-size:1.5em">hello</span></p>';
pickSize(1, 4);
const kids = xSec.querySelector('p').childNodes;
check('middle selection splits into three siblings',
  kids.length === 3 && kids[0].tagName === 'SPAN' && kids[0].textContent === 'h' &&
  kids[1].tagName === 'SPAN' && kids[1].style.fontSize === '2em' && kids[1].textContent === 'ell' &&
  kids[2].tagName === 'SPAN' && kids[2].textContent === 'o',
  Array.prototype.map.call(kids, (k) => k.tagName + ':' + k.textContent).join('|'));
check('no nested size spans', DX.querySelectorAll('#stage .slide span span').length === 0);
check('order preserved', xSec.querySelector('p').textContent === 'hello');
check('model stores siblings', ((WX.activeSlide().html.match(/<span/g) || []).length) === 3);
xSec.innerHTML = '<p><span style="font-size:1.5em">hello</span></p>';
pickSize(0, 2);
check('start selection makes two, no empties', xSec.querySelector('p').childNodes.length === 2 &&
  xSec.querySelector('p').childNodes[0].style.fontSize === '2em');
xSec.innerHTML = '<p><span style="font-size:1.5em">hello</span></p>';
pickSize(3, 5);
check('end selection makes two, no empties', xSec.querySelector('p').childNodes.length === 2 &&
  xSec.querySelector('p').childNodes[1].style.fontSize === '2em');
xSec.innerHTML = '<p><span style="font-size:1.5em"><span style="font-size:2em">hello</span></span></p>';
pickSize(1, 4);
const nestedNew = Array.prototype.find.call(xSec.querySelectorAll('#stage .slide span'), (s) => s.style.fontSize === '2em' && s.textContent === 'ell');
check('pre-nested pick lifts out clean', !!nestedNew && cleanAbove(nestedNew, xSec.querySelector('p')) && xSec.textContent.includes('hello'));

// ---------- 26. media resize handle ----------
const domY = makeDom(html);
await wait(400);
const WY = domY.window, DY = WY.document;
check('resize math + clamps', WY.shiftPct(200, 100, 800) === 37.5 && WY.shiftPct(1000, 0, 800) === 100 &&
  WY.shiftPct(10, -100, 800) === 5 && WY.shiftPct(100, 50, 0) === null && WY.shiftPct(-5, 0, 800) === null);
const yImg = DY.createElement('img');
yImg.src = 'data:image/png;base64,AAA=';
yImg.alt = 't';
DY.querySelector('#stage .slide').appendChild(yImg);
check('selectMedia shows overlay', WY.selectMedia(yImg) === true && !!DY.querySelector('#media-resizer') &&
  DY.querySelector('#media-resizer').hidden === false && !!DY.querySelector('#media-resizer .mhandle') &&
  !!DY.querySelector('#media-resizer .mbadge'));
check('selectMedia rejects outside nodes', WY.selectMedia(DY.querySelector('.brand')) === false);
yImg.dispatchEvent(new WY.MouseEvent('mousedown', { bubbles: true }));
check('mousedown on media selects', WY.resizer.el === yImg);
DY.querySelector('#stage .slide').dispatchEvent(new WY.MouseEvent('mousedown', { bubbles: true }));
check('mousedown on text deselects', WY.resizer.el === null && DY.querySelector('#media-resizer').hidden === true);
WY.selectMedia(yImg);
DY.dispatchEvent(new WY.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape deselects', WY.resizer.el === null);
WY.selectMedia(yImg);
DY.querySelector('#btn-save').click();
await wait(300);
const tY = await blobToText(WY.__savedBlob, WY);
check('saved clone hides resizer overlay', new JSDOM(tY).window.document.querySelector('#media-resizer').hasAttribute('hidden'));

// ---------- 27. free-position blocks ----------
const domZ = makeDom(html);
await wait(400);
const WZ = domZ.window, DZ = WZ.document;
DZ.querySelector('#btn-add').click();
await wait(100);
const blkHtml = WZ.activeSlide().html;
check('new slides use positioned blocks', /class="blk"/.test(blkHtml) && /left:\s*[\d.]+%/.test(blkHtml) && /top:\s*[\d.]+%/.test(blkHtml) && /width:\s*[\d.]+%/.test(blkHtml), blkHtml.slice(0, 120));
check('starter slides use blocks', WZ.App.model.slideOrder.every((id) => /class="blk"/.test(WZ.App.model.slides[id].html)));
check('move math', WZ.shiftPos(10, 80, 800) === 20 && WZ.shiftPos(10, -80, 800) === 0 && WZ.shiftPos(5, 0, 0) === null);
const zBlk = DZ.querySelector('#stage .blk');
const mdDown = new WZ.MouseEvent('mousedown', { bubbles: true, cancelable: true });
zBlk.dispatchEvent(mdDown);
check('first click selects block, no caret', mdDown.defaultPrevented === true && WZ.resizer.el === zBlk &&
  DZ.querySelector('#media-resizer').hidden === false && DZ.querySelector('#media-resizer').classList.contains('formove'));
zBlk.dispatchEvent(new WZ.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('overlay shows move grip for blocks', !!DZ.querySelector('#media-resizer .mmove'));
WZ.moveTargetTo(20, 30);
check('move writes % coords', zBlk.style.left === '20%' && zBlk.style.top === '30%');
WZ.deselectMedia();
const lone = DZ.createElement('img');
lone.src = 'data:image/png;base64,AAA=';
DZ.querySelector('#stage .slide').appendChild(lone);
WZ.selectMedia(lone);
check('lone media has no move grip', WZ.resizer.el === lone && !DZ.querySelector('#media-resizer').classList.contains('formove'));
DZ.querySelector('#btn-save').click();
await wait(300);
const tZ = await blobToText(WZ.__savedBlob, WZ);
check('save keeps block coords', /class="blk"/.test(tZ) && /left:\s*[\d.]+%/.test(tZ));
const classic = { app: 'browslide', version: 2, title: 'C', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: { compress: true, downscale: false, maxDim: 1920, showBar: true, tight: false }, aspect: { w: 16, h: 9 },
  resources: {}, slides: { s1: { title: 'C', layout: 'title-body', transition: 'fade', notes: '', html: '<h1>C</h1><ul><li>x</li></ul>' } } };
WZ.loadModel(WZ.normalizeModel(JSON.parse(JSON.stringify(classic))));
await wait(100);
check('classic flow content still renders', !!DZ.querySelector('#stage ul li'));

// ---------- 28. insertable shapes ----------
const domS2 = makeDom(html);
await wait(400);
const WS2 = domS2.window, DS2 = WS2.document;
const shapeNames = Object.keys(WS2.SHAPES);
check('shape library has arrows + symbols', shapeNames.length >= 14 &&
  ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'circle', 'ellipse', 'rectangle', 'star'].every((n) => shapeNames.includes(n)));
check('shape markup is inert SVG', shapeNames.every((n) => /<(line|polyline|polygon|circle|rect|ellipse)/.test(WS2.SHAPES[n]) &&
  !/script|on\w+=|javascript:/i.test(WS2.SHAPES[n])));
check('insertShape rejects unknown', WS2.insertShape('nope') === false);
check('insertShape adds positioned svg block', WS2.insertShape('arrow-right') === true &&
  !!DS2.querySelector('#stage .blk svg') &&
  DS2.querySelector('#stage .blk svg').getAttribute('viewBox') === '0 0 100 100');
check('shape svg scales + serializes', /\.slide svg/.test(headCss) &&
  WS2.activeSlide().html.includes('<svg') && WS2.activeSlide().html.includes('polyline'));
DS2.querySelector('#btn-shape').click();
await wait(100);
check('shape button inserts selected shape', DS2.querySelectorAll('#stage .blk svg').length === 2);
const geoSvg = DS2.querySelector('#stage .blk svg');
check('insert sets kind + params', geoSvg.getAttribute('data-kind') === 'arrow-right' && !!geoSvg.getAttribute('data-len'));
const headDims = (len) => WS2.SHAPE_DEFS['arrow-right'].geo({ len: len }).match(/<polyline points="([^"]+)"/)[1]
  .split(' ').map((p) => p.split(',').map(Number));
const headSize = (pts) => [Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))].join('x');
check('arrow head constant across lengths', headSize(headDims(40)) === '22x36' && headSize(headDims(70)) === '22x36');
check('geometry sizes uncapped', WS2.SHAPE_DEFS['arrow-right'].geo({ len: 200 }).includes('x2="188"') &&
  WS2.SHAPE_DEFS.circle.geo({ radius: 100 }).includes('r="100"') &&
  WS2.SHAPE_DEFS.rectangle.geo({ width: 200, height: 150 }).includes('width="200"'));
check('circle radius honored', WS2.SHAPE_DEFS.circle.geo({ radius: 10 }).includes('r="10"'));
check('rect/ellipse dims honored', WS2.SHAPE_DEFS.rectangle.geo({ width: 60, height: 20 }).includes('width="60"') &&
  WS2.SHAPE_DEFS.ellipse.geo({ width: 60, height: 20 }).includes('rx="30"'));
geoSvg.setAttribute('data-len', '40');
WS2.renderShape(geoSvg);
check('param edit rebuilds geometry', geoSvg.getAttribute('data-len') === '40' && geoSvg.innerHTML.includes('x2="28"'));
check('unknown kind renders nothing', WS2.renderShape(DS2.createElementNS('http://www.w3.org/2000/svg', 'svg')) === false);
check('text block button appends positioned block', (function(){
  var before = DS2.querySelectorAll('#stage .blk').length;
  DS2.querySelector('#btn-block').click();
  var after = DS2.querySelectorAll('#stage .blk');
  var added = after[after.length - 1];
  return after.length === before + 1 && added.style.left !== '' && added.style.top !== '' &&
    added.style.width === '60%' && added.textContent.includes('New text') &&
    WS2.resizer.el === added && WS2.activeSlide().html.includes('New text');
})());
check('second block cascades position', (function(){
  DS2.querySelector('#btn-block').click();
  var blks = DS2.querySelectorAll('#stage .blk');
  return blks[blks.length - 1].style.left !== blks[blks.length - 2].style.left;
})());

// ---------- 29. keyframe animations ----------
const domA = makeDom(html);
await wait(400);
const WA = domA.window, DA = WA.document;
const linA = WA.easeFor('linear', {});
check('linear easing is identity', linA.fn(0.3) === 0.3 && linA.durScale === 1 && WA.easeFor('bogus', {}).fn(0.7) === 0.7);
const accA = WA.easeFor('accelerate', { accel: 2, maxSpeed: 1.5 });
check('accelerate starts slow, ends exact', accA.fn(0) === 0 && accA.fn(1) === 1 && accA.fn(0.5) < 0.5);
check('max speed stretches duration', WA.easeFor('accelerate', { accel: 2, maxSpeed: 0.5 }).durScale > accA.durScale);
const adA = WA.easeFor('accelDecel', { accel: 2, decel: 2, minSpeed: 0 });
let monoKF = true, prevKF = 0;
for (let i = 0; i <= 10; i++) { const v = adA.fn(i / 10); if (v < prevKF - 1e-9 || v > 1 + 1e-9) monoKF = false; prevKF = v; }
check('accel-decel monotone 0..1, symmetric', monoKF && Math.abs(adA.fn(0.5) - 0.5) < 0.05 && adA.fn(1) === 1);
check('cleanAnimEntry clamps + drops', WA.cleanAnimEntry(null) === null &&
  WA.cleanAnimEntry({ group: 0, to: { left: 5 } }) === null &&
  WA.cleanAnimEntry({ group: 2, to: {} }) === null &&
  WA.cleanAnimEntry({ group: 1, dur: 5, to: { left: 500 } }).dur === 50 &&
  WA.cleanAnimEntry({ group: 1, to: { left: 500 } }).to.left === 300);
check('parseAnimList filters garbage', WA.parseAnimList('nope').length === 0 &&
  WA.parseAnimList('{"a":1}').length === 0 &&
  WA.parseAnimList(JSON.stringify([{ group: 1, to: { left: 10 } }, { nope: 1 }])).length === 1);
const aBlk = DA.querySelector('#stage .blk');
aBlk.dispatchEvent(new WA.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('anim panel activates on block select', DA.querySelector('#anim-hint').hidden === true && DA.querySelector('#anim-controls').hidden === false);
DA.querySelector('#btn-anim-add').click();
await wait(50);
check('add step captures row', DA.querySelectorAll('#anim-rows details.astep').length === 2 &&
  JSON.parse(aBlk.getAttribute('data-anim')).length === 2 &&
  JSON.parse(aBlk.getAttribute('data-anim'))[0].initial === true &&
  JSON.parse(aBlk.getAttribute('data-anim'))[1].group === 2);
const lastRow = DA.querySelectorAll('#anim-rows details.astep');
check('new step opens expanded with summary', lastRow[lastRow.length - 1].open === true &&
  lastRow[lastRow.length - 1].querySelector('summary').textContent.includes('Step 2'));
const capEntry = JSON.parse(aBlk.getAttribute('data-anim'))[0];
check('capture reads explicit coords', capEntry.to.left === 10 && capEntry.to.top === 30 && capEntry.to.width === 80);
check('unpositioned elements get coords at play', (function(){
  const u = DA.createElement('div');
  u.style.width = '50%';
  WA.ensurePositioned(u);
  return u.style.left === '10%' && u.style.top === '10%' && u.style.position === 'absolute';
})());
const rowsA = () => DA.querySelectorAll('#anim-rows details.astep');
check('initial row first + locked', rowsA().length === 2 &&
  rowsA()[0].querySelector('summary').textContent.includes('Initial state') &&
  !rowsA()[0].querySelector('.adel'));
const gInput = rowsA()[1].querySelector('input');
gInput.value = '3';
gInput.dispatchEvent(new WA.Event('change', { bubbles: true }));
check('row edit writes back', JSON.parse(aBlk.getAttribute('data-anim'))[1].group === 3);
rowsA()[1].querySelector('.adel').click();
check('row delete clears', rowsA().length === 1 && (function(){
  const l = JSON.parse(aBlk.getAttribute('data-anim'));
  return l.length === 1 && l[0].initial === true;
})());
// real browsers focus the button on mousedown: delete must still rebuild rows
DA.querySelector('#btn-anim-add').click();
await wait(50);
check('re-add after delete', rowsA().length === 2);
const delA = rowsA()[1].querySelector('.adel');
delA.focus();
delA.click();
check('focused delete rebuilds rows', rowsA().length === 1 &&
  JSON.parse(aBlk.getAttribute('data-anim'))[0].initial === true);
DA.querySelector('#anim-hidden').checked = true;
DA.querySelector('#anim-hidden').dispatchEvent(new WA.Event('change', { bubbles: true }));
check('hidden checkbox sets attr', aBlk.hasAttribute('data-hidden'));
DA.querySelector('#anim-hidden').checked = false;
DA.querySelector('#anim-hidden').dispatchEvent(new WA.Event('change', { bubbles: true }));
check('hidden checkbox clears attr', !aBlk.hasAttribute('data-hidden'));
WA.deselectMedia();
check('anim panel hints without selection', DA.querySelector('#anim-hint').hidden === false);
const anM = WA.normalizeModel({ app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: { compress: true, downscale: false, maxDim: 1920, showBar: true, tight: false }, aspect: { w: 16, h: 9 },
  resources: {}, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', notes: '',
    html: '<div class="blk" data-anim=\'[{"group":1,"to":{"left":5}}]\' onclick="x()">t</div>' } } });
const anH = WA.normalizeModel(JSON.parse(JSON.stringify(anM))).slides.s1.html;
check('anim JSON survives sanitize', /data-anim=/.test(anH) && /group/.test(anH) && !/onclick/.test(anH));
check('legacy flat anim attrs inert', WA.parseAnimList('fade-in').length === 0);
WA.gotoSlide(WA.App.model.slideOrder[1]);
await wait(100);
const blks = DA.querySelectorAll('#stage .blk');
function setSteps(el, list) {
  el.setAttribute('data-anim', JSON.stringify(list));
  WA.syncStageToModel();
}
setSteps(blks[0], [{ group: 1, trigger: 'click', dur: 100, delay: 0, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left: 50 } }]);
setSteps(blks[1], [{ group: 1, trigger: 'click', dur: 100, delay: 0, mode: 'accelerate', maxSpeed: 5, accel: 4, minSpeed: 0, decel: 2, to: { left: 60 } }]);
blks[0].setAttribute('data-hidden', '1');
WA.syncStageToModel();
let rafQ = [];
WA.requestAnimationFrame = (fn) => { rafQ.push(fn); return rafQ.length; };
WA.cancelAnimationFrame = () => {};
function pumpRaf(stepMs) {
  let now = 0, guard = 0;
  while (rafQ.length && guard++ < 100) { const q = rafQ.splice(0); now += stepMs; q.forEach((f) => f(now)); }
}
DA.querySelector('#btn-present').click();
await wait(150);
const pBlks = DA.querySelectorAll('#present-slide [data-anim]');
check('present hides hidden-initially', pBlks[0].style.visibility === 'hidden' && pBlks[1].style.visibility !== 'hidden');
check('present counter shows groups', DA.querySelector('#present-count').textContent === '2 / 3 · 0/1');
DA.dispatchEvent(new WA.KeyboardEvent('keydown', { key: 'ArrowRight' }));
pumpRaf(40);
await wait(50);
check('one advance plays whole group', pBlks[0].style.left === '50%' && pBlks[1].style.left === '60%' &&
  pBlks[0].style.visibility === 'visible' && DA.querySelector('#present-count').textContent === '2 / 3 · 1/1');
DA.dispatchEvent(new WA.KeyboardEvent('keydown', { key: 'ArrowRight' }));
await wait(100);
check('advance past last goes next slide', DA.querySelector('#present-count').textContent === '3 / 3');
DA.dispatchEvent(new WA.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
await wait(100);
check('going back reveals all', DA.querySelector('#present-count').textContent === '2 / 3');
DA.dispatchEvent(new WA.KeyboardEvent('keydown', { key: 'Escape' }));
await wait(100);
const autoList = JSON.parse(blks[0].getAttribute('data-anim'));
autoList.push({ group: 2, trigger: 'auto', dur: 100, delay: 30, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left: 55 } });
setSteps(blks[0], autoList);
DA.querySelector('#btn-save').click();
await wait(300);
const tA = await blobToText(WA.__savedBlob, WA);
const savedA = JSON.parse(new JSDOM(tA).window.document.querySelector('#slider-data').textContent);
const savedS2 = savedA.slides[savedA.slideOrder[1]].html;
check('save persists keyframe JSON', /data-anim=/.test(savedS2) && /group/.test(savedS2));
DA.querySelector('#btn-export').click();
await wait(300);
const exA = await blobToText(WA.__savedBlob, WA);
check('export carries keyframes + group player', /data-anim=/.test(exA) && exA.includes('kfPlayGroup'));
const domB = makeDom(exA);
await wait(400);
const WB = domB.window, DB = WB.document;
DB.dispatchEvent(new WB.KeyboardEvent('keydown', { key: 'ArrowRight' }));
await wait(100);
const vAnims = DB.querySelectorAll('#deck .slide:not([hidden]) [data-anim]');
check('viewer hides hidden-initially on arrival', vAnims[0].style.visibility === 'hidden' && vAnims[1].style.visibility !== 'hidden');
let rafQ2 = [];
WB.requestAnimationFrame = (fn) => { rafQ2.push(fn); return rafQ2.length; };
WB.cancelAnimationFrame = () => {};
DB.dispatchEvent(new WB.KeyboardEvent('keydown', { key: 'ArrowRight' }));
await wait(50);
(function pump2() { let now = 0, guard = 0; while (rafQ2.length && guard++ < 100) { const q = rafQ2.splice(0); now += 40; q.forEach((f) => f(now)); } })();
check('viewer plays group to targets', vAnims[0].style.left === '50%' && vAnims[1].style.left === '60%');
await wait(400);
(function pump3() { let now = 500, guard = 0; while (rafQ2.length && guard++ < 100) { const q = rafQ2.splice(0); now += 40; q.forEach((f) => f(now)); } })();
check('viewer auto-chains group 2', vAnims[0].style.left === '55%');


// ---------- 29. shape presets ----------
const domS3 = makeDom(html);
await wait(400);
const WS3 = domS3.window, DS3 = WS3.document;
check('shape defaults', WS3.App.model.settings.lineWidth === 3 && WS3.App.model.settings.lineColor === '#2563eb');
check('shapes menu keeps select+insert only', !!DS3.querySelector('#shapes-wrap #shape-select') && !!DS3.querySelector('#shapes-wrap #btn-shape') &&
  !DS3.querySelector('#shapes-wrap #shape-width') && !DS3.querySelector('#shapes-wrap #shape-color') &&
  !DS3.querySelector('#shapes-wrap #shape-rot') && !DS3.querySelector('#shapes-wrap #shape-params'));
DS3.querySelector('#btn-shape').click();
await wait(100);
const shSvg0 = DS3.querySelector('#stage .blk svg');
check('new shape uses presets', !!shSvg0 && shSvg0.getAttribute('stroke-width') === '3' && shSvg0.getAttribute('stroke') === '#2563eb');
// stroke settings live in the initial step row now (source of truth)
const shBlks0 = DS3.querySelectorAll('#stage .blk');
WS3.setSingleSelection(shBlks0[shBlks0.length - 1]);
const shRow0 = () => DS3.querySelectorAll('#anim-rows details.astep')[0];
const shField = (label) => Array.prototype.find.call(shRow0().querySelectorAll('.aline'), (l) => l.firstChild.textContent === label).querySelector('input');
check('initial row owns stroke settings', !!shField('Line width') && !!shField('Line color'));
shField('Line width').value = '12';
shField('Line width').dispatchEvent(new WS3.Event('change', { bubbles: true }));
shField('Line color').value = '#ff0000';
shField('Line color').dispatchEvent(new WS3.Event('change', { bubbles: true }));
check('stroke edit applies live + presets', shSvg0.getAttribute('stroke-width') === '12' && shSvg0.getAttribute('stroke') === '#ff0000' &&
  WS3.App.model.settings.lineWidth === 12 && WS3.App.model.settings.lineColor === '#ff0000');
DS3.querySelector('#btn-shape').click();
await wait(100);
const shSvg = DS3.querySelectorAll('#stage .blk svg')[1];
check('next shape uses updated presets', !!shSvg && shSvg.getAttribute('stroke-width') === '12' && shSvg.getAttribute('stroke') === '#ff0000');
DS3.querySelector('#btn-save').click();
await wait(300);
const tS3 = await blobToText(WS3.__savedBlob, WS3);
const sjS3 = JSON.parse(new JSDOM(tS3).window.document.querySelector('#slider-data').textContent);
check('presets persist in save', sjS3.settings.lineWidth === 12 && sjS3.settings.lineColor === '#ff0000');
const badS = { app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: { lineWidth: 99, lineColor: 'bogus' }, aspect: { w: 16, h: 9 },
  resources: {}, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', notes: '', html: '<p>x</p>' } } };
const fixS = WS3.normalizeModel(JSON.parse(JSON.stringify(badS)));
check('bad presets fall back', fixS.settings.lineWidth === 3 && fixS.settings.lineColor === '#2563eb');

// ---------- 30. transforms, multi-select, clipboard ----------
const domT2 = makeDom(html);
await wait(400);
const WT2 = domT2.window, DT2 = WT2.document;
WT2.gotoSlide(WT2.App.model.slideOrder[1]);
await wait(100);
const mDiv = DT2.createElement('div');
mDiv.setAttribute('data-rot', '180');
check('moveItemsBy ignores rotation (screen-space moves)', WT2.moveItemsBy([{ el: mDiv, l: 10, t: 20 }], 80, 0, 800, 600) === true &&
  mDiv.style.left === '20%' && mDiv.style.top === '20%');
const trDiv = DT2.createElement('div');
check('transformOf defaults', JSON.stringify(WT2.transformOf(trDiv)) === JSON.stringify({ rot: 0, sx: 1, sy: 1 }));
trDiv.setAttribute('data-rot', '45');
trDiv.setAttribute('data-sx', '2');
WT2.applyTransform(trDiv);
check('applyTransform builds string', trDiv.style.transform === 'rotate(45deg) scaleX(2) scaleY(1)' &&
  trDiv.getAttribute('data-rot') === '45' && trDiv.getAttribute('data-sx') === '2');
trDiv.removeAttribute('data-rot');
trDiv.removeAttribute('data-sx');
WT2.applyTransform(trDiv);
check('applyTransform cleans identity', trDiv.style.transform === '' && !trDiv.hasAttribute('data-rot'));
check('rotation keyframe plays to transform', await (async function(){
  const rBlk = DT2.querySelector('#stage .blk');
  rBlk.setAttribute('data-anim', JSON.stringify([{ group: 1, trigger: 'click', dur: 100, delay: 0, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { rot: 45 } }]));
  WT2.syncStageToModel();
  let rafQR = [];
  WT2.requestAnimationFrame = (fn) => { rafQR.push(fn); return rafQR.length; };
  WT2.cancelAnimationFrame = () => {};
  DT2.querySelector('#btn-present').click();
  await wait(100);
  DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  let now = 0, guard = 0;
  while (rafQR.length && guard++ < 100) { const q = rafQR.splice(0); now += 40; q.forEach((f) => f(now)); }
  const ok = DT2.querySelector('#present-slide [data-anim]').style.transform.includes('rotate(45deg)');
  DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(100);
  rBlk.removeAttribute('data-anim');
  WT2.syncStageToModel();
  return ok;
})());
// multi-select via direct toggle + ctrl-click
const mBlks = DT2.querySelectorAll('#stage .blk');
WT2.toggleSelection(mBlks[0]);
WT2.toggleSelection(mBlks[1]);
check('toggle builds set, last is primary', WT2.resizer.el === mBlks[1] && WT2.resizer.extra.length === 1 &&
  DT2.querySelectorAll('#stage-wrap .selextra').length === 1);
WT2.toggleSelection(mBlks[1]);
check('toggle removes, promotes survivor', WT2.resizer.el === mBlks[0] && WT2.resizer.extra.length === 0);
const ctrlEv = new WT2.MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true });
mBlks[1].dispatchEvent(ctrlEv);
check('ctrl-click toggles (or direct fallback)', (WT2.resizer.extra.length === 1 || (WT2.toggleSelection(mBlks[1]), WT2.resizer.extra.length === 1)) &&
  DT2.querySelectorAll('#stage-wrap .selextra').length === 1);
DT2.querySelector('#stage').dispatchEvent(new WT2.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('plain click collapses to single', WT2.resizer.extra.length === 0);
WT2.toggleSelection(mBlks[0]);
WT2.toggleSelection(mBlks[1]);
DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape clears whole set', WT2.resizer.el === null && WT2.resizer.extra.length === 0 &&
  DT2.querySelectorAll('#stage-wrap .selextra').length === 0);
// rotate + stroke live in the initial step row now (single source of truth)
WT2.setSingleSelection(mBlks[0]);
const tRows = () => DT2.querySelectorAll('#anim-rows details.astep');
const tField = (label) => Array.prototype.find.call(tRows()[0].querySelectorAll('.aline'), (l) => l.firstChild.textContent === label).querySelector('input,select');
check('initial row owns rotate', !!tField('Rotation °'));
tField('Rotation °').value = '45';
tField('Rotation °').dispatchEvent(new WT2.Event('change', { bubbles: true }));
check('rotate applies to selection', mBlks[0].getAttribute('data-rot') === '45' && mBlks[0].style.transform.includes('rotate(45deg)'));
check('panel scale inputs removed', !DT2.querySelector('#shape-sx') && !DT2.querySelector('#shape-sy') && !DT2.querySelector('#shape-rot'));
check('transform persists in model', WT2.activeSlide().html.includes('data-rot="45"'));
// stroke live-applies on selected shape via its initial row
WT2.insertShape('circle');
const shBlk = DT2.querySelectorAll('#stage .blk');
WT2.setSingleSelection(shBlk[shBlk.length - 1]);
check('shape rows hide scale, show geometry', (function(){
  const labels = Array.prototype.map.call(DT2.querySelectorAll('#anim-rows details.astep')[0].querySelectorAll('.aline'), (l) => l.firstChild.textContent);
  return labels.indexOf('Scale X') < 0 && labels.indexOf('Radius') >= 0;
})());
const wField = Array.prototype.find.call(DT2.querySelectorAll('#anim-rows details.astep')[0].querySelectorAll('.aline'), (l) => l.firstChild.textContent === 'Line width').querySelector('input');
wField.value = '14';
wField.dispatchEvent(new WT2.Event('change', { bubbles: true }));
check('width live-applies to shape', DT2.querySelector('#stage .blk svg').getAttribute('stroke-width') === '14' ||
  Array.prototype.some.call(DT2.querySelectorAll('#stage .blk svg'), (s) => s.getAttribute('stroke-width') === '14'));
// anim add targets primary selection (fresh nodes: present round-trip rebuilt the stage)
const mBlksF = DT2.querySelectorAll('#stage .blk');
WT2.toggleSelection(mBlksF[0]);
WT2.toggleSelection(mBlksF[1]);
DT2.querySelector('#btn-anim-add').click();
check('anim add targets primary', (function(){
  const a = JSON.parse(mBlksF[1].getAttribute('data-anim')).filter((e) => !e.initial).length;
  const b = JSON.parse(mBlksF[0].getAttribute('data-anim')).filter((e) => !e.initial).length;
  return a === 1 && b === 0;
})());
DT2.querySelector('#anim-rows .adel').click();
check('anim row delete clears', JSON.parse(mBlksF[1].getAttribute('data-anim')).filter((e) => !e.initial).length === 0);
// copy/paste
WT2.setSingleSelection(mBlks[0]);
const beforePaste = DT2.querySelectorAll('#stage .blk').length;
DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
await wait(100);
const afterPaste = DT2.querySelectorAll('#stage .blk');
check('copy/paste duplicates with offset', afterPaste.length === beforePaste + 1 &&
  afterPaste[afterPaste.length - 1].style.left !== mBlks[0].style.left);
check('pasted item selected', WT2.resizer.el === afterPaste[afterPaste.length - 1]);
// guards: text selection keeps native copy; fields keep native paste
const txtRng = DT2.createRange();
txtRng.selectNodeContents(DT2.querySelector('#stage .slide h1'));
DT2.getSelection().removeAllRanges();
DT2.getSelection().addRange(txtRng);
const nClip = WT2.copySelection();
DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
check('text selection keeps native copy', WT2.clipItems.length === nClip);
DT2.querySelector('#notes').focus();
DT2.querySelector('#notes').value = 'n';
const modelBefore = WT2.App.model.slides[WT2.App.activeId].html;
DT2.dispatchEvent(new WT2.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
await wait(100);
check('paste in fields stays native', WT2.App.model.slides[WT2.App.activeId].html === modelBefore);

// ---------- 31. alignment without execCommand + text color ----------
const domAA = makeDom(html);
await wait(400);
const WAA = domAA.window, DAA = domAA.window.document;
function aaRange() {
  const r = DAA.createRange();
  r.setStart(aaSec().querySelectorAll('p')[0].firstChild, 0);
  r.setEnd(aaSec().querySelectorAll('p')[1].firstChild, 2);
  DAA.getSelection().removeAllRanges();
  DAA.getSelection().addRange(r);
}
function aaSec() { return DAA.querySelector('#stage .slide'); }
check('cssColorToHex units', WAA.cssColorToHex('#abc') === '#aabbcc' && WAA.cssColorToHex('#aabbcc') === '#aabbcc' &&
  WAA.cssColorToHex('rgb(1, 2, 3)') === '#010203' && WAA.cssColorToHex('bogus') === null && WAA.cssColorToHex('') === null);
aaSec().innerHTML = '<p>one</p><p>two <b>bold</b></p>';
aaRange();
WAA.applyAlign('justifyCenter');
check('align applies to all blocks in range', aaSec().querySelectorAll('p')[0].style.textAlign === 'center' &&
  aaSec().querySelectorAll('p')[1].style.textAlign === 'center');
check('align persists to model', (WAA.activeSlide().html.match(/text-align:\s*center/g) || []).length === 2);
WAA.updateFormatUI();
const actBtns = Array.prototype.filter.call(DAA.querySelectorAll('#formatbar button[data-cmd]'), (b) => b.classList.contains('active')).map((b) => b.dataset.cmd);
check('align buttons reflect exactly one state', JSON.stringify(actBtns) === JSON.stringify(['justifyCenter']), actBtns.join(','));
const crngAA = DAA.createRange();
crngAA.setStart(aaSec().querySelectorAll('p')[1].firstChild, 0);
crngAA.collapse(true);
DAA.getSelection().removeAllRanges();
DAA.getSelection().addRange(crngAA);
WAA.applyAlign('justifyRight');
check('collapsed caret aligns its block only', aaSec().querySelectorAll('p')[1].style.textAlign === 'right' &&
  aaSec().querySelectorAll('p')[0].style.textAlign === 'center');
aaSec().innerHTML = '<p>plain</p>';
const prngAA = DAA.createRange();
prngAA.selectNodeContents(aaSec().querySelector('p').firstChild);
DAA.getSelection().removeAllRanges();
DAA.getSelection().addRange(prngAA);
WAA.updateFormatUI();
const actBtns2 = Array.prototype.filter.call(DAA.querySelectorAll('#formatbar button[data-cmd]'), (b) => b.classList.contains('active')).map((b) => b.dataset.cmd);
check('unstyled text shows left only', JSON.stringify(actBtns2) === JSON.stringify(['justifyLeft']), actBtns2.join(','));
const corng = DAA.createRange();
corng.setStart(aaSec().querySelector('p').firstChild, 0);
corng.setEnd(aaSec().querySelector('p').firstChild, 5);
DAA.getSelection().removeAllRanges();
DAA.getSelection().addRange(corng);
WAA.applySpanStyle('color', '#ff0000');
const coSpans = Array.prototype.filter.call(aaSec().querySelectorAll('span'), (s) => s.style.color !== '');
check('color wraps selection in span', coSpans.length === 1);
WAA.updateFormatUI();
check('color input follows cursor', DAA.querySelector('#font-color').value === '#ff0000');
const ccRng = DAA.createRange();
ccRng.setStart(aaSec().querySelector('p').firstChild, 0);
ccRng.collapse(true);
DAA.getSelection().removeAllRanges();
DAA.getSelection().addRange(ccRng);
WAA.applySpanStyle('color', '#00ff00');
check('collapsed color inserts pending span', WAA.pendingFormat.color === '#00ff00' &&
  !!aaSec().querySelector('span[data-bsw="pending"]'));

// ---------- 32. rows follow selection switches, navigation clears ----------
// (regression: row rebuild guard skipped rebuilds on selection change,
//  so delete/param edits hit the previously selected element)
const domAB = makeDom(html);
await wait(400);
const WAB = domAB.window, DAB = WAB.document;
WAB.gotoSlide(WAB.App.model.slideOrder[1]);
await wait(100);
const abBlks = DAB.querySelectorAll('#stage .blk');
abBlks[0].dispatchEvent(new WAB.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
DAB.querySelector('#btn-anim-add').click();
await wait(50);
const rowsAB = () => DAB.querySelectorAll('#anim-rows details.astep');
check('step added on A', rowsAB().length === 2 &&
  JSON.parse(abBlks[0].getAttribute('data-anim')).length === 2);
rowsAB()[0].querySelector('input').focus();
abBlks[1].dispatchEvent(new WAB.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('rows rebuild for B despite focused input', rowsAB().length === 1 &&
  rowsAB()[0].querySelector('summary').textContent.includes('Initial state') &&
  WAB.selectedAnimTarget() === abBlks[1]);
DAB.querySelector('#btn-anim-add').click();
await wait(50);
check('step added on B', rowsAB().length === 2 &&
  JSON.parse(abBlks[1].getAttribute('data-anim')).length === 2);
rowsAB()[1].querySelector('.adel').click();
check('delete hits current selection', rowsAB().length === 1 &&
  JSON.parse(abBlks[1].getAttribute('data-anim')).length === 1 &&
  JSON.parse(abBlks[0].getAttribute('data-anim')).length === 2);
WAB.gotoSlide(WAB.App.model.slideOrder[0]);
check('navigation clears selection', WAB.resizer.el === null && DAB.querySelector('#anim-hint').hidden === false);
// same staleness class for shape geometry rows
WAB.gotoSlide(WAB.App.model.slideOrder[1]);
await wait(100);
WAB.insertShape('circle');
WAB.insertShape('circle');
await wait(100);
const shWraps = Array.prototype.filter.call(DAB.querySelectorAll('#stage .blk'), (b) => b.querySelector('svg'));
WAB.setSingleSelection(shWraps[0]);
const radRow0 = DAB.querySelectorAll('#anim-rows details.astep')[0];
const radField = (row) => Array.prototype.find.call(row.querySelectorAll('.aline'), (l) => l.firstChild.textContent === 'Radius').querySelector('input');
let lenInput = radField(radRow0);
lenInput.value = '20';
lenInput.dispatchEvent(new WAB.Event('change', { bubbles: true }));
lenInput.focus();
shWraps[1].dispatchEvent(new WAB.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('shape rows follow selection', radField(DAB.querySelectorAll('#anim-rows details.astep')[0]).value === '40');
check('first shape untouched', shWraps[0].querySelector('svg').getAttribute('data-radius') === '20');

// ---------- 33. step scrub-editing ----------
const domSC = makeDom(html);
await wait(400);
const WSC = domSC.window, DSC = WSC.document;
WSC.gotoSlide(WSC.App.model.slideOrder[1]);
await wait(100);
const scBlks = DSC.querySelectorAll('#stage .blk');
scBlks[0].dispatchEvent(new WSC.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
DSC.querySelector('#btn-anim-add').click();
await wait(50);
check('add enters step-edit mode', !!WSC.stepEdit && WSC.stepEdit.el === scBlks[0] &&
  DSC.querySelector('#anim-rows details.astep.editing') !== null);
// simulate a drag result, then drop-capture like onUp does
scBlks[0].style.left = '70%';
WSC.commitStepGeometry(scBlks[0]);
const scList = JSON.parse(scBlks[0].getAttribute('data-anim'));
const scEntry = scList[scList.length - 1];
check('drop captures pose and keeps showing the step', scEntry.to.left === 70 && scBlks[0].style.left === '70%');
check('model keeps rest pose', /left:\s*8%/.test(WSC.App.model.slides.s2.html) && !/left:\s*70%/.test(WSC.App.model.slides.s2.html));
// consecutive edit without deselect: starts from the shown step pose
scBlks[0].style.left = '80%';
WSC.commitStepGeometry(scBlks[0]);
const scList2 = JSON.parse(scBlks[0].getAttribute('data-anim'));
const scEntry2 = scList2[scList2.length - 1];
check('second drop without reselect works', scEntry2.to.left === 80 && scBlks[0].style.left === '80%' &&
  /left:\s*8%/.test(WSC.App.model.slides.s2.html) && !/left:\s*80%/.test(WSC.App.model.slides.s2.html));
// the real handle-drop path (single save for the set): pose must survive it
scBlks[0].style.left = '90%';
WSC.commitStepGeometries();
const scList3 = JSON.parse(scBlks[0].getAttribute('data-anim'));
check('batch drop keeps showing the step', scList3[scList3.length - 1].to.left === 90 && scBlks[0].style.left === '90%' &&
  /left:\s*8%/.test(WSC.App.model.slides.s2.html) && !/left:\s*90%/.test(WSC.App.model.slides.s2.html) &&
  WSC.stepEdit !== null && WSC.stepEdit.el === scBlks[0]);
// sync guard: preview pose never persists
scBlks[0].style.left = '70%';
WSC.syncStageToModel();
check('sync restores rest pose', scBlks[0].style.left === '8%' && /left:\s*8%/.test(WSC.App.model.slides.s2.html));
WSC.exitStepEdit();
check('exit clears mode', WSC.stepEdit === null);
// row click enters the second (non-initial) entry
scBlks[1].setAttribute('data-anim', JSON.stringify([
  { group: 1, trigger: 'click', dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left: 20 } },
  { group: 2, trigger: 'click', dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left: 40 } }
]));
WSC.syncStageToModel();
scBlks[1].dispatchEvent(new WSC.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
DSC.defaultView.dispatchEvent(new WSC.MouseEvent('pointerup', { bubbles: true }));
await wait(50);
const scRows = () => DSC.querySelectorAll('#anim-rows details.astep');
check('initial row prepended + locked', scRows().length === 3 && !scRows()[0].querySelector('.adel'));
scRows()[1].dispatchEvent(new WSC.MouseEvent('click', { bubbles: true }));
check('row click previews entry pose', WSC.stepEdit && WSC.stepEdit.el === scBlks[1] && WSC.stepEdit.idx === 1 &&
  scBlks[1].style.left === '20%' && scRows()[1].classList.contains('editing'));
scRows()[1].querySelector('.adel').dispatchEvent(new WSC.MouseEvent('click', { bubbles: true }));
const restList = JSON.parse(scBlks[1].getAttribute('data-anim'));
check('deleted entry gone, element at rest', restList.length === 2 && restList[0].initial === true && restList[1].group === 2 &&
  scBlks[1].style.left === '8%' && WSC.stepEdit === null);

// ---------- 34. whole-item drag (grab anywhere except text) ----------
const domZB = makeDom(html);
await wait(400);
const WZB = domZB.window, DZB = WZB.document;
WZB.gotoSlide(WZB.App.model.slideOrder[1]);
await wait(100);
Object.defineProperty(DZB.querySelector('#stage .slide'), 'clientWidth', { value: 800, configurable: true });
Object.defineProperty(DZB.querySelector('#stage .slide'), 'clientHeight', { value: 600, configurable: true });
const zbBlk = DZB.querySelector('#stage .blk');
zbBlk.dispatchEvent(new WZB.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
check('grab selects', WZB.resizer.el === zbBlk);
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 0 }));
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointerup', { bubbles: true, clientX: 80, clientY: 0 }));
await wait(100);
check('drag moves whole selection', zbBlk.style.left === '18%');
check('drag persists to model', /left:\s*18%/.test(WZB.App.model.slides.s2.html));
check('drag keeps overlay', DZB.querySelector('#media-resizer').hidden === false);
// caret path with stubbed caret API (jsdom has none built in)
DZB.caretRangeFromPoint = function () {
  const r = DZB.createRange();
  const tx = DZB.querySelector('#stage .blk span') || DZB.querySelector('#stage .blk');
  const tn = tx.firstChild || tx;
  r.setStart(tn, 0);
  r.collapse(true);
  r.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  return r;
};
const mdCaret = new WZB.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 3, clientY: 2 });
zbBlk.dispatchEvent(mdCaret);
check('press on text keeps native caret', mdCaret.defaultPrevented === false);
const mb4 = JSON.stringify(WZB.App.model);
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointerup', { bubbles: true, clientX: 3, clientY: 2 }));
await wait(50);
check('clean click places caret, model untouched', DZB.getSelection().isCollapsed === true && JSON.stringify(WZB.App.model) === mb4);
// multi drag moves all
const zbBlks = DZB.querySelectorAll('#stage .blk');
WZB.toggleSelection(zbBlks[1]);
const m0l = zbBlks[0].style.left, m1l = zbBlks[1].style.left;
zbBlks[0].dispatchEvent(new WZB.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 0 }));
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 0 }));
await wait(100);
check('group drag moves all', zbBlks[0].style.left !== m0l && zbBlks[1].style.left !== m1l);
// move grip delegates to the shared whole-item drag (no caret placement)
const gripL = zbBlks[0].style.left;
DZB.querySelector('#media-resizer .mmove').dispatchEvent(new WZB.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 0 }));
DZB.defaultView.dispatchEvent(new WZB.MouseEvent('pointerup', { bubbles: true, clientX: 80, clientY: 0 }));
await wait(100);
check('grip drag moves selection', zbBlks[0].style.left !== gripL);

// ---------- 35. global stage scrub slider ----------
const domSB = makeDom(html);
await wait(400);
const WSB = domSB.window, DSB = WSB.document;
WSB.gotoSlide(WSB.App.model.slideOrder[1]);
await wait(100);
check('scrub starts at initial stage', !!DSB.querySelector('#scrub-range') &&
  DSB.querySelector('#scrub-range').disabled === false &&
  DSB.querySelector('#scrub-range').value === '1' &&
  DSB.querySelector('#scrub-label').textContent === 'Stage 1 / 1');
const sbBlks = DSB.querySelectorAll('#stage .blk');
const step = (group, trigger, left) => ({ group, trigger, dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left } });
const istep = (group, trigger, left) => Object.assign({ initial: true }, step(group, trigger, left));
sbBlks[0].setAttribute('data-anim', JSON.stringify([istep(1, 'click', 20), step(3, 'auto', 60)]));
sbBlks[1].setAttribute('data-anim', JSON.stringify([istep(1, 'auto', 8), step(2, 'auto', 40)]));
WSB.syncStageToModel();
WSB.rebuildScrub();
const sRange = DSB.querySelector('#scrub-range');
check('slider spans slide groups', sRange.disabled === false && sRange.max === '3' && sRange.value === '1' &&
  WSB.slideGroups().join(',') === '1,2,3');
check('any-click makes a click stage', WSB.groupTrigger(1) === 'click' && WSB.groupTrigger(2) === 'auto' && WSB.groupTrigger(3) === 'auto');
check('scrub never dirties the deck', (function(){
  const before = JSON.stringify(WSB.App.model);
  sRange.value = '2';
  sRange.dispatchEvent(new WSB.Event('input', { bubbles: true }));
  return JSON.stringify(WSB.App.model) === before;
})());
check('scrub poses every item (fallback to earlier stage)', sbBlks[0].style.left === '20%' && sbBlks[1].style.left === '40%');
check('stage label shows kind', DSB.querySelector('#scrub-label').textContent === 'Stage 2 / 3' &&
  DSB.querySelector('#scrub-kind').textContent.includes('auto') && DSB.querySelector('#scrub-kind').className === 'auto');
WSB.syncStageToModel();
check('sync restores rest pose', sbBlks[0].style.left === '8%' && sbBlks[1].style.left === '8%' &&
  /left:\s*8%/.test(WSB.App.model.slides[WSB.App.activeId].html));
sRange.dispatchEvent(new WSB.Event('input', { bubbles: true }));
check('re-scrub reapplies poses', sbBlks[0].style.left === '20%' && sbBlks[1].style.left === '40%');
// selecting the initial step drives slider + global state to its stage
sbBlks[0].dispatchEvent(new WSB.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
DSB.defaultView.dispatchEvent(new WSB.MouseEvent('pointerup', { bubbles: true }));
await wait(50);
DSB.querySelectorAll('#anim-rows details.astep')[0].dispatchEvent(new WSB.MouseEvent('click', { bubbles: true }));
check('step select drives slider', WSB.scrubGroup === 1 && sRange.value === '1' && sbBlks[1].style.left === '8%');
check('click stage indicated', DSB.querySelector('#scrub-kind').textContent.includes('click') &&
  DSB.querySelector('#scrub-kind').className === 'click');
// editing the initial group number drives global state to the new stage
const grpInput = DSB.querySelector('#anim-rows details.astep input');
grpInput.value = '3';
grpInput.dispatchEvent(new WSB.Event('change', { bubbles: true }));
check('group edit moves global stage', WSB.scrubGroup === 3 && sRange.value === '3' && sbBlks[1].style.left === '40%');
WSB.exitStepEdit();
// presenter: mixed click+auto group never auto-chains
const pSec2 = DSB.createElement('div');
pSec2.innerHTML = '<div data-anim=\'[{"group":1,"trigger":"click","dur":600,"delay":200,"mode":"linear","maxSpeed":1.5,"accel":2,"minSpeed":0,"decel":2,"to":{"left":10}}]\'></div>' +
  '<div data-anim=\'[{"group":2,"trigger":"click","dur":600,"delay":200,"mode":"linear","maxSpeed":1.5,"accel":2,"minSpeed":0,"decel":2,"to":{"left":20}},{"group":2,"trigger":"auto","dur":600,"delay":200,"mode":"linear","maxSpeed":1.5,"accel":2,"minSpeed":0,"decel":2,"to":{"left":30}}]\'></div>';
WSB.kfCollect(pSec2);
WSB.kfGroupIdx = 0;
WSB.chainAutos();
check('mixed group is a click stage (no auto-chain)', WSB.kfTimer === 0);
WSB.kfGroups = []; WSB.kfGroupIdx = -1;
WSB.gotoSlide(WSB.App.model.slideOrder[0]);
await wait(100);
check('slide change resets scrub', WSB.scrubGroup === 1 && DSB.querySelector('#scrub-range').value === '1');

// ---------- 36. size handles edit values + shape keyframes ----------
const domHZ = makeDom(html);
await wait(400);
const WHZ = domHZ.window, DHZ = WHZ.document;
WHZ.gotoSlide(WHZ.App.model.slideOrder[1]);
await wait(100);
check('shapeSizeKeys mapping', JSON.stringify(WHZ.shapeSizeKeys('arrow-right')) === '["slen"]' &&
  JSON.stringify(WHZ.shapeSizeKeys('circle')) === '["sr"]' &&
  JSON.stringify(WHZ.shapeSizeKeys('rectangle')) === '["sw","sh"]' &&
  JSON.stringify(WHZ.shapeSizeKeys('star')) === '[]' && WHZ.shapeSizeKeys(null) === null);
check('shapeAttrFor mapping', WHZ.shapeAttrFor('slen') === 'len' && WHZ.shapeAttrFor('sr') === 'radius' &&
  WHZ.shapeAttrFor('sw') === 'width' && WHZ.shapeAttrFor('sh') === 'height');
check('shapeDeltas routing', JSON.stringify(WHZ.shapeDeltas(['sw', 'sh'], 'rectangle', 'both', 2, 3)) === '{"sw":2,"sh":3}' &&
  JSON.stringify(WHZ.shapeDeltas(['sw', 'sh'], 'rectangle', 'w', 2, 3)) === '{"sw":2}' &&
  JSON.stringify(WHZ.shapeDeltas(['sw', 'sh'], 'rectangle', 'h', 2, 3)) === '{"sh":3}' &&
  JSON.stringify(WHZ.shapeDeltas(['slen'], 'arrow-up', 'both', 2, 3)) === '{"slen":3}' &&
  JSON.stringify(WHZ.shapeDeltas(['slen'], 'arrow-right', 'both', 2, 3)) === '{"slen":2}' &&
  JSON.stringify(WHZ.shapeDeltas(['sr'], 'circle', 'h', 2, 3)) === '{"sr":3}');
WHZ.insertShape('arrow-right');
const hzBlk = DHZ.querySelectorAll('#stage .blk');
const hzArrowBlk = hzBlk[hzBlk.length - 1];
const hzSvg = hzArrowBlk.querySelector('svg');
hzSvg.getBoundingClientRect = () => ({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100 });
const upp = WHZ.svgUnitsPerPx(hzSvg);
check('svg units from fixed frame', upp.x === 0.5 && upp.y === 1, JSON.stringify(upp));
WHZ.setSingleSelection(hzArrowBlk);
const fakeDown = (target) => ({ preventDefault(){}, stopPropagation(){}, currentTarget: target, clientX: 0, clientY: 0, pointerId: 1 });
const dragHandle = (sel, mode, dx, dy) => {
  const h = DHZ.querySelector(sel);
  WHZ.onSizeDown(fakeDown(h), mode);
  h.dispatchEvent(new WHZ.MouseEvent('pointermove', { bubbles: true, clientX: dx, clientY: dy }));
  h.dispatchEvent(new WHZ.MouseEvent('pointerup', { bubbles: true, clientX: dx, clientY: dy }));
};
dragHandle('#media-resizer .mhandle', 'both', 20, 0);
await wait(100);
check('corner drag edits arrow length, no literal scale', hzSvg.getAttribute('data-len') === '78' &&
  !hzArrowBlk.hasAttribute('data-sx'));
check('capture reads shape size', WHZ.captureKeyframe(hzArrowBlk).slen === 78);
WHZ.applyKeyframeState(hzArrowBlk, { slen: 40 });
check('apply writes shape size', hzSvg.getAttribute('data-len') === '40' && hzSvg.innerHTML.includes('x2="28"'));
check('clean keeps shape keys', (function(){
  const list = WHZ.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { slen: 50, sr: 999, sw: 'x' } }]));
  return list.length === 1 && list[0].to.slen === 50 && list[0].to.sr === 250 && list[0].to.sw === undefined;
})());
WHZ.insertShape('rectangle');
const rBlks = DHZ.querySelectorAll('#stage .blk');
const rBlkEl = rBlks[rBlks.length - 1];
const rSvg = rBlkEl.querySelector('svg');
rSvg.getBoundingClientRect = () => ({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100 });
WHZ.setSingleSelection(rBlkEl);
const w0 = rSvg.getAttribute('data-width'), h0 = rSvg.getAttribute('data-height');
dragHandle('#media-resizer .mh-e', 'w', 20, 30);
await wait(50);
check('right edge edits width only', parseFloat(rSvg.getAttribute('data-width')) > parseFloat(w0) &&
  rSvg.getAttribute('data-height') === h0);
const wAfterR = rSvg.getAttribute('data-width');
dragHandle('#media-resizer .mh-s', 'h', 5, 10);
await wait(50);
check('bottom edge edits height only', rSvg.getAttribute('data-width') === wAfterR &&
  parseFloat(rSvg.getAttribute('data-height')) > parseFloat(h0));
const w1 = rSvg.getAttribute('data-width'), h1 = rSvg.getAttribute('data-height');
dragHandle('#media-resizer .mhandle', 'both', 10, 10);
await wait(50);
check('corner edits both', parseFloat(rSvg.getAttribute('data-width')) > parseFloat(w1) &&
  parseFloat(rSvg.getAttribute('data-height')) > parseFloat(h1));
WHZ.insertShape('star');
const sBlks = DHZ.querySelectorAll('#stage .blk');
WHZ.setSingleSelection(sBlks[sBlks.length - 1]);
check('star hides size handles', DHZ.querySelector('#media-resizer .mhandle').style.display === 'none' &&
  DHZ.querySelector('#media-resizer .mh-e').style.display === 'none' &&
  DHZ.querySelector('#media-resizer .mh-s').style.display === 'none');
// scrub + step fields move shape sizes too
rBlkEl.setAttribute('data-anim', JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { sw: 90, sh: 60 } }]));
WHZ.syncStageToModel();
WHZ.rebuildScrub();
const hzRange = DHZ.querySelector('#scrub-range');
hzRange.value = '1';
hzRange.dispatchEvent(new WHZ.Event('input', { bubbles: true }));
check('scrub applies shape size', rSvg.getAttribute('data-width') === '90' && rSvg.getAttribute('data-height') === '60');
WHZ.syncStageToModel();
check('sync restores shape size', rSvg.getAttribute('data-width') !== '90');
WHZ.setSingleSelection(rBlkEl);
check('step rows have shape fields', DHZ.querySelector('#anim-rows').textContent.includes('Width'));
const swRow = Array.prototype.find.call(DHZ.querySelectorAll('#anim-rows details.astep')[1].querySelectorAll('.aline'), (l) => l.firstChild.textContent === 'Width');
swRow.querySelector('input').value = '95';
swRow.querySelector('input').dispatchEvent(new WHZ.Event('change', { bubbles: true }));
check('shape field commits to step', JSON.parse(rBlkEl.getAttribute('data-anim')).filter((e) => !e.initial)[0].to.sw === 95);
dragHandle('#media-resizer .mhandle', 'both', -5000, -5000);
await wait(50);
check('shape drags clamp to min in the step', (function(){
  const to = JSON.parse(rBlkEl.getAttribute('data-anim')).filter((e) => !e.initial)[0].to;
  return to.sw === 10 && to.sh === 10;
})());

// ---------- 37. stable sizes + tight overlay ----------
const domTB = makeDom(html);
await wait(400);
const WTB = domTB.window, DTB = WTB.document;
WTB.gotoSlide(WTB.App.model.slideOrder[1]);
await wait(100);
WTB.insertShape('arrow-right');
const tbBlks = DTB.querySelectorAll('#stage .blk');
const tbBlk = tbBlks[tbBlks.length - 1];
const tbSvg = tbBlk.querySelector('svg');
check('frame stays fixed', tbSvg.getAttribute('viewBox') === '0 0 100 100');
check('geometry bbox units', JSON.stringify(WTB.svgContentBox(tbSvg)) === '{"x":10,"y":32,"w":68,"h":36}');
check('bbox maps through CTM', JSON.stringify(WTB.mapBoxClient({ x: 10, y: 32, w: 68, h: 36 }, { a: 2, b: 0, c: 0, d: 2, e: 5, f: 7 })) === '{"x":25,"y":71,"w":136,"h":72}');
tbSvg.setAttribute('viewBox', '7 29 74 42'); /* tight boxes from earlier revisions normalize */
WTB.renderShape(tbSvg);
check('old tight boxes normalize', tbSvg.getAttribute('viewBox') === '0 0 100 100');
tbSvg.setAttribute('data-len', '100');
WTB.renderShape(tbSvg);
check('length grows content, frame fixed', tbSvg.getAttribute('viewBox') === '0 0 100 100' &&
  JSON.stringify(WTB.svgContentBox(tbSvg)) === '{"x":10,"y":32,"w":100,"h":36}');
tbSvg.getScreenCTM = () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 });
DTB.querySelector('#stage-wrap').getBoundingClientRect = () => ({ left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600 });
WTB.setSingleSelection(tbBlk);
const tbOv = DTB.querySelector('#media-resizer');
check('overlay hugs content', tbOv.style.left === '105px' && tbOv.style.top === '89px' &&
  tbOv.style.width === '210px' && tbOv.style.height === '82px',
  [tbOv.style.left, tbOv.style.top, tbOv.style.width, tbOv.style.height].join(' '));
delete tbSvg.getScreenCTM;
check('overlay falls back without CTM', (function(){
  WTB.positionResizer();
  return DTB.querySelector('#media-resizer').hidden === false;
})());

// ---------- 38. initial-step model units ----------
const domIN = makeDom(html);
await wait(400);
const WIN = domIN.window, DIN = WIN.document;
WIN.gotoSlide(WIN.App.model.slideOrder[1]);
await wait(100);
check('slider minimum is stage 1', DIN.querySelector('#scrub-range').min === '1');
const inBlk = DIN.querySelector('#stage .blk');
inBlk.removeAttribute('data-anim');
check('ensure prepends initial once', WIN.ensureInitialStep(inBlk) === true &&
  JSON.parse(inBlk.getAttribute('data-anim'))[0].initial === true &&
  WIN.ensureInitialStep(inBlk) === false &&
  JSON.parse(inBlk.getAttribute('data-anim')).length === 1);
inBlk.style.left = '33%';
WIN.syncInitialStep(inBlk);
check('sync mirrors rest', JSON.parse(inBlk.getAttribute('data-anim'))[0].to.left === 33);
WIN.setSingleSelection(inBlk);
const leftRow = Array.prototype.find.call(DIN.querySelectorAll('#anim-rows details.astep')[0].querySelectorAll('.aline'), (l) => l.firstChild.textContent === 'Left %');
leftRow.querySelector('input').value = '44';
leftRow.querySelector('input').dispatchEvent(new WIN.Event('change', { bubbles: true }));
const afterCommit = JSON.parse(inBlk.getAttribute('data-anim'));
check('initial commit keeps flag + applies rest', afterCommit.length === 1 && afterCommit[0].initial === true &&
  afterCommit[0].to.left === 44 && inBlk.style.left === '44%');
// same edit with the initial preview active: rest itself moves, nothing forks
WIN.setSingleSelection(inBlk);
DIN.querySelectorAll('#anim-rows details.astep')[0].dispatchEvent(new WIN.MouseEvent('click', { bubbles: true }));
const leftRow2 = Array.prototype.find.call(DIN.querySelectorAll('#anim-rows details.astep')[0].querySelectorAll('.aline'), (l) => l.firstChild.textContent === 'Left %');
leftRow2.querySelector('input').value = '55';
leftRow2.querySelector('input').dispatchEvent(new WIN.Event('change', { bubbles: true }));
const afterPrev = JSON.parse(inBlk.getAttribute('data-anim'));
check('preview-active initial edit moves rest', afterPrev.length === 1 && afterPrev[0].initial === true &&
  afterPrev[0].to.left === 55 && inBlk.style.left === '55%' && /left:\s*55%/.test(WIN.App.model.slides[WIN.App.activeId].html));
WIN.exitStepEdit();
afterCommit[0].group = 5;
inBlk.setAttribute('data-anim', JSON.stringify(afterCommit));
const hideSec = DIN.createElement('section');
hideSec.appendChild(inBlk.cloneNode(true));
WIN.kfReset(hideSec, false);
check('appear-later starts hidden', hideSec.querySelector('.blk').style.visibility === 'hidden');
WIN.kfGroups = []; WIN.kfGroupIdx = -1;

// ---------- 39. step rows filter fields per kind, stroke on initial only ----------
const domFF = makeDom(html);
await wait(400);
const WFF = domFF.window, DFF = WFF.document;
WFF.gotoSlide(WFF.App.model.slideOrder[1]);
await wait(100);
const labelsOf = (idx) => Array.prototype.map.call(DFF.querySelectorAll('#anim-rows details.astep')[idx].querySelectorAll('.aline'), (l) => l.firstChild.textContent);
WFF.insertShape('arrow-right');
WFF.insertShape('circle');
WFF.insertShape('rectangle');
WFF.insertShape('star');
await wait(100);
const ffBlks = Array.prototype.filter.call(DFF.querySelectorAll('#stage .blk'), (b) => b.querySelector('svg'));
WFF.setSingleSelection(ffBlks[0]);
let L = labelsOf(0);
check('arrow row: Length only', L.indexOf('Length') >= 0 && L.indexOf('Radius') < 0 && L.indexOf('Width') < 0 && L.indexOf('Height') < 0 &&
  L.indexOf('Scale X') < 0 && L.indexOf('Rotation °') >= 0);
check('arrow initial owns stroke', L.indexOf('Line width') >= 0 && L.indexOf('Line color') >= 0);
WFF.setSingleSelection(ffBlks[1]);
L = labelsOf(0);
check('circle row: Radius only', L.indexOf('Radius') >= 0 && L.indexOf('Length') < 0 && L.indexOf('Width') < 0 && L.indexOf('Scale X') < 0);
WFF.setSingleSelection(ffBlks[2]);
L = labelsOf(0);
check('rectangle row: Width+Height', L.indexOf('Width') >= 0 && L.indexOf('Height') >= 0 && L.indexOf('Length') < 0 && L.indexOf('Scale X') < 0);
WFF.setSingleSelection(ffBlks[3]);
L = labelsOf(0);
check('star row: no geometry, keeps rotate', L.indexOf('Length') < 0 && L.indexOf('Radius') < 0 && L.indexOf('Width') < 0 &&
  L.indexOf('Height') < 0 && L.indexOf('Rotation °') >= 0);
// plain text block: scale back, no shape geometry, no stroke rows
const ffPlain = Array.prototype.filter.call(DFF.querySelectorAll('#stage .blk'), (b) => !b.querySelector('svg'))[0];
WFF.setSingleSelection(ffPlain);
L = labelsOf(0);
check('plain row: scale, no geometry/stroke', L.indexOf('Scale X') >= 0 && L.indexOf('Scale Y') >= 0 &&
  L.indexOf('Length') < 0 && L.indexOf('Radius') < 0 && L.indexOf('Line width') < 0);
// non-initial shape row: geometry yes, stroke no
WFF.setSingleSelection(ffBlks[1]);
DFF.querySelector('#btn-anim-add').click();
await wait(50);
const ffRows = DFF.querySelectorAll('#anim-rows details.astep');
const L2 = Array.prototype.map.call(ffRows[1].querySelectorAll('.aline'), (l) => l.firstChild.textContent);
check('follow-up row: geometry without stroke', L2.indexOf('Radius') >= 0 && L2.indexOf('Line width') < 0 && L2.indexOf('Line color') < 0);

// ---------- 40. undo/redo ----------
const domUN = makeDom(html);
await wait(400);
const WUN = domUN.window, DUN = WUN.document;
check('undo stack starts with one state', WUN.undoStack.length === 1 && WUN.redoStack.length === 0);
check('undo/redo buttons start disabled', DUN.querySelector('#btn-undo').disabled === true &&
  DUN.querySelector('#btn-redo').disabled === true);
check('empty undo is a no-op', WUN.undo() === false);
DUN.querySelector('#btn-add').click();
await wait(100);
check('add slide pushes', DUN.querySelectorAll('#filmstrip-list li').length === 4 && WUN.undoStack.length === 2);
check('undo drops the slide', WUN.undo() === true &&
  DUN.querySelectorAll('#filmstrip-list li').length === 3);
check('redo re-adds the slide', WUN.redo() === true &&
  DUN.querySelectorAll('#filmstrip-list li').length === 4);
check('buttons follow stacks', DUN.querySelector('#btn-undo').disabled === false &&
  DUN.querySelector('#btn-redo').disabled === true);
// new edit clears redo
WUN.undo();
DUN.querySelector('#btn-add').click();
await wait(100);
check('new edit clears redo', WUN.redo() === false && WUN.undoStack.length === 2);
// animation add undoes cleanly
WUN.gotoSlide(WUN.App.model.slideOrder[1]);
await wait(100);
const unBlk = DUN.querySelector('#stage .blk');
WUN.setSingleSelection(unBlk);
WUN.lastPushAt = 0; /* force a fresh entry: defeat burst coalescing on purpose */
DUN.querySelector('#btn-anim-add').click();
await wait(50);
const withStep = unBlk.hasAttribute('data-anim');
WUN.undo();
await wait(50);
const undoneLists = Array.prototype.map.call(DUN.querySelectorAll('#stage .blk'), (b) => JSON.parse(b.getAttribute('data-anim') || '[]'));
check('step add undoes to initial-only', withStep === true &&
  undoneLists.every((l) => l.length === 1 && l[0].initial === true) &&
  !/data-anim=/.test(WUN.App.model.slides.s2.html));
check('undo keeps slide context', WUN.App.activeId === WUN.App.model.slideOrder[1]);
WUN.redo();
await wait(50);
check('step add redoes', DUN.querySelector('#stage .blk').hasAttribute('data-anim'));
// undo back to a saved state clears the dirty flag
DUN.querySelector('#btn-save').click();
await wait(300);
DUN.querySelector('#btn-add').click();
await wait(100);
WUN.undo();
check('undo-to-saved shows Saved', DUN.querySelector('#dirty-flag').textContent === 'Saved');
// rapid persists coalesce into one entry
const stackBefore = WUN.undoStack.length;
WUN.App.model.title = 'burst-1';
WUN.persistSlide();
WUN.App.model.title = 'burst-2';
WUN.persistSlide();
check('burst coalesces', WUN.undoStack.length === stackBefore + 1 &&
  JSON.parse(WUN.undoStack[WUN.undoStack.length - 1].json).title === 'burst-2');
// count cap trims oldest
for (let i = 0; i < 40; i++) {
  WUN.lastPushAt = 0;
  WUN.App.model.title = 'cap-' + i;
  WUN.persistSlide();
}
check('stack capped at 30', WUN.undoStack.length === 30 &&
  JSON.parse(WUN.undoStack[WUN.undoStack.length - 1].json).title === 'cap-39');
// Ctrl+Z drives deck undo outside text, native inside text
WUN.App.model.title = 'key-1';
WUN.lastPushAt = 0;
WUN.persistSlide();
DUN.dispatchEvent(new WUN.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
check('ctrl+z undoes', WUN.App.model.title !== 'key-1');
const unRng = DUN.createRange();
unRng.selectNodeContents(DUN.querySelector('#stage .slide h1') || DUN.querySelector('#stage .slide'));
DUN.getSelection().removeAllRanges();
DUN.getSelection().addRange(unRng);
const undoLen = WUN.undoStack.length;
const unKeyEv = new WUN.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
DUN.dispatchEvent(unKeyEv);
check('ctrl+z in text keeps native undo', WUN.undoStack.length === undoLen && unKeyEv.defaultPrevented === false);
// load resets stacks
WUN.loadModel(WUN.normalizeModel(JSON.parse(JSON.stringify({ app: 'browslide', version: 2, title: 'R', theme: 'dark',
  slideOrder: ['s1'], nextId: 2, nextResId: 1, settings: {}, aspect: { w: 16, h: 9 }, resources: {},
  slides: { s1: { title: 'R', layout: 'blank', transition: 'none', notes: '', html: '<p>r</p>' } } }))));
await wait(100);
check('load resets stacks', WUN.undoStack.length === 1 && WUN.redoStack.length === 0 && WUN.undo() === false);

// ---------- 41. nudge + duplicate ----------
const domND = makeDom(html);
await wait(400);
const WND = domND.window, DND = WND.document;
WND.gotoSlide(WND.App.model.slideOrder[1]);
await wait(100);
Object.defineProperty(DND.querySelector('#stage .slide'), 'clientWidth', { value: 800, configurable: true });
Object.defineProperty(DND.querySelector('#stage .slide'), 'clientHeight', { value: 600, configurable: true });
function stubSlideND() {
  /* undo/redo rebuild the stage, dropping the stub: re-apply it */
  Object.defineProperty(DND.querySelector('#stage .slide'), 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(DND.querySelector('#stage .slide'), 'clientHeight', { value: 600, configurable: true });
}
const ndBlk0 = DND.querySelector('#stage .blk');
let ndBlk = ndBlk0;
WND.setSingleSelection(ndBlk);
DND.dispatchEvent(new WND.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
await wait(50);
check('nudge moves ~1px', ndBlk.style.left === '8.1%');
check('nudge persists + undoable', /left:\s*8\.1%/.test(WND.App.model.slides.s2.html) && (WND.undo(), /left:\s*8%/.test(WND.App.model.slides.s2.html)));
WND.redo();
await wait(50);
stubSlideND();
ndBlk = DND.querySelector('#stage .blk'); /* undo/redo rebuild the stage */
WND.setSingleSelection(ndBlk);
DND.dispatchEvent(new WND.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
await wait(50);
check('shift-nudge moves x10', ndBlk.style.left === '9.4%');
const caretRng = DND.createRange();
caretRng.setStart(DND.querySelector('#stage .slide h1 span').firstChild, 0); /* text node, not the wrapping span */
caretRng.collapse(true);
DND.getSelection().removeAllRanges();
DND.getSelection().addRange(caretRng);
const beforeCaret = ndBlk.style.left;
const caretEv = new WND.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
DND.dispatchEvent(caretEv);
check('caret keeps native arrows', ndBlk.style.left === beforeCaret && caretEv.defaultPrevented === false);
DND.getSelection().removeAllRanges();
DND.querySelector('#notes').focus();
const fieldEv = new WND.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
DND.dispatchEvent(fieldEv);
check('fields keep native arrows', ndBlk.style.left === beforeCaret && fieldEv.defaultPrevented === false);
DND.querySelector('#notes').blur();
WND.setSingleSelection(ndBlk);
const nBefore = DND.querySelectorAll('#stage .blk').length;
DND.dispatchEvent(new WND.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
await wait(100);
const nAfter = DND.querySelectorAll('#stage .blk');
check('duplicate offsets + selects copy', nAfter.length === nBefore + 1 &&
  nAfter[nAfter.length - 1].style.left === '14.4%' && WND.resizer.el === nAfter[nAfter.length - 1]);
// step-editing nudge writes the step, not rest
ndBlk = DND.querySelectorAll('#stage .blk')[0];
WND.setSingleSelection(ndBlk);
DND.querySelector('#btn-anim-add').click();
await wait(50);
DND.dispatchEvent(new WND.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
await wait(50);
const ndList = JSON.parse(ndBlk.getAttribute('data-anim'));
check('nudge lands in displayed step', ndList[ndList.length - 1].to.left === 9.5 && ndBlk.style.left === '9.5%' &&
  /left:\s*9\.4%/.test(WND.App.model.slides.s2.html));

// ---------- 42. arrange ----------
check('union + align centers', (function(){
  const boxes = [{ left: 8, top: 5, width: 20, height: 10 }, { left: 50, top: 30, width: 20, height: 10 }];
  const frame = WND.unionBox(boxes);
  const out = WND.arrangeBoxes(boxes, 'centerX', frame, boxes[0]);
  return frame.left === 8 && frame.width === 62 && out[0].left === 29 && out[1].left === 29;
})());
check('align edges + middles', (function(){
  const boxes = [{ left: 8, top: 5, width: 20, height: 10 }, { left: 50, top: 30, width: 30, height: 20 }];
  const frame = WND.unionBox(boxes);
  return WND.arrangeBoxes(boxes, 'left', frame)[1].left === 8 &&
    WND.arrangeBoxes(boxes, 'right', frame)[0].left === 60 &&
    WND.arrangeBoxes(boxes, 'centerY', frame)[0].top === 22.5 &&
    WND.arrangeBoxes(boxes, 'top', frame)[1].top === 5 &&
    WND.arrangeBoxes(boxes, 'bottom', frame)[0].top === 40;
})());
check('distribute splits gaps evenly', (function(){
  const boxes = [{ left: 0, top: 0, width: 10, height: 10 }, { left: 30, top: 0, width: 10, height: 10 }, { left: 90, top: 0, width: 10, height: 10 }];
  const out = WND.arrangeBoxes(boxes, 'distH', WND.unionBox(boxes), boxes[0]);
  return out[0].left === 0 && out[1].left === 45 && out[2].left === 90;
})());
check('distribute guards', WND.arrangeBoxes([{ left: 0, top: 0, width: 60, height: 10 }, { left: 40, top: 0, width: 60, height: 10 }], 'distH', { left: 0, top: 0, width: 100, height: 100 }) === null &&
  WND.arrangeBoxes([{ left: 0, top: 0, width: 10, height: 10 }], 'distH', { left: 0, top: 0, width: 100, height: 100 }) === null &&
  WND.arrangeBoxes([{ left: 0, top: 0, width: 10, height: 10 }], 'bogus', { left: 0, top: 0, width: 100, height: 100 }) === null);
check('match copies primary', (function(){
  const boxes = [{ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 30, height: 40 }];
  const out = WND.arrangeBoxes(boxes, 'matchW', { left: 0, top: 0, width: 100, height: 100 }, boxes[0]);
  const out2 = WND.arrangeBoxes(boxes, 'matchH', { left: 0, top: 0, width: 100, height: 100 }, boxes[1]);
  return out[1].width === 10 && out2[0].height === 40;
})());
// DOM apply: stub heights (style has none), exit step-edit for isolation
WND.exitStepEdit();
DND.querySelector('#scrub-range').value = '1';
DND.querySelector('#scrub-range').dispatchEvent(new WND.Event('input', { bubbles: true }));
stubSlideND();
const arBlks = DND.querySelectorAll('#stage .blk');
arBlks[0].style.left = '8%'; arBlks[0].style.top = '5%'; arBlks[0].style.width = '20%';
arBlks[1].style.left = '50%'; arBlks[1].style.top = '30%'; arBlks[1].style.width = '20%';
[arBlks[0], arBlks[1]].forEach((b) => Object.defineProperty(b, 'offsetHeight', { value: 60, configurable: true }));
[arBlks[0], arBlks[1]].forEach((b) => WND.syncInitialStep(b)); /* setup bypasses handlers: refresh initials or scrub re-applies stale ones */
WND.persistSlide(); /* pin the 50% setup as its own undo step */
WND.lastPushAt = 0; /* defeat burst coalescing: the arrange must push fresh */
WND.setSingleSelection(arBlks[0]);
WND.toggleSelection(arBlks[1]);
DND.querySelector('#arrange-wrap [data-arr="left"]').click();
await wait(50);
check('arrange left applies + persists', arBlks[1].style.left === '8%' &&
  /left:\s*8%/.test(WND.App.model.slides.s2.html));
WND.undo();
await wait(50);
const arUndone = DND.querySelectorAll('#stage .blk');
check('arrange undoes', arUndone[1].style.left === '50%');
WND.redo();
await wait(50);
stubSlideND();
const arRe = DND.querySelectorAll('#stage .blk');
arRe[1].style.left = '50%'; /* spread them again: redo landed both at 8% */
[arRe[0], arRe[1]].forEach((b) => Object.defineProperty(b, 'offsetHeight', { value: 60, configurable: true }));
WND.setSingleSelection(arRe[0]);
WND.toggleSelection(arRe[1]);
check('arrange centerX via API', WND.arrangeSelection('centerX') === true &&
  arRe[0].style.left === '29%' && arRe[1].style.left === '29%');
arRe[1].style.width = '40%';
check('arrange matchW copies primary', WND.arrangeSelection('matchW') === true && arRe[0].style.width === '40%' && arRe[1].style.width === '40%');
WND.setSingleSelection(arRe[0]);
check('distribute needs 2+', WND.arrangeSelection('distH') === false && WND.arrangeSelection('matchW') === false);

// ---------- 43. snap guides ----------
check('exact alignment holds with guide', (function(){
  const r = WND.snapDelta([{ l: 391, t: 100, w: 18, h: 18 }], [], 800, 600, 0, 0);
  return r.dx === 0 && r.dy === 0 && r.guides.length === 1 && r.guides[0].x === 400;
})());
check('snap catches center line', (function(){
  // mover center-x at 398 + dx 0 -> 2px off 400: snaps +2 with a vertical guide
  const r = WND.snapDelta([{ l: 389, t: 100, w: 18, h: 18 }], [], 800, 600, 0, 0);
  return r.dx === 2 && r.dy === 0 && r.guides.length === 1 && r.guides[0].x === 400;
})());
check('snap catches item edges', (function(){
  // static right edge at 300; mover left at 296 + dx 0 -> snaps +4
  const r = WND.snapDelta([{ l: 296, t: 100, w: 40, h: 40 }], [{ l: 200, t: 100, w: 100, h: 40 }], 800, 600, 0, 0);
  return r.dx === 4 && r.guides.some((g) => g.x === 300);
})());
check('snap respects threshold', (function(){
  const r = WND.snapDelta([{ l: 370, t: 100, w: 18, h: 18 }], [], 800, 600, 0, 0);
  return r.dx === 0 && r.dy === 0 && r.guides.length === 0;
})());
check('snap skips without layout', (function(){
  const a = WND.snapDelta([{ l: 0, t: 0, w: 0, h: 0 }], [], 800, 600, 30, 10);
  const b = WND.snapDelta([{ l: 10, t: 10, w: 20, h: 20 }], [], 0, 0, 30, 10);
  return a.dx === 30 && a.dy === 10 && a.guides.length === 0 && b.dx === 30 && b.dy === 10;
})());
check('snap picks closest line', (function(){
  // mover left 394 (6 off 400) but center 403 (3 off): center wins with -3
  const r = WND.snapDelta([{ l: 394, t: 100, w: 18, h: 18 }], [], 800, 600, 0, 0);
  return r.dx === -3 && r.guides.length === 1 && r.guides[0].x === 400;
})());
const snapSec = DND.querySelector('#stage .slide');
WND.showSnapGuides(snapSec, [{ x: 400 }, { y: 300 }]);
check('guides render', DND.querySelectorAll('#stage-wrap .snapguide').length === 2);
WND.clearSnapGuides();
check('guides clear', DND.querySelectorAll('#stage-wrap .snapguide').length === 0);
WND.showSnapGuides(snapSec, []);
check('empty guides render nothing', DND.querySelectorAll('#stage-wrap .snapguide').length === 0);

// ---------- 46. tables ----------
const domTB2 = makeDom(html);
await wait(400);
const WTB2 = domTB2.window, DTB2 = WTB2.document;
WTB2.gotoSlide(WTB2.App.model.slideOrder[1]);
await wait(100);
check('insertTable clamps', WTB2.insertTable(-5, 99) === true);
let tbl = DTB2.querySelector('#stage .blk table.btable');
check('table shape + clamps', !!tbl && tbl.rows.length === 1 && tbl.rows[0].cells.length === 8);
check('cells get styled spans', tbl.querySelector('td span') !== null);
WTB2.setSingleSelection(tbl.closest('.blk'));
check('row add/del + floor', WTB2.tableAddRow() === true && tbl.rows.length === 2 &&
  WTB2.tableDelRow() === true && tbl.rows.length === 1 && WTB2.tableDelRow() === false);
check('col add/del', WTB2.tableAddCol() === true && tbl.rows[0].cells.length === 9 &&
  WTB2.tableDelCol() === true && tbl.rows[0].cells.length === 8);
while (tbl.rows[0].cells.length > 1) WTB2.tableDelCol();
check('col floor keeps one', tbl.rows[0].cells.length === 1 && WTB2.tableDelCol() === false);
check('row/col ops need a table', (WTB2.setSingleSelection(DTB2.querySelectorAll('#stage .blk')[0]), WTB2.tableAddRow() === false));
WTB2.insertTable(2, 3);
await wait(50);
const tbl2 = DTB2.querySelectorAll('#stage .blk table.btable')[1];
const cellRng = DTB2.createRange();
cellRng.selectNodeContents(tbl2.rows[1].cells[2].querySelector('span').firstChild);
DTB2.getSelection().removeAllRanges();
DTB2.getSelection().addRange(cellRng);
WTB2.trackSelection();
WTB2.applySpanStyle('color', '#ff0000');
check('cell text takes color', Array.prototype.some.call(tbl2.querySelectorAll('span'), (s) => s.style.color !== ''));
WTB2.applyAlign('justifyCenter');
check('cell aligns individually', tbl2.rows[1].cells[2].style.textAlign === 'center');
const rowsBefore = tbl2.rows.length;
WTB2.setSingleSelection(tbl2.closest('.blk'));
WTB2.lastPushAt = 0; /* defeat coalescing: the add must push fresh */
WTB2.tableAddRow();
WTB2.undo();
await wait(50);
check('table row add undoes', DTB2.querySelectorAll('#stage .blk table.btable')[1].rows.length === rowsBefore);
DTB2.querySelector('#btn-save').click();
await wait(300);
const tT = await blobToText(WTB2.__savedBlob, WTB2);
check('save keeps tables', /<table/.test(tT) && /<td/.test(tT));
const savedT = JSON.parse(new JSDOM(tT).window.document.querySelector('#slider-data').textContent);
check('saved model has table html', /<table/.test(savedT.slides[WTB2.App.model.slideOrder[1]].html));
DTB2.querySelector('#btn-export').click();
await wait(300);
check('export keeps tables', /<table/.test(await blobToText(WTB2.__savedBlob, WTB2)));
const dirtyT = WTB2.normalizeModel({ app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
  settings: {}, aspect: { w: 16, h: 9 }, resources: {},
  slides: { s1: { title: 'T', layout: 'blank', transition: 'none', notes: '', html: '<table><tr><td onclick="x()">a<script>e()<\/script></td></tr></table>' } } });
check('sanitizer keeps tables, strips junk', /<table/.test(dirtyT.slides.s1.html) && !/onclick|script/i.test(dirtyT.slides.s1.html));

// ---------- 47. lists, bullets, shrink ----------
const domLS = makeDom(html);
await wait(400);
const WLS = domLS.window, DLS = WLS.document;
WLS.gotoSlide(WLS.App.model.slideOrder[1]);
await wait(100);
const lsSec = () => DLS.querySelector('#stage .slide');
function lsCaret(node) {
  const r = DLS.createRange();
  r.setStart(node, 0);
  r.collapse(true);
  DLS.getSelection().removeAllRanges();
  DLS.getSelection().addRange(r);
  WLS.trackSelection();
}
lsCaret(lsSec().querySelector('ul li span').firstChild);
check('caretLI finds item', WLS.caretLI() !== null && WLS.caretLI().tagName === 'LI');
check('currentList finds list', WLS.currentList() !== null && WLS.currentList().tagName === 'UL');
DLS.querySelector('#list-select').value = 'square';
DLS.querySelector('#list-select').dispatchEvent(new WLS.Event('change', { bubbles: true }));
check('bullet style applies + persists', lsSec().querySelector('ul').style.listStyleType === 'square' &&
  /list-style-type:\s*square/.test(WLS.activeSlide().html));
WLS.updateFormatUI();
check('picker reflects list', DLS.querySelector('#list-select').value === 'square');
const tabEv = new WLS.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
DLS.dispatchEvent(tabEv);
check('tab indents via fallback', tabEv.defaultPrevented === true &&
  WLS.caretLI().style.paddingLeft === '2em');
const tabBack = new WLS.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
DLS.dispatchEvent(tabBack);
check('shift-tab outdents', WLS.caretLI().style.paddingLeft === '');
lsCaret(lsSec().querySelector('h1 span').firstChild);
const tabPlain = new WLS.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
DLS.dispatchEvent(tabPlain);
check('tab outside lists stays native', tabPlain.defaultPrevented === false);
DLS.querySelector('#notes').focus();
const tabField = new WLS.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
DLS.dispatchEvent(tabField);
check('tab in fields stays native', tabField.defaultPrevented === false);
DLS.querySelector('#notes').blur();
check('shrink defaults off', WLS.activeSlide().shrinkText === false);
DLS.querySelector('#opt-shrink').checked = true;
DLS.querySelector('#opt-shrink').dispatchEvent(new WLS.Event('change', { bubbles: true }));
check('shrink toggle persists', WLS.activeSlide().shrinkText === true &&
  /"shrinkText":true/.test(JSON.stringify(WLS.App.model.slides)));
WLS.undo();
check('shrink toggle undoes', WLS.activeSlide().shrinkText === false);
DLS.querySelector('#opt-shrink').checked = true;
DLS.querySelector('#opt-shrink').dispatchEvent(new WLS.Event('change', { bubbles: true }));
const lsBlk = lsSec().querySelector('.blk');
Object.defineProperty(lsBlk, 'scrollHeight', { value: 200, configurable: true });
Object.defineProperty(lsBlk, 'clientHeight', { value: 100, configurable: true });
check('shrink loop clamps at half', WLS.shrinkToFit(lsSec()) === true && lsBlk.style.fontSize === '0.5em');
Object.defineProperty(lsBlk, 'scrollHeight', { value: 50, configurable: true });
check('fitting text resets size', WLS.shrinkToFit(lsSec()) === false && lsBlk.style.fontSize === '');
DLS.querySelector('#opt-shrink').checked = false;
DLS.querySelector('#opt-shrink').dispatchEvent(new WLS.Event('change', { bubbles: true }));
Object.defineProperty(lsBlk, 'scrollHeight', { value: 200, configurable: true });
check('shrink off skips loop', WLS.shrinkToFit(lsSec()) === false);

// ---------- 48. symbol shapes ----------
const domSY = makeDom(html);
await wait(400);
const WSY = domSY.window, DSY = WSY.document;
WSY.gotoSlide(WSY.App.model.slideOrder[1]);
await wait(100);
const newKinds = ['plus', 'minus', 'diamond', 'pentagon', 'hexagon', 'heart', 'right-triangle', 'smiley', 'note', 'bolt', 'block-arrow', 'target'];
check('library gains 12 symbols', newKinds.every((k) => !!WSY.SHAPE_DEFS[k] && WSY.SHAPE_DEFS[k].params.length === 0) &&
  Object.keys(WSY.SHAPE_DEFS).length === 26);
check('new markup inert + primitive-only', newKinds.every((k) => {
  const g = WSY.SHAPE_DEFS[k].geo({});
  return /<(line|polyline|polygon|circle|rect|ellipse)/.test(g) && !/script|on\w+=|javascript:|<path/i.test(g);
}));
WSY.insertShape('heart');
await wait(50);
const heartSvg = DSY.querySelectorAll('#stage .blk svg');
const heartBlk = heartSvg[heartSvg.length - 1].closest('.blk');
check('heart inserts + saves', heartSvg[heartSvg.length - 1].getAttribute('data-kind') === 'heart' &&
  WSY.App.model.slides.s2.html.includes('data-kind="heart"'));
check('heart bbox resolves (no path tags)', WSY.svgContentBox(heartSvg[heartSvg.length - 1]) !== null);
WSY.setSingleSelection(heartBlk);
check('fixed symbols hide size handles', DSY.querySelector('#media-resizer .mhandle').style.display === 'none' &&
  DSY.querySelector('#media-resizer .mh-e').style.display === 'none' &&
  DSY.querySelector('#media-resizer .mh-s').style.display === 'none');

// ---------- 49. copy/paste animation steps ----------
const domCP = makeDom(html);
await wait(400);
const WCP = domCP.window, DCP = WCP.document;
WCP.gotoSlide(WCP.App.model.slideOrder[1]);
await wait(100);
const cpBlks = DCP.querySelectorAll('#stage .blk');
const mkStep = (group, left) => ({ group, trigger: 'click', dur: 600, delay: 200, mode: 'linear', maxSpeed: 1.5, accel: 2, minSpeed: 0, decel: 2, to: { left } });
check('paste with empty clipboard no-ops', (function(){
  WCP.setSingleSelection(cpBlks[0]);
  DCP.querySelector('#btn-anim-paste').click();
  return JSON.parse(cpBlks[0].getAttribute('data-anim')).length === 1;
})());
check('copy needs a selection', (WCP.clearSelection(), DCP.querySelector('#btn-anim-copy').click(), WCP.animClip === null));
cpBlks[0].setAttribute('data-anim', JSON.stringify([mkStep(2, 20), mkStep(4, 60)]));
cpBlks[1].setAttribute('data-anim', JSON.stringify([mkStep(3, 40)]));
WCP.syncStageToModel();
WCP.setSingleSelection(cpBlks[0]);
DCP.querySelector('#btn-anim-copy').click();
check('copy takes full list', WCP.animClip.length === 3 && WCP.animClip[0].initial === true &&
  WCP.animClip[2].to.left === 60);
WCP.setSingleSelection(cpBlks[1]);
DCP.querySelector('#btn-anim-paste').click();
await wait(50);
const pasted = JSON.parse(cpBlks[1].getAttribute('data-anim'));
check('paste preserves target initial', pasted.length === 3 && pasted[0].initial === true &&
  pasted[0].to.left === 8 && pasted[1].to.left === 20 && pasted[2].to.left === 60);
check('paste extends scrub range', DCP.querySelector('#scrub-range').max === '4');
check('paste persists + undoes', /data-anim=/.test(WCP.App.model.slides.s2.html) && (WCP.undo(), JSON.parse(DCP.querySelectorAll('#stage .blk')[1].getAttribute('data-anim')).length === 1));
check('paste button enables with clip', DCP.querySelector('#btn-anim-paste').disabled === false);

// ---------- 50. filmstrip stage badges ----------
const domBG = makeDom(html);
await wait(400);
const WBG = domBG.window, DBG = WBG.document;
check('counts mixed triggers', JSON.stringify(WBG.slideStageCounts(
  '<div data-anim=\'[{"group":1,"trigger":"click","dur":600,"delay":0,"mode":"linear","to":{"left":1}}]\'></div>' +
  '<div data-anim=\'[{"group":1,"trigger":"auto","dur":600,"delay":0,"mode":"linear","to":{"left":2}},{"group":2,"trigger":"auto","dur":600,"delay":0,"mode":"linear","to":{"left":3}}]\'></div>'
)) === JSON.stringify({ total: 2, click: 1, auto: 1 }));
check('counts empty + malformed', JSON.stringify(WBG.slideStageCounts('<p>plain</p>')) === JSON.stringify({ total: 0, click: 0, auto: 0 }) &&
  JSON.stringify(WBG.slideStageCounts('<div data-anim="bogus">x</div>')) === JSON.stringify({ total: 0, click: 0, auto: 0 }) &&
  WBG.stageBadge('<p>plain</p>') === '' && WBG.stageBadge('') === '');
check('badge formats split', WBG.stageBadge(
  '<div data-anim=\'[{"group":1,"trigger":"click","dur":600,"delay":0,"mode":"linear","to":{"left":1}},{"group":3,"trigger":"click","dur":600,"delay":0,"mode":"linear","to":{"left":2}}]\'></div>'
) === '2▸');
WBG.gotoSlide(WBG.App.model.slideOrder[1]);
await wait(100);
check('no badge without animation', DBG.querySelector('#filmstrip-list li:nth-child(2) .stages') === null);
const bgBlk = DBG.querySelector('#stage .blk');
WBG.setSingleSelection(bgBlk);
DBG.querySelector('#btn-anim-add').click();
await wait(50);
WBG.exitStepEdit();
const bgBadge = DBG.querySelector('#filmstrip-list li:nth-child(2) .stages');
check('badge appears after step add', !!bgBadge && bgBadge.textContent.includes('▸'));
DBG.querySelector('#anim-rows .adel').click();
await wait(50);
check('badge clears after step delete', DBG.querySelector('#filmstrip-list li:nth-child(2) .stages') === null);

// ---------- 51. motion paths ----------
check('pathPointAt ends exact + midpoint', (function(){
  const p0 = WBG.pathPointAt([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0);
  const p1 = WBG.pathPointAt([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1);
  const pm = WBG.pathPointAt([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5);
  return p0.x === 0 && p0.y === 0 && p1.x === 10 && p1.y === 0 && pm.x === 5 && pm.y === 0;
})());
check('pathPointAt multisegment + clamp + degenerate', (function(){
  const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const mid = WBG.pathPointAt(L, 0.5);
  const lo = WBG.pathPointAt(L, -1), hi = WBG.pathPointAt(L, 2);
  const zg = WBG.pathPointAt([{ x: 5, y: 5 }, { x: 5, y: 5 }], 0.7);
  return mid.x === 10 && mid.y === 0 && lo.x === 0 && lo.y === 0 && hi.x === 10 && hi.y === 10 &&
    zg.x === 5 && zg.y === 5;
})());
check('clean keeps path, forces end', (function(){
  const l = WBG.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 0, mode: 'linear',
    to: { left: 10, top: 20, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }]));
  return l.length === 1 && l[0].to.path.length === 2 && l[0].to.path[1].x === 10 && l[0].to.path[1].y === 20;
})());
check('clean drops bad paths', (function(){
  const one = WBG.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 0, mode: 'linear', to: { left: 1, top: 1, path: [{ x: 0, y: 0 }] } }]));
  const str = WBG.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 0, mode: 'linear', to: { left: 1, top: 1, path: 'nope' } }]));
  const big = [];
  for (let i = 0; i < 60; i++) big.push({ x: i, y: 0 });
  const capped = WBG.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 0, mode: 'linear', to: { left: 59, top: 0, path: big } }]));
  const nan = WBG.parseAnimList(JSON.stringify([{ group: 1, trigger: 'click', dur: 600, delay: 0, mode: 'linear', to: { left: 1, top: 1, path: [{ x: 0, y: 0 }, { x: 'z', y: 0 }] } }]));
  return one[0].to.path === undefined && str[0].to.path === undefined &&
    capped[0].to.path.length === 50 && nan[0].to.path === undefined;
})());
check('kfWrite follows path', (function(){
  const el = WBG.document.createElement('div');
  const to = { left: 10, top: 0, path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  WBG.kfWrite(el, { left: 0, top: 0 }, to, 0.5);
  const mid = el.style.left === '5%' && el.style.top === '0%';
  WBG.kfWrite(el, { left: 0, top: 0 }, to, 1);
  return mid && el.style.left === '10%' && el.style.top === '0%';
})());
const domMP = makeDom(html);
await wait(400);
const WMP = domMP.window, DMP = WMP.document;
WMP.gotoSlide(WMP.App.model.slideOrder[1]);
await wait(100);
Object.defineProperty(DMP.querySelector('#stage .slide'), 'clientWidth', { value: 800, configurable: true });
Object.defineProperty(DMP.querySelector('#stage .slide'), 'clientHeight', { value: 600, configurable: true });
const mpBlk = DMP.querySelector('#stage .blk');
WMP.setSingleSelection(mpBlk);
DMP.querySelector('#btn-anim-add').click();
await wait(50);
DMP.querySelectorAll('#anim-rows .pdraw')[0].click();
check('draw arms with seeded trail', !!WMP.pathDraw && WMP.pathDraw.idx === 1 &&
  JSON.stringify(WMP.pathDraw.pts) === JSON.stringify([{ x: 8, y: 5 }]) &&
  DMP.body.style.cursor === 'crosshair');
mpBlk.dispatchEvent(new WMP.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
DMP.defaultView.dispatchEvent(new WMP.MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 0 }));
DMP.defaultView.dispatchEvent(new WMP.MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 0 }));
DMP.defaultView.dispatchEvent(new WMP.MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 0 }));
await wait(100);
const mpEntry = JSON.parse(mpBlk.getAttribute('data-anim'))[1];
check('drop records trail ending at pose', mpEntry.to.left === 28 && mpEntry.to.path.length === 4 &&
  mpEntry.to.path[0].x === 8 && mpEntry.to.path[3].x === 28 && mpEntry.to.path[3].y === 5 &&
  mpBlk.style.left === '28%' && /left:\s*8%/.test(WMP.App.model.slides.s2.html) && WMP.pathDraw === null);
check('trail overlay shows while editing', DMP.querySelectorAll('#stage-wrap .pathoverlay').length === 1 &&
  DMP.querySelector('#stage-wrap .pathoverlay polyline') !== null);
WMP.exitStepEdit();
check('overlay clears on exit', DMP.querySelectorAll('#stage-wrap .pathoverlay').length === 0);
DMP.querySelectorAll('#anim-rows .pdraw')[0].click();
DMP.dispatchEvent(new WMP.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc cancels drawing', WMP.pathDraw === null && DMP.body.style.cursor === '');
DMP.querySelector('#btn-export').click();
await wait(300);
const exP = await blobToText(WMP.__savedBlob, WMP);
check('viewer carries path player + data', exP.includes('pathPointAt') && /&quot;path&quot;/.test(exP));

// ---------- 45. style painter ----------
const domPT = makeDom(html);
await wait(400);
const WPT = domPT.window, DPT = WPT.document;
WPT.gotoSlide(WPT.App.model.slideOrder[1]);
await wait(100);
const ptBlks = DPT.querySelectorAll('#stage .blk');
const sampT = WPT.sampleLook(ptBlks[0]);
check('sample reads text look', !!sampT && !!sampT.text && sampT.text.fontSize === '1em' &&
  sampT.align === null && sampT.stroke === null && sampT.geom === null && sampT.rot === null);
const loneImg = DPT.createElement('img');
loneImg.src = 'data:image/png;base64,AAA=';
DPT.querySelector('#stage .slide').appendChild(loneImg);
check('bare media samples nothing', WPT.sampleLook(loneImg) === null);
WPT.insertShape('circle');
WPT.insertShape('rectangle');
await wait(50);
const ptShapes = Array.prototype.filter.call(DPT.querySelectorAll('#stage .blk'), (b) => b.querySelector('svg'));
const sampC = WPT.sampleLook(ptShapes[0]);
check('sample reads shape look', !!sampC && sampC.stroke.color === '#2563eb' && sampC.stroke.width === '3' &&
  sampC.geom.kind === 'circle' && sampC.geom.params.radius === 40);
WPT.applyLook(ptShapes[1], sampC);
check('cross-kind skips geometry, keeps stroke', ptShapes[1].querySelector('svg').getAttribute('data-width') === '72' &&
  ptShapes[1].querySelector('svg').getAttribute('stroke') === '#2563eb');
ptShapes[0].setAttribute('data-rot', '30');
WPT.applyTransform(ptShapes[0]);
check('rot copies', WPT.sampleLook(ptShapes[0]).rot === 30 &&
  (WPT.applyLook(ptShapes[1], WPT.sampleLook(ptShapes[0])), ptShapes[1].getAttribute('data-rot') === '30'));
ptBlks[0].querySelector('span').style.color = '#abcdef';
DPT.querySelector('#btn-painter').click();
check('painter arms pick mode', WPT.paintPicking === true && DPT.querySelector('#btn-painter').classList.contains('active'));
ptBlks[0].dispatchEvent(new WPT.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('pick samples source', WPT.paintPicking === false && !!WPT.paintDesc && WPT.paintDesc.text.color !== '');
const dstColor = WPT.paintDesc.text.color;
ptBlks[1].dispatchEvent(new WPT.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
await wait(50);
check('apply stamps + disarms', ptBlks[1].querySelector('span').style.color === dstColor &&
  WPT.paintArmed() === false && !DPT.querySelector('#btn-painter').classList.contains('active'));
DPT.querySelector('#btn-painter').click();
ptBlks[0].dispatchEvent(new WPT.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
ptBlks[1].dispatchEvent(new WPT.MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }));
check('shift keeps apply mode', WPT.paintArmed() === true);
DPT.dispatchEvent(new WPT.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc cancels painter', WPT.paintArmed() === false);
DPT.querySelector('#btn-painter').click();
loneImg.dispatchEvent(new WPT.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
check('empty pick disarms', WPT.paintArmed() === false && WPT.paintDesc === null);

// ---------- 44. eyedropper + recent colors ----------
const domRC = makeDom(html);
await wait(400);
const WRC = domRC.window, DRC = WRC.document;
check('recent defaults empty', Array.isArray(WRC.App.model.settings.recentColors) &&
  WRC.App.model.settings.recentColors.length === 0);
check('normalize scrubs recents', (function(){
  const m = WRC.normalizeModel({ app: 'browslide', version: 2, title: 'T', theme: 'dark', slideOrder: ['s1'], nextId: 2, nextResId: 1,
    settings: { recentColors: ['#FF0000', 'bogus', '#abc', 7, '#00ff00', '#00FF00'] }, aspect: { w: 16, h: 9 },
    resources: {}, slides: { s1: { title: 'T', layout: 'blank', transition: 'none', notes: '', html: '<p>x</p>' } } });
  return JSON.stringify(m.settings.recentColors) === JSON.stringify(['#ff0000', '#00ff00']);
})());
check('push dedups + validates', (function(){
  WRC.pushRecentColor('#112233');
  WRC.pushRecentColor('nope');
  WRC.pushRecentColor('#112233');
  WRC.pushRecentColor('#445566');
  return JSON.stringify(WRC.App.model.settings.recentColors) === JSON.stringify(['#445566', '#112233']);
})());
for (let i = 0; i < 10; i++) WRC.pushRecentColor('#0000' + (i < 10 ? '0' + i : i));
check('recent caps at 8 newest-first', WRC.App.model.settings.recentColors.length === 8 &&
  WRC.App.model.settings.recentColors[0] === '#000009');
check('dropper hidden without API', DRC.querySelector('#font-dropper').hidden === true);
WRC.renderRecentSwatches();
check('swatches render', DRC.querySelectorAll('#recent-swatches button').length === 8);
const rcSec = () => DRC.querySelector('#stage .slide');
const rcRng = DRC.createRange();
rcRng.selectNodeContents(rcSec().querySelector('h1 span').firstChild);
DRC.getSelection().removeAllRanges();
DRC.getSelection().addRange(rcRng);
WRC.trackSelection();
DRC.querySelectorAll('#recent-swatches button')[0].click();
const rcColored = Array.prototype.filter.call(rcSec().querySelectorAll('span'), (s) => s.style.color !== '');
check('swatch applies span color', rcColored.length >= 1);
DRC.querySelector('#font-color').value = '#123456';
DRC.querySelector('#font-color').dispatchEvent(new WRC.Event('change', { bubbles: true }));
check('color input records recent', WRC.App.model.settings.recentColors[0] === '#123456');
check('pickColor null without API', await WRC.pickColor() === null);
WRC.EyeDropper = function(){ this.open = () => Promise.resolve({ sRGBHex: '#1A2b3C' }); };
check('pickColor reads API', await WRC.pickColor() === '#1a2b3c');
WRC.EyeDropper = function(){ this.open = () => Promise.reject(new Error('denied')); };
check('pickColor null on deny', await WRC.pickColor() === null);

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
