/** macOS reads the Dock tile, the app menu title and the Cmd-Tab icon from the running
 * bundle, not from app.setName() or app.dock.setIcon(), so `npm run dev` launches as
 * "Electron" wearing Electron's logo. Rename and re-skin the development bundle in
 * place. Electron ships it linker-signed with Info.plist unbound and no sealed
 * resources, so editing the name and the icns does not invalidate the signature. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const PLIST_BUDDY = '/usr/libexec/PlistBuddy'
const SOURCE_ICON = 'build/icon.png'
const name = readFileSync('electron-builder.yml', 'utf8').match(/^productName:\s*(.+?)\s*$/m)?.[1]
if (!name) throw Error('electron-builder.yml has no productName to brand the dev bundle with.')

let contents
try {
  // The electron package exports the path to its own executable: <bundle>/Contents/MacOS/Electron.
  contents = dirname(dirname(createRequire(import.meta.url)('electron')))
} catch {
  contents = ''
}
const plist = contents && join(contents, 'Info.plist')
if (!plist || !existsSync(plist) || !existsSync(PLIST_BUDDY)) {
  // A missing dev bundle is not a failure: packaged builds carry the real name already.
  console.log('Dev branding skipped (no Electron.app to rename).')
  process.exit(0)
}

const read = (key) => execFileSync(PLIST_BUDDY, ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim()

function renameBundle() {
  if (read('CFBundleName') === name) return false
  // PlistBuddy takes the rest of the command as the value, so spaces need no quoting.
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync(PLIST_BUDDY, ['-c', `Set :${key} ${name}`, plist])
  }
  return true
}

// The @2x variants double the stated size, so 512x512 is the largest pair the 512px
// mascot fills without upscaling. iconutil is happy with a partial ladder.
const ICONSET = [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64],
  ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512]]

function reskinBundle() {
  const iconFile = read('CFBundleIconFile')
  const target = join(contents, 'Resources', iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`)
  if (!existsSync(SOURCE_ICON) || !existsSync(target)) return false
  // Electron's own icns comes back on every reinstall, so stamp what we generated from
  // rather than trusting the file to still be ours.
  const stamp = `${target}.source`
  const digest = createHash('sha256').update(readFileSync(SOURCE_ICON)).digest('hex')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return false

  const work = mkdtempSync(join(tmpdir(), 'buddy-icns-'))
  try {
    const iconset = join(work, 'icon.iconset')
    mkdirSync(iconset)
    for (const [label, px] of ICONSET) {
      execFileSync('sips', ['-z', String(px), String(px), SOURCE_ICON,
        '--out', join(iconset, `icon_${label}.png`)], { stdio: 'ignore' })
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', target])
    writeFileSync(stamp, digest)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return true
}

const renamed = renameBundle()
const reskinned = reskinBundle()
if (renamed || reskinned) {
  // Finder and the app switcher cache bundle metadata; a touch invalidates the entry.
  execFileSync('touch', [dirname(contents)])
  console.log(`Branded the dev Electron bundle as ${name}${reskinned ? ' with its own icon.' : '.'}`)
} else {
  console.log(`Dev bundle already branded as ${name}.`)
}
