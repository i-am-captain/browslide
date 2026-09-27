import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Phase 5 native-codec tests. Runs the REAL CompressionStream/DecompressionStream
// (Node 18+ implements the same WHATWG spec as browsers) plus a zlib cross-check
// proving byte-level interop with a real deflate implementation. Run: npm test
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'browslide.html');
const src = fs.readFileSync(SRC, 'utf-8');
const js = src.match(/<script>([\s\S]*?)<\/script>/)[1];
global.document = { addEventListener() {} }; // boot hook; nothing else runs at load
vm.runInThisContext(js, { filename: 'browslide-app.js' });
const { Codec, parseDataUrl, COMPRESSIBLE_RE } = globalThis;
delete global.document;

let failures = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failures++;
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (s) => new TextEncoder().encode(s);
const zeros = new Uint8Array(5000);
const text = bytes('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/>'.repeat(40));
const rand = new Uint8Array(3000);
for (let i = 0; i < rand.length; i++) rand[i] = (i * 2654435761) % 251;

check('native codec supported here', Codec.supported() === true);
check('preferred format is deflate-raw', Codec.preferredFormat() === 'deflate-raw');

// base64 helpers incl. >64KB chunking path
const big = new Uint8Array(200000);
for (let i = 0; i < big.length; i++) big[i] = i % 251;
check('bytesToB64/b64ToBytes round-trip (200KB)', eq(Codec.b64ToBytes(Codec.bytesToB64(big)), big));

// native round-trips
for (const [name, data] of [['zeros', zeros], ['svg text', text], ['pseudo-random', rand]]) {
  const comp = await Codec.compress(data, 'deflate-raw');
  const back = await Codec.decompress(comp, 'deflate-raw');
  check(`deflate-raw round-trip (${name})`, eq(back, data), `${data.length} -> ${comp.length}`);
}
const gz = await Codec.compress(text, 'gzip');
check('gzip round-trip', eq(await Codec.decompress(gz, 'gzip'), text));

// byte-level interop with zlib (proves the format is real deflate, not just self-consistent)
const zc = zlib.deflateRawSync(Buffer.from(text));
check('Codec decodes zlib deflateRaw output', eq(await Codec.decompress(new Uint8Array(zc), 'deflate-raw'), text));
const mine = await Codec.compress(text, 'deflate-raw');
check('zlib decodes Codec output', eq(new Uint8Array(zlib.inflateRawSync(Buffer.from(mine))), text));

// policy + parser fields the save path relies on
check('policy compresses svg/wav/json/text', ['image/svg+xml', 'audio/wav', 'audio/x-wav', 'text/plain', 'application/json'].every((m) => COMPRESSIBLE_RE.test(m)));
check('policy skips jpeg/png/mp4', ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg'].every((m) => !COMPRESSIBLE_RE.test(m)));
const p = parseDataUrl('data:image/svg+xml;base64,' + Codec.bytesToB64(text));
check('parseDataUrl exposes payload', p && p.base64 === true && p.payload.length > 0 && p.mime === 'image/svg+xml');

console.log(failures === 0 ? '\nALL CODEC TESTS PASSED' : `\n${failures} CODEC TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
