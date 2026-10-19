// 14-apply.js — точка входа клиентской половины.
// `slots` — реестр слотов интерфейса, `configForms` — доступ к настройкам хоста.
const inject = ['slots', 'configForms']

/**
 * Включить мобильный слой и раздел настроек.
 * @param ctx - контекст браузерного плагина.
 */
function apply(ctx) {
  try {
    // Раздел «Сервер» убран: всё, что нужно, собрано в одном разделе Mobile UI.
    installSettingsSection(ctx)
    ctx.effect(() => {
      installStyles()
      const uninstallVpnHint = installVpnHint()
      const uninstallUsageBar = installUsageBar()
      const uninstallMeta = installViewportMeta()
      const uninstallAppIcons = installAppIcons()
      const uninstallViewport = installViewportTracking()
      const uninstallHeaderActions = installHeaderActions()
      const uninstallLayout = trackLayout()
      return () => {
        uninstallLayout()
        uninstallHeaderActions()
        uninstallViewport()
        uninstallAppIcons()
        uninstallMeta()
        uninstallUsageBar()
        uninstallVpnHint()
        removeStyles()
      }
    }, 'dsh-mobile-ui: mobile layer')
  } catch (error) {
    // Слой косметический: его сбой не должен ломать загрузку интерфейса.
    console.warn(`dsh-mobile-ui: could not install the mobile layer: ${String(error)}`)
  }
}

exports.apply = apply;
exports.inject = inject;
