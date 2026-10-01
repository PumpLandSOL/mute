'use strict';
// Dependency-free EVM signature recovery: keccak-256 + secp256k1 ecrecover for personal_sign messages.
// Used to prove a caller controls the wallet before any Live desk action.

// ---------- keccak-256 ----------
const M64 = (1n << 64n) - 1n;
const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rol = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function f1600(s) {
  for (let rnd = 0; rnd < 24; rnd++) {
    const c = []; for (let x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) { const d = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= d; }
    const b = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rol(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y] & M64) & b[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[rnd];
  }
}
function keccak256(buf) {
  buf = Buffer.from(buf); const rate = 136; const padLen = rate - (buf.length % rate);
  const p = Buffer.alloc(buf.length + padLen); buf.copy(p); p[buf.length] ^= 0x01; p[p.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += rate) { for (let i = 0; i < rate / 8; i++) s[i] ^= p.readBigUInt64LE(off + i * 8); f1600(s); }
  const out = Buffer.alloc(32); for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8); return out;
}

// ---------- secp256k1 ----------
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m) => ((a % m) + m) % m;
function inv(a, m) { let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } return mod(s0, m); }
function pow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function add(A, B) {
  if (!A) return B; if (!B) return A; const [x1, y1] = A, [x2, y2] = B;
  if (x1 === x2) { if (mod(y1 + y2, P) === 0n) return null; const l = mod(3n * x1 * x1 * inv(2n * y1, P), P); const x = mod(l * l - 2n * x1, P); return [x, mod(l * (x1 - x) - y1, P)]; }
  const l = mod((y2 - y1) * inv(x2 - x1, P), P); const x = mod(l * l - x1 - x2, P); return [x, mod(l * (x1 - x) - y1, P)];
}
function mul(A, k) { let R = null; k = mod(k, N); while (k > 0n) { if (k & 1n) R = add(R, A); A = add(A, A); k >>= 1n; } return R; }
const toBuf32 = (x) => Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
const pubToAddress = (Q) => '0x' + keccak256(Buffer.concat([toBuf32(Q[0]), toBuf32(Q[1])])).subarray(12).toString('hex');

function recover(hash, sigHex) {
  const sig = Buffer.from(String(sigHex).replace(/^0x/, ''), 'hex'); if (sig.length !== 65) throw new Error('bad signature length');
  const r = BigInt('0x' + sig.subarray(0, 32).toString('hex')), s = BigInt('0x' + sig.subarray(32, 64).toString('hex')); let v = sig[64]; if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('bad v'); if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('bad r/s');
  const y2 = mod(r * r * r + 7n, P); let y = pow(y2, (P + 1n) / 4n, P); if (y * y % P !== y2) throw new Error('not on curve'); if (Number(y & 1n) !== v) y = P - y;
  const e = BigInt('0x' + Buffer.from(hash).toString('hex')); const ri = inv(r, N);
  const Q = add(mul([r, y], mod(s * ri, N)), mul(G, mod(-e * ri, N))); if (!Q) throw new Error('bad point'); return pubToAddress(Q);
}
const personalHash = (msg) => { const m = Buffer.from(msg, 'utf8'); return keccak256(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + m.length, 'utf8'), m])); };
const recoverPersonal = (msg, sig) => recover(personalHash(msg), sig);

// test helper only: sign with a private key (deterministic k from the hash, never used in production paths)
function signPersonal(msg, priv) {
  const h = personalHash(msg), e = BigInt('0x' + h.toString('hex')); const k = mod(BigInt('0x' + keccak256(Buffer.concat([h, toBuf32(priv)])).toString('hex')), N - 1n) + 1n;
  const R = mul(G, k), r = mod(R[0], N); let s = mod(inv(k, N) * (e + r * priv), N); let v = Number(R[1] & 1n); if (s > N / 2n) { s = N - s; v ^= 1; }
  return '0x' + toBuf32(r).toString('hex') + toBuf32(s).toString('hex') + (27 + v).toString(16);
}
module.exports = { keccak256, recoverPersonal, signPersonal, pubToAddress, mul, G };
