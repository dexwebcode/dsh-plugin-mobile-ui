// 05-styles/08-backdrop.js — затемнение под панелью.
const STYLE_BACKDROP = `.${BACKDROP_CLASS} {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgb(0 0 0 / 35%);
    opacity: 0;
    /* По умолчанию нажатия проходят насквозь: затемнение — только картинка,
       пока панель закрыта. Когда панель на экране, правило в
       05-styles/02-sidebar-drawer.js включает перехват. */
    pointer-events: none;
    transition: opacity 0.26s ease;
  }`
