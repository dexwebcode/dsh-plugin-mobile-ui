// 01-shell.js — классы, атрибуты и маркеры, по которым слой узнаёт свои элементы.
const MARKER = 'data-dsh-mobile-ui'

/** Класс кнопки-логотипа в шапке, которая открывает панель. */
const BUTTON_CLASS = 'dsh-mobile-drawer-button'

/** Класс затемнения под выдвижной панелью. */
const BACKDROP_CLASS = 'dsh-mobile-backdrop'

/** Состояние панели на корне документа: по нему включается затемнение. */
const PANEL_ATTR = 'data-dsh-mobile-panel'

/** Класс кнопки нового чата в шапке телефона. */
const NEW_CHAT_BUTTON_CLASS = 'dsh-mobile-newchat-button'

/** Флаг на корне документа: кнопка нового чата установлена (своя шапка). */
const NEW_CHAT_ATTR = 'data-dsh-mobile-newchat'

/** Штатная кнопка «New Session» в панели сессий: её нажимает новая кнопка. */
const NEW_SESSION_SELECTOR = "[class$='_newSession']"

/** Диалог настроек: модальная панель с лентой разделов. */
const SETTINGS_DIALOG_SELECTOR = "[role='dialog'][aria-modal='true']"
