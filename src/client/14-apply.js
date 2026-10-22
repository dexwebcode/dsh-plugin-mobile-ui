// 14-apply.js — точка входа клиентской половины.
// `slots` — реестр слотов интерфейса.
const inject = ['slots']

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
      // Режимы применяются раньше остального: от них зависит, что показывать.
      const uninstallModes = installModes()
      const uninstallLazyMedia = installLazyMedia()
      const uninstallVpnHint = installVpnHint()
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
        uninstallVpnHint()
        uninstallLazyMedia()
        uninstallModes()
        removeStyles()
      }
    }, 'dsh-plugin-mobile-ui: mobile layer')
  } catch (error) {
    // Слой косметический: его сбой не должен ломать загрузку интерфейса.
    console.warn(`dsh-plugin-mobile-ui: could not install the mobile layer: ${String(error)}`)
  }
}

exports.apply = apply;
exports.inject = inject;
