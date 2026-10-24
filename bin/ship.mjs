#!/usr/bin/env node
// ship — merkezi app-shipper reposuna "şu repoyu mağazalara gönder" der.
//
//   ship                         → bulunduğun klasördeki repo, iOS + Android
//   ship tahmin-et               → OsmanSivrikaya/tahmin-et
//   ship tahmin-et ios           → sadece iOS   (android | ios | both)
//   ship tahmin-et --version 1.2 --ref develop --path frontend --track beta --draft --no-watch
//   ship init tahmin-et          → o repoya "v* tag push edince otomatik gönder" ekler
//   ship keystore tahmin-et --jks C:\x.jks --alias upload --store-pass *** [--key-pass ***]
//   ship env tahmin-et .env.production   → build sırasında .env olarak yazılır
//   ship setup                   → tek seferlik: hesap bilgileri → GitHub secret'ları
//   ship status                  → son gönderimler

import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const SHIPPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME_DIR = path.join(os.homedir(), '.app-shipper')
const CONFIG_PATH = path.join(HOME_DIR, 'config.json')

// ─────────────────────── helpers ───────────────────────
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
}
const die = (msg) => { console.error(c.r(`✖ ${msg}`)); process.exit(1) }

function gh(args, opts = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim()
  } catch (e) {
    if (e.code === 'ENOENT') die('GitHub CLI (gh) yok: winget install GitHub.cli')
    throw new Error((e.stderr || e.message).toString().trim())
  }
}
const setSecret = (repo, name, value) => gh(['secret', 'set', name, '-R', repo], { input: value })

function parseArgs(argv) {
  const pos = []; const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (k.startsWith('no-')) flags[k.slice(3)] = false
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]
      else flags[k] = true
    } else pos.push(a)
  }
  return { pos, flags }
}

const loadConfig = () => (fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {})
const saveConfig = (cfg) => { fs.mkdirSync(HOME_DIR, { recursive: true }); fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)) }

let _login
const login = () => (_login ??= gh(['api', 'user', '-q', '.login']))

function resolveRepo(arg) {
  if (!arg) {
    let url
    try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* */ }
    const m = url?.match(/github\.com[:/](.+?\/.+?)(\.git)?$/)
    if (!m) die('Bu klasör bir GitHub reposu değil. Repo adını ver: ship <repo>')
    return m[1]
  }
  return arg.includes('/') ? arg : `${login()}/${arg}`
}

function shipperRepo() {
  const cfg = loadConfig()
  if (cfg.shipperRepo) return cfg.shipperRepo
  try {
    const url = execFileSync('git', ['-C', SHIPPER_DIR, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const m = url.match(/github\.com[:/](.+?\/.+?)(\.git)?$/)
    if (m) return m[1]
  } catch { /* */ }
  die('app-shipper reposu bulunamadı. Önce: ship setup')
}

const slugOf = (repo) => repo.split('/').pop().toUpperCase().replace(/[^A-Z0-9]/g, '_')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────── ship <repo> ───────────────────────
async function ship(pos, flags) {
  const repo = resolveRepo(pos[0])
  const platforms = pos[1] || flags.platform || 'both'
  if (!['both', 'ios', 'android'].includes(platforms)) die(`Platform: both | ios | android (verilen: ${platforms})`)
  const shipper = shipperRepo()

  const fields = { repo, platforms, ref: flags.ref || '', version: flags.version || '', app_path: flags.path || '',
    android_track: flags.track || 'internal', android_status: flags.draft ? 'draft' : 'completed' }
  const args = ['workflow', 'run', 'ship.yml', '-R', shipper]
  for (const [k, v] of Object.entries(fields)) args.push('-f', `${k}=${v}`)

  const before = new Date(Date.now() - 5000).toISOString()
  gh(args)
  console.log(c.g(`🚀 ${repo}${fields.ref ? '@' + fields.ref : ''} → ${platforms} gönderiliyor`))

  // Yeni run'ı bul
  let run
  for (let i = 0; i < 20 && !run; i++) {
    await sleep(2000)
    const list = JSON.parse(gh(['run', 'list', '-R', shipper, '-w', 'ship.yml', '-L', '10', '--json', 'databaseId,createdAt,displayTitle,url']))
    run = list.find((r) => r.createdAt >= before && r.displayTitle.includes(repo))
  }
  if (!run) return console.log(`Takip: https://github.com/${shipper}/actions`)
  console.log(`   ${run.url}`)
  if (flags.watch === false) return

  const code = await watchWorkflow(run.databaseId, shipper, platforms, fields)
  if (code !== 0) process.exit(code)
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const formatDuration = (sec) => `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`

async function watchWorkflow(runId, shipper, platforms, fields) {
  process.stdout.write('\x1b[?25l')
  const restoreCursor = () => process.stdout.write('\x1b[?25h')
  process.on('SIGINT', () => { restoreCursor(); process.exit(130) })
  process.on('exit', restoreCursor)

  const startTime = Date.now()
  let spinIdx = 0
  let lastData = null
  let lastFetch = 0
  let isFetching = false
  let lastLineCount = 0

  async function fetchStatus() {
    if (isFetching) return
    isFetching = true
    try {
      const out = gh(['run', 'view', String(runId), '-R', shipper, '--json', 'status,conclusion,jobs'])
      lastData = JSON.parse(out)
    } catch { /* ağ hatası */ }
    finally { isFetching = false }
  }

  await fetchStatus()

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      spinIdx = (spinIdx + 1) % SPINNER.length
      const now = Date.now()
      if (now - lastFetch > 2500) {
        lastFetch = now
        fetchStatus()
      }

      const elapsed = Math.floor((now - startTime) / 1000)
      const spinner = c.c(SPINNER[spinIdx])

      const lines = []
      lines.push(`${c.b('Durum')} ${c.dim(`[${formatDuration(elapsed)}]`)}`)

      const jobs = lastData?.jobs || []
      for (const j of jobs) {
        let icon = c.dim('○')
        let extra = ''
        if (j.status === 'completed') {
          if (j.conclusion === 'success') icon = c.g('✔')
          else if (j.conclusion === 'cancelled') icon = c.y('⊘')
          else icon = c.r('✖')
        } else if (j.status === 'in_progress') {
          icon = spinner
          const activeStep = j.steps?.find((s) => s.status === 'in_progress')
          if (activeStep) extra = c.dim(` → ${activeStep.name}`)
        }
        lines.push(`  ${icon} ${j.name}${extra}`)
      }

      if (lastLineCount > 0) {
        process.stdout.write(`\x1b[${lastLineCount}A`)
      }
      for (const line of lines) {
        process.stdout.write(`\x1b[2K${line}\n`)
      }
      lastLineCount = lines.length

      if (lastData && lastData.status === 'completed') {
        clearInterval(timer)
        restoreCursor()
        console.log('')
        const success = lastData.conclusion === 'success'
        const iosJob = jobs.find((j) => j.name.includes('iOS'))
        const androidJob = jobs.find((j) => j.name.includes('Android'))

        if (iosJob?.conclusion === 'success') {
          console.log(c.g('✔ iOS: TestFlight yüklemesi tamamlandı! (Apple tarafından işlenmesi ~5-15 dk sürer)'))
        }
        if (androidJob?.conclusion === 'success') {
          console.log(c.g(`✔ Android: Google Play (${fields.android_track}) yüklemesi tamamlandı!`))
        }

        if (success) {
          resolve(0)
        } else {
          console.log(c.r('✖ Bazı adımlar tamamlanamadı. Hata detayı:'))
          spawnSync('gh', ['run', 'view', String(runId), '-R', shipper, '--log-failed'], { stdio: 'inherit' })
          resolve(1)
        }
      }
    }, 100)
  })
}

// ─────────────────────── ship init <repo> ───────────────────────
async function init(pos) {
  const repo = resolveRepo(pos[0])
  const shipper = shipperRepo()
  const cfg = loadConfig()
  if (!cfg.token) die('Token kayıtlı değil. Önce: ship setup')

  const wf = `# app-shipper: v* tag push edilince mağazalara otomatik gönderir.  (git tag v1.2.0 && git push --tags)
name: Ship on tag
on:
  push:
    tags: ["v*"]
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: \${{ secrets.SHIPPER_TOKEN }}
        run: |
          gh workflow run ship.yml -R ${shipper} \\
            -f repo=\${{ github.repository }} -f ref=\${{ github.ref_name }} -f version="\${GITHUB_REF_NAME#v}"
          echo "Takip: https://github.com/${shipper}/actions"
`
  const file = '.github/workflows/ship-on-tag.yml'
  let sha
  try { sha = gh(['api', `repos/${repo}/contents/${file}`, '-q', '.sha']) } catch { /* yok */ }
  const putArgs = ['api', '-X', 'PUT', `repos/${repo}/contents/${file}`, '-f', 'message=ci: app-shipper ship-on-tag', '-f', `content=${Buffer.from(wf).toString('base64')}`]
  if (sha) putArgs.push('-f', `sha=${sha}`)
  try { gh(putArgs) } catch (e) {
    if (String(e).includes('workflow')) die('gh token\'ında workflow izni yok: gh auth refresh -s workflow   sonra tekrar dene')
    throw e
  }
  setSecret(repo, 'SHIPPER_TOKEN', cfg.token)
  console.log(c.g(`✔ ${repo}: ${file} eklendi + SHIPPER_TOKEN secret'ı ayarlandı`))
  console.log('  Artık:  git tag v1.0.1 && git push --tags   →  otomatik TestFlight + Google Play')
  console.log(c.y('  (Lokal klasörde "git pull" yapmayı unutma — dosya repoya doğrudan commit edildi.)'))
}

// ─────────────────────── ship keystore / env ───────────────────────
function keystore(pos, flags) {
  const repo = resolveRepo(pos[0])
  if (!flags.jks || !flags.alias || !flags['store-pass']) die('ship keystore <repo> --jks <dosya> --alias <alias> --store-pass <şifre> [--key-pass <şifre>]')
  const s = slugOf(repo); const shipper = shipperRepo()
  setSecret(shipper, `ANDROID_KEYSTORE_BASE64_${s}`, fs.readFileSync(flags.jks).toString('base64'))
  setSecret(shipper, `ANDROID_KEYSTORE_PASSWORD_${s}`, flags['store-pass'])
  setSecret(shipper, `ANDROID_KEY_ALIAS_${s}`, flags.alias)
  setSecret(shipper, `ANDROID_KEY_PASSWORD_${s}`, flags['key-pass'] || flags['store-pass'])
  console.log(c.g(`✔ ${repo} için özel upload keystore kaydedildi (diğer uygulamalar ortak keystore'u kullanmaya devam eder)`))
}

function env(pos) {
  const repo = resolveRepo(pos[0])
  if (!pos[1]) die('ship env <repo> <.env dosyası>')
  setSecret(shipperRepo(), `ENV_${slugOf(repo)}`, fs.readFileSync(pos[1], 'utf8'))
  console.log(c.g(`✔ ${repo}: build sırasında ${pos[1]} içeriği .env olarak yazılacak`))
}

function status() {
  spawnSync('gh', ['run', 'list', '-R', shipperRepo(), '-w', 'ship.yml', '-L', '15'], { stdio: 'inherit' })
}

// ─────────────────────── ship setup ───────────────────────
function findOpenssl() {
  for (const p of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    try { execFileSync(p, ['version'], { stdio: 'ignore' }); return p } catch { /* */ }
  }
  die('openssl bulunamadı (Git for Windows kur)')
}

function ascJwt(keyId, issuerId, p8) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`
  return `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

async function createDistCert(keyId, issuerId, p8) {
  const dir = path.join(HOME_DIR, 'ios'); fs.mkdirSync(dir, { recursive: true })
  const p12 = path.join(dir, 'dist.p12'); const passFile = path.join(dir, 'dist.p12.password')
  if (fs.existsSync(p12) && fs.existsSync(passFile)) {
    console.log(c.g('✔ Mevcut Apple Distribution sertifikası kullanılıyor') + ` (${p12})`)
    return { p12: fs.readFileSync(p12), password: fs.readFileSync(passFile, 'utf8') }
  }
  const openssl = findOpenssl()
  const key = path.join(dir, 'dist.key'); const csr = path.join(dir, 'dist.csr'); const cer = path.join(dir, 'dist.cer'); const pem = path.join(dir, 'dist.pem')
  execFileSync(openssl, ['genrsa', '-out', key, '2048'], { stdio: 'ignore' })
  execFileSync(openssl, ['req', '-new', '-key', key, '-out', csr, '-subj', '/CN=app-shipper/O=app-shipper/C=TR'], { stdio: 'ignore' })
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/certificates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ascJwt(keyId, issuerId, p8)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: fs.readFileSync(csr, 'utf8').replace(/-----[^-]+-----|\s/g, '') } } }),
  })
  const body = await res.text()
  if (!res.ok) {
    if (res.status === 409 || body.includes('maximum')) die('Apple Distribution sertifika limiti dolu → developer.apple.com/account/resources/certificates → kullanılmayanı Revoke et, tekrar dene.')
    die(`Apple API hatası ${res.status}: ${body}`)
  }
  fs.writeFileSync(cer, Buffer.from(JSON.parse(body).data.attributes.certificateContent, 'base64'))
  execFileSync(openssl, ['x509', '-inform', 'DER', '-in', cer, '-out', pem])
  const password = crypto.randomBytes(18).toString('base64url')
  execFileSync(openssl, ['pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12, '-passout', `pass:${password}`,
    '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1', '-name', 'Apple Distribution: app-shipper'])
  fs.writeFileSync(passFile, password)
  console.log(c.g('✔ Apple Distribution sertifikası oluşturuldu') + ` (${p12})`)
  return { p12: fs.readFileSync(p12), password }
}

function sharedKeystore() {
  const dir = path.join(HOME_DIR, 'android'); fs.mkdirSync(dir, { recursive: true })
  const jks = path.join(dir, 'upload.jks'); const passFile = path.join(dir, 'upload.jks.password')
  if (!fs.existsSync(jks)) {
    const pass = crypto.randomBytes(18).toString('base64url')
    try {
      execFileSync('keytool', ['-genkeypair', '-keystore', jks, '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-storepass', pass, '-keypass', pass, '-dname', 'CN=app-shipper, O=app-shipper, C=TR'], { stdio: 'ignore' })
    } catch { die('keytool bulunamadı (JDK kur)') }
    fs.writeFileSync(passFile, pass)
    console.log(c.g('✔ Ortak Android upload keystore oluşturuldu') + ` (${jks})`)
    console.log(c.y(`  ⚠ ${HOME_DIR} klasörünü güvenli bir yere YEDEKLE (kaybedersen Play'e güncelleme atamazsın).`))
  } else console.log(c.g('✔ Mevcut ortak Android keystore kullanılıyor'))
  return { jks: fs.readFileSync(jks), password: fs.readFileSync(passFile, 'utf8') }
}

async function setup(flags) {
  gh(['auth', 'status'])
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const cfg = loadConfig()
  const ask = async (key, q, def) => flags[key] || (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim().replace(/^"|"$/g, '') || def

  console.log(c.b('\napp-shipper kurulumu') + ' — bilgiler sadece GitHub secret\'larına ve ~/.app-shipper altına yazılır.\n')

  // 1) Merkezi repo
  let shipper = cfg.shipperRepo
  if (!shipper) {
    try { shipper = shipperRepo() } catch { /* */ }
  }
  if (!shipper || flags.create) {
    const name = await ask('name', 'Merkezi repo adı', 'app-shipper')
    if (!fs.existsSync(path.join(SHIPPER_DIR, '.git'))) execFileSync('git', ['init', '-b', 'main'], { cwd: SHIPPER_DIR })
    execFileSync('git', ['add', '-A'], { cwd: SHIPPER_DIR })
    try { execFileSync('git', ['commit', '-m', 'app-shipper'], { cwd: SHIPPER_DIR, stdio: 'ignore' }) } catch { /* zaten commit'li */ }
    gh(['repo', 'create', name, '--private', '--source', SHIPPER_DIR, '--push'])
    shipper = `${login()}/${name}`
    console.log(c.g(`✔ ${shipper} (private) oluşturuldu`))
  }
  cfg.shipperRepo = shipper; saveConfig(cfg)

  // 2) Apple
  console.log(c.b('\n— Apple —') + '  appstoreconnect.apple.com/access/integrations/api → Team Keys → + (Rol: Admin)')
  const keyId = await ask('key-id', 'Key ID')
  const issuerId = await ask('issuer-id', 'Issuer ID')
  const p8Path = await ask('p8', '.p8 dosya yolu')
  const teamId = await ask('team-id', 'Team ID (developer.apple.com/account → Membership)', cfg.teamId)
  const p8 = fs.readFileSync(p8Path, 'utf8')
  cfg.teamId = teamId; saveConfig(cfg)
  const cert = await createDistCert(keyId, issuerId, p8)

  // 3) Google Play
  console.log(c.b('\n— Google Play —') + '  Service account JSON (Play Console → Users and permissions\'ta yetkili olmalı)')
  const playJson = await ask('play-json', 'Service account JSON dosya yolu')
  const ks = sharedKeystore()

  // 4) GitHub token (özel repoları okumak + tag'den tetiklemek için)
  console.log(c.b('\n— GitHub token —') + '  github.com/settings/personal-access-tokens/new')
  console.log('  Repository access: All repositories · Permissions: Contents=Read, Actions=Read and write')
  const token = flags.token || cfg.token || (await rl.question('Fine-grained token: ')).trim()
  cfg.token = token; saveConfig(cfg)
  rl.close()

  // 5) Secret'lar
  const secrets = {
    ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_PRIVATE_KEY: p8, APPLE_TEAM_ID: teamId,
    IOS_DIST_CERT_P12_BASE64: cert.p12.toString('base64'), IOS_DIST_CERT_PASSWORD: cert.password,
    PLAY_SERVICE_ACCOUNT_JSON: fs.readFileSync(playJson, 'utf8'),
    ANDROID_KEYSTORE_BASE64: ks.jks.toString('base64'), ANDROID_KEYSTORE_PASSWORD: ks.password, ANDROID_KEY_ALIAS: 'upload', ANDROID_KEY_PASSWORD: ks.password,
    SOURCE_TOKEN: token,
  }
  for (const [k, v] of Object.entries(secrets)) { setSecret(shipper, k, v); process.stdout.write(c.g('.')) }
  console.log(c.g(`\n✔ ${Object.keys(secrets).length} secret ${shipper} reposuna yüklendi`))
  console.log(`\nHazır! Dene:  ${c.b('ship tahmin-et')}`)
}

// ─────────────────────── main ───────────────────────
const { pos, flags } = parseArgs(process.argv.slice(2))
const cmd = pos[0]
try {
  if (cmd === 'setup') await setup(flags)
  else if (cmd === 'init') await init(pos.slice(1))
  else if (cmd === 'keystore') keystore(pos.slice(1), flags)
  else if (cmd === 'env') env(pos.slice(1))
  else if (cmd === 'status') status()
  else if (cmd === 'help' || flags.help) console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  else await ship(pos, flags)
} catch (e) {
  die(e.message)
}
