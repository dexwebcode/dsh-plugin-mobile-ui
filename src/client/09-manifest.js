// 09-manifest.js — манифест приложения и иконки в документе.
function installAppIcons() {
  const head = document.head
  const created = []
  const add = (tag) => {
    head.appendChild(tag)
    created.push(tag)
  }
  const addLink = (rel, href, extra = {}) => {
    const tag = document.createElement('link')
    tag.rel = rel
    tag.href = href
    for (const [name, value] of Object.entries(extra)) tag.setAttribute(name, value)
    add(tag)
  }

  const manifest = JSON.stringify({
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: APP_ICONS.map(([sizes, dataUrl, purpose]) => ({
      src: dataUrl,
      sizes: `${sizes}x${sizes}`,
      type: 'image/png',
      purpose,
    })),
  })
  let manifestUrl = null
  try {
    manifestUrl = URL.createObjectURL(new Blob([manifest], { type: 'application/manifest+json' }))
  } catch (error) {
    console.warn(`dsh-plugin-mobile-ui: could not build the app manifest: ${String(error)}`)
  }

  // Штатная ссылка на манифест: если своя не собралась, оставляем её.
  const existingManifest = document.querySelector('link[rel="manifest"]')
  if (existingManifest === null && manifestUrl !== null) {
    addLink('manifest', manifestUrl)
  } else if (existingManifest !== null && manifestUrl !== null) {
    existingManifest.href = manifestUrl
  }

  // Иконки ярлыка тоже уходят data URL: файл по абсолютному адресу отдаётся
  // как octet-stream (см. комментарий к APP_ICON_*).
  addLink('apple-touch-icon', APP_ICON_180, { sizes: '180x180' })
  addLink('icon', APP_ICON_32, { type: 'image/png', sizes: '32x32' })
  addLink('icon', APP_ICON_192, { type: 'image/png', sizes: '192x192' })

  const meta = (name, content) => {
    const tag = document.createElement('meta')
    tag.name = name
    tag.content = content
    add(tag)
  }
  meta('apple-mobile-web-app-capable', 'yes')
  meta('apple-mobile-web-app-title', APP_SHORT_NAME)
  meta('apple-mobile-web-app-status-bar-style', 'default')
  meta('theme-color', '#ffffff')

  return () => {
    for (const tag of created) tag.remove()
    if (existingManifest !== null && manifestUrl !== null) existingManifest.href = './manifest.webmanifest'
    if (manifestUrl !== null) URL.revokeObjectURL(manifestUrl)
  }
}
