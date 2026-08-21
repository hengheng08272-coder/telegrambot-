// MD5 of a KHQR payload — the handle Bakong's Open API answers about
// ("has this exact QR been paid?", check_transaction_by_md5).
//
// Written out here rather than pulled from a package because it is the
// only hashing this app does, WebCrypto deliberately does not offer MD5,
// and every candidate package is a transitive dependency of something
// else that may or may not be hoisted. Forty lines with a known-answer
// test beats a dependency that can vanish on the next install.
//
// This is a checksum-style use — an identifier the bank and this app
// both compute over the same public string. Nothing here is a security
// boundary, which is just as well, because MD5 has not been one for a
// very long time.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(2^32 * abs(sin(i + 1)))
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

export function md5(input: string): string {
  // KHQR payloads are ASCII, but encode properly anyway so a merchant
  // name with non-Latin characters hashes the same here as anywhere else.
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit little-endian length. A KHQR payload is a few hundred bytes,
  // so the high word is always zero, but write it properly regardless.
  for (let i = 0; i < 8; i++) bytes.push((bitLength / 2 ** (8 * i)) & 0xff);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = Array.from({ length: 16 }, (_, j) => {
      const o = chunk + j * 4;
      return bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    });

    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0]
    .map((word) =>
      Array.from({ length: 4 }, (_, i) => ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')).join(''),
    )
    .join('');
}
