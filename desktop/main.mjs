import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification } from 'electron'
import { execFileSync, execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHIPPER_DIR = path.resolve(__dirname, '..')
const HOME_DIR = path.join(os.homedir(), '.app-shipper')
const CONFIG_PATH = path.join(HOME_DIR, 'config.json')
const HISTORY_PATH = path.join(HOME_DIR, 'history.json')

if (process.platform === 'win32') {
  app.setAppUserModelId('com.osmansivrikaya.appshipper')
}

let mainWindow = null

function createWindow() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1060,
    minHeight: 740,
    frame: false,
    backgroundColor: '#090a0f',
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, iconFile),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(true)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false)
    }, 1200)
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─────────────────────── Pencere Kontrolleri ───────────────────────

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle('window:close', () => mainWindow?.close())

// ─────────────────────── Yardımcılar & Config ───────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      cfg.appleProfiles ??= []
      cfg.googleProfiles ??= []
      cfg.projects ??= []
      cfg.lang ??= 'tr'
      cfg.soundEnabled ??= true
      return cfg
    }
  } catch { /* ignore */ }
  return { appleProfiles: [], googleProfiles: [], projects: [], lang: 'tr', soundEnabled: true }
}

function saveConfig(cfg) {
  fs.mkdirSync(HOME_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveHistory(jobs) {
  const h = loadHistory()
  const secs = (a, b) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 1000)
  const jobKey = (name) => (name.includes('iOS') ? 'iOS' : name.includes('Android') ? 'Android' : name)
  for (const j of jobs || []) {
    if (j.conclusion !== 'success') continue
    const k = jobKey(j.name)
    h[k] ??= {}
    for (const st of j.steps || []) {
      if (st.conclusion !== 'success' || !st.startedAt || !st.completedAt) continue
      h[k][st.name] = [...(h[k][st.name] || []), secs(st.startedAt, st.completedAt)].slice(-5)
    }
  }
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(h))
  } catch { /* ignore */ }
}

function ghEnv() {
  const cfg = loadConfig()
  const env = { ...process.env }
  if (cfg.token) {
    env.GH_TOKEN = cfg.token
  }
  return env
}

function ghSync(args, opts = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: ghEnv(),
      ...opts,
    }).trim()
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('GitHub CLI (gh) kurulu değil. Lütfen https://cli.github.com adresinden kurun.')
    throw new Error((e.stderr || e.message).toString().trim())
  }
}

async function ghAsync(args, opts = {}) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      encoding: 'utf8',
      env: ghEnv(),
      ...opts,
    })
    return stdout.trim()
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('GitHub CLI (gh) kurulu değil.')
    throw new Error((e.stderr || e.message).toString().trim())
  }
}

const setSecret = (repo, name, value) => ghSync(['secret', 'set', name, '-R', repo], { input: value })
const slugOf = (str) => str.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^_+|_+$/g, '')

function getShipperRepo() {
  const cfg = loadConfig()
  if (cfg.shipperRepo) return cfg.shipperRepo
  try {
    const url = execFileSync('git', ['-C', SHIPPER_DIR, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const m = url.match(/github\.com[:/](.+?\/.+?)(\.git)?$/)
    if (m) return m[1]
  } catch { /* ignore */ }
  return ''
}

function getGhUserProfile() {
  try {
    const raw = ghSync(['api', 'user'])
    const u = JSON.parse(raw)
    return {
      login: u.login,
      name: u.name || u.login,
      avatarUrl: u.avatar_url || '',
      htmlUrl: u.html_url || '',
      plan: u.plan?.name || 'Pro',
    }
  } catch {
    return null
  }
}

function findOpenssl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    '/usr/bin/openssl',
    '/opt/homebrew/bin/openssl',
  ]
  for (const p of candidates) {
    try {
      execFileSync(p, ['version'], { stdio: 'ignore' })
      return p
    } catch { /* ignore */ }
  }
  throw new Error('OpenSSL bulunamadı. Windows kullanıyorsanız Git for Windows kurulu olduğundan emin olun.')
}

function ascJwt(keyId, issuerId, p8) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`
  return `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

function extractTeamIdFromPem(pemPath) {
  try {
    if (!fs.existsSync(pemPath)) return ''
    const x509 = new crypto.X509Certificate(fs.readFileSync(pemPath))
    const m = x509.subject.match(/OU=([A-Z0-9]{10})/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

async function createOrLoadDistCert(profileSlug, keyId, issuerId, p8) {
  const sub = profileSlug ? `ios_${profileSlug}` : 'ios'
  const dir = path.join(HOME_DIR, sub)
  fs.mkdirSync(dir, { recursive: true })
  const p8Copy = path.join(dir, 'AuthKey.p8')
  if (p8) {
    try { fs.writeFileSync(p8Copy, p8) } catch { /* ignore */ }
  }
  const p12 = path.join(dir, 'dist.p12')
  const passFile = path.join(dir, 'dist.p12.password')
  const pem = path.join(dir, 'dist.pem')
  if (fs.existsSync(p12) && fs.existsSync(passFile)) {
    return {
      p12: fs.readFileSync(p12),
      password: fs.readFileSync(passFile, 'utf8'),
      teamId: extractTeamIdFromPem(pem),
    }
  }
  const openssl = findOpenssl()
  const key = path.join(dir, 'dist.key')
  const csr = path.join(dir, 'dist.csr')
  const cer = path.join(dir, 'dist.cer')
  execFileSync(openssl, ['genrsa', '-out', key, '2048'], { stdio: 'ignore' })
  execFileSync(openssl, ['req', '-new', '-key', key, '-out', csr, '-subj', '/CN=app-shipper/O=app-shipper/C=TR'], { stdio: 'ignore' })
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/certificates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ascJwt(keyId, issuerId, p8)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'certificates',
        attributes: {
          certificateType: 'DISTRIBUTION',
          csrContent: fs.readFileSync(csr, 'utf8').replace(/-----[^-]+-----|\s/g, ''),
        },
      },
    }),
  })
  const body = await res.text()
  if (!res.ok) {
    if (res.status === 409 || body.includes('maximum')) {
      throw new Error('Apple Distribution sertifika limiti dolu! developer.apple.com/account/resources/certificates adresinden kullanılmayan bir sertifikayı Revoke edip tekrar deneyin.')
    }
    throw new Error(`Apple API hatası (${res.status}): ${body}`)
  }
  fs.writeFileSync(cer, Buffer.from(JSON.parse(body).data.attributes.certificateContent, 'base64'))
  execFileSync(openssl, ['x509', '-inform', 'DER', '-in', cer, '-out', pem])
  const password = crypto.randomBytes(18).toString('base64url')
  execFileSync(openssl, [
    'pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12, '-passout', `pass:${password}`,
    '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1', '-name', 'Apple Distribution: app-shipper',
  ])
  fs.writeFileSync(passFile, password)
  return {
    p12: fs.readFileSync(p12),
    password,
    teamId: extractTeamIdFromPem(pem),
  }
}

function createOrLoadKeystore(profileSlug) {
  const sub = profileSlug ? `android_${profileSlug}` : 'android'
  const dir = path.join(HOME_DIR, sub)
  fs.mkdirSync(dir, { recursive: true })
  const jks = path.join(dir, 'upload.jks')
  const passFile = path.join(dir, 'upload.jks.password')
  if (!fs.existsSync(jks)) {
    const pass = crypto.randomBytes(18).toString('base64url')
    try {
      execFileSync('keytool', [
        '-genkeypair', '-keystore', jks, '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-storepass', pass, '-keypass', pass, '-dname', 'CN=app-shipper, O=app-shipper, C=TR',
      ], { stdio: 'ignore' })
    } catch {
      throw new Error('keytool bulunamadı. Lütfen bilgisayarınıza Java JDK kurun veya mevcut bir .jks dosyası seçin.')
    }
    fs.writeFileSync(passFile, pass)
  }
  return { jks: fs.readFileSync(jks), password: fs.readFileSync(passFile, 'utf8'), alias: 'upload' }
}

// ─────────────────────── Yerel Proje Analizi ───────────────────────

function detectTypeInDir(d) {
  try {
    if (fs.existsSync(path.join(d, 'pubspec.yaml'))) {
      const pub = fs.readFileSync(path.join(d, 'pubspec.yaml'), 'utf8')
      if (/sdk:\s*flutter/.test(pub)) return 'flutter'
    }
    const files = fs.readdirSync(d)
    if (files.some((f) => f.startsWith('capacitor.config.'))) return 'capacitor'
    if (fs.existsSync(path.join(d, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'))
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      if (deps.expo) return 'expo'
      if (deps['react-native']) return 'react-native'
    }
    const hasGradle = fs.existsSync(path.join(d, 'gradlew')) || fs.existsSync(path.join(d, 'android', 'gradlew'))
    const hasXcode = files.some((f) => f.endsWith('.xcodeproj')) ||
      (fs.existsSync(path.join(d, 'ios')) && fs.readdirSync(path.join(d, 'ios')).some((f) => f.endsWith('.xcodeproj')))
    if (hasGradle || hasXcode) return 'native'
  } catch { /* ignore */ }
  return ''
}

function inspectProjectFolder(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) throw new Error('Klasör bulunamadı.')

  let shipJson = {}
  const shipJsonPath = path.join(folderPath, 'ship.json')
  if (fs.existsSync(shipJsonPath)) {
    try { shipJson = JSON.parse(fs.readFileSync(shipJsonPath, 'utf8')) } catch { /* ignore */ }
  }

  const candidates = ['.']
  try {
    for (const f1 of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!f1.isDirectory() || f1.name.startsWith('.') || ['node_modules', 'Pods', 'build', 'dist', 'android', 'ios'].includes(f1.name)) continue
      candidates.push(f1.name)
      const p1 = path.join(folderPath, f1.name)
      for (const f2 of fs.readdirSync(p1, { withFileTypes: true })) {
        if (!f2.isDirectory() || f2.name.startsWith('.') || ['node_modules', 'Pods', 'build', 'dist', 'android', 'ios'].includes(f2.name)) continue
        candidates.push(`${f1.name}/${f2.name}`)
      }
    }
  } catch { /* ignore */ }

  let appSubPath = shipJson.appPath || ''
  let type = ''

  if (appSubPath) {
    type = detectTypeInDir(path.join(folderPath, appSubPath))
  } else {
    for (const c of candidates) {
      const t = detectTypeInDir(path.join(folderPath, c))
      if (t && t !== 'native') { appSubPath = c === '.' ? '' : c; type = t; break }
    }
    if (!type) {
      for (const c of candidates) {
        const t = detectTypeInDir(path.join(folderPath, c))
        if (t === 'native') { appSubPath = c === '.' ? '' : c; type = t; break }
      }
    }
  }

  const appFullDir = appSubPath ? path.join(folderPath, appSubPath) : folderPath
  let version = ''
  let buildNumber = ''
  let iosBundleId = ''
  let androidPackage = ''
  let appName = path.basename(folderPath)

  if (fs.existsSync(path.join(appFullDir, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(appFullDir, 'package.json'), 'utf8'))
      if (pkg.version && pkg.version !== '0.0.0') version = pkg.version
      if (pkg.name) appName = pkg.name
    } catch { /* ignore */ }
  } else if (fs.existsSync(path.join(appFullDir, 'pubspec.yaml'))) {
    try {
      const pub = fs.readFileSync(path.join(appFullDir, 'pubspec.yaml'), 'utf8')
      const vm = pub.match(/^version:\s*([^\s+]+)(?:\+(\d+))?/m)
      const nm = pub.match(/^name:\s*(\S+)/m)
      if (vm) {
        version = vm[1]
        if (vm[2]) buildNumber = vm[2]
      }
      if (nm) appName = nm[1]
    } catch { /* ignore */ }
  }

  // iOS project.pbxproj içinden gerçek MARKETING_VERSION, CURRENT_PROJECT_VERSION ve PRODUCT_BUNDLE_IDENTIFIER oku
  const iosRoot = fs.existsSync(path.join(appFullDir, 'ios')) ? path.join(appFullDir, 'ios') : appFullDir
  try {
    const pbxCandidates = [
      path.join(iosRoot, 'App', 'App.xcodeproj', 'project.pbxproj'),
      path.join(iosRoot, 'Runner.xcodeproj', 'project.pbxproj'),
    ]
    if (fs.existsSync(iosRoot)) {
      for (const item of fs.readdirSync(iosRoot)) {
        if (item.endsWith('.xcodeproj')) {
          pbxCandidates.push(path.join(iosRoot, item, 'project.pbxproj'))
        }
      }
    }
    for (const pbxPath of pbxCandidates) {
      if (fs.existsSync(pbxPath)) {
        const pbx = fs.readFileSync(pbxPath, 'utf8')
        const mv = pbx.match(/MARKETING_VERSION\s*=\s*([0-9][0-9A-Za-z.-]*)\s*;/)
        const cpv = pbx.match(/CURRENT_PROJECT_VERSION\s*=\s*([0-9]+)\s*;/)
        const bids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([a-zA-Z0-9.-]+)"?\s*;/g)]
          .map((m) => m[1])
          .filter((b) => !b.includes('$') && !b.endsWith('Tests'))
        if (mv && (!version || version === '0.0.0')) version = mv[1]
        if (cpv && !buildNumber) buildNumber = cpv[1]
        if (bids.length > 0 && !iosBundleId) iosBundleId = bids[0]
        break
      }
    }
  } catch { /* ignore */ }

  // Android build.gradle(.kts) içinden applicationId, versionName ve versionCode oku
  const gradleCandidates = [
    path.join(appFullDir, 'android', 'app', 'build.gradle'),
    path.join(appFullDir, 'android', 'app', 'build.gradle.kts'),
    path.join(appFullDir, 'app', 'build.gradle'),
    path.join(appFullDir, 'app', 'build.gradle.kts'),
  ]
  for (const gp of gradleCandidates) {
    if (fs.existsSync(gp)) {
      try {
        const g = fs.readFileSync(gp, 'utf8')
        const aid = g.match(/applicationId\s*[= ]\s*["']([a-zA-Z0-9_.]+)["']/)
        const vn = g.match(/versionName\s*[=( ]\s*.*?["']([0-9][0-9A-Za-z.-]*)["']/)
        if (aid && !androidPackage) androidPackage = aid[1]
        if (vn && (!version || version === '0.0.0')) version = vn[1]
      } catch { /* ignore */ }
      break
    }
  }

  let hasAndroid = false
  let hasIos = false
  if (type === 'expo') {
    hasAndroid = true
    hasIos = true
  } else if (type === 'flutter' || type === 'capacitor') {
    hasAndroid = fs.existsSync(path.join(appFullDir, 'android'))
    hasIos = fs.existsSync(path.join(appFullDir, 'ios'))
  } else if (type) {
    hasAndroid = fs.existsSync(path.join(appFullDir, 'android', 'gradlew')) || fs.existsSync(path.join(appFullDir, 'gradlew'))
    const iosCheckDir = fs.existsSync(path.join(appFullDir, 'ios')) ? path.join(appFullDir, 'ios') : appFullDir
    try {
      hasIos = fs.readdirSync(iosCheckDir).some((f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
    } catch { /* ignore */ }
  }

  let gitRepo = ''
  let gitBranch = ''
  let isDirty = false
  let hasGit = false

  try {
    const inside = execFileSync('git', ['-C', folderPath, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (inside === 'true') {
      hasGit = true
      try {
        const url = execFileSync('git', ['-C', folderPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
        const m = url.match(/github\.com[:/](.+?\/.+?)(\.git)?$/)
        if (m) gitRepo = m[1]
      } catch { /* remote yok */ }
      try {
        gitBranch = execFileSync('git', ['-C', folderPath, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch { /* ignore */ }
      try {
        const status = execFileSync('git', ['-C', folderPath, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
        isDirty = status.length > 0
      } catch { /* ignore */ }
    }
  } catch { /* git repo değil */ }

  return {
    folderPath,
    appName,
    type: type || 'unknown',
    appSubPath,
    version: version || '1.0.0',
    buildNumber: buildNumber || '1',
    iosBundleId,
    androidPackage,
    hasAndroid,
    hasIos,
    hasGit,
    gitRepo,
    gitBranch,
    isDirty,
    hasEnvFile: fs.existsSync(path.join(appFullDir, '.env')) || fs.existsSync(path.join(appFullDir, '.env.production')),
  }
}

// ─────────────────────── IPC: Başlangıç, Login & Lisans ───────────────────────

ipcMain.handle('app:init', async () => {
  const cfg = loadConfig()
  const shipper = getShipperRepo()
  if (shipper && !cfg.shipperRepo) {
    cfg.shipperRepo = shipper
    saveConfig(cfg)
  }

  const userProfile = getGhUserProfile()
  let remoteSecrets = []
  if (userProfile && shipper) {
    try {
      remoteSecrets = JSON.parse(ghSync(['secret', 'list', '-R', shipper, '--json', 'name'])).map((x) => x.name)
    } catch { /* ignore */ }
  }

  const hasDefaultApple = remoteSecrets.includes('ASC_KEY_ID')
  const hasDefaultGoogle = remoteSecrets.includes('PLAY_SERVICE_ACCOUNT_JSON')

  return {
    config: cfg,
    shipperRepo: shipper,
    userProfile,
    remoteSecrets,
    hasDefaultApple,
    hasDefaultGoogle,
    platform: process.platform,
  }
})

ipcMain.handle('auth:loginWithToken', async (_e, { licenseKey, githubToken, shipperRepoName }) => {
  const cfg = loadConfig()
  if (licenseKey) {
    cfg.licenseKey = licenseKey.trim()
    cfg.licenseTier = licenseKey.toUpperCase().startsWith('ENT') ? 'Enterprise' : 'Pro Studio'
  } else if (!cfg.licenseKey) {
    cfg.licenseKey = 'SHIPPER-PRO-ACTIVE'
    cfg.licenseTier = 'Pro Studio'
  }

  if (githubToken && githubToken.trim()) {
    cfg.token = githubToken.trim()
    saveConfig(cfg)
  }

  const userProfile = getGhUserProfile()
  if (!userProfile) {
    throw new Error('GitHub hesabına bağlanılamadı. Lütfen geçerli bir GitHub Personal Access Token girin veya GitHub ile Giriş Yap butonunu kullanın.')
  }

  const shipper = shipperRepoName ? (shipperRepoName.includes('/') ? shipperRepoName : `${userProfile.login}/${shipperRepoName}`) : (cfg.shipperRepo || `${userProfile.login}/app-shipper`)
  try {
    ghSync(['repo', 'view', shipper])
  } catch {
    try {
      if (!fs.existsSync(path.join(SHIPPER_DIR, '.git'))) {
        execFileSync('git', ['init', '-b', 'main'], { cwd: SHIPPER_DIR })
      }
      execFileSync('git', ['add', '-A'], { cwd: SHIPPER_DIR })
      try { execFileSync('git', ['commit', '-m', 'app-shipper'], { cwd: SHIPPER_DIR, stdio: 'ignore' }) } catch { /* ignore */ }
      ghSync(['repo', 'create', shipper, '--private', '--source', SHIPPER_DIR, '--push'])
    } catch { /* ignore */ }
  }

  cfg.shipperRepo = shipper
  if (cfg.token) {
    try { setSecret(shipper, 'SOURCE_TOKEN', cfg.token) } catch { /* ignore */ }
  }
  saveConfig(cfg)
  ensureShipperWorkflowSynced(shipper)

  return {
    config: cfg,
    shipperRepo: shipper,
    userProfile,
  }
})

ipcMain.handle('auth:startWebLogin', async () => {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '-s', 'repo,workflow'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let output = ''
      let resolvedCode = false
      const onData = (chunk) => {
        output += chunk.toString()
        const codeMatch = output.match(/one-time code:\s*([A-Z0-9-]+)/i)
        if (codeMatch && !resolvedCode) {
          resolvedCode = true
          const code = codeMatch[1]
          try { clipboard.writeText(code) } catch { /* ignore */ }
          shell.openExternal('https://github.com/login/device')
          resolve({ deviceCode: code, status: 'waiting_browser' })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.stdin.write('\n')

      child.on('close', (code) => {
        if (code === 0) {
          // Tarayıcıda onaylandı! Otomatik olarak oturumu ve repoyu tamamla
          try {
            const userProfile = getGhUserProfile()
            if (userProfile) {
              const cfg = loadConfig()
              cfg.licenseKey ||= 'SHIPPER-PRO-ACTIVE'
              cfg.licenseTier ||= 'Pro Studio'
              const shipper = cfg.shipperRepo || `${userProfile.login}/app-shipper`
              cfg.shipperRepo = shipper
              try {
                const tok = ghSync(['auth', 'token'])
                if (tok) {
                  cfg.token = tok
                  setSecret(shipper, 'SOURCE_TOKEN', tok)
                }
              } catch { /* ignore */ }
              saveConfig(cfg)
              ensureShipperWorkflowSynced(shipper)
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('auth:webLoginSuccess', { config: cfg, shipperRepo: shipper, userProfile })
              }
            }
          } catch { /* ignore */ }
          if (!resolvedCode) resolve({ status: 'connected' })
        } else if (!resolvedCode) {
          reject(new Error(output || 'GitHub Web girişi başlatılamadı.'))
        }
      })
    } catch (e) {
      reject(e)
    }
  })
})

// ─────────────────────── Apple & Google Otomatik Tarayıcı Asistanı ───────────────────────

ipcMain.handle('accounts:appleBrowserConnect', async (_e, { label, isDefault }) => {
  return new Promise((resolve) => {
    const ascWin = new BrowserWindow({
      width: 1120,
      height: 780,
      title: 'Apple App Store Connect — Giriş Yapın ve API Anahtarını İndirin (.p8)',
      autoHideMenuBar: true,
    })

    let capturedP8Path = ''
    let capturedKeyId = ''
    let capturedIssuerId = ''
    let capturedTeamId = ''

    // Sayfa yüklendikçe Issuer ID ve Key ID'yi DOM'dan otomatik yakalamayı dene
    const scanTimer = setInterval(async () => {
      if (ascWin.isDestroyed()) {
        clearInterval(scanTimer)
        return
      }
      try {
        const text = await ascWin.webContents.executeJavaScript(`document.body ? document.body.innerText : ''`)
        const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        if (uuidMatch && !capturedIssuerId) capturedIssuerId = uuidMatch[0]
        const teamMatch = text.match(/\b([A-Z0-9]{10})\b/)
        if (teamMatch && !capturedTeamId) capturedTeamId = teamMatch[1]
      } catch { /* ignore */ }
    }, 2000)

    // Kullanıcı .p8 dosyasını indirdiğinde otomatik yakala!
    ascWin.webContents.session.on('will-download', (_event, item) => {
      const fileName = item.getFilename()
      if (fileName.endsWith('.p8')) {
        const saveDir = path.join(HOME_DIR, 'downloads')
        fs.mkdirSync(saveDir, { recursive: true })
        const savePath = path.join(saveDir, fileName)
        item.setSavePath(savePath)

        const m = fileName.match(/AuthKey_([A-Z0-9]+)\.p8/i)
        if (m) capturedKeyId = m[1]

        item.once('done', (_ev, state) => {
          if (state === 'completed') {
            capturedP8Path = savePath
            clearInterval(scanTimer)
            setTimeout(() => {
              if (!ascWin.isDestroyed()) ascWin.close()
            }, 600)
          }
        })
      }
    })

    ascWin.on('closed', () => {
      clearInterval(scanTimer)
      resolve({
        label: label || 'Apple Hesabım',
        isDefault: Boolean(isDefault),
        p8Path: capturedP8Path,
        keyId: capturedKeyId,
        issuerId: capturedIssuerId,
        teamId: capturedTeamId,
      })
    })

    ascWin.loadURL('https://appstoreconnect.apple.com/access/integrations/api')
  })
})

ipcMain.handle('accounts:googleBrowserConnect', async (_e, { label, isDefault }) => {
  return new Promise((resolve) => {
    const gcpWin = new BrowserWindow({
      width: 1120,
      height: 780,
      title: 'Google Cloud Console — Giriş Yapın ve Service Account JSON Anahtarını İndirin',
      autoHideMenuBar: true,
    })

    let capturedJsonPath = ''

    // Kullanıcı .json anahtarını indirdiği anda otomatik yakala ve hesabı kur!
    gcpWin.webContents.session.on('will-download', (_event, item) => {
      const fileName = item.getFilename()
      if (fileName.endsWith('.json')) {
        const saveDir = path.join(HOME_DIR, 'downloads')
        fs.mkdirSync(saveDir, { recursive: true })
        const savePath = path.join(saveDir, fileName)
        item.setSavePath(savePath)

        item.once('done', (_ev, state) => {
          if (state === 'completed') {
            capturedJsonPath = savePath
            setTimeout(() => {
              if (!gcpWin.isDestroyed()) gcpWin.close()
            }, 600)
          }
        })
      }
    })

    gcpWin.on('closed', () => {
      resolve({
        label: label || 'Google Play Hesabım',
        isDefault: Boolean(isDefault),
        jsonPath: capturedJsonPath,
      })
    })

    gcpWin.loadURL('https://console.cloud.google.com/iam-admin/serviceaccounts')
  })
})

ipcMain.handle('auth:logout', async () => {
  const cfg = loadConfig()
  delete cfg.token
  delete cfg.licenseKey
  saveConfig(cfg)
  return true
})

ipcMain.handle('settings:updatePrefs', async (_e, prefs) => {
  const cfg = loadConfig()
  Object.assign(cfg, prefs)
  saveConfig(cfg)
  return cfg
})

// ─────────────────────── KALICI PROJELER YÖNETİMİ (Savable Projects) ───────────────────────

ipcMain.handle('projects:save', async (_e, projData) => {
  // projData: { id, name, icon, iosEnabled, androidEnabled, iosPath, androidPath, appleProfile, googleProfile, androidTrack, isDraft }
  const cfg = loadConfig()
  const id = projData.id || `proj_${Date.now()}`

  let iosInfo = null
  let androidInfo = null
  if (projData.iosEnabled && projData.iosPath) {
    iosInfo = inspectProjectFolder(projData.iosPath)
  }
  if (projData.androidEnabled && projData.androidPath) {
    androidInfo = inspectProjectFolder(projData.androidPath)
  }

  const primaryInfo = iosInfo || androidInfo
  const project = {
    id,
    name: (projData.name || primaryInfo?.appName || 'Yeni Uygulama').trim(),
    icon: projData.icon || '📱',
    type: primaryInfo?.type || 'mobile',
    version: primaryInfo?.version || '1.0.0',
    buildNumber: primaryInfo?.buildNumber || '1',
    iosBundleId: iosInfo?.iosBundleId || primaryInfo?.iosBundleId || '',
    androidPackage: androidInfo?.androidPackage || primaryInfo?.androidPackage || '',
    iosEnabled: Boolean(projData.iosEnabled),
    androidEnabled: Boolean(projData.androidEnabled),
    iosPath: projData.iosEnabled ? (projData.iosPath || '').trim() : '',
    androidPath: projData.androidEnabled ? (projData.androidPath || '').trim() : '',
    iosSubPath: iosInfo?.appSubPath || '',
    androidSubPath: androidInfo?.appSubPath || '',
    appleProfile: projData.appleProfile || '',
    googleProfile: projData.googleProfile || '',
    androidTrack: projData.androidTrack || 'internal',
    isDraft: Boolean(projData.isDraft),
    autoSyncGit: projData.autoSyncGit !== false,
    updatedAt: new Date().toISOString(),
  }

  cfg.projects = [
    project,
    ...(cfg.projects || []).filter((p) => p.id !== id),
  ]
  saveConfig(cfg)
  return { project, projects: cfg.projects }
})

ipcMain.handle('projects:delete', async (_e, id) => {
  const cfg = loadConfig()
  cfg.projects = (cfg.projects || []).filter((p) => p.id !== id)
  saveConfig(cfg)
  return cfg.projects
})

// ─────────────────────── Klasör & Dosya Seçiciler ───────────────────────

ipcMain.handle('dialog:selectFolder', async (_e, title) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Mobil Proje Klasörünü Seçin',
    properties: ['openDirectory'],
  })
  if (res.canceled || !res.filePaths[0]) return null
  const folder = res.filePaths[0]
  const info = inspectProjectFolder(folder)
  return { folderPath: folder, info }
})

ipcMain.handle('project:inspect', async (_e, folderPath) => {
  return inspectProjectFolder(folderPath)
})

ipcMain.handle('dialog:selectFile', async (_e, { title, filters }) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Dosya Seçin',
    properties: ['openFile'],
    filters: filters || [{ name: 'Tüm Dosyalar', extensions: ['*'] }],
  })
  if (res.canceled || !res.filePaths[0]) return null
  return res.filePaths[0]
})

const SYNCED_HASHES = new Map()

function gitBlobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

async function syncOneShipperFile(shipper, relPath) {
  const buf = fs.readFileSync(path.join(SHIPPER_DIR, relPath))
  const localSha = gitBlobSha(buf)
  const memKey = `${shipper}:${relPath}`
  if (SYNCED_HASHES.get(memKey) === localSha) return
  let remoteSha = ''
  try {
    remoteSha = (await ghAsync(['api', `repos/${shipper}/contents/${relPath}`, '-q', '.sha'])).trim()
  } catch { /* yeni dosya */ }
  if (remoteSha !== localSha) {
    const args = [
      'api', '-X', 'PUT', `repos/${shipper}/contents/${relPath}`,
      '-f', `message=chore: sync ${relPath} from App Shipper Desktop`,
      '-f', `content=${buf.toString('base64')}`,
    ]
    if (remoteSha) args.push('-f', `sha=${remoteSha}`)
    try { await ghAsync(args) } catch { return }
  }
  SYNCED_HASHES.set(memKey, localSha)
}

// Tüm dosyalar paralel; uzakta zaten aynıysa hiç yazılmaz, aynı oturumda tekrar sorulmaz
function ensureShipperWorkflowSynced(shipper) {
  const syncFiles = [
    '.github/workflows/ship.yml',
    'fastlane/Fastfile',
    'scripts/android-signing.sh',
    'scripts/android-build.sh',
    'scripts/prepare.sh',
  ]
  return Promise.all(syncFiles.map((f) => syncOneShipperFile(shipper, f).catch(() => {})))
}

// ─────────────────────── Canlı App Store Connect Sürüm & Build Sorgulama ───────────────────────

ipcMain.handle('project:fetchStoreStatus', async (_e, { bundleId, appleProfileSlug }) => {
  try {
    const cfg = loadConfig()
    const profiles = cfg.appleProfiles || []
    const prof = (appleProfileSlug && profiles.find((p) => p.slug === appleProfileSlug))
      || profiles.find((p) => p.isDefault)
      || profiles[0]
    if (!prof || !prof.keyId || !prof.issuerId) {
      return { found: false, reason: 'no_apple_profile' }
    }

    const sub = prof.slug ? `ios_${prof.slug}` : 'ios'
    const candidateP8s = [
      prof.p8Path,
      path.join(HOME_DIR, sub, 'AuthKey.p8'),
      path.join(HOME_DIR, 'downloads', `AuthKey_${prof.keyId}.p8`),
    ].filter(Boolean)

    let p8 = ''
    for (const cp of candidateP8s) {
      if (fs.existsSync(cp)) {
        p8 = fs.readFileSync(cp, 'utf8')
        break
      }
    }
    if (!p8) {
      return { found: false, reason: 'no_local_p8' }
    }

    const token = ascJwt(prof.keyId, prof.issuerId, p8)
    const headers = { Authorization: `Bearer ${token}` }

    const appsUrl = bundleId
      ? `https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId,sku`
      : `https://api.appstoreconnect.apple.com/v1/apps?limit=10&fields[apps]=name,bundleId,sku`

    const appsRes = await fetch(appsUrl, { headers })
    if (!appsRes.ok) return { found: false, reason: `api_error_${appsRes.status}` }
    const appsJson = await appsRes.json()
    const app = (appsJson.data || [])[0]
    if (!app) {
      return { found: false, reason: 'app_not_found', bundleId }
    }

    const [vRes, bRes] = await Promise.all([
      fetch(`https://api.appstoreconnect.apple.com/v1/apps/${app.id}/appStoreVersions?limit=1`, { headers }),
      fetch(`https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1&include=preReleaseVersion`, { headers }),
    ])

    const vJson = vRes.ok ? await vRes.json() : {}
    const bJson = bRes.ok ? await bRes.json() : {}

    const storeVersion = vJson.data?.[0]?.attributes?.versionString || ''
    const storeState = vJson.data?.[0]?.attributes?.appStoreState || ''
    const latestBuildNumber = bJson.data?.[0]?.attributes?.version || ''
    const processingState = bJson.data?.[0]?.attributes?.processingState || ''
    const preReleaseVersion = bJson.included?.[0]?.attributes?.version || ''

    const nextBuildNumber = latestBuildNumber && /^\d+$/.test(latestBuildNumber)
      ? String(Number(latestBuildNumber) + 1)
      : '1'

    return {
      found: true,
      appId: app.id,
      appName: app.attributes?.name || '',
      bundleId: app.attributes?.bundleId || bundleId,
      storeVersion,
      storeState,
      latestBuildNumber,
      nextBuildNumber,
      processingState,
      preReleaseVersion,
    }
  } catch (e) {
    return { found: false, reason: e.message }
  }
})

// ─────────────────────── Apple & Google Hesap Profilleri ───────────────────────

ipcMain.handle('accounts:saveApple', async (_e, payload) => {
  const shipper = getShipperRepo()
  if (!shipper) throw new Error('Önce Merkezi Repo (app-shipper) bağlantısını kurun.')

  const label = (payload.label || 'Varsayılan Apple').trim()
  const isDefault = Boolean(payload.isDefault)
  const slug = isDefault ? '' : slugOf(label)
  const suffix = slug ? `_${slug}` : ''

  if (!payload.keyId || !payload.issuerId || !payload.p8Path) {
    throw new Error('Lütfen Key ID, Issuer ID ve .p8 dosyasını eksiksiz girin.')
  }
  const p8 = fs.readFileSync(payload.p8Path, 'utf8')
  const cert = await createOrLoadDistCert(slug, payload.keyId.trim(), payload.issuerId.trim(), p8)
  const realTeamId = cert.teamId || (payload.teamId || '').trim()
  if (!realTeamId) {
    throw new Error('Apple Team ID sertifikadan okunamadı, lütfen Team ID alanını doldurun.')
  }

  setSecret(shipper, `ASC_KEY_ID${suffix}`, payload.keyId.trim())
  setSecret(shipper, `ASC_ISSUER_ID${suffix}`, payload.issuerId.trim())
  setSecret(shipper, `ASC_PRIVATE_KEY${suffix}`, p8)
  setSecret(shipper, `APPLE_TEAM_ID${suffix}`, realTeamId)
  setSecret(shipper, `IOS_DIST_CERT_P12_BASE64${suffix}`, cert.p12.toString('base64'))
  setSecret(shipper, `IOS_DIST_CERT_PASSWORD${suffix}`, cert.password)

  const cfg = loadConfig()
  const profile = {
    id: slug || 'DEFAULT',
    slug,
    label,
    keyId: payload.keyId.trim(),
    issuerId: payload.issuerId.trim(),
    teamId: realTeamId,
    p8Path: payload.p8Path,
    isDefault,
    updatedAt: new Date().toISOString(),
  }
  cfg.appleProfiles = [
    profile,
    ...(cfg.appleProfiles || []).filter((p) => p.id !== profile.id),
  ]
  saveConfig(cfg)
  return { profile, appleProfiles: cfg.appleProfiles }
})

ipcMain.handle('accounts:deleteApple', async (_e, id) => {
  const cfg = loadConfig()
  cfg.appleProfiles = (cfg.appleProfiles || []).filter((p) => p.id !== id)
  saveConfig(cfg)
  return cfg.appleProfiles
})

ipcMain.handle('accounts:saveGoogle', async (_e, payload) => {
  const shipper = getShipperRepo()
  if (!shipper) throw new Error('Önce Merkezi Repo (app-shipper) bağlantısını kurun.')

  const label = (payload.label || 'Varsayılan Google Play').trim()
  const isDefault = Boolean(payload.isDefault)
  const slug = isDefault ? '' : slugOf(label)
  const suffix = slug ? `_${slug}` : ''

  if (!payload.jsonPath) throw new Error('Lütfen Google Play Service Account JSON dosyasını seçin.')
  const rawJson = fs.readFileSync(payload.jsonPath, 'utf8')
  let parsed
  try { parsed = JSON.parse(rawJson) } catch { throw new Error('Seçilen dosya geçerli bir JSON değil.') }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Bu dosya geçerli bir Google Service Account anahtarı değil (client_email veya private_key eksik).')
  }

  let ksData
  if (payload.customJksPath) {
    if (!payload.keystorePass || !payload.keyAlias) {
      throw new Error('Özel keystore (.jks) seçtiğinizde Keystore Şifresi ve Alias alanlarını doldurmalısınız.')
    }
    ksData = {
      jks: fs.readFileSync(payload.customJksPath),
      password: payload.keystorePass,
      alias: payload.keyAlias,
      keyPass: payload.keyPass || payload.keystorePass,
    }
  } else {
    const autoKs = createOrLoadKeystore(slug)
    ksData = { jks: autoKs.jks, password: autoKs.password, alias: 'upload', keyPass: autoKs.password }
  }

  setSecret(shipper, `PLAY_SERVICE_ACCOUNT_JSON${suffix}`, rawJson)
  setSecret(shipper, `ANDROID_KEYSTORE_BASE64${suffix}`, ksData.jks.toString('base64'))
  setSecret(shipper, `ANDROID_KEYSTORE_PASSWORD${suffix}`, ksData.password)
  setSecret(shipper, `ANDROID_KEY_ALIAS${suffix}`, ksData.alias)
  setSecret(shipper, `ANDROID_KEY_PASSWORD${suffix}`, ksData.keyPass)

  const cfg = loadConfig()
  const profile = {
    id: slug || 'DEFAULT',
    slug,
    label,
    clientEmail: parsed.client_email,
    projectId: parsed.project_id || '',
    isDefault,
    updatedAt: new Date().toISOString(),
  }
  cfg.googleProfiles = [
    profile,
    ...(cfg.googleProfiles || []).filter((p) => p.id !== profile.id),
  ]
  saveConfig(cfg)
  return { profile, googleProfiles: cfg.googleProfiles }
})

ipcMain.handle('accounts:deleteGoogle', async (_e, id) => {
  const cfg = loadConfig()
  cfg.googleProfiles = (cfg.googleProfiles || []).filter((p) => p.id !== id)
  saveConfig(cfg)
  return cfg.googleProfiles
})

ipcMain.handle('settings:saveGeneral', async (_e, { shipperRepoName, sourceToken, createRepo }) => {
  const user = ghSync(['api', 'user', '-q', '.login'])
  const shipper = shipperRepoName.includes('/') ? shipperRepoName : `${user}/${shipperRepoName || 'app-shipper'}`

  if (createRepo) {
    try {
      ghSync(['repo', 'view', shipper])
    } catch {
      if (!fs.existsSync(path.join(SHIPPER_DIR, '.git'))) {
        execFileSync('git', ['init', '-b', 'main'], { cwd: SHIPPER_DIR })
      }
      execFileSync('git', ['add', '-A'], { cwd: SHIPPER_DIR })
      try { execFileSync('git', ['commit', '-m', 'app-shipper'], { cwd: SHIPPER_DIR, stdio: 'ignore' }) } catch { /* ignore */ }
      ghSync(['repo', 'create', shipper, '--private', '--source', SHIPPER_DIR, '--push'])
    }
  }

  const cfg = loadConfig()
  cfg.shipperRepo = shipper
  if (sourceToken) {
    cfg.token = sourceToken.trim()
    setSecret(shipper, 'SOURCE_TOKEN', cfg.token)
  }
  saveConfig(cfg)
  ensureShipperWorkflowSynced(shipper)
  return { shipperRepo: shipper, hasToken: Boolean(cfg.token) }
})

ipcMain.handle('project:uploadEnv', async (_e, { repoOrName, envFilePath }) => {
  const shipper = getShipperRepo()
  if (!shipper) throw new Error('Merkezi repo ayarlanmamış.')
  const s = slugOf(repoOrName.split('/').pop())
  const content = fs.readFileSync(envFilePath, 'utf8')
  setSecret(shipper, `ENV_${s}`, content)
  return { secretName: `ENV_${s}` }
})

ipcMain.handle('project:uploadKeystore', async (_e, { repoOrName, jksPath, alias, storePass, keyPass }) => {
  const shipper = getShipperRepo()
  if (!shipper) throw new Error('Merkezi repo ayarlanmamış.')
  const s = slugOf(repoOrName.split('/').pop())
  setSecret(shipper, `ANDROID_KEYSTORE_BASE64_${s}`, fs.readFileSync(jksPath).toString('base64'))
  setSecret(shipper, `ANDROID_KEYSTORE_PASSWORD_${s}`, storePass)
  setSecret(shipper, `ANDROID_KEY_ALIAS_${s}`, alias)
  setSecret(shipper, `ANDROID_KEY_PASSWORD_${s}`, keyPass || storePass)
  return { slug: s }
})

// ─────────────────────── Gönderim (Ship) & Senkronizasyon ───────────────────────

function sendShipEvent(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ship:event', data)
  }
}

function syncFolderToGitHub(folderPath, user, autoSyncGit) {
  const info = inspectProjectFolder(folderPath)
  let targetRepo = info.gitRepo
  let targetRef = info.gitBranch || ''

  if ((!info.hasGit || !targetRepo || info.isDirty) && autoSyncGit !== false) {
    sendShipEvent({ phase: 'sync', message: `Yerel klasör (${path.basename(folderPath)}) bulutla senkronize ediliyor...` })

    if (!info.hasGit) {
      execFileSync('git', ['init', '-b', 'main'], { cwd: folderPath })
      const giPath = path.join(folderPath, '.gitignore')
      if (!fs.existsSync(giPath)) {
        fs.writeFileSync(giPath, 'node_modules/\n.expo/\nbuild/\ndist/\nPods/\n*.jks\n*.p8\n*.p12\n.DS_Store\n')
      }
    }

    if (!targetRepo) {
      const repoSlug = path.basename(folderPath).toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'mobile-app'
      targetRepo = `${user}/${repoSlug}`
      sendShipEvent({ phase: 'sync', message: `Özel bulut reposu kontrol ediliyor (${targetRepo})...` })
      try {
        ghSync(['repo', 'view', targetRepo])
        try {
          execFileSync('git', ['-C', folderPath, 'remote', 'add', 'origin', `https://github.com/${targetRepo}.git`])
        } catch {
          execFileSync('git', ['-C', folderPath, 'remote', 'set-url', 'origin', `https://github.com/${targetRepo}.git`])
        }
      } catch {
        execFileSync('git', ['-C', folderPath, 'add', '-A'])
        try { execFileSync('git', ['-C', folderPath, 'commit', '-m', 'chore: initial commit via App Shipper']) } catch { /* ignore */ }
        ghSync(['repo', 'create', targetRepo, '--private', '--source', folderPath, '--push'])
      }
    }

    const status = execFileSync('git', ['-C', folderPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
    if (status.length > 0) {
      sendShipEvent({ phase: 'sync', message: 'Son değişiklikler paketleniyor...' })
      execFileSync('git', ['-C', folderPath, 'add', '-A'])
      execFileSync('git', ['-C', folderPath, 'commit', '-m', 'chore: ship build sync'])
    }

    const branch = execFileSync('git', ['-C', folderPath, 'branch', '--show-current'], { encoding: 'utf8' }).trim() || 'main'
    sendShipEvent({ phase: 'sync', message: `'${branch}' dalı buluta aktarılıyor...` })
    execFileSync('git', ['-C', folderPath, 'push', '-u', 'origin', branch])
    targetRef = branch
  }

  return { targetRepo, targetRef, appSubPath: info.appSubPath || '' }
}

async function triggerWorkflowAndFindRun(shipper, fields) {
  const args = ['workflow', 'run', 'ship.yml', '-R', shipper]
  for (const [k, v] of Object.entries(fields)) {
    args.push('-f', `${k}=${v}`)
  }

  const before = new Date(Date.now() - 10000).toISOString()
  sendShipEvent({ phase: 'trigger', message: `🚀 ${fields.repo} → ${fields.platforms.toUpperCase()} pipeline başlatıldı!` })
  ghSync(args)

  let run = null
  for (let i = 0; i < 40 && !run; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const list = JSON.parse(await ghAsync(['run', 'list', '-R', shipper, '-w', 'ship.yml', '-L', '10', '--json', 'databaseId,createdAt,displayTitle,url,status']))
      run = list.find((r) => r.createdAt >= before)
    } catch { /* ignore */ }
  }
  return run
}

ipcMain.handle('ship:start', async (_e, payload) => {
  // payload: { iosPath, androidPath, platforms, version, ref, appSubPath, androidTrack, isDraft, appleProfile, googleProfile, autoSyncGit }
  const shipper = getShipperRepo()
  if (!shipper) throw new Error('Merkezi app-shipper reposu bulunamadı. Lütfen Ayarlar sekmesinden kontrol edin.')

  const user = ghSync(['api', 'user', '-q', '.login'])
  const platforms = payload.platforms || 'both'

  sendShipEvent({ phase: 'trigger', message: 'Bulut Mac (Xcode) & Linux (Gradle) sunucuları hazırlanıyor...' })
  const syncPromise = ensureShipperWorkflowSynced(shipper)

  const iosFolder = (payload.iosPath || '').trim()
  const androidFolder = (payload.androidPath || '').trim()

  // Eğer hem iOS hem Android gönderilecekse ve ikisi FARKLI klasörlerden alınıyorsa iki ayrı iş akışı tetiklenir
  if (platforms === 'both' && iosFolder && androidFolder && path.resolve(iosFolder) !== path.resolve(androidFolder)) {
    const iosSync = syncFolderToGitHub(iosFolder, user, payload.autoSyncGit)
    const andSync = syncFolderToGitHub(androidFolder, user, payload.autoSyncGit)
    await syncPromise

    const iosRun = await triggerWorkflowAndFindRun(shipper, {
      repo: iosSync.targetRepo,
      platforms: 'ios',
      ref: payload.ref || iosSync.targetRef,
      version: payload.version || '',
      app_path: payload.appSubPath || iosSync.appSubPath,
      android_track: payload.androidTrack || 'internal',
      android_status: payload.isDraft ? 'draft' : 'completed',
      apple_profile: payload.appleProfile || '',
      google_profile: payload.googleProfile || '',
    })

    const andRun = await triggerWorkflowAndFindRun(shipper, {
      repo: andSync.targetRepo,
      platforms: 'android',
      ref: payload.ref || andSync.targetRef,
      version: payload.version || '',
      app_path: payload.appSubPath || andSync.appSubPath,
      android_track: payload.androidTrack || 'internal',
      android_status: payload.isDraft ? 'draft' : 'completed',
      apple_profile: payload.appleProfile || '',
      google_profile: payload.googleProfile || '',
    })

    const runIds = [iosRun?.databaseId, andRun?.databaseId].filter(Boolean)
    return {
      runIds,
      runId: runIds[0],
      runUrl: iosRun?.url || andRun?.url || `https://github.com/${shipper}/actions`,
      repo: `${iosSync.targetRepo} + ${andSync.targetRepo}`,
      shipper,
    }
  }

  // Tek klasör (veya sadece ios / sadece android)
  const targetFolder = platforms === 'ios' ? iosFolder : platforms === 'android' ? androidFolder : (iosFolder || androidFolder)
  if (!targetFolder) {
    throw new Error('Seçilen platform için proje klasörü tanımlanmamış.')
  }

  const synced = syncFolderToGitHub(targetFolder, user, payload.autoSyncGit)
  await syncPromise
  const run = await triggerWorkflowAndFindRun(shipper, {
    repo: synced.targetRepo,
    platforms,
    ref: payload.ref || synced.targetRef,
    version: payload.version || '',
    app_path: payload.appSubPath || synced.appSubPath,
    android_track: payload.androidTrack || 'internal',
    android_status: payload.isDraft ? 'draft' : 'completed',
    apple_profile: payload.appleProfile || '',
    google_profile: payload.googleProfile || '',
  })

  if (!run) {
    throw new Error(`Derleme başlatıldı ancak takip ID'si alınamadı: https://github.com/${shipper}/actions`)
  }

  return {
    runIds: [run.databaseId],
    runId: run.databaseId,
    runUrl: run.url,
    repo: synced.targetRepo,
    shipper,
  }
})

const DEFAULT_TOTAL = { Android: 190, iOS: 330 }
const HIDDEN_STEP = /^(Set up job|Complete job|Post )/
const prettyStep = (n) => n.replace(/^Run /, '').replace(/@v\d+$/, '')
const jobKey = (name) => (name.includes('iOS') ? 'iOS' : name.includes('Android') ? 'Android' : name)
const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length

function estimateJob(job, hist, now) {
  const key = jobKey(job.name)
  const known = hist[key] || {}
  const jobElapsed = job.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0
  const steps = (job.steps || []).filter((st) => st.conclusion !== 'skipped')
  const est = {}
  let have = 0
  for (const st of steps) {
    if (known[st.name]?.length) {
      est[st.name] = avg(known[st.name])
      have++
    } else {
      est[st.name] = 4
    }
  }
  if (job.status === 'completed') return { pct: 100, remaining: 0, elapsed: jobElapsed, est }
  if (job.status !== 'in_progress') return { pct: 0, remaining: DEFAULT_TOTAL[key] || 200, elapsed: 0, est }
  if (!have) {
    const total = DEFAULT_TOTAL[key] || 240
    return {
      pct: Math.min(95, Math.max(3, Math.round((jobElapsed / total) * 100))),
      remaining: Math.max(15, Math.round(total - jobElapsed)),
      elapsed: Math.round(jobElapsed),
      est,
    }
  }
  let total = 0
  let done = 0
  for (const st of steps) {
    total += est[st.name]
    if (st.status === 'completed') done += est[st.name]
    else if (st.status === 'in_progress' && st.startedAt) {
      done += Math.min(Math.max(0, (now - Date.parse(st.startedAt)) / 1000), est[st.name] * 0.95)
    }
  }
  return {
    pct: Math.min(99, Math.max(2, Math.round((done / total) * 100))),
    remaining: Math.max(5, Math.round(total - done)),
    elapsed: Math.round(jobElapsed),
    est,
  }
}

ipcMain.handle('ship:pollRun', async (_e, { runIds, runId }) => {
  const shipper = getShipperRepo()
  const ids = Array.isArray(runIds) && runIds.length ? runIds : [runId]
  const hist = loadHistory()
  const now = Date.now()

  const allJobs = []
  let allCompleted = true
  let anyFailure = false
  let firstUrl = ''

  for (const id of ids) {
    const out = await ghAsync(['run', 'view', String(id), '-R', shipper, '--json', 'status,conclusion,jobs,url,createdAt'])
    const data = JSON.parse(out)
    if (!firstUrl) firstUrl = data.url
    if (data.status !== 'completed') allCompleted = false
    if (data.status === 'completed') {
      saveHistory(data.jobs || [])
      if (data.conclusion !== 'success') anyFailure = true
    }

    for (const j of data.jobs || []) {
      const e = estimateJob(j, hist, now)
      const steps = (j.steps || [])
        .filter((st) => st.conclusion !== 'skipped' && !HIDDEN_STEP.test(st.name))
        .map((st) => {
          const dur = st.startedAt && st.completedAt
            ? Math.max(0, Math.round((Date.parse(st.completedAt) - Date.parse(st.startedAt)) / 1000))
            : st.startedAt && st.status === 'in_progress'
              ? Math.max(0, Math.round((now - Date.parse(st.startedAt)) / 1000))
              : 0
          return {
            name: prettyStep(st.name),
            rawName: st.name,
            status: st.status,
            conclusion: st.conclusion,
            duration: dur,
            estimated: Math.round(e.est[st.name] || 0),
          }
        })
      allJobs.push({
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        pct: e.pct,
        remaining: e.remaining,
        elapsed: e.elapsed,
        steps,
      })
    }
  }

  return {
    status: allCompleted ? 'completed' : 'in_progress',
    conclusion: allCompleted ? (anyFailure ? 'failure' : 'success') : null,
    url: firstUrl,
    jobs: allJobs,
  }
})

ipcMain.handle('ship:getFailedLogs', async (_e, { runId }) => {
  const shipper = getShipperRepo()
  try {
    return await ghAsync(['run', 'view', String(runId), '-R', shipper, '--log-failed'])
  } catch (e) {
    return e.message
  }
})

ipcMain.handle('ship:history', async () => {
  const shipper = getShipperRepo()
  if (!shipper) return []
  try {
    const out = await ghAsync(['run', 'list', '-R', shipper, '-w', 'ship.yml', '-L', '20', '--json', 'databaseId,displayTitle,status,conclusion,createdAt,updatedAt,url,headBranch'])
    return JSON.parse(out)
  } catch {
    return []
  }
})

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (url && /^https?:\/\//.test(url)) {
    await shell.openExternal(url)
  }
})

ipcMain.handle('shell:openPath', async (_e, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    await shell.openPath(folderPath)
  }
})

ipcMain.handle('window:setProgress', (_e, progress) => {
  if (!mainWindow) return
  mainWindow.setProgressBar(typeof progress === 'number' ? progress : -1)
})

ipcMain.handle('app:notify', (_e, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: title || 'App Shipper',
        body: body || '',
        icon: path.join(__dirname, 'icon.png'),
      })
      n.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
        }
      })
      n.show()
    }
  } catch { /* ignore */ }
})
