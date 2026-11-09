const state = {
  userProfile: null,
  shipperRepo: '',
  projects: [],
  activeProjectId: null,
  appleProfiles: [],
  googleProfiles: [],
  hasDefaultApple: false,
  hasDefaultGoogle: false,
  isBuildMinimized: false,
  lastStoreStatus: null,
}

const $ = (id) => document.getElementById(id)

function showToast(msg, type = 'info') {
  const container = $('toastContainer')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  container.appendChild(el)
  // Keep at most 4 toasts on screen
  while (container.children.length > 4) container.firstChild.remove()
  setTimeout(() => el.remove(), 4000)
}

// Turn raw gh/network errors into short Turkish messages
function friendlyError(e) {
  const raw = String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim()
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timed out|Could not resolve/i.test(raw)) return 'Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.'
  if (/401|Bad credentials|auth login|not logged|authentication/i.test(raw)) return 'GitHub oturumu geçersiz. Lütfen yeniden giriş yapın.'
  if (/403|rate limit/i.test(raw)) return 'GitHub isteği reddetti (yetki veya istek sınırı). Biraz sonra tekrar deneyin.'
  if (/404|Not Found/i.test(raw)) return 'İstenen kayıt GitHub üzerinde bulunamadı.'
  if (/ENOENT.*gh|gh: command not found/i.test(raw)) return 'GitHub CLI (gh) bulunamadı.'
  return raw ? `Bir sorun oluştu: ${raw.slice(0, 160)}` : 'Bilinmeyen bir hata oluştu.'
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Button busy state: disables the button and shows a spinner
function setBusy(btn, busy, label) {
  if (!btn) return
  const t = btn.querySelector('span:last-child')
  if (busy) {
    if (btn.dataset.busy === '1') return
    btn.dataset.busy = '1'
    btn.disabled = true
    btn.classList.add('is-busy')
    if (label && t && !t.children.length) { btn.dataset.idleLabel = t.textContent; t.textContent = label }
  } else {
    delete btn.dataset.busy
    btn.disabled = false
    btn.classList.remove('is-busy')
    if (btn.dataset.idleLabel !== undefined && t) { t.textContent = btn.dataset.idleLabel; delete btn.dataset.idleLabel }
  }
}

function skeletonRows(n = 3, cls = '') {
  return Array.from({ length: n }, () => `<div class="skeleton skel-row ${cls}"></div>`).join('')
}

function stateBlock({ icon = '', title, text = '', retryId = '', error = false }) {
  return `<div class="state-block${error ? ' error' : ''}">
    ${icon ? `<div class="state-icon">${icon}</div>` : ''}
    <div class="state-title">${escapeHtml(title)}</div>
    ${text ? `<div>${escapeHtml(text)}</div>` : ''}
    ${retryId ? `<button type="button" class="btn btn-secondary btn-xs" id="${retryId}">Tekrar Dene</button>` : ''}
  </div>`
}

const debounce = (fn, ms = 200) => {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

// Runs an async poll function on an interval without overlapping calls
function startGuardedPoll(fn, ms) {
  let busy = false
  return setInterval(async () => {
    if (busy) return
    busy = true
    try { await fn() } finally { busy = false }
  }, ms)
}

function formatSec(sec) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function prettyStoreState(st) {
  const map = {
    PREPARE_FOR_SUBMISSION: 'Gönderime Hazır',
    WAITING_FOR_REVIEW: 'İnceleme Bekliyor',
    IN_REVIEW: 'İncelemede',
    READY_FOR_SALE: 'Mağazada Yayında',
    PENDING_DEVELOPER_RELEASE: 'Yayın Bekliyor',
    REJECTED: 'Reddedildi',
    DEVELOPER_REJECTED: 'İptal Edildi',
  }
  return map[st] || st || ''
}

// Pencere Kontrolleri
$('btnMinWin').addEventListener('click', () => window.shipperAPI.minimizeWindow())
$('btnMaxWin').addEventListener('click', () => window.shipperAPI.maximizeWindow())
$('btnCloseWin').addEventListener('click', () => window.shipperAPI.closeWindow())

// Sekme Geçişleri
function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName)
  })
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`)
  })
  if (tabName === 'history') loadHistoryList()
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
})

$('btnJumpAppleAccount')?.addEventListener('click', () => switchTab('accounts'))
$('btnJumpGoogleAccount')?.addEventListener('click', () => switchTab('accounts'))

// Başlangıç
async function initApp() {
  $('savedProjectsList').innerHTML = skeletonRows(3)
  try {
    const data = await window.shipperAPI.init()
    state.shipperRepo = data.shipperRepo || ''
    state.userProfile = data.userProfile
    state.projects = data.config.projects || []
    state.appleProfiles = data.config.appleProfiles || []
    state.googleProfiles = data.config.googleProfiles || []
    state.hasDefaultApple = data.hasDefaultApple
    state.hasDefaultGoogle = data.hasDefaultGoogle

    $('setShipperRepo').value = state.shipperRepo

    if (!state.userProfile) {
      $('loginPortal').classList.remove('hidden')
    } else {
      $('loginPortal').classList.add('hidden')
      applyUserProfile(state.userProfile)
    }

    renderAccountSelectors()
    renderProfilesLists()
    renderProjectsSidebar()

    if (state.projects.length > 0) {
      await selectProject(state.projects[0].id)
    } else {
      showEmptyProjectsState()
    }
  } catch (e) {
    $('savedProjectsList').innerHTML = stateBlock({ icon: '⚠', title: 'Yüklenemedi', text: friendlyError(e), retryId: 'btnRetryInit', error: true })
    $('btnRetryInit')?.addEventListener('click', initApp)
    showToast(friendlyError(e), 'error')
  }
}

function applyUserProfile(u) {
  if (!u) return
  $('userNameText').textContent = u.name || u.login
  $('userTierText').textContent = `@${u.login}`
  if (u.avatarUrl) $('userAvatar').src = u.avatarUrl
  $('topCloudStatus').textContent = state.shipperRepo ? `· ${state.shipperRepo}` : ''
}

// Giriş
$('linkCreateToken').addEventListener('click', (e) => {
  e.preventDefault()
  window.shipperAPI.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow&description=App+Shipper')
})

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('btnSubmitLogin')
  btn.disabled = true
  btn.textContent = 'Bağlanıyor...'
  try {
    const res = await window.shipperAPI.loginWithToken({
      licenseKey: 'PRO',
      githubToken: $('loginGithubToken').value.trim(),
      shipperRepoName: 'app-shipper',
    })
    state.userProfile = res.userProfile
    state.shipperRepo = res.shipperRepo
    $('setShipperRepo').value = state.shipperRepo
    applyUserProfile(res.userProfile)
    $('loginPortal').classList.add('hidden')
    showToast(`Hoş geldiniz ${res.userProfile.name}`, 'success')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Bağlan'
  }
})

window.shipperAPI.onWebLoginSuccess((data) => {
  state.userProfile = data.userProfile
  state.shipperRepo = data.shipperRepo
  $('setShipperRepo').value = state.shipperRepo
  applyUserProfile(data.userProfile)
  $('loginPortal').classList.add('hidden')
  $('deviceCodeBox').classList.add('hidden')
  showToast(`Giriş tamamlandı (${data.userProfile.login})`, 'success')
})

$('btnWebOAuthLogin').addEventListener('click', async () => {
  const btn = $('btnWebOAuthLogin')
  btn.disabled = true
  try {
    const res = await window.shipperAPI.startWebLogin()
    if (res.deviceCode) {
      $('deviceCodeBox').classList.remove('hidden')
      $('deviceCodeText').textContent = res.deviceCode
      showToast(`Kod (${res.deviceCode}) kopyalandı. Açılan tarayıcıya yapıştırıp onaylayın.`, 'info')
    } else {
      await initApp()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
  }
})

$('btnLogout').addEventListener('click', async () => {
  await window.shipperAPI.logout()
  $('loginPortal').classList.remove('hidden')
})

// Projeler
function showEmptyProjectsState() {
  $('emptyProjectsHero').classList.remove('hidden')
  $('activeProjectWorkspace').classList.add('hidden')
}

function renderProjectsSidebar() {
  const container = $('savedProjectsList')
  if (!state.projects.length) {
    container.innerHTML = stateBlock({ icon: '📦', title: 'Henüz proje yok', text: 'Başlamak için + ile bir klasör ekleyin.' })
    return
  }

  container.innerHTML = state.projects.map((p) => {
    const isAct = p.id === state.activeProjectId
    const ver = p.version && p.version !== '0.0.0' ? `v${p.version}` : 'v1.0'
    const iosBadge = p.iosEnabled ? `<span class="sb-pill ios">iOS</span>` : ''
    const andBadge = p.androidEnabled ? `<span class="sb-pill and">AND</span>` : ''
    return `
      <div class="proj-sidebar-item ${isAct ? 'active' : ''}" data-proj-id="${p.id}">
        <div class="proj-sb-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        </div>
        <div class="proj-sb-meta">
          <div class="proj-sb-name">${escapeHtml(p.name)}</div>
          <div class="proj-sb-sub">
            <span>${ver}</span>
            ${iosBadge}
            ${andBadge}
          </div>
        </div>
      </div>
    `
  }).join('')

  container.querySelectorAll('.proj-sidebar-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectProject(el.dataset.projId)
      switchTab('workspace')
    })
  })
}

async function selectProject(id) {
  const proj = state.projects.find((p) => p.id === id)
  if (!proj) {
    showEmptyProjectsState()
    return
  }
  state.activeProjectId = proj.id
  const selToken = (state.selToken = (state.selToken || 0) + 1)

  // Yerel klasörden güncel versiyon ve Bundle ID bilgilerini oku
  const targetFolder = proj.iosPath || proj.androidPath
  if (targetFolder) {
    try {
      const liveInfo = await window.shipperAPI.inspectProject(targetFolder)
      if (selToken !== state.selToken) return
      if (liveInfo) {
        if (liveInfo.version && liveInfo.version !== '0.0.0') proj.version = liveInfo.version
        if (liveInfo.buildNumber) proj.buildNumber = liveInfo.buildNumber
        if (liveInfo.iosBundleId) proj.iosBundleId = liveInfo.iosBundleId
        if (liveInfo.androidPackage) proj.androidPackage = liveInfo.androidPackage
      }
    } catch { /* ignore */ }
  }

  renderProjectsSidebar()

  $('emptyProjectsHero').classList.add('hidden')
  $('activeProjectWorkspace').classList.remove('hidden')

  $('wsProjName').textContent = proj.name
  $('wsProjType').textContent = (proj.type || 'mobile').toUpperCase()
  const displayVer = proj.version && proj.version !== '0.0.0' ? proj.version : '1.0.0'
  $('wsProjVersion').textContent = `v${displayVer}`

  const bundleParts = []
  if (proj.iosBundleId) bundleParts.push(`iOS: ${proj.iosBundleId}`)
  if (proj.androidPackage) bundleParts.push(`Android: ${proj.androidPackage}`)
  $('wsProjSubPath').textContent = bundleParts.length > 0
    ? bundleParts.join('  ·  ')
    : (proj.iosPath || proj.androidPath || 'Yerel çalışma alanı hazır')

  $('wsIosEnabled').checked = proj.iosEnabled !== false
  $('wsAndroidEnabled').checked = proj.androidEnabled !== false
  $('wsIosPath').value = proj.iosPath || ''
  $('wsAndroidPath').value = proj.androidPath || ''

  $('selAppleProfile').value = proj.appleProfile || ''
  $('selGoogleProfile').value = proj.googleProfile || ''
  $('selAndroidTrack').value = proj.androidTrack || 'internal'
  $('selAndroidDraft').value = proj.isDraft ? 'draft' : 'completed'
  $('chkAutoSyncGit').checked = proj.autoSyncGit !== false

  $('inpVersion').value = ''
  $('inpVersion').placeholder = `Otomatik (${displayVer})`
  $('inpBuildNumber').value = ''
  $('inpBuildNumber').placeholder = `Otomatik (#${proj.buildNumber || '1'})`

  updateWorkspacePipelineUI()
  loadRecentErrors()
  refreshStoreStatus()
}

// Canlı App Store Connect Sürüm & Build Sorgusu
const relTime = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'az önce'
  if (m < 60) return `${m} dk önce`
  if (m < 1440) return `${Math.round(m / 60)} sa önce`
  return `${Math.round(m / 1440)} gün önce`
}

async function loadRecentErrors() {
  const proj = state.projects.find((p) => p.id === state.activeProjectId)
  const box = $('recentErrorsBox')
  if (!proj) return box.classList.add('hidden')
  const token = (state.errToken = (state.errToken || 0) + 1)
  box.classList.remove('hidden')
  const list = $('recentErrorsList')
  list.innerHTML = '<div class="err-empty">Yükleniyor...</div>'
  let items = []
  try {
    items = await window.shipperAPI.getRecentErrors({ projectId: proj.id, projectName: proj.name, days: 7 })
  } catch { /* ignore */ }
  if (token !== state.errToken) return
  list.innerHTML = ''
  if (!items.length) {
    list.innerHTML = '<div class="err-empty">Son 7 günde hata yok.</div>'
    return
  }
  for (const it of items) {
    const d = document.createElement('details')
    d.className = 'err-item'
    const sum = document.createElement('summary')
    const when = document.createElement('span')
    when.className = 'err-when'
    when.textContent = relTime(it.createdAt)
    const step = document.createElement('span')
    step.className = 'err-step'
    step.textContent = it.step || 'Hata'
    sum.append(when, step)
    const body = document.createElement('div')
    body.className = 'err-body'
    const pre = document.createElement('pre')
    pre.textContent = it.lines && it.lines.length ? it.lines.join('\n') : 'Ayrıntı alınamadı; GitHub\'da aç.'
    const actions = document.createElement('div')
    actions.className = 'err-actions'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'btn-chip'
    copy.textContent = 'Kopyala'
    copy.addEventListener('click', () => { navigator.clipboard.writeText(`${it.step}\n${pre.textContent}`); showToast('Hata kopyalandı', 'success') })
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'btn-chip'
    open.textContent = 'GitHub\'da aç'
    open.addEventListener('click', () => window.shipperAPI.openExternal(it.url))
    actions.append(copy)
    if (it.url) actions.append(open)
    body.append(pre, actions)
    d.append(sum, body)
    list.append(d)
  }
}

$('btnRefreshErrors').addEventListener('click', loadRecentErrors)

async function refreshStoreStatus() {
  const proj = state.projects.find((p) => p.id === state.activeProjectId)
  if (!proj || !proj.iosEnabled) return

  const storeToken = (state.storeToken = (state.storeToken || 0) + 1)
  const storeEls = ['storeLiveVersion', 'storeLiveLastBuild', 'storeLiveNextBuild'].map($)
  storeEls.forEach((el) => { el.textContent = 'Sorgulanıyor'; el.classList.add('skel-text') })
  $('storeLiveDot').className = 'live-dot'
  setBusy($('btnRefreshStoreStatus'), true)

  try {
    const res = await window.shipperAPI.fetchStoreStatus({
      bundleId: proj.iosBundleId || '',
      appleProfileSlug: $('selAppleProfile').value || proj.appleProfile || '',
    })
    if (storeToken !== state.storeToken) return
    state.lastStoreStatus = res

    if (!res || !res.found) {
      $('storeLiveAppName').textContent = proj.iosBundleId ? `App Store Connect (${proj.iosBundleId})` : 'App Store Connect'
      $('storeLiveVersion').textContent = `Yerel: v${proj.version || '1.0.0'}`
      $('storeLiveLastBuild').textContent = 'Kayıt / Yetki Yok'
      $('storeLiveNextBuild').textContent = 'Build #1'
      $('storeLiveDot').className = 'live-dot warn'
      return
    }

    $('storeLiveDot').className = 'live-dot ok'
    $('storeLiveAppName').textContent = `${res.appName} (${res.bundleId})`
    const stateLabel = prettyStoreState(res.storeState)
    $('storeLiveVersion').textContent = res.storeVersion
      ? `v${res.storeVersion}${stateLabel ? ` · ${stateLabel}` : ''}`
      : `Yerel: v${proj.version || '1.0'}`

    $('storeLiveLastBuild').textContent = res.latestBuildNumber
      ? `Build #${res.latestBuildNumber}${res.preReleaseVersion ? ` (v${res.preReleaseVersion})` : ''}`
      : 'Henüz yüklenmedi'

    $('storeLiveNextBuild').textContent = `Build #${res.nextBuildNumber || '1'}`

    const baseVer = proj.version && proj.version !== '0.0.0' ? proj.version : (res.storeVersion || '1.0.0')
    $('inpVersion').placeholder = `Otomatik (${baseVer})`
    $('inpBuildNumber').placeholder = `Otomatik (#${res.nextBuildNumber || '1'})`
  } catch {
    if (storeToken !== state.storeToken) return
    $('storeLiveVersion').textContent = `Yerel: v${proj.version || '1.0.0'}`
    $('storeLiveLastBuild').textContent = '—'
    $('storeLiveNextBuild').textContent = 'Otomatik'
  } finally {
    if (storeToken === state.storeToken) {
      storeEls.forEach((el) => el.classList.remove('skel-text'))
      setBusy($('btnRefreshStoreStatus'), false)
    }
  }
}

$('btnRefreshStoreStatus')?.addEventListener('click', refreshStoreStatus)
$('selAppleProfile')?.addEventListener('change', refreshStoreStatus)

// +0.0.1 Sürüm Artırma Butonu
$('btnBumpVersion')?.addEventListener('click', () => {
  const proj = state.projects.find((p) => p.id === state.activeProjectId)
  const current = $('inpVersion').value.trim()
    || (proj?.version && proj.version !== '0.0.0' ? proj.version : '')
    || state.lastStoreStatus?.storeVersion
    || '1.0.0'
  const parts = current.split('.').map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[parts.length - 1] += 1
  $('inpVersion').value = parts.join('.')
})

function updateWorkspacePipelineUI() {
  const iosOn = $('wsIosEnabled').checked
  const andOn = $('wsAndroidEnabled').checked

  $('cardIosPipeline').classList.toggle('disabled-pipe', !iosOn)
  $('wsIosBody').classList.toggle('hidden', !iosOn)
  $('wsIosDisabledMsg').classList.toggle('hidden', iosOn)

  $('cardAndroidPipeline').classList.toggle('disabled-pipe', !andOn)
  $('wsAndroidBody').classList.toggle('hidden', !andOn)
  $('wsAndroidDisabledMsg').classList.toggle('hidden', andOn)

  $('btnShipApple').classList.toggle('hidden', !iosOn)
  $('btnShipGoogle').classList.toggle('hidden', !andOn)
  $('btnShipBoth').classList.toggle('hidden', !(iosOn && andOn))
}

$('wsIosEnabled').addEventListener('change', updateWorkspacePipelineUI)
$('wsAndroidEnabled').addEventListener('change', updateWorkspacePipelineUI)

$('btnOpenWsIosFolder')?.addEventListener('click', () => {
  const p = $('wsIosPath').value.trim()
  if (p) window.shipperAPI.openPath(p)
})

$('btnOpenWsAndroidFolder')?.addEventListener('click', () => {
  const p = $('wsAndroidPath').value.trim()
  if (p) window.shipperAPI.openPath(p)
})

$('btnPickWsIosPath').addEventListener('click', async () => {
  const res = await window.shipperAPI.selectFolder('iOS Proje Klasörünü Seçin')
  if (res) {
    $('wsIosPath').value = res.folderPath
    await saveActiveWorkspaceProject()
  }
})

$('btnPickWsAndroidPath').addEventListener('click', async () => {
  const res = await window.shipperAPI.selectFolder('Android Proje Klasörünü Seçin')
  if (res) {
    $('wsAndroidPath').value = res.folderPath
    await saveActiveWorkspaceProject()
  }
})

async function saveActiveWorkspaceProject() {
  const cur = state.projects.find((p) => p.id === state.activeProjectId)
  if (!cur) return
  try {
    const res = await window.shipperAPI.saveProject({
      id: cur.id,
      name: cur.name,
      icon: cur.icon,
      iosEnabled: $('wsIosEnabled').checked,
      androidEnabled: $('wsAndroidEnabled').checked,
      iosPath: $('wsIosPath').value.trim(),
      androidPath: $('wsAndroidPath').value.trim(),
      appleProfile: $('selAppleProfile').value,
      googleProfile: $('selGoogleProfile').value,
      androidTrack: $('selAndroidTrack').value,
      isDraft: $('selAndroidDraft').value === 'draft',
      autoSyncGit: $('chkAutoSyncGit').checked,
    })
    state.projects = res.projects
    await selectProject(res.project.id)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

$('btnSaveWorkspaceChanges').addEventListener('click', async () => {
  await saveActiveWorkspaceProject()
  showToast('Proje ayarları kaydedildi', 'success')
})

// Proje Ekle / Düzenle Modalı
function openProjectModal(editProj = null) {
  $('projectModal').classList.remove('hidden')
  if (editProj) {
    $('pmId').value = editProj.id
    $('pmName').value = editProj.name || ''
    $('pmIosEnabled').checked = editProj.iosEnabled !== false
    $('pmAndroidEnabled').checked = editProj.androidEnabled !== false
    $('pmIosPath').value = editProj.iosPath || ''
    $('pmAndroidPath').value = editProj.androidPath || ''
    $('pmSameFolder').checked = editProj.iosPath === editProj.androidPath
    $('btnDeleteProjectInModal').classList.remove('hidden')
  } else {
    $('formSaveProject').reset()
    $('pmId').value = ''
    $('pmIosEnabled').checked = true
    $('pmAndroidEnabled').checked = true
    $('pmSameFolder').checked = true
    $('btnDeleteProjectInModal').classList.add('hidden')
  }
  syncProjectModalSections()
}

function syncProjectModalSections() {
  const iosOn = $('pmIosEnabled').checked
  const andOn = $('pmAndroidEnabled').checked
  const same = $('pmSameFolder').checked && iosOn && andOn

  $('pmIosSection').classList.toggle('hidden', !iosOn)
  $('pmSameFolderRow').classList.toggle('hidden', !(iosOn && andOn))
  $('pmAndroidSection').classList.toggle('hidden', !andOn || same)
}

$('pmIosEnabled').addEventListener('change', syncProjectModalSections)
$('pmAndroidEnabled').addEventListener('change', syncProjectModalSections)
$('pmSameFolder').addEventListener('change', syncProjectModalSections)

$('btnNewProjectModal').addEventListener('click', () => openProjectModal(null))
$('btnHeroAddProject').addEventListener('click', () => openProjectModal(null))
$('btnQuickNewProject').addEventListener('click', () => openProjectModal(null))
$('btnEditCurrentProject').addEventListener('click', () => {
  const cur = state.projects.find((p) => p.id === state.activeProjectId)
  openProjectModal(cur || null)
})

$('btnCloseProjectModal').addEventListener('click', () => $('projectModal').classList.add('hidden'))
$('btnCancelProjectModal').addEventListener('click', () => $('projectModal').classList.add('hidden'))

$('btnPickPmIos').addEventListener('click', async () => {
  const res = await window.shipperAPI.selectFolder('Proje Klasörünü Seçin')
  if (!res) return
  $('pmIosPath').value = res.folderPath
  if ($('pmSameFolder').checked) {
    $('pmAndroidPath').value = res.folderPath
  }
  if (!$('pmName').value.trim() && res.info?.appName) {
    $('pmName').value = res.info.appName
  }
})

$('btnPickPmAndroid').addEventListener('click', async () => {
  const res = await window.shipperAPI.selectFolder('Android Proje Klasörünü Seçin')
  if (!res) return
  $('pmAndroidPath').value = res.folderPath
  if (!$('pmName').value.trim() && res.info?.appName) {
    $('pmName').value = res.info.appName
  }
})

$('formSaveProject').addEventListener('submit', async (e) => {
  e.preventDefault()
  const iosEnabled = $('pmIosEnabled').checked
  const androidEnabled = $('pmAndroidEnabled').checked
  if (!iosEnabled && !androidEnabled) {
    return showToast('En az bir platform seçmelisiniz.', 'error')
  }

  const iosPath = $('pmIosPath').value.trim()
  const androidPath = ($('pmSameFolder').checked && iosEnabled && androidEnabled)
    ? iosPath
    : $('pmAndroidPath').value.trim()

  if (iosEnabled && !iosPath) return showToast('Lütfen iOS klasörünü seçin.', 'error')
  if (androidEnabled && !androidPath) return showToast('Lütfen Android klasörünü seçin.', 'error')

  try {
    const res = await window.shipperAPI.saveProject({
      id: $('pmId').value || undefined,
      name: $('pmName').value.trim(),
      icon: '📱',
      iosEnabled,
      androidEnabled,
      iosPath,
      androidPath,
      appleProfile: $('selAppleProfile').value,
      googleProfile: $('selGoogleProfile').value,
    })
    state.projects = res.projects
    $('projectModal').classList.add('hidden')
    await selectProject(res.project.id)
    showToast(`"${res.project.name}" kaydedildi`, 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

$('btnDeleteProjectInModal').addEventListener('click', async () => {
  const id = $('pmId').value
  if (!id) return
  state.projects = await window.shipperAPI.deleteProject(id)
  $('projectModal').classList.add('hidden')
  renderProjectsSidebar()
  if (state.projects.length > 0) await selectProject(state.projects[0].id)
  else showEmptyProjectsState()
  showToast('Proje silindi')
})

// Hesap Seçiciler
function renderAccountSelectors() {
  const appleSel = $('selAppleProfile')
  const googleSel = $('selGoogleProfile')

  appleSel.innerHTML = ''
  const defAppleOpt = document.createElement('option')
  defAppleOpt.value = ''
  const defAppleProf = state.appleProfiles.find((p) => p.isDefault)
  defAppleOpt.textContent = defAppleProf
    ? `${defAppleProf.label} (${defAppleProf.teamId}) — Varsayılan`
    : (state.hasDefaultApple ? 'Varsayılan Apple Hesabı (Kayıtlı)' : 'Varsayılan Apple Hesabı')
  appleSel.appendChild(defAppleOpt)

  for (const p of state.appleProfiles) {
    if (p.isDefault) continue
    const opt = document.createElement('option')
    opt.value = p.slug
    opt.textContent = `${p.label} (${p.teamId})`
    appleSel.appendChild(opt)
  }

  googleSel.innerHTML = ''
  const defGoogleOpt = document.createElement('option')
  defGoogleOpt.value = ''
  const defGoogleProf = state.googleProfiles.find((p) => p.isDefault)
  defGoogleOpt.textContent = defGoogleProf
    ? `${defGoogleProf.label} — Varsayılan`
    : (state.hasDefaultGoogle ? 'Varsayılan Google Hesabı (Kayıtlı)' : 'Varsayılan Google Hesabı')
  googleSel.appendChild(defGoogleOpt)

  for (const p of state.googleProfiles) {
    if (p.isDefault) continue
    const opt = document.createElement('option')
    opt.value = p.slug
    opt.textContent = `${p.label} (${p.clientEmail})`
    googleSel.appendChild(opt)
  }
}

function renderProfilesLists() {
  const apList = $('appleProfilesList')
  if (!state.appleProfiles.length) {
    apList.innerHTML = `<div class="empty-hint">Henüz kayıtlı Apple hesabı yok.</div>`
  } else {
    apList.innerHTML = state.appleProfiles.map((p) => `
      <div class="profile-item">
        <div>
          <div class="profile-item-title">${p.label} ${p.isDefault ? '(Varsayılan)' : ''}</div>
          <div class="profile-item-sub">Team ID: ${p.teamId} · Key ID: ${p.keyId}</div>
        </div>
        <button class="btn btn-xs btn-secondary" data-del-apple="${p.id}">Sil</button>
      </div>
    `).join('')

    apList.querySelectorAll('[data-del-apple]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.appleProfiles = await window.shipperAPI.deleteAppleAccount(btn.dataset.delApple)
        renderProfilesLists()
        renderAccountSelectors()
      })
    })
  }

  const gpList = $('googleProfilesList')
  if (!state.googleProfiles.length) {
    gpList.innerHTML = `<div class="empty-hint">Henüz kayıtlı Google hesabı yok.</div>`
  } else {
    gpList.innerHTML = state.googleProfiles.map((p) => `
      <div class="profile-item">
        <div>
          <div class="profile-item-title">${p.label} ${p.isDefault ? '(Varsayılan)' : ''}</div>
          <div class="profile-item-sub">${p.clientEmail}</div>
        </div>
        <button class="btn btn-xs btn-secondary" data-del-google="${p.id}">Sil</button>
      </div>
    `).join('')

    gpList.querySelectorAll('[data-del-google]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.googleProfiles = await window.shipperAPI.deleteGoogleAccount(btn.dataset.delGoogle)
        renderProfilesLists()
        renderAccountSelectors()
      })
    })
  }
}

// Projeye Özel .env ve Keystore
$('btnUploadProjectEnv').addEventListener('click', async () => {
  const cur = state.projects.find((p) => p.id === state.activeProjectId)
  if (!cur) return showToast('Önce bir proje seçin.', 'error')
  const envFilePath = await window.shipperAPI.selectFile({
    title: '.env Dosyası Seçin',
    filters: [{ name: 'Env Files', extensions: ['env', 'production', 'local', '*'] }],
  })
  if (!envFilePath) return
  try {
    const res = await window.shipperAPI.uploadEnv({ repoOrName: cur.name, envFilePath })
    showToast(`.env dosyası yüklendi (${res.secretName})`, 'success')
  } catch (e) {
    showToast(e.message, 'error')
  }
})

$('btnUploadProjectKeystore').addEventListener('click', () => {
  const cur = state.projects.find((p) => p.id === state.activeProjectId)
  if (!cur) return showToast('Önce bir proje seçin.', 'error')
  $('keystoreModal').classList.remove('hidden')
})

$('btnCloseKeystoreModal').addEventListener('click', () => $('keystoreModal').classList.add('hidden'))
$('btnCloseKeystoreModalTop')?.addEventListener('click', () => $('keystoreModal').classList.add('hidden'))

$('btnPickPkJks').addEventListener('click', async () => {
  const f = await window.shipperAPI.selectFile({
    title: 'Android Keystore (.jks) Seçin',
    filters: [{ name: 'Keystore', extensions: ['jks', 'keystore'] }],
  })
  if (f) $('pkJksPath').value = f
})

$('formProjectKeystore').addEventListener('submit', async (e) => {
  e.preventDefault()
  const cur = state.projects.find((p) => p.id === state.activeProjectId)
  try {
    await window.shipperAPI.uploadKeystore({
      repoOrName: cur.name,
      jksPath: $('pkJksPath').value,
      alias: $('pkAlias').value.trim(),
      storePass: $('pkStorePass').value,
    })
    $('keystoreModal').classList.add('hidden')
    showToast('Özel Android keystore kaydedildi', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

// Apple & Google Tarayıcı Asistanı ve Kayıt
$('btnAppleBrowserWizard').addEventListener('click', async () => {
  const btn = $('btnAppleBrowserWizard')
  btn.disabled = true
  try {
    const res = await window.shipperAPI.appleBrowserConnect({
      label: $('apLabel').value,
      isDefault: $('apIsDefault').checked,
    })
    if (res.p8Path) $('apP8Path').value = res.p8Path
    if (res.keyId) $('apKeyId').value = res.keyId
    if (res.issuerId) $('apIssuerId').value = res.issuerId
    if (res.teamId) $('apTeamId').value = res.teamId

    $('detailsAppleManual').open = true

    if (res.p8Path && res.keyId && res.issuerId) {
      showToast('Apple anahtarı yakalandı, sertifika ve Team ID doğrulanıp kaydediliyor...', 'info')
      $('formAppleAccount').requestSubmit()
    } else if (res.p8Path || res.issuerId) {
      showToast('Bilgiler yakalandı, eksik alan varsa tamamlayıp Kaydet\'e basın.', 'success')
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
  }
})

$('btnPickP8').addEventListener('click', async () => {
  const f = await window.shipperAPI.selectFile({
    title: 'App Store Connect .p8 Anahtarını Seçin',
    filters: [{ name: 'Apple AuthKey (.p8)', extensions: ['p8'] }],
  })
  if (f) {
    $('apP8Path').value = f
    const m = f.match(/AuthKey_([A-Z0-9]+)\.p8/i)
    if (m && !$('apKeyId').value) $('apKeyId').value = m[1]
  }
})

$('formAppleAccount').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('btnSaveApple')
  const origText = btn.textContent
  btn.disabled = true
  btn.textContent = 'Kaydediliyor...'
  try {
    const res = await window.shipperAPI.saveAppleAccount({
      label: $('apLabel').value,
      keyId: $('apKeyId').value,
      issuerId: $('apIssuerId').value,
      teamId: $('apTeamId').value,
      p8Path: $('apP8Path').value,
      isDefault: $('apIsDefault').checked,
    })
    state.appleProfiles = res.appleProfiles
    renderProfilesLists()
    renderAccountSelectors()
    refreshStoreStatus()
    showToast(`"${res.profile.label}" (Team: ${res.profile.teamId}) kaydedildi`, 'success')
    $('formAppleAccount').reset()
    $('apIsDefault').checked = !state.appleProfiles.some((p) => p.isDefault)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = origText
  }
})

$('btnGoogleBrowserWizard').addEventListener('click', async () => {
  const btn = $('btnGoogleBrowserWizard')
  btn.disabled = true
  try {
    const res = await window.shipperAPI.googleBrowserConnect({
      label: $('gpLabel').value,
      isDefault: $('gpIsDefault').checked,
    })
    if (res.jsonPath) {
      $('gpJsonPath').value = res.jsonPath
      $('detailsGoogleManual').open = true
      showToast('Google JSON anahtarı yakalandı, kaydediliyor...', 'info')
      $('formGoogleAccount').requestSubmit()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
  }
})

$('btnPickPlayJson').addEventListener('click', async () => {
  const f = await window.shipperAPI.selectFile({
    title: 'Google Play Service Account JSON Seçin',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (f) $('gpJsonPath').value = f
})

$('btnPickGoogleJks').addEventListener('click', async () => {
  const f = await window.shipperAPI.selectFile({
    title: 'Android Keystore (.jks) Seçin',
    filters: [{ name: 'Keystore', extensions: ['jks', 'keystore'] }],
  })
  if (f) $('gpJksPath').value = f
})

$('formGoogleAccount').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('btnSaveGoogle')
  const origText = btn.textContent
  btn.disabled = true
  btn.textContent = 'Kaydediliyor...'
  try {
    const res = await window.shipperAPI.saveGoogleAccount({
      label: $('gpLabel').value,
      jsonPath: $('gpJsonPath').value,
      customJksPath: $('gpJksPath').value,
      keyAlias: $('gpKeyAlias').value,
      keystorePass: $('gpStorePass').value,
      isDefault: $('gpIsDefault').checked,
    })
    state.googleProfiles = res.googleProfiles
    renderProfilesLists()
    renderAccountSelectors()
    showToast(`"${res.profile.label}" kaydedildi`, 'success')
    $('formGoogleAccount').reset()
    $('gpIsDefault').checked = !state.googleProfiles.some((p) => p.isDefault)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = origText
  }
})

$('formGeneralSettings').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('btnSaveGeneral')
  btn.disabled = true
  try {
    const res = await window.shipperAPI.saveGeneralSettings({
      shipperRepoName: $('setShipperRepo').value.trim(),
      sourceToken: $('setSourceToken').value.trim(),
      createRepo: $('setCreateRepo').checked,
    })
    state.shipperRepo = res.shipperRepo
    $('topCloudStatus').textContent = `· ${state.shipperRepo}`
    showToast('Ayarlar kaydedildi', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
  }
})

$('btnExportConfig').addEventListener('click', async () => {
  try {
    const r = await window.shipperAPI.exportConfig()
    if (r) showToast(`Dışa aktarıldı: ${r.projects} proje, ${r.apple} Apple, ${r.google} Google hesabı`, 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

$('btnImportConfig').addEventListener('click', async () => {
  try {
    const r = await window.shipperAPI.importConfig()
    if (!r) return
    showToast(`İçe aktarıldı: ${r.projects} proje, ${r.apple} Apple, ${r.google} Google hesabı`, 'success')
    setTimeout(() => location.reload(), 900)
  } catch (err) {
    showToast(err.message, 'error')
  }
})

// ─────────────────── GÖNDERİM & ARKA PLANDA DEVAM ETME (Çoklu eşzamanlı build) ───────────────────
// Her build kendi nesnesinde yaşar; modal / mini çubuk / üst hap yalnızca odaktaki build'i çizer, sekmeler build'ler arasında geçirir.

const MAX_PARALLEL_BUILDS = 3
const builds = new Map() // id → build
let focusedBuildId = null
let buildSeq = 0

const platformLabel = (p) => (p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : 'iOS + Android')
const platformSet = (p) => (p === 'both' ? ['ios', 'android'] : [p])
const focusedBuild = () => builds.get(focusedBuildId) || null
const runningBuilds = () => [...builds.values()].filter((b) => b.running)

function buildTitle(b) {
  const prefix = b.projectName ? `${b.projectName} · ` : ''
  if (b.platforms === 'ios') return `${prefix}iOS → TestFlight`
  if (b.platforms === 'android') return `${prefix}Android → Google Play`
  return `${prefix}App Store & Google Play`
}

function createBuild(platforms, proj, runIds = []) {
  const usedSlots = new Set(runningBuilds().map((x) => x.slot))
  let slot = 1
  while (usedSlots.has(slot) && slot < MAX_PARALLEL_BUILDS) slot++
  const b = {
    id: `b${++buildSeq}`,
    slot,
    platforms,
    projectId: proj?.id || '',
    projectName: proj?.name || '',
    running: true,
    runIds,
    runUrl: '',
    startTime: Date.now(),
    elapsed: 0,
    pct: 5,
    phase: 'BAŞLATILIYOR',
    status: 'Bağlanıyor...',
    subtitle: 'Proje senkronize ediliyor ve bulut derleme sunucusu başlatılıyor...',
    loader: '',
    jobsHtml: skeletonRows(2),
    failedLog: '',
    canResume: false,
    pollTimer: null,
  }
  b.title = buildTitle(b)
  builds.set(b.id, b)
  return b
}

function setBuildProgress(b, pct, status) {
  b.pct = Math.max(0, Math.min(100, Math.round(pct)))
  if (status) b.status = status
}

function removeBuild(b) {
  if (b.pollTimer) clearInterval(b.pollTimer)
  builds.delete(b.id)
  if (focusedBuildId === b.id) focusedBuildId = [...builds.keys()].pop() || null
}

function buildTabsHtml() {
  if (builds.size < 2) return ''
  return [...builds.values()].map((b) => {
    const cls = `${b.id === focusedBuildId ? 'active' : ''} ${b.running ? 'running' : b.loader}`
    const short = `${b.projectName || 'Build'} · ${platformLabel(b.platforms)}`
    const tail = b.running ? `${b.pct}%` : `<span class="build-tab-close" data-close-build="${b.id}" title="Sekmeyi kapat" style="cursor:pointer;padding:0 4px">✕</span>`
    return `<button type="button" class="build-tab ${cls}" data-build="${b.id}" title="${escapeHtml(b.title)}"><span class="build-tab-dot"></span><span class="build-tab-name">${escapeHtml(short)}</span><span class="build-tab-pct">${tail}</span></button>`
  }).join('')
}

let _lastTabsHtml = ''
let _lastProgressSent = null
function paintBuilds() {
  const b = focusedBuild()
  const running = runningBuilds()

  // Sekmeler (modal + mini çubuk)
  const tabs = buildTabsHtml()
  if (tabs !== _lastTabsHtml) {
    _lastTabsHtml = tabs
    for (const id of ['buildTabs', 'minBuildTabs']) {
      const el = $(id)
      if (!el) continue
      el.innerHTML = tabs
      el.classList.toggle('hidden', !tabs)
    }
  }

  // Üst hap + görev çubuğu ilerlemesi
  const avgPct = running.length ? Math.round(running.reduce((a, x) => a + x.pct, 0) / running.length) : 0
  if (!builds.size) $('topBuildPill').classList.add('hidden')
  else $('topBuildPill').classList.remove('hidden')
  $('topPillText').textContent = running.length > 1
    ? `${running.length} build · ${avgPct}%`
    : running.length === 1 ? `Derleniyor · ${avgPct}%`
      : (b && b.loader === 'completed' ? 'Tamamlandı' : 'Durdu')
  const sent = running.length ? Math.max(0.05, avgPct / 100) : -1
  if (sent !== _lastProgressSent) {
    _lastProgressSent = sent
    window.shipperAPI.setProgress(sent)
  }

  if (!b) return
  const safePct = Math.max(5, b.pct)
  $('overallPctLabel').textContent = `${b.pct}%`
  $('overallProgressBar').style.width = `${safePct}%`
  $('minBarPct').textContent = `${b.pct}%`
  $('minBarProgressFill').style.width = `${safePct}%`
  $('overallStatusLabel').textContent = b.status
  $('minBarStatus').textContent = b.status
  $('shipPhaseTag').textContent = b.phase
  $('shipModalTitle').textContent = b.title
  $('minBarTitle').textContent = b.title
  $('shipModalSubtitle').textContent = b.subtitle
  for (const id of ['orbitalLoader', 'minBarSpinner']) {
    const el = $(id)
    el.className = id === 'orbitalLoader' ? 'spinner-lg' : 'spinner-sm'
    if (b.loader) el.classList.add(b.loader)
  }
  if ($('liveJobsContainer').dataset.lastHtml !== b.jobsHtml) {
    $('liveJobsContainer').dataset.lastHtml = b.jobsHtml
    $('liveJobsContainer').innerHTML = b.jobsHtml
  }
  $('btnResumeShip').classList.toggle('hidden', !b.canResume)
  $('failedLogBox').classList.toggle('hidden', !b.failedLog)
  $('failedLogPre').textContent = b.failedLog
  setCancelButtonsVisible(b.running)
  $('btnHideOverlayText').textContent = b.running ? 'Arka Planda Devam Et' : 'Kapat'
  const t = formatSec(b.running ? (Date.now() - b.startTime) / 1000 : b.elapsed)
  $('shipElapsedTimer').textContent = t
  $('minBarTimer').textContent = t
}

setInterval(() => {
  const b = focusedBuild()
  if (!b || !b.running) return
  const t = formatSec((Date.now() - b.startTime) / 1000)
  $('shipElapsedTimer').textContent = t
  $('minBarTimer').textContent = t
}, 1000)

function focusBuild(id) {
  if (!builds.has(id)) return
  focusedBuildId = id
  paintBuilds()
}

function openBuildOverlay(id) {
  if (id) focusedBuildId = id
  state.isBuildMinimized = false
  $('shippingOverlay').classList.remove('hidden')
  $('minimizedBuildBar').classList.add('hidden')
  paintBuilds()
}

function minimizeBuildToBackground() {
  $('shippingOverlay').classList.add('hidden')
  state.isBuildMinimized = true
  if (builds.size) $('minimizedBuildBar').classList.remove('hidden')
  paintBuilds()
}

function restoreBuildFromBackground() {
  openBuildOverlay()
}

// Kapat: biten build'i listeden çıkarır; başka build varsa ona geçer, yoksa her şeyi gizler
function closeFinishedBuild() {
  const b = focusedBuild()
  if (b && !b.running) removeBuild(b)
  if (!builds.size) {
    $('shippingOverlay').classList.add('hidden')
    $('minimizedBuildBar').classList.add('hidden')
    state.isBuildMinimized = false
  }
  _lastTabsHtml = null
  paintBuilds()
}

window.shipperAPI.onShipEvent((ev) => {
  const b = (ev.buildId && builds.get(ev.buildId)) || null
  if (!b || !b.running) return
  b.status = ev.message
  if (b.id === focusedBuildId) paintBuilds()
})

;['buildTabs', 'minBuildTabs'].forEach((id) => {
  $(id)?.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close-build]')
    if (closer) {
      e.stopPropagation()
      const target = builds.get(closer.dataset.closeBuild)
      if (target && !target.running) {
        removeBuild(target)
        _lastTabsHtml = null
        if (!builds.size) {
          $('shippingOverlay').classList.add('hidden')
          $('minimizedBuildBar').classList.add('hidden')
          state.isBuildMinimized = false
        }
        paintBuilds()
      }
      return
    }
    const tab = e.target.closest('[data-build]')
    if (tab) focusBuild(tab.dataset.build)
  })
})

$('btnMinimizeBuildTop')?.addEventListener('click', minimizeBuildToBackground)
$('btnHideOverlay').addEventListener('click', () => {
  const b = focusedBuild()
  if (b?.running) {
    minimizeBuildToBackground()
    showToast('Derleme arka plana alındı. Sağ alttan takip edebilirsiniz.', 'info')
  } else {
    closeFinishedBuild()
  }
})

$('shippingOverlay').addEventListener('click', (e) => {
  if (e.target === $('shippingOverlay')) {
    if (runningBuilds().length) minimizeBuildToBackground()
    else $('shippingOverlay').classList.add('hidden')
  }
})

$('minBarClickArea')?.addEventListener('click', restoreBuildFromBackground)
$('btnRestoreBuildModal')?.addEventListener('click', restoreBuildFromBackground)
$('topBuildPill')?.addEventListener('click', restoreBuildFromBackground)
$('btnDismissMinBar')?.addEventListener('click', () => {
  $('minimizedBuildBar').classList.add('hidden')
})

function setCancelButtonsVisible(visible) {
  $('btnCancelBuild')?.classList.toggle('hidden', !visible)
  $('btnCancelMinBar')?.classList.toggle('hidden', !visible)
  if ($('btnCancelBuild') && !$('btnCancelBuild').dataset.cancelling) {
    $('btnCancelBuild').disabled = false
    $('btnCancelBuild').innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
      <span>Derlemeyi Durdur</span>
    `
  }
  if ($('btnCancelMinBar') && !$('btnCancelBuild')?.dataset.cancelling) {
    $('btnCancelMinBar').disabled = false
    $('btnCancelMinBar').textContent = 'Durdur'
  }
}

async function cancelActiveBuild() {
  const b = focusedBuild()
  if (!b || !b.running) return
  if (!b.runIds.length) {
    return showToast('Bu build henüz buluta gönderilmedi (yerel hazırlık sürüyor); başladıktan sonra durdurulabilir.', 'info')
  }
  const btn = $('btnCancelBuild')
  btn.dataset.cancelling = '1'
  btn.disabled = true
  btn.textContent = 'Durduruluyor...'
  if ($('btnCancelMinBar')) {
    $('btnCancelMinBar').disabled = true
    $('btnCancelMinBar').textContent = '...'
  }
  try {
    await window.shipperAPI.cancelRun({ runIds: b.runIds, runId: b.runIds[0] })
    b.running = false
    b.elapsed = Math.floor((Date.now() - b.startTime) / 1000)
    if (b.pollTimer) clearInterval(b.pollTimer)
    b.loader = 'failed'
    b.phase = 'İPTAL EDİLDİ'
    setBuildProgress(b, 100, 'Derleme kullanıcı tarafından durduruldu.')
    showToast('Derleme durduruldu', 'info')
  } catch (e) {
    showToast(`Durdurulamadı: ${e.message}`, 'error')
  } finally {
    delete btn.dataset.cancelling
    paintBuilds()
  }
}

$('btnCancelBuild')?.addEventListener('click', cancelActiveBuild)
$('btnCancelMinBar')?.addEventListener('click', (e) => {
  e.stopPropagation()
  cancelActiveBuild()
})

function jobsHtmlFor(jobs) {
  return jobs.map((j) => {
    let jStatus = 'Sırada'
    if (j.status === 'in_progress') jStatus = `${j.pct}%`
    else if (j.status === 'completed') {
      if (j.conclusion === 'success') jStatus = 'Tamamlandı'
      else if (j.conclusion === 'cancelled') jStatus = 'İptal Edildi'
      else jStatus = 'Hata'
    }

    const visibleSteps = (j.steps || []).filter((st) => st.conclusion !== 'skipped')
    const stepsHtml = visibleSteps.map((st) => {
      let icon = '·'
      if (st.status === 'completed') {
        if (st.conclusion === 'failure') icon = '✕'
        else if (st.conclusion === 'cancelled') icon = '⊘'
        else icon = '✓'
      } else if (st.status === 'in_progress') {
        icon = `<span class="step-spinner"></span>`
      }

      const timeText = st.duration > 0 ? formatSec(st.duration) : ''
      return `
        <div class="step-row ${st.status}">
          <div class="step-left">
            <span>${icon}</span>
            <span>${st.name}</span>
          </div>
          <span>${timeText}</span>
        </div>
      `
    }).join('')

    return `
      <div class="job-card">
        <div class="job-card-header">
          <span>${j.name === 'detect' ? 'Platform Hazırlığı' : j.name}</span>
          <span class="text-muted">${jStatus}</span>
        </div>
        <div class="steps-list">${stepsHtml}</div>
      </div>
    `
  }).join('')
}

// Bir yoklama sonucunu build nesnesine işler (çizim paintBuilds'te)
function applyRunData(b, runData) {
  // Atlanan (skipped) platform işlerini gizle (örn: sadece iOS seçildiğinde Android -> Google Play)
  const rawJobs = (runData.jobs || []).filter((j) => j.conclusion !== 'skipped')
  const mainJobs = rawJobs.filter((j) => j.name !== 'detect')
  // Ana platform işleri başladıysa "detect" ön kontrol kartını gizle ki ekran sade kalsın
  const jobs = mainJobs.length > 0 ? mainJobs : rawJobs

  let overallPct = 10
  let maxRemaining = 0
  if (mainJobs.length > 0) {
    overallPct = Math.round(mainJobs.reduce((acc, j) => acc + (j.pct || 0), 0) / mainJobs.length)
    maxRemaining = Math.max(0, ...mainJobs.filter((j) => j.status !== 'completed').map((j) => j.remaining || 0))
  } else if (rawJobs.some((j) => j.name === 'detect' && j.status === 'completed')) {
    overallPct = 15
  }
  if (runData.status === 'completed') overallPct = 100

  let statusText = ''
  if (runData.status !== 'completed') {
    b.phase = 'DERLENİYOR'
    statusText = maxRemaining > 0
      ? `Derleniyor · Tahmini kalan: ~${formatSec(maxRemaining)}`
      : 'Adımlar yürütülüyor...'
  }
  setBuildProgress(b, overallPct, statusText)
  b.jobsHtml = jobsHtmlFor(jobs)
}

async function finishBuild(b, runData) {
  b.running = false
  b.elapsed = Math.floor((Date.now() - b.startTime) / 1000)
  if (b.pollTimer) clearInterval(b.pollTimer)
  if (runData.conclusion === 'success') {
    b.loader = 'completed'
    b.phase = 'TAMAMLANDI'
    setBuildProgress(b, 100, 'Mağaza yüklemeleri başarıyla tamamlandı!')
    showToast(`${b.title} mağazaya gönderildi!`, 'success')
    window.shipperAPI.notify({
      title: 'App Shipper — Gönderim Tamamlandı',
      body: `${b.title} başarıyla mağazaya yüklendi.`,
    })
    refreshStoreStatus()
  } else if (runData.conclusion === 'cancelled') {
    b.loader = 'failed'
    b.phase = 'İPTAL EDİLDİ'
    setBuildProgress(b, 100, 'Derleme kullanıcı tarafından durduruldu.')
  } else {
    b.loader = 'failed'
    b.phase = 'HATA'
    b.canResume = true
    setBuildProgress(b, 100, 'Derleme sırasında hata oluştu — detayları inceleyin.')
    window.shipperAPI.notify({
      title: 'App Shipper — Derleme Hatası',
      body: `${b.title} sırasında bir hata oluştu.`,
    })
    try {
      const logs = await window.shipperAPI.getFailedLogs({ runId: b.runIds[0] })
      if (logs) b.failedLog = logs.slice(-4500)
    } catch { /* ignore */ }
  }
  paintBuilds()
}

function startBuildPolling(b) {
  const pollFn = async () => {
    if (!builds.has(b.id) || !b.running) return
    let runData
    try {
      runData = await window.shipperAPI.pollRun({ runIds: b.runIds, runId: b.runIds[0] })
    } catch { return }
    if (!builds.has(b.id) || !b.running) return
    applyRunData(b, runData)
    if (runData.status === 'completed') await finishBuild(b, runData)
    else paintBuilds()
  }
  if (b.pollTimer) clearInterval(b.pollTimer)
  b.pollTimer = startGuardedPoll(pollFn, 3000)
  return pollFn()
}

function failBuild(b, e) {
  b.running = false
  b.elapsed = Math.floor((Date.now() - b.startTime) / 1000)
  if (b.pollTimer) clearInterval(b.pollTimer)
  b.loader = 'failed'
  b.phase = 'HATA'
  setBuildProgress(b, 100, friendlyError(e))
  paintBuilds()
  showToast(`${b.title}: ${friendlyError(e)}`, 'error')
}

async function startShipping(platforms, opts = {}) {
  const iosPath = $('wsIosPath').value.trim()
  const androidPath = $('wsAndroidPath').value.trim()

  if ((platforms === 'ios' || platforms === 'both') && !iosPath) {
    return showToast('iOS klasörü seçilmemiş', 'error')
  }
  if ((platforms === 'android' || platforms === 'both') && !androidPath) {
    return showToast('Android klasörü seçilmemiş', 'error')
  }

  const curProj = state.projects.find((p) => p.id === state.activeProjectId)

  // Paralel sınırlar: en fazla 3 build; aynı proje + aynı platform ikinci kez başlamaz (bulutta birbirini iptal eder)
  const active = runningBuilds().filter((x) => x.id !== opts.replaceId)
  if (active.length >= MAX_PARALLEL_BUILDS) {
    return showToast(`En fazla ${MAX_PARALLEL_BUILDS} build aynı anda çalışabilir. Birinin bitmesini bekleyin.`, 'error')
  }
  const want = new Set(platformSet(platforms))
  const clash = active.find((x) => x.projectId === (curProj?.id || '') && platformSet(x.platforms).some((p) => want.has(p)))
  if (clash) {
    return showToast(`${curProj?.name || 'Bu proje'} için ${platformLabel(clash.platforms)} build'i zaten çalışıyor.`, 'error')
  }

  if (state.shipStarting) return
  state.shipStarting = true
  const shipBtns = ['btnShipApple', 'btnShipGoogle', 'btnShipBoth'].map($)
  shipBtns.forEach((b) => setBusy(b, true))
  try {
    await saveActiveWorkspaceProject()
  } catch (e) {
    return showToast(friendlyError(e), 'error')
  } finally {
    // Yalnızca kaydetme sürerken kilit: ardından başka bir projenin build'i de başlatılabilir
    state.shipStarting = false
    shipBtns.forEach((b) => setBusy(b, false))
  }

  if (opts.replaceId && builds.has(opts.replaceId)) removeBuild(builds.get(opts.replaceId))
  const b = createBuild(platforms, curProj)
  openBuildOverlay(b.id)

  const rawVerInput = $('inpVersion').value.trim()
  const rawBuildInput = $('inpBuildNumber').value.trim()

  // Eğer kullanıcı özel build numarası girdiyse version+buildNumber formatında ilet
  let versionPayload = rawVerInput
  if (rawBuildInput) {
    const baseVer = rawVerInput || (curProj?.version && curProj.version !== '0.0.0' ? curProj.version : '')
    versionPayload = `${baseVer}+${rawBuildInput}`
  }

  try {
    const res = opts.resume
      ? await window.shipperAPI.resumeShip({ buildId: b.id, projectId: curProj?.id || '' })
      : await window.shipperAPI.startShip({
        buildId: b.id,
        slot: b.slot,
        projectId: curProj?.id || '',
        projectName: curProj?.name || '',
        iosPath,
        androidPath,
        platforms,
        version: versionPayload,
        ref: $('inpRef').value.trim(),
        androidTrack: $('selAndroidTrack').value,
        isDraft: $('selAndroidDraft').value === 'draft',
        appleProfile: $('selAppleProfile').value,
        googleProfile: $('selGoogleProfile').value,
        autoSyncGit: $('chkAutoSyncGit').checked,
      })

    if (!builds.has(b.id)) return
    b.runIds = res.runIds || [res.runId]
    b.runUrl = res.runUrl
    b.subtitle = `${res.repo} derlemesi canlı takip ediliyor.`
    await startBuildPolling(b)
  } catch (e) {
    if (builds.has(b.id)) failBuild(b, e)
  }
}

$('btnShipApple').addEventListener('click', () => startShipping('ios'))
$('btnShipGoogle').addEventListener('click', () => startShipping('android'))
$('btnShipBoth').addEventListener('click', () => startShipping('both'))

$('btnResumeShip').addEventListener('click', () => {
  const b = focusedBuild()
  if (!b || b.running) return
  // Devam yalnızca o build'in ait olduğu projede çalışır (yüklenen paket proje başına saklanır)
  if (b.projectId !== state.activeProjectId) return showToast(`Önce "${b.projectName}" projesini seçin, sonra devam edin.`, 'error')
  startShipping('ios', { resume: true, replaceId: b.id })
})

$('btnOpenRunUrl').addEventListener('click', () => {
  const b = focusedBuild()
  if (b?.runUrl) window.shipperAPI.openExternal(b.runUrl)
})

// Geçmiş (Filtreleme, Sıralama ve Sayfalama)
state.historyList = []
state.historyPage = 1

function populateHistoryProjectDropdown() {
  const sel = $('histProjectFilter')
  if (!sel) return
  const currentVal = sel.value || 'all'
  const projNames = new Set()
  for (const p of state.projects || []) {
    if (p.name) projNames.add(p.name)
  }
  for (const r of state.historyList || []) {
    if (r.projectName && r.projectName !== 'Proje') projNames.add(r.projectName)
  }
  sel.innerHTML = `<option value="all">Tüm Projeler</option>` +
    Array.from(projNames).map((name) => `<option value="${name}">${name}</option>`).join('')
  if (Array.from(projNames).includes(currentVal)) sel.value = currentVal
}

function getFilteredAndSortedHistory() {
  const q = ($('histSearch')?.value || '').trim().toLowerCase()
  const projFilter = $('histProjectFilter')?.value || 'all'
  const platFilter = $('histPlatformFilter')?.value || 'all'
  const statusFilter = $('histStatusFilter')?.value || 'all'
  const dateFilter = $('histDateFilter')?.value || 'all'
  const sortOrder = $('histSortOrder')?.value || 'date_desc'
  const now = Date.now()

  const filtered = (state.historyList || []).filter((r) => {
    const isRunning = r.status !== 'completed'
    const runStatus = isRunning ? 'running' : (r.conclusion || 'failure')

    if (projFilter !== 'all' && r.projectName !== projFilter) return false
    if (platFilter !== 'all' && r.platforms !== platFilter) return false
    if (statusFilter !== 'all' && runStatus !== statusFilter) return false

    if (dateFilter !== 'all' && r.createdAt) {
      const createdMs = Date.parse(r.createdAt)
      const diffHours = (now - createdMs) / (1000 * 3600)
      if (dateFilter === 'today' && diffHours > 24) return false
      if (dateFilter === '7d' && diffHours > 24 * 7) return false
      if (dateFilter === '30d' && diffHours > 24 * 30) return false
    }

    if (q) {
      const hay = `${r.projectName || ''} ${r.displayTitle || ''} ${r.version || ''} ${r.databaseId || ''} ${r.platforms || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  filtered.sort((a, b) => {
    if (sortOrder === 'date_asc') return Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0)
    if (sortOrder === 'proj_asc') return String(a.projectName || '').localeCompare(String(b.projectName || ''), 'tr')
    if (sortOrder === 'proj_desc') return String(b.projectName || '').localeCompare(String(a.projectName || ''), 'tr')
    if (sortOrder === 'dur_desc') return (b.durationSec || 0) - (a.durationSec || 0)
    if (sortOrder === 'dur_asc') return (a.durationSec || 0) - (b.durationSec || 0)
    return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  })

  return filtered
}

function renderHistoryTable() {
  const container = $('historyTableContainer')
  const pageBar = $('historyPaginationBar')
  if (!container) return

  const filtered = getFilteredAndSortedHistory()
  const pageSize = parseInt($('histPageSize')?.value || '8', 10)
  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (state.historyPage > totalPages) state.historyPage = totalPages
  if (state.historyPage < 1) state.historyPage = 1

  if (!totalItems) {
    container.innerHTML = stateBlock({ icon: '🗂', title: 'Gönderim kaydı yok', text: state.historyList.length ? 'Seçilen filtrelere uygun kayıt bulunamadı.' : 'İlk gönderiminizden sonra kayıtlar burada görünecek.' })
    pageBar?.classList.add('hidden')
    return
  }

  const startIdx = (state.historyPage - 1) * pageSize
  const pageItems = filtered.slice(startIdx, startIdx + pageSize)

  container.innerHTML = pageItems.map((r) => {
    const isRunning = r.status !== 'completed'
    const isOk = r.conclusion === 'success'
    const isCancelled = r.conclusion === 'cancelled'
    const dotClass = isRunning ? 'running' : (isOk ? 'success' : (isCancelled ? 'cancelled' : 'failure'))
    const statusLabel = isRunning ? 'Derleniyor' : (isOk ? 'Başarılı' : (isCancelled ? 'İptal Edildi' : 'Hatalı'))
    const dateStr = new Date(r.createdAt).toLocaleString('tr-TR')
    const durText = r.durationSec > 0 ? ` &middot; Süre: ${formatSec(r.durationSec)}` : ''

    let platBadge = `<span class="hist-badge plat-both">iOS + Android</span>`
    if (r.platforms === 'ios') platBadge = `<span class="hist-badge plat-ios">&#63743; iOS · TestFlight</span>`
    else if (r.platforms === 'android') platBadge = `<span class="hist-badge plat-android">Android · Play</span>`

    const verBadge = r.version ? `<span class="hist-badge ver">v${r.version}</span>` : ''

    return `
      <div class="history-row">
        <div>
          <div class="history-title">
            <span class="status-dot ${dotClass}"></span>
            <div class="hist-tags">
              <span class="hist-badge proj">${r.projectName || 'Proje'}</span>
              ${platBadge}
              ${verBadge}
              <span>${r.displayTitle}</span>
            </div>
          </div>
          <div class="history-sub">${dateStr} &middot; <strong>${statusLabel}</strong>${durText} &middot; <span class="text-muted">#${r.databaseId}</span></div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          ${isRunning ? `<button class="btn btn-xs btn-danger" data-cancel-run="${r.databaseId}">Durdur</button>` : ''}
          ${isRunning ? `<button class="btn btn-xs btn-primary" data-watch-run="${r.databaseId}" data-watch-url="${r.url}" data-watch-plat="${r.platforms || 'both'}">Canlı İzle</button>` : ''}
          <button class="btn btn-xs btn-secondary" data-open-url="${r.url}">GitHub'da Aç</button>
        </div>
      </div>
    `
  }).join('')

  // Sayfalama çubuğunu güncelle
  if (pageBar) {
    pageBar.classList.remove('hidden')
    const endIdx = Math.min(totalItems, startIdx + pageSize)
    $('histPageInfo').textContent = `Toplam ${totalItems} gönderimden ${startIdx + 1}–${endIdx} arası gösteriliyor`

    const btns = []
    btns.push(`<button class="page-btn" data-hist-page="${state.historyPage - 1}" ${state.historyPage <= 1 ? 'disabled' : ''}>&laquo; Önceki</button>`)
    for (let p = 1; p <= totalPages; p++) {
      if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - state.historyPage) <= 1) {
        btns.push(`<button class="page-btn ${p === state.historyPage ? 'active' : ''}" data-hist-page="${p}">${p}</button>`)
      } else if (btns[btns.length - 1] !== `<span class="text-muted" style="padding:0 4px">…</span>`) {
        btns.push(`<span class="text-muted" style="padding:0 4px">…</span>`)
      }
    }
    btns.push(`<button class="page-btn" data-hist-page="${state.historyPage + 1}" ${state.historyPage >= totalPages ? 'disabled' : ''}>Sonraki &raquo;</button>`)
    $('histPageButtons').innerHTML = btns.join('')

    $('histPageButtons').querySelectorAll('[data-hist-page]').forEach((b) => {
      b.addEventListener('click', () => {
        const targetPage = parseInt(b.dataset.histPage, 10)
        if (targetPage >= 1 && targetPage <= totalPages) {
          state.historyPage = targetPage
          renderHistoryTable()
        }
      })
    })
  }

  container.querySelectorAll('[data-open-url]').forEach((btn) => {
    btn.addEventListener('click', () => window.shipperAPI.openExternal(btn.dataset.openUrl))
  })

  container.querySelectorAll('[data-cancel-run]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '...'
      try {
        await window.shipperAPI.cancelRun({ runId: btn.dataset.cancelRun })
        showToast('Derleme durduruldu', 'info')
        setTimeout(loadHistoryList, 1200)
      } catch (e) {
        showToast(e.message, 'error')
        btn.disabled = false
        btn.textContent = 'Durdur'
      }
    })
  })

  container.querySelectorAll('[data-watch-run]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const runId = btn.dataset.watchRun
      const existing = [...builds.values()].find((x) => x.runIds.map(String).includes(String(runId)))
      if (existing) return openBuildOverlay(existing.id)
      if (runningBuilds().length >= MAX_PARALLEL_BUILDS) return showToast(`En fazla ${MAX_PARALLEL_BUILDS} build aynı anda izlenebilir.`, 'error')
      const b = createBuild(btn.dataset.watchPlat || 'both', state.projects.find((p) => p.id === state.activeProjectId), [runId])
      b.runUrl = btn.dataset.watchUrl
      b.subtitle = 'Çalışan derleme canlı takip ediliyor.'
      openBuildOverlay(b.id)
      startBuildPolling(b)
    })
  })
}

async function loadHistoryList() {
  const container = $('historyTableContainer')
  container.innerHTML = skeletonRows(6, 'sm')
  setBusy($('btnRefreshHistory'), true)
  try {
    state.historyList = await window.shipperAPI.getHistory()
    populateHistoryProjectDropdown()
    renderHistoryTable()
  } catch (e) {
    container.innerHTML = stateBlock({ icon: '⚠', title: 'Geçmiş yüklenemedi', text: friendlyError(e), retryId: 'btnRetryHistory', error: true })
    $('btnRetryHistory')?.addEventListener('click', loadHistoryList)
  } finally {
    setBusy($('btnRefreshHistory'), false)
  }
}

;['histSearch', 'histProjectFilter', 'histPlatformFilter', 'histStatusFilter', 'histDateFilter', 'histSortOrder', 'histPageSize'].forEach((id) => {
  const el = $(id)
  if (!el) return
  const ev = el.tagName === 'INPUT' ? 'input' : 'change'
  const onChange = () => {
    state.historyPage = 1
    renderHistoryTable()
  }
  el.addEventListener(ev, ev === 'input' ? debounce(onChange, 180) : onChange)
})

$('btnRefreshHistory').addEventListener('click', loadHistoryList)

initApp()
