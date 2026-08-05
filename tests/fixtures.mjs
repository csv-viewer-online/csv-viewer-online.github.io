// CSV fixtures are generated rather than committed, for three reasons:
//   - UTF-16 files are binary blobs nobody can review in a diff
//   - generating them lets us ASSERT the bytes are really in the claimed
//     encoding, so a fixture cannot silently stop testing what it claims to
//   - they never enter the repo, so GitHub Pages never serves test data
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEADER = ['name', 'city', 'note']
const ROWS = [
  ['José', 'São Paulo', 'accented vowels'],
  ['François', 'Genève', 'cedilla + grave'],
  ['Müller', 'Zürich', 'umlauts']
]

const toCsv = (rows) => rows.map((r) => r.join(',')).join('\n') + '\n'
const BODY = toCsv([HEADER, ...ROWS])

// Every character above is <= U+00FF, so Windows-1252 and ISO-8859-1 encode
// these bytes identically — which is why both are expected to report as
// Windows-1252 after detection.
const latin1 = (text) => Buffer.from(text, 'latin1')
const utf16le = (text) => Buffer.from(text, 'utf16le')
const utf16be = (text) => Buffer.from(text, 'utf16le').swap16()

const BOM = { utf8: Buffer.from([0xef, 0xbb, 0xbf]), le: Buffer.from([0xff, 0xfe]), be: Buffer.from([0xfe, 0xff]) }
const cat = (...bufs) => Buffer.concat(bufs)

/**
 * name -> { bytes, encoding (what detection should report), decodesTo }
 * `encoding: null` means "detection should report UTF-8", i.e. no chip suffix.
 */
export const FIXTURES = {
  'ascii.csv': {
    bytes: Buffer.from(toCsv([HEADER, ['Acme', 'Berlin', 'plain ASCII only']]), 'utf8'),
    encoding: null,
    firstRow: ['Acme', 'Berlin']
  },
  'utf8.csv': {
    bytes: Buffer.from(BODY + toCsv([['東京', '日本', 'CJK'], ['Emoji', '🙂', 'non-BMP']]), 'utf8'),
    encoding: null,
    firstRow: ['José', 'São Paulo']
  },
  'utf8-bom.csv': {
    bytes: cat(BOM.utf8, Buffer.from(BODY, 'utf8')),
    encoding: null,
    firstRow: ['José', 'São Paulo']
  },
  'windows-1252.csv': {
    bytes: latin1(BODY),
    encoding: 'Windows-1252',
    firstRow: ['José', 'São Paulo']
  },
  'latin1.csv': {
    bytes: latin1(BODY),
    encoding: 'Windows-1252',
    firstRow: ['José', 'São Paulo']
  },
  'utf16le-bom.csv': {
    bytes: cat(BOM.le, utf16le(BODY)),
    encoding: 'UTF-16LE',
    firstRow: ['José', 'São Paulo']
  },
  'utf16le-nobom.csv': {
    bytes: utf16le(BODY),
    encoding: 'UTF-16LE',
    firstRow: ['José', 'São Paulo']
  },
  'utf16be-bom.csv': {
    bytes: cat(BOM.be, utf16be(BODY)),
    encoding: 'UTF-16BE',
    firstRow: ['José', 'São Paulo']
  },
  'utf16be-nobom.csv': {
    bytes: utf16be(BODY),
    encoding: 'UTF-16BE',
    firstRow: ['José', 'São Paulo']
  },

  // Not encoding cases — used by the smoke and input specs
  'semicolons.csv': { bytes: Buffer.from('name;city;qty\nJosé;Köln;5\nAcme;Berlin;12\n', 'utf8'), encoding: null },
  'tabs.tsv': { bytes: Buffer.from('name\tcity\tqty\nAcme\tBerlin\t5\nGlobex\tTokyo\t7\n', 'utf8'), encoding: null },
  'pipes.csv': { bytes: Buffer.from('name|city|qty\nAcme|Berlin|5\n', 'utf8'), encoding: null },
  'plain.csv': { bytes: Buffer.from(toCsv([HEADER, ...ROWS]), 'utf8'), encoding: null },

  // An unterminated quote swallows the rows that follow it
  'malformed.csv': { bytes: Buffer.from('name,city\n"unterminated quote,Berlin\nok,Paris\n', 'utf8'), encoding: null },
  'header-only.csv': { bytes: Buffer.from('name,city,qty\n', 'utf8'), encoding: null },
  // Not delimited text at all — a PNG header. notCsv opts out of the
  // "must decode to something CSV-shaped" assertion, since being unreadable
  // is the whole point of this one.
  'not-a-csv.png': {
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]),
    encoding: null,
    notCsv: true
  }
}

/** Decoding a fixture's bytes must reproduce the text it claims to hold. */
function assertBytes(name, bytes, fixture) {
  if (fixture.notCsv) return
  const enc = {
    'windows-1252.csv': 'windows-1252',
    'latin1.csv': 'windows-1252',
    'utf16le-bom.csv': 'utf-16le',
    'utf16le-nobom.csv': 'utf-16le',
    'utf16be-bom.csv': 'utf-16be',
    'utf16be-nobom.csv': 'utf-16be'
  }[name] || 'utf-8'

  const text = new TextDecoder(enc).decode(bytes)
  if (!text.includes('name')) {
    throw new Error(`fixture ${name} does not decode as ${enc} — it would test nothing`)
  }
  if (name.startsWith('windows-1252') || name.startsWith('latin1') || name.startsWith('utf16')) {
    if (!text.includes('José')) {
      throw new Error(`fixture ${name} lost its accented characters when encoded as ${enc}`)
    }
    // Guard the whole point of the suite: these must NOT be valid UTF-8, or
    // detection would never exercise its fallback path.
    if (!name.startsWith('utf16')) {
      let validUtf8 = true
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { validUtf8 = false }
      if (validUtf8) throw new Error(`fixture ${name} is valid UTF-8, so it cannot test the fallback`)
    }
  }
}

let dir = null

/** Writes every fixture to a temp dir once per run; returns name -> path. */
export async function ensureFixtures() {
  if (dir) return dir
  const base = await mkdtemp(join(tmpdir(), 'csv-viewer-fixtures-'))
  const paths = {}
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const { bytes } = fixture
    assertBytes(name, bytes, fixture)
    const file = join(base, name)
    await writeFile(file, bytes)
    // Re-read from disk, so a broken write cannot pass silently
    const back = await readFile(file)
    if (!back.equals(bytes)) throw new Error(`fixture ${name} did not round-trip to disk`)
    paths[name] = file
  }
  dir = paths
  return paths
}
