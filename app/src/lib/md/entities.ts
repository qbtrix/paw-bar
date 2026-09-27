// lib/md/entities.ts — decode HTML character references in reply text.
// Created 2026-09-27 with the native markdown renderer. The old path got this
// for free from the browser parsing marked's HTML; text bindings show `&amp;`
// literally, so the decoding happens here. Named references cover what models
// actually write; an unknown name stays as typed.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓',
  frac12: '½', frac14: '¼', frac34: '¾', ne: '≠', le: '≤', ge: '≥', infin: '∞',
};

const ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

function fromCodePoint(n: number): string | null {
  // NUL, surrogates and out-of-range code points become U+FFFD, as browsers do.
  if (n === 0 || (n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return '�';
  return String.fromCodePoint(n);
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(ENTITY_RE, (whole, dec: string, hex: string, name: string) => {
    if (dec) return fromCodePoint(parseInt(dec, 10)) ?? whole;
    if (hex) return fromCodePoint(parseInt(hex, 16)) ?? whole;
    return NAMED[name] ?? whole;
  });
}
