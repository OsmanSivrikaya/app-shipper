const state = {
  userProfile: null,
  shipperRepo: '',
  projects: [],
  activeProjectId: null,
  appleProfiles: [],
  googleProfiles: [],
  hasDefaultApple: false,
  hasDefaultGoogle: false,
  soundEnabled: true,
  lang: 'tr',
  activeRunIds: [],
  activeRunUrl: '',
  pollTimer: null,
  elapsedTimer: null,
  startTime: 0,
}

const $ = (id) => document.getElementById(id)

// ─────────────────────── Ses Efektleri (Web Audio API Chimes) ───────────────────────

function playSound(type) {
  if (!state.soundEnabled) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (type === 'launch') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(320, now)
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.18)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.start(now)
      osc.stop(now + 0.22)
    } else if (type === 'success') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(523.25, now) // C5
      osc.frequency.setValueAtTime(659.25, now + 0.12) // E5
      osc.frequency.setValueAtTime(783.99, now + 0.24) // G5
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
      osc.start(now)
      osc.stop(now + 0.45)
    } else if (type === 'error') {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, now)
      osc.frequency.linearRampToValueAtTime(140, now + 0.25)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
      osc.start(now)
      osc.stop(now + 0.28)
    }
  } catch { /* ignore */ }
}

function showToast(msg, type = 'info') {
  const container = $('toastContainer')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  container.appendChild(el)
  setTimeout(() => el.remove(), 4500)
}

function formatSec(sec) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─────────────────────── Özel Pencere Çubuğu Kontrolleri ───────────────────────

$('btnMinWin').addEventListener('click', () => window.shipperAPI.minimizeWindow())
$('btnMaxWin').addEventListener('click', () => window.shipperAPI.maximizeWindow())
$('btnCloseWin').addEventListener('click', () => window.shipperAPI.closeWindow())

$('btnToggleSound').addEventListener('click', async () => {
  state.soundEnabled = !state.soundEnabled
  $('btnToggleSound').textContent = state.soundEnabled ? '🔊' : '🔇'
  await window.shipperAPI.updatePrefs({ soundEnabled: state.soundEnabled })
})

$('btnToggleLang').addEventListener('click', async () => {
  state.lang = state.lang === 'tr' ? 'en' : 'tr'
  $('btnToggleLang').textContent = state.lang.toUpperCase()
  await window.shipperAPI.updatePrefs({ lang: state.lang })
  showToast(state.lang === 'tr' ? 'Dil Türkçe olarak ayarlandı' : 'Language switched to English')
})

// ─────────────────────── Sekme Geçişleri ───────────────────────

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

// ─────────────────────── Başlangıç & Login Kontrolü ───────────────────────

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
    state.soundEnabled = data.config.soundEnabled !== false
    state.lang = data.config.lang || 'tr'

    $('btnToggleSound').textContent = state.soundEnabled ? '🔊' : '🔇'
    $('btnToggleLang').textContent = state.lang.toUpperCase()
    $('setShipperRepo').value = state.shipperRepo

    // Eğer GitHub oturumu yoksa veya lisans ilk kez açılıyorsa Login Portalını göster
    if (!state.userProfile) {
      $('loginPortal').classList.remove('hidden')
    } else {
      $('loginPortal').classList.add('hidden')
      applyUserProfile(state.userProfile, data.config.licenseTier || 'PRO STUDIO')
    }

    renderAccountSelectors()
    renderProfilesLists()
    renderProjectsSidebar()

    if (state.projects.length > 0) {
      selectProject(state.projects[0].id)
    } else {
      showEmptyProjectsState()
    }
  } catch (e) {
    showToast(e.message, 'error')
  }
}

function applyUserProfile(u, tier = 'PRO STUDIO') {
  if (!u) return
  $('userNameText').textContent = u.name || `@${u.login}`
  $('userTierText').textContent = `${tier.toUpperCase()} · @${u.login}`
  if (u.avatarUrl) $('userAvatar').src = u.avatarUrl
  $('topCloudStatus').textContent = `Bulut Motoru Aktif (${state.shipperRepo || u.login + '/app-shipper'})`
}

// Login Formu
$('linkCreateToken').addEventListener('click', (e) => {
  e.preventDefault()
  window.shipperAPI.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow&description=App+Shipper+Studio')
})

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('btnSubmitLogin')
  btn.disabled = true
  btn.textContent = '⏳ Bulut Motoru Doğrulanıyor...'
  try {
    const res = await window.shipperAPI.loginWithToken({
      licenseKey: $('loginLicenseKey').value.trim(),
      githubToken: $('loginGithubToken').value.trim(),
      shipperRepoName: $('loginShipperRepo').value.trim(),
    })
    state.userProfile = res.userProfile
    state.shipperRepo = res.shipperRepo
    $('setShipperRepo').value = state.shipperRepo
    applyUserProfile(res.userProfile, res.config.licenseTier)
    $('loginPortal').classList.add('hidden')
    playSound('success')
    showToast(`Hoş geldiniz ${res.userProfile.name}! Stüdyo hazır.`, 'success')
  } catch (err) {
    playSound('error')
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '🚀 Stüdyoyu Etkinleştir ve Giriş Yap'
  }
})

window.shipperAPI.onWebLoginSuccess((data) => {
  state.userProfile = data.userProfile
  state.shipperRepo = data.shipperRepo
  $('setShipperRepo').value = state.shipperRepo
  applyUserProfile(data.userProfile, data.config?.licenseTier || 'PRO STUDIO')
  $('loginPortal').classList.add('hidden')
  $('deviceCodeBox').classList.add('hidden')
  playSound('success')
  showToast(`🎉 Hoş geldiniz ${data.userProfile.name}! Tarayıcıdan otomatik giriş tamamlandı.`, 'success')
})

$('btnWebOAuthLogin').addEventListener('click', async () => {
  const btn = $('btnWebOAuthLogin')
  btn.disabled = true
  btn.textContent = '⏳ Tarayıcı açılıyor, onay bekleniyor...'
  try {
    const res = await window.shipperAPI.startWebLogin()
    if (res.deviceCode) {
      $('deviceCodeBox').classList.remove('hidden')
      $('deviceCodeText').textContent = res.deviceCode
      showToast(`Kod (${res.deviceCode}) panoya kopyalandı! Açılan tarayıcıda Ctrl+V yapıp onaylayın, uygulama otomatik açılacak.`, 'info')
    } else {
      await initApp()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '🌐 Tarayıcıdan GitHub ile Otomatik Giriş Yap'
  }
})

$('btnLogout').addEventListener('click', async () => {
  await window.shipperAPI.logout()
  $('loginPortal').classList.remove('hidden')
})

// ─────────────────────── KALICI PROJELERİM & ÇALIŞMA ALANI (WORKSPACE) ───────────────────────

function showEmptyProjectsState() {
  $('emptyProjectsHero').classList.remove('hidden')
  $('activeProjectWorkspace').classList.add('hidden')
}

function renderProjectsSidebar() {
  const container = $('savedProjectsList')
  if (!state.projects.length) {
    container.innerHTML = `<div class="empty-hint">Henüz kayıtlı proje yok.<br/>"+ Proje Ekle" ile başlayın.</div>`
    return
  }

  container.innerHTML = state.projects.map((p) => {
    const isAct = p.id === state.activeProjectId
    const badges = [
      p.iosEnabled ? '🍎' : '',
      p.androidEnabled ? '🤖' : '',
    ].filter(Boolean).join(' ')

    return `
      <div class="proj-sidebar-item ${isAct ? 'active' : ''}" data-proj-id="${p.id}">
        <div class="proj-sb-left">
          <span class="proj-sb-icon">${p.icon || '📱'}</span>
          <span class="proj-sb-name">${p.name}</span>
        </div>
        <div class="proj-sb-badges">${badges}</div>
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

function selectProject(id) {
  const proj = state.projects.find((p) => p.id === id)
  if (!proj) {
    showEmptyProjectsState()
    return
  }
  state.activeProjectId = proj.id
  renderProjectsSidebar()

  $('emptyProjectsHero').classList.add('hidden')
  $('activeProjectWorkspace').classList.remove('hidden')

  $('wsProjIcon').textContent = proj.icon || '📱'
  $('wsProjName').textContent = proj.name
  $('wsProjType').textContent = (proj.type || 'mobile').toUpperCase()
  $('wsProjVersion').textContent = `v${proj.version || '1.0.0'}`

  $('wsIosEnabled').checked = proj.iosEnabled !== false
  $('wsAndroidEnabled').checked = proj.androidEnabled !== false
  $('wsIosPath').value = proj.iosPath || ''
  $('wsAndroidPath').value = proj.androidPath || ''

  $('selAppleProfile').value = proj.appleProfile || ''
  $('selGoogleProfile').value = proj.googleProfile || ''
  $('selAndroidTrack').value = proj.androidTrack || 'internal'
  $('selAndroidDraft').value = proj.isDraft ? 'draft' : 'completed'
  $('chkAutoSyncGit').checked = proj.autoSyncGit !== false

  updateWorkspacePipelineUI()
}

function updateWorkspacePipelineUI() {
  const iosOn = $('wsIosEnabled').checked
  const andOn = $('wsAndroidEnabled').checked

  $('cardIosPipeline').classList.toggle('disabled-pipe', !iosOn)
  $('wsIosBody').classList.toggle('hidden', !iosOn)
  $('wsIosDisabledMsg').classList.toggle('hidden', iosOn)

  $('cardAndroidPipeline').classList.toggle('disabled-pipe', !andOn)
  $('wsAndroidBody').classList.toggle('hidden', !andOn)
  $('wsAndroidDisabledMsg').classList.toggle('hidden', andOn)

  // Gönderim butonlarını akıllıca göster/gizle
  $('btnShipApple').classList.toggle('hidden', !iosOn)
  $('btnShipGoogle').classList.toggle('hidden', !andOn)
  $('btnShipBoth').classList.toggle('hidden', !(iosOn && andOn))
}

$('wsIosEnabled').addEventListener('change', updateWorkspacePipelineUI)
$('wsAndroidEnabled').addEventListener('change', updateWorkspacePipelineUI)

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
    selectProject(res.project.id)
    showToast('✔ Proje yapılandırması kaydedildi!', 'success')
  } catch (e) {
    showToast(e.message, 'error')
  }
}

$('btnSaveWorkspaceChanges').addEventListener('click', saveActiveWorkspaceProject)

// ─────────────────────── PROJE EKLE / DÜZENLE MODALI ───────────────────────

function openProjectModal(editProj = null) {
  $('projectModal').classList.remove('hidden')
  if (editProj) {
    $('pmId').value = editProj.id
    $('pmIcon').value = editProj.icon || '📱'
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
    return showToast('En az bir platform (iOS veya Android) seçmelisiniz.', 'error')
  }

  const iosPath = $('pmIosPath').value.trim()
  const androidPath = ($('pmSameFolder').checked && iosEnabled && androidEnabled)
    ? iosPath
    : $('pmAndroidPath').value.trim()

  if (iosEnabled && !iosPath) return showToast('Lütfen iOS proje klasörünü seçin.', 'error')
  if (androidEnabled && !androidPath) return showToast('Lütfen Android proje klasörünü seçin.', 'error')

  try {
    const res = await window.shipperAPI.saveProject({
      id: $('pmId').value || undefined,
      name: $('pmName').value.trim(),
      icon: $('pmIcon').value,
      iosEnabled,
      androidEnabled,
      iosPath,
      androidPath,
      appleProfile: $('selAppleProfile').value,
      googleProfile: $('selGoogleProfile').value,
    })
    state.projects = res.projects
    $('projectModal').classList.add('hidden')
    selectProject(res.project.id)
    playSound('success')
    showToast(`✔ "${res.project.name}" projesi kaydedildi! Artık tekrar klasör seçmeden gönderebilirsiniz.`, 'success')
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
  if (state.projects.length > 0) selectProject(state.projects[0].id)
  else showEmptyProjectsState()
  showToast('Proje listeden kaldırıldı.')
})

// ─────────────────────── Hesap Seçiciler & Listeler ───────────────────────

function renderAccountSelectors() {
  const appleSel = $('selAppleProfile')
  const googleSel = $('selGoogleProfile')

  appleSel.innerHTML = ''
  const defAppleOpt = document.createElement('option')
  defAppleOpt.value = ''
  defAppleOpt.textContent = state.hasDefaultApple ? '🍎 Varsayılan Apple Hesabı (Kayıtlı)' : '🍎 Varsayılan Apple Hesabı'
  appleSel.appendChild(defAppleOpt)

  for (const p of state.appleProfiles) {
    if (p.isDefault) continue
    const opt = document.createElement('option')
    opt.value = p.slug
    opt.textContent = `🍎 ${p.label} (Team: ${p.teamId})`
    appleSel.appendChild(opt)
  }

  googleSel.innerHTML = ''
  const defGoogleOpt = document.createElement('option')
  defGoogleOpt.value = ''
  defGoogleOpt.textContent = state.hasDefaultGoogle ? '🤖 Varsayılan Google Play Hesabı (Kayıtlı)' : '🤖 Varsayılan Google Play Hesabı'
  googleSel.appendChild(defGoogleOpt)

  for (const p of state.googleProfiles) {
    if (p.isDefault) continue
    const opt = document.createElement('option')
    opt.value = p.slug
    opt.textContent = `🤖 ${p.label} (${p.clientEmail})`
    googleSel.appendChild(opt)
  }
}

function renderProfilesLists() {
  const apList = $('appleProfilesList')
  if (!state.appleProfiles.length) {
    apList.innerHTML = `<div class="empty-hint">Kayıtlı ek Apple profili yok. Aşağıdan ekleyebilirsiniz.</div>`
  } else {
    apList.innerHTML = state.appleProfiles.map((p) => `
      <div class="profile-item">
        <div>
          <div class="profile-item-title">🍎 ${p.label} ${p.isDefault ? '<span class="tag tag-accent">Varsayılan</span>' : `<span class="badge">${p.slug}</span>`}</div>
          <div class="profile-item-sub">Team ID: ${p.teamId} · Key ID: ${p.keyId}</div>
        </div>
        <button class="btn btn-xs btn-ghost" data-del-apple="${p.id}">Sil</button>
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
    gpList.innerHTML = `<div class="empty-hint">Kayıtlı ek Google Play profili yok. Aşağıdan ekleyebilirsiniz.</div>`
  } else {
    gpList.innerHTML = state.googleProfiles.map((p) => `
      <div class="profile-item">
        <div>
          <div class="profile-item-title">🤖 ${p.label} ${p.isDefault ? '<span class="tag tag-accent">Varsayılan</span>' : `<span class="badge">${p.slug}</span>`}</div>
          <div class="profile-item-sub">${p.clientEmail}</div>
        </div>
        <button class="btn btn-xs btn-ghost" data-del-google="${p.id}">Sil</button>
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

// ─────────────────────── Projeye Özel .env ve Keystore ───────────────────────

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
    showToast(`✔ .env dosyası bulut motoruna (${res.secretName}) yüklendi!`, 'success')
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
    showToast('✔ Projeye özel Android keystore kaydedildi!', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
})

// ─────────────────────── Apple & Google Otomatik Tarayıcı Asistanı & Kayıt ───────────────────────

$('btnAppleBrowserWizard').addEventListener('click', async () => {
  const btn = $('btnAppleBrowserWizard')
  const orig = btn.textContent
  btn.disabled = true
  btn.textContent = '🌐 Apple Tarayıcısı Açık — Giriş Yapıp .p8 İndirin...'
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

    if (res.p8Path && res.keyId && res.issuerId && res.teamId) {
      showToast('✨ Apple bilgileri ve .p8 otomatik yakalandı! Sertifika üretilip kaydediliyor...', 'info')
      $('formAppleAccount').requestSubmit()
    } else if (res.p8Path || res.issuerId) {
      showToast('✔ Tarayıcıdan bilgiler yakalandı! Eksik alan varsa kontrol edip Kaydet\'e basın.', 'success')
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = orig
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
  btn.textContent = '⏳ Sertifika üretiliyor ve buluta yükleniyor...'
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
    playSound('success')
    showToast(`✔ "${res.profile.label}" Apple hesabı ve sertifikası kaydedildi!`, 'success')
    $('formAppleAccount').reset()
  } catch (err) {
    playSound('error')
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = origText
  }
})

$('btnGoogleBrowserWizard').addEventListener('click', async () => {
  const btn = $('btnGoogleBrowserWizard')
  const orig = btn.textContent
  btn.disabled = true
  btn.textContent = '🌐 Google Tarayıcısı Açık — JSON Anahtarını İndirin...'
  try {
    const res = await window.shipperAPI.googleBrowserConnect({
      label: $('gpLabel').value,
      isDefault: $('gpIsDefault').checked,
    })
    if (res.jsonPath) {
      $('gpJsonPath').value = res.jsonPath
      showToast('✨ Google JSON anahtarı otomatik yakalandı! Hesap kaydediliyor...', 'info')
      $('formGoogleAccount').requestSubmit()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = orig
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
  btn.textContent = '⏳ Keystore hazırlanıyor ve buluta yükleniyor...'
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
    playSound('success')
    showToast(`✔ "${res.profile.label}" Google Play hesabı kaydedildi!`, 'success')
    $('formGoogleAccount').reset()
  } catch (err) {
    playSound('error')
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
  btn.textContent = '⏳ Kaydediliyor...'
  try {
    const res = await window.shipperAPI.saveGeneralSettings({
      shipperRepoName: $('setShipperRepo').value.trim(),
      sourceToken: $('setSourceToken').value.trim(),
      createRepo: $('setCreateRepo').checked,
    })
    state.shipperRepo = res.shipperRepo
    $('topCloudStatus').textContent = `Bulut Motoru Aktif (${state.shipperRepo})`
    showToast('✔ Genel ayarlar kaydedildi ve senkronize edildi!', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '💾 Ayarları Kaydet ve Senkronize Et'
  }
})

// ─────────────────────── GÖNDERİM (SHIP) & CANLI TELEMETRİ ───────────────────────

window.shipperAPI.onShipEvent((ev) => {
  $('overallStatusLabel').textContent = ev.message
})

function openLoadingOverlay(platforms) {
  const overlay = $('shippingOverlay')
  overlay.classList.remove('hidden')

  const loader = $('orbitalLoader')
  loader.className = 'orbital-loader'
  $('livePulseDot').style.background = '#38bdf8'
  $('failedLogBox').classList.add('hidden')
  $('liveJobsContainer').innerHTML = ''

  if (platforms === 'ios') {
    $('loaderCoreIcon').textContent = '🍎'
    $('shipModalTitle').textContent = 'Apple App Store (TestFlight) Gönderimi'
  } else if (platforms === 'android') {
    $('loaderCoreIcon').textContent = '🤖'
    $('shipModalTitle').textContent = 'Google Play Console Gönderimi'
  } else {
    $('loaderCoreIcon').textContent = '🚀'
    $('shipModalTitle').textContent = 'Apple & Google Play Paralel Gönderimi'
  }

  $('shipPhaseTag').textContent = 'BAŞLATILIYOR'
  $('shipModalSubtitle').textContent = 'Proje dosyaları senkronize ediliyor ve bulut sunucusu tetikleniyor...'
  $('overallStatusLabel').textContent = 'Bulut bağlantısı kuruluyor...'
  $('overallPctLabel').textContent = '5%'
  $('overallProgressBar').style.width = '5%'
  $('overallProgressBar').classList.add('shimmer')

  state.startTime = Date.now()
  if (state.elapsedTimer) clearInterval(state.elapsedTimer)
  state.elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - state.startTime) / 1000)
    $('shipElapsedTimer').textContent = formatSec(sec)
  }, 1000)
}

function renderLiveJobs(runData) {
  const jobs = runData.jobs || []
  const container = $('liveJobsContainer')

  const mainJobs = jobs.filter((j) => j.name !== 'detect')
  let overallPct = 10
  let maxRemaining = 0
  if (mainJobs.length > 0) {
    overallPct = Math.round(mainJobs.reduce((acc, j) => acc + (j.pct || 0), 0) / mainJobs.length)
    maxRemaining = Math.max(0, ...mainJobs.filter((j) => j.status !== 'completed').map((j) => j.remaining || 0))
  } else if (jobs.some((j) => j.name === 'detect' && j.status === 'completed')) {
    overallPct = 15
  }

  if (runData.status === 'completed') overallPct = 100

  $('overallPctLabel').textContent = `${overallPct}%`
  $('overallProgressBar').style.width = `${Math.max(6, overallPct)}%`

  if (runData.status !== 'completed') {
    $('shipPhaseTag').textContent = 'BULUTTA DERLENİYOR & İMZALANIYOR'
    $('overallStatusLabel').textContent = maxRemaining > 0
      ? `Bulut sunucularda derleniyor · Tahmini kalan: ~${formatSec(maxRemaining)}`
      : 'Derleme adımları yürütülüyor...'
  }

  container.innerHTML = jobs.map((j) => {
    let statusBadge = `<span class="badge">Sırada</span>`
    if (j.status === 'in_progress') {
      statusBadge = `<span class="tag tag-accent">${j.pct}% · ~${formatSec(j.remaining)} kaldı</span>`
    } else if (j.status === 'completed') {
      if (j.conclusion === 'success') statusBadge = `<span class="tag" style="background:rgba(52,211,153,0.2);color:#34d399">✔ Tamamlandı</span>`
      else if (j.conclusion === 'skipped') statusBadge = `<span class="badge">Atlandı</span>`
      else statusBadge = `<span class="tag" style="background:rgba(248,113,113,0.2);color:#f87171">✖ Hata</span>`
    }

    const stepsHtml = (j.steps || []).map((st) => {
      let icon = '○'
      if (st.status === 'completed') {
        icon = st.conclusion === 'failure' ? '❌' : '✔'
      } else if (st.status === 'in_progress') {
        icon = `<span class="step-spinner"></span>`
      }
      const timeText = st.status === 'in_progress'
        ? `${formatSec(st.duration)}${st.estimated > 4 ? ` / ~${formatSec(st.estimated)}` : ''}`
        : st.duration > 0
          ? formatSec(st.duration)
          : st.estimated > 4
            ? `~${formatSec(st.estimated)}`
            : ''

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
          <div class="job-title">${j.name.includes('iOS') ? '🍎' : j.name.includes('Android') ? '🤖' : '🔍'} ${j.name}</div>
          ${statusBadge}
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
    return showToast('iOS proje klasörü seçilmemiş!', 'error')
  }
  if ((platforms === 'android' || platforms === 'both') && !androidPath) {
    return showToast('Android proje klasörü seçilmemiş!', 'error')
  }

  // Gönderim öncesi mevcut proje ayarlarını otomatik kaydet
  await saveActiveWorkspaceProject()
  playSound('launch')
  openLoadingOverlay(platforms)

  try {
    const res = await window.shipperAPI.startShip({
      iosPath,
      androidPath,
      platforms,
      version: $('inpVersion').value.trim(),
      ref: $('inpRef').value.trim(),
      androidTrack: $('selAndroidTrack').value,
      isDraft: $('selAndroidDraft').value === 'draft',
      appleProfile: $('selAppleProfile').value,
      googleProfile: $('selGoogleProfile').value,
      autoSyncGit: $('chkAutoSyncGit').checked,
    })

    state.activeRunIds = res.runIds || [res.runId]
    state.activeRunUrl = res.runUrl
    $('shipModalSubtitle').textContent = `${res.repo} bulut derlemesi canlı olarak izleniyor.`

    if (state.pollTimer) clearInterval(state.pollTimer)

    const pollFn = async () => {
      try {
        const runData = await window.shipperAPI.pollRun({ runIds: state.activeRunIds, runId: state.activeRunIds[0] })
        renderLiveJobs(runData)

        if (runData.status === 'completed') {
          clearInterval(state.pollTimer)
          clearInterval(state.elapsedTimer)
          $('overallProgressBar').classList.remove('shimmer')

          const loader = $('orbitalLoader')
          if (runData.conclusion === 'success') {
            loader.classList.add('completed')
            $('loaderCoreIcon').textContent = '🎉'
            $('shipPhaseTag').textContent = 'BAŞARIYLA TAMAMLANDI'
            $('livePulseDot').style.background = '#34d399'
            $('overallStatusLabel').textContent = '✔ Tüm mağaza yüklemeleri başarıyla tamamlandı!'
            playSound('success')
            showToast('🎉 Uygulama mağazalara başarıyla gönderildi!', 'success')
          } else {
            loader.classList.add('failed')
            $('loaderCoreIcon').textContent = '⚠️'
            $('shipPhaseTag').textContent = 'HATA OLUŞTU'
            $('livePulseDot').style.background = '#f87171'
            $('overallStatusLabel').textContent = '✖ Bazı adımlar tamamlanamadı. Aşağıdaki hata detayını inceleyin.'
            playSound('error')
            const logs = await window.shipperAPI.getFailedLogs({ runId: state.activeRunIds[0] })
            if (logs) {
              $('failedLogBox').classList.remove('hidden')
              $('failedLogPre').textContent = logs.slice(-4000)
            }
          }
        }
      } catch { /* geçici ağ hatası */ }
    }

    await pollFn()
    state.pollTimer = setInterval(pollFn, 3000)
  } catch (e) {
    clearInterval(state.elapsedTimer)
    $('orbitalLoader').classList.add('failed')
    $('loaderCoreIcon').textContent = '✖'
    $('shipPhaseTag').textContent = 'BAŞLATILAMADI'
    $('overallStatusLabel').textContent = e.message
    playSound('error')
    showToast(e.message, 'error')
  }
}

$('btnShipApple').addEventListener('click', () => startShipping('ios'))
$('btnShipGoogle').addEventListener('click', () => startShipping('android'))
$('btnShipBoth').addEventListener('click', () => startShipping('both'))

$('btnHideOverlay').addEventListener('click', () => $('shippingOverlay').classList.add('hidden'))
$('btnOpenRunUrl').addEventListener('click', () => {
  if (state.activeRunUrl) window.shipperAPI.openExternal(state.activeRunUrl)
})

// ─────────────────────── Son Gönderimler Geçmişi ───────────────────────

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
      const icon = r.status !== 'completed' ? '⏳' : r.conclusion === 'success' ? '✔' : '✖'
      const dateStr = new Date(r.createdAt).toLocaleString('tr-TR')
      return `
        <div class="history-row">
          <div>
            <div class="history-title">${icon} ${r.displayTitle}</div>
            <div class="history-sub">${dateStr} · Durum: ${r.conclusion || r.status}</div>
          </div>
          <div style="display:flex;gap:8px">
            ${r.status !== 'completed' ? `<button class="btn btn-xs btn-primary" data-watch-run="${r.databaseId}" data-watch-url="${r.url}">Canlı İzle</button>` : ''}
            <button class="btn btn-xs btn-secondary" data-open-url="${r.url}">GitHub'da Aç</button>
          </div>
        </div>
      `
    }).join('')

    container.querySelectorAll('[data-open-url]').forEach((btn) => {
      btn.addEventListener('click', () => window.shipperAPI.openExternal(btn.dataset.openUrl))
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
          if (runData.status === 'completed') clearInterval(state.pollTimer)
        }, 3000)
      })
    })
  } catch (e) {
    container.innerHTML = `<div class="empty-hint">${e.message}</div>`
  }
}

$('btnRefreshHistory').addEventListener('click', loadHistoryList)

initApp()
