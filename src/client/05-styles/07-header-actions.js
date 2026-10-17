// 05-styles/07-header-actions.js — Relay и «папка» прячутся из шапки телефона.
const STYLE_HEADER_ACTIONS = `@media (max-width: 1023px) {
    /* Плавающая пилюля Relay на телефоне не нужна нигде: она висит поверх шапки,
       налезает на кнопки (ширина 70px — прямо на «⋮» и на «Open in File
       Explorer») и на ленту разделов в настройках. В чате её роль выполняет
       пункт меню «⋮», поэтому пилюля прячется в любом состоянии — и в новой
       сессии тоже, где «⋮» ещё нет.

       Ищем в body, а не в кадре: ссылку Relay вешает на body отдельный плагин,
       внутри кадра её нет. */
    #dsh-relay-link {
      display: none !important;
    }
    /* Кнопка «открыть в проводнике» (сдвоенная: папка + шеврон) целиком:
       одиночный шеврон без папки выглядел бы обрубком. */
    [class$='_menuAnchor']:has([aria-label='Open in File Explorer']) {
      display: none !important;
    }
    /* Правая панель на телефоне не нужна: она открывается за краем экрана и
       ничего не показывает, а её кнопка выглядывала из-за открытого меню — по
       ней легко было попасть вместо «свернуть». Прячем всегда. */
    [data-sidebar-right-expand] {
      display: none !important;
    }
    /* Вкладки Chat / Trajectory: отступ слева 5px от левого края шапки — чуть
       правее кита, чтобы «Chat» не липла к кнопке-логотипу. */
    [class$='_header'] [class$='_tabs'] {
      padding-left: 5px !important;
    }
    /* Новый чат — крупнее, «три точки» — чуть крупнее штатных 28px. Обе кнопки
       поднимаются на 3px: строка шапки высотой 30px, и высокие кнопки без сдвига
       вставали по её верхнему краю — центры уезжали на 54px вместо общих 51px
       (по ним выровнены кит и плашка). */
    .${NEW_CHAT_BUTTON_CLASS} {
      width: 36px !important;
      height: 36px !important;
      transform: translateY(-3px);
    }
    .${NEW_CHAT_BUTTON_CLASS} svg {
      width: 20px !important;
      height: 20px !important;
    }
    [aria-label='More actions'] {
      width: 32px !important;
      height: 32px !important;
      transform: translateY(-3px);
    }
    [aria-label='More actions'] svg {
      width: 17px !important;
      height: 17px !important;
    }
  }`
