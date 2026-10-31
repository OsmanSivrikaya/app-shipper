const state = {
  userProfile: null,
  shipperRepo: '',
  projects: [],
  activeProjectId: null,
  appleProfiles: [],
  googleProfiles: [],
  hasDefaultApple: false,
  hasDefaultGoogle: false,
  activeRunIds: [],
  activeRunUrl: '',
  isBuildRunning: false,
  isBuildMinimized: false,
  pollTimer: null,
  elapsedTimer: null,
  startTime: 0,
  lastStoreStatus: null,
}

const $ = (id) => document.getElementById(id)

function showToast(msg, type = 'info') {
  const container = $('toastContainer')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  container.appendChild(el)
  setTimeout(() => el.remove(), 4000)
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
    showToast(e.message, 'error')
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
    container.innerHTML = `<div class="empty-hint">Kayıtlı proje yok</div>`
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
          <div class="proj-sb-name">${p.name}</div>
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

  // Yerel klasörden güncel versiyon ve Bundle ID bilgilerini oku
  const targetFolder = proj.iosPath || proj.androidPath
  if (targetFolder) {
    try {
      const liveInfo = await window.shipperAPI.inspectProject(targetFolder)
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
  refreshStoreStatus()
}

// Canlı App Store Connect Sürüm & Build Sorgusu
async function refreshStoreStatus() {
  const proj = state.projects.find((p) => p.id === state.activeProjectId)
  if (!proj || !proj.iosEnabled) return

  $('storeLiveVersion').textContent = 'Sorgulanıyor...'
  $('storeLiveLastBuild').textContent = '...'
  $('storeLiveNextBuild').textContent = '...'
  $('storeLiveDot').className = 'live-dot'

  try {
    const res = await window.shipperAPI.fetchStoreStatus({
      bundleId: proj.iosBundleId || '',
      appleProfileSlug: $('selAppleProfile').value || proj.appleProfile || '',
    })
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
    $('storeLiveVersion').textContent = `Yerel: v${proj.version || '1.0.0'}`
    $('storeLiveLastBuild').textContent = '—'
    $('storeLiveNextBuild').textContent = 'Otomatik'
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

// ─────────────────── GÖNDERİM & ARKA PLANDA DEVAM ETME (Background Continuation) ───────────────────

window.shipperAPI.onShipEvent((ev) => {
  $('overallStatusLabel').textContent = ev.message
  $('minBarStatus').textContent = ev.message
})

function minimizeBuildToBackground() {
  $('shippingOverlay').classList.add('hidden')
  state.isBuildMinimized = true
  if (state.isBuildRunning || state.activeRunIds.length > 0) {
    $('minimizedBuildBar').classList.remove('hidden')
    $('topBuildPill').classList.remove('hidden')
  }
}

function restoreBuildFromBackground() {
  state.isBuildMinimized = false
  $('shippingOverlay').classList.remove('hidden')
  $('minimizedBuildBar').classList.add('hidden')
}

$('btnMinimizeBuildTop')?.addEventListener('click', minimizeBuildToBackground)
$('btnHideOverlay').addEventListener('click', () => {
  if (state.isBuildRunning) {
    minimizeBuildToBackground()
    showToast('Derleme arka plana alındı. Sağ alttan takip edebilirsiniz.', 'info')
  } else {
    $('shippingOverlay').classList.add('hidden')
    $('minimizedBuildBar').classList.add('hidden')
    $('topBuildPill').classList.add('hidden')
  }
})

$('shippingOverlay').addEventListener('click', (e) => {
  if (e.target === $('shippingOverlay')) {
    if (state.isBuildRunning) minimizeBuildToBackground()
    else $('shippingOverlay').classList.add('hidden')
  }
})

$('minBarClickArea')?.addEventListener('click', restoreBuildFromBackground)
$('btnRestoreBuildModal')?.addEventListener('click', restoreBuildFromBackground)
$('topBuildPill')?.addEventListener('click', restoreBuildFromBackground)
$('btnDismissMinBar')?.addEventListener('click', () => {
  $('minimizedBuildBar').classList.add('hidden')
  if (!state.isBuildRunning) $('topBuildPill').classList.add('hidden')
})

function setCancelButtonsVisible(visible) {
  $('btnCancelBuild')?.classList.toggle('hidden', !visible)
  $('btnCancelMinBar')?.classList.toggle('hidden', !visible)
  if ($('btnCancelBuild')) {
    $('btnCancelBuild').disabled = false
    $('btnCancelBuild').innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
      <span>Derlemeyi Durdur</span>
    `
  }
  if ($('btnCancelMinBar')) {
    $('btnCancelMinBar').disabled = false
    $('btnCancelMinBar').textContent = 'Durdur'
  }
}

async function cancelActiveBuild() {
  if (!state.activeRunIds || !state.activeRunIds.length) return
  if ($('btnCancelBuild')) {
    $('btnCancelBuild').disabled = true
    $('btnCancelBuild').textContent = 'Durduruluyor...'
  }
  if ($('btnCancelMinBar')) {
    $('btnCancelMinBar').disabled = true
    $('btnCancelMinBar').textContent = '...'
  }
  try {
    await window.shipperAPI.cancelRun({ runIds: state.activeRunIds, runId: state.activeRunIds[0] })
    state.isBuildRunning = false
    if (state.pollTimer) clearInterval(state.pollTimer)
    if (state.elapsedTimer) clearInterval(state.elapsedTimer)
    window.shipperAPI.setProgress(-1)
    setCancelButtonsVisible(false)
    $('btnHideOverlayText').textContent = 'Kapat'
    $('orbitalLoader').classList.add('failed')
    $('minBarSpinner').classList.add('failed')
    $('shipPhaseTag').textContent = 'İPTAL EDİLDİ'
    updateProgressUI(100, 'Derleme kullanıcı tarafından durduruldu.')
    showToast('Derleme durduruldu', 'info')
  } catch (e) {
    showToast(`Durdurulamadı: ${e.message}`, 'error')
    setCancelButtonsVisible(true)
  }
}

$('btnCancelBuild')?.addEventListener('click', cancelActiveBuild)
$('btnCancelMinBar')?.addEventListener('click', (e) => {
  e.stopPropagation()
  cancelActiveBuild()
})

function openLoadingOverlay(platforms) {
  state.isBuildRunning = true
  state.isBuildMinimized = false
  state.activePlatforms = platforms
  $('shippingOverlay').classList.remove('hidden')
  $('minimizedBuildBar').classList.add('hidden')
  $('topBuildPill').classList.remove('hidden')
  setCancelButtonsVisible(true)

  const loader = $('orbitalLoader')
  loader.className = 'spinner-lg'
  $('minBarSpinner').className = 'spinner-sm'
  $('failedLogBox').classList.add('hidden')
  $('liveJobsContainer').innerHTML = ''
  $('btnHideOverlayText').textContent = 'Arka Planda Devam Et'

  const curProj = state.projects.find((p) => p.id === state.activeProjectId)
  const projPrefix = curProj ? `${curProj.name} · ` : ''

  let title = `${projPrefix}App Store & Google Play`
  if (platforms === 'ios') title = `${projPrefix}iOS → TestFlight`
  else if (platforms === 'android') title = `${projPrefix}Android → Google Play`

  $('shipModalTitle').textContent = title
  $('minBarTitle').textContent = title

  $('shipPhaseTag').textContent = 'BAŞLATILIYOR'
  $('shipModalSubtitle').textContent = 'Proje senkronize ediliyor ve bulut derleme sunucusu başlatılıyor...'
  $('overallStatusLabel').textContent = 'Bağlanıyor...'
  $('minBarStatus').textContent = 'Bağlanıyor...'
  updateProgressUI(5)

  state.startTime = Date.now()
  if (state.elapsedTimer) clearInterval(state.elapsedTimer)
  state.elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - state.startTime) / 1000)
    const formatted = formatSec(sec)
    $('shipElapsedTimer').textContent = formatted
    $('minBarTimer').textContent = formatted
  }, 1000)
}

function updateProgressUI(pct, statusLabel) {
  const safePct = Math.max(5, Math.min(100, Math.round(pct)))
  $('overallPctLabel').textContent = `${pct}%`
  $('overallProgressBar').style.width = `${safePct}%`
  $('minBarPct').textContent = `${pct}%`
  $('minBarProgressFill').style.width = `${safePct}%`
  $('topPillText').textContent = state.isBuildRunning ? `Derleniyor · ${pct}%` : (pct === 100 ? 'Tamamlandı' : 'Durdu')
  if (statusLabel) {
    $('overallStatusLabel').textContent = statusLabel
    $('minBarStatus').textContent = statusLabel
  }
  window.shipperAPI.setProgress(state.isBuildRunning ? safePct / 100 : -1)
}

function renderLiveJobs(runData) {
  // Atlanan (skipped) platform işlerini kesinlikle gizle (örn: sadece iOS seçildiğinde Android -> Google Play)
  const rawJobs = (runData.jobs || []).filter((j) => j.conclusion !== 'skipped')
  const container = $('liveJobsContainer')

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
    $('shipPhaseTag').textContent = 'DERLENİYOR'
    statusText = maxRemaining > 0
      ? `Derleniyor · Tahmini kalan: ~${formatSec(maxRemaining)}`
      : 'Adımlar yürütülüyor...'
  }
  updateProgressUI(overallPct, statusText)

  container.innerHTML = jobs.map((j) => {
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

async function startShipping(platforms) {
  const iosPath = $('wsIosPath').value.trim()
  const androidPath = $('wsAndroidPath').value.trim()

  if ((platforms === 'ios' || platforms === 'both') && !iosPath) {
    return showToast('iOS klasörü seçilmemiş', 'error')
  }
  if ((platforms === 'android' || platforms === 'both') && !androidPath) {
    return showToast('Android klasörü seçilmemiş', 'error')
  }

  await saveActiveWorkspaceProject()
  openLoadingOverlay(platforms)

  const curProj = state.projects.find((p) => p.id === state.activeProjectId)
  const rawVerInput = $('inpVersion').value.trim()
  const rawBuildInput = $('inpBuildNumber').value.trim()

  // Eğer kullanıcı özel build numarası girdiyse version+buildNumber formatında ilet
  let versionPayload = rawVerInput
  if (rawBuildInput) {
    const baseVer = rawVerInput || (curProj?.version && curProj.version !== '0.0.0' ? curProj.version : '')
    versionPayload = `${baseVer}+${rawBuildInput}`
  }

  try {
    const res = await window.shipperAPI.startShip({
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

    state.activeRunIds = res.runIds || [res.runId]
    state.activeRunUrl = res.runUrl
    $('shipModalSubtitle').textContent = `${res.repo} derlemesi canlı takip ediliyor.`

    if (state.pollTimer) clearInterval(state.pollTimer)

    const pollFn = async () => {
      try {
        const runData = await window.shipperAPI.pollRun({ runIds: state.activeRunIds, runId: state.activeRunIds[0] })
        renderLiveJobs(runData)

        if (runData.status === 'completed') {
          state.isBuildRunning = false
          clearInterval(state.pollTimer)
          clearInterval(state.elapsedTimer)
          window.shipperAPI.setProgress(-1)
          setCancelButtonsVisible(false)
          $('btnHideOverlayText').textContent = 'Kapat'

          const loader = $('orbitalLoader')
          const minSpinner = $('minBarSpinner')

          if (runData.conclusion === 'success') {
            loader.classList.add('completed')
            minSpinner.classList.add('completed')
            $('shipPhaseTag').textContent = 'TAMAMLANDI'
            updateProgressUI(100, 'Mağaza yüklemeleri başarıyla tamamlandı!')
            showToast('Uygulama mağazalara başarıyla gönderildi!', 'success')
            window.shipperAPI.notify({
              title: 'App Shipper — Gönderim Tamamlandı',
              body: `${$('minBarTitle').textContent} başarıyla mağazaya yüklendi.`,
            })
            refreshStoreStatus()
          } else if (runData.conclusion === 'cancelled') {
            loader.classList.add('failed')
            minSpinner.classList.add('failed')
            $('shipPhaseTag').textContent = 'İPTAL EDİLDİ'
            updateProgressUI(100, 'Derleme kullanıcı tarafından durduruldu.')
          } else {
            loader.classList.add('failed')
            minSpinner.classList.add('failed')
            $('shipPhaseTag').textContent = 'HATA'
            updateProgressUI(100, 'Derleme sırasında hata oluştu — detayları inceleyin.')
            window.shipperAPI.notify({
              title: 'App Shipper — Derleme Hatası',
              body: `${$('minBarTitle').textContent} sırasında bir hata oluştu.`,
            })
            const logs = await window.shipperAPI.getFailedLogs({ runId: state.activeRunIds[0] })
            if (logs) {
              $('failedLogBox').classList.remove('hidden')
              $('failedLogPre').textContent = logs.slice(-4500)
            }
          }
        }
      } catch { /* ignore */ }
    }

    await pollFn()
    state.pollTimer = setInterval(pollFn, 3000)
  } catch (e) {
    state.isBuildRunning = false
    clearInterval(state.elapsedTimer)
    window.shipperAPI.setProgress(-1)
    setCancelButtonsVisible(false)
    $('btnHideOverlayText').textContent = 'Kapat'
    $('orbitalLoader').classList.add('failed')
    $('minBarSpinner').classList.add('failed')
    $('shipPhaseTag').textContent = 'HATA'
    updateProgressUI(100, e.message)
    showToast(e.message, 'error')
  }
}

$('btnShipApple').addEventListener('click', () => startShipping('ios'))
$('btnShipGoogle').addEventListener('click', () => startShipping('android'))
$('btnShipBoth').addEventListener('click', () => startShipping('both'))

$('btnOpenRunUrl').addEventListener('click', () => {
  if (state.activeRunUrl) window.shipperAPI.openExternal(state.activeRunUrl)
})

// Geçmiş
async function loadHistoryList() {
  const container = $('historyTableContainer')
  container.innerHTML = `<div class="empty-hint">Yükleniyor...</div>`
  try {
    const list = await window.shipperAPI.getHistory()
    if (!list.length) {
      container.innerHTML = `<div class="empty-hint">Henüz gönderim geçmişi yok.</div>`
      return
    }
    container.innerHTML = list.map((r) => {
      const isRunning = r.status !== 'completed'
      const isOk = r.conclusion === 'success'
      const isCancelled = r.conclusion === 'cancelled'
      const dotClass = isRunning ? 'running' : (isOk ? 'success' : 'failure')
      const statusLabel = isRunning ? 'Derleniyor' : (isOk ? 'Başarılı' : (isCancelled ? 'İptal Edildi' : 'Hatalı'))
      const dateStr = new Date(r.createdAt).toLocaleString('tr-TR')
      return `
        <div class="history-row">
          <div>
            <div class="history-title">
              <span class="status-dot ${dotClass}"></span>
              <span>${r.displayTitle}</span>
            </div>
            <div class="history-sub">${dateStr} &middot; ${statusLabel}</div>
          </div>
          <div style="display:flex;gap:8px">
            ${isRunning ? `<button class="btn btn-xs btn-danger" data-cancel-run="${r.databaseId}">Durdur</button>` : ''}
            ${isRunning ? `<button class="btn btn-xs btn-primary" data-watch-run="${r.databaseId}" data-watch-url="${r.url}">Canlı İzle</button>` : ''}
            <button class="btn btn-xs btn-secondary" data-open-url="${r.url}">GitHub'da Aç</button>
          </div>
        </div>
      `
    }).join('')

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
        state.activeRunIds = [btn.dataset.watchRun]
        state.activeRunUrl = btn.dataset.watchUrl
        openLoadingOverlay('both')
        if (state.pollTimer) clearInterval(state.pollTimer)
        state.pollTimer = setInterval(async () => {
          const runData = await window.shipperAPI.pollRun({ runIds: state.activeRunIds, runId: state.activeRunIds[0] })
          renderLiveJobs(runData)
          if (runData.status === 'completed') {
            state.isBuildRunning = false
            clearInterval(state.pollTimer)
            clearInterval(state.elapsedTimer)
            window.shipperAPI.setProgress(-1)
            setCancelButtonsVisible(false)
          }
        }, 3000)
      })
    })
  } catch (e) {
    container.innerHTML = `<div class="empty-hint">${e.message}</div>`
  }
}

$('btnRefreshHistory').addEventListener('click', loadHistoryList)

initApp()
