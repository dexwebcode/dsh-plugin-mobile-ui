// 05-styles/21-session-loading.js — полоса загрузки при переключении чата.
const STYLE_SESSION_LOADING = `@media (max-width: 1023px) {
    .${LOADING_CLASS} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 300;
      pointer-events: none;
      overflow: hidden;
      background: transparent;
    }
    /* Бегущая капсула: без растворения — сплошной цвет со скруглёнными
       концами. Едет вправо, возвращается назад и по дороге раздувается,
       а затем снова сжимается. */
    .${LOADING_CLASS} > span {
      position: absolute;
      top: 0;
      height: 100%;
      border-radius: 999px;
      /* Цвет фиксированный: переменная темы на этой сборке пустая, и полоса
         получалась почти чёрной — на тёмном фоне её не было видно. */
      background: #4d6bfe;
      box-shadow: 0 0 6px rgba(77, 107, 254, 0.45);
      animation: ${LOADING_CLASS}-travel 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes ${LOADING_CLASS}-travel {
      0% { left: 0%; width: 30%; }
      40% { left: 70%; width: 30%; }
      52% { left: 70%; width: 30%; }
      78% { left: 22%; width: 46%; }
      92% { left: 0%; width: 30%; }
      100% { left: 0%; width: 30%; }
    }
  }`
