const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  try {
    console.log(`  • Applying ad-hoc macOS code signature to ${appPath}`)
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  } catch (e) {
    console.warn(`  ! Ad-hoc codesign warning: ${e.message}`)
  }
}
