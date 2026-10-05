# Vendored dependencies

Fetched from jsdelivr and committed so the installed app works offline. These
are byte-identical to the published npm artifacts; nothing here is patched.

| File | Package | Version |
|---|---|---|
| `handsontable.full.min.js` | handsontable | 13.1.0 |
| `handsontable.full.min.css` | handsontable | 13.1.0 |
| `papaparse.min.js` | papaparse | 5.5.4 |

Handsontable is used under its free non-commercial licence; see
`licenseKey: 'non-commercial-and-evaluation'` in `app.js`.

## Updating

Re-download at the new version, refresh the checksums below, and bump `CACHE`
in `sw.js` so existing clients discard the old copies.

```
curl -fsSL -o vendor/handsontable.full.min.js https://cdn.jsdelivr.net/npm/handsontable@<v>/dist/handsontable.full.min.js
shasum -a 256 vendor/*.js vendor/*.css
```

## Checksums (SHA-256)

```
6daee37b2dc294ef97682e27d844d78a38b29a5ed65c4e7980c44c1b1b686dce  vendor/handsontable.full.min.js
ac889c7a0c70f5bdec910e93c519daad741c2cf12ee3017737e4d5d1b768a14d  vendor/papaparse.min.js
3e2e7259c94442b7fcd8623bdbd5f2533a4014fc228c732491d9c7e3ab60baac  vendor/handsontable.full.min.css
```
