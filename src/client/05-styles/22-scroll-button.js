// 05-styles/22-scroll-button.js — круглая кнопка «к последнему сообщению» над полем ввода.
const STYLE_SCROLL_BUTTON = `@media (max-width: 1023px) {
    /* Harness держит кнопку в слоте со sticky-позиционированием, и на телефоне
       она ездит вместе с перепиской. Фиксируем слот: правый нижний угол с
       отступом от низа экрана до верха поля ввода (его измеряет
       22-scroll-button.js — высота поля зависит от текста и клавиатуры).
       z-index ниже затемнения (55) и панели (60): открытое меню перекрывает
       кнопку, а не наоборот. */
    [class*='_toBottomSlot'] {
      position: fixed !important;
      top: auto !important;
      bottom: calc(var(--dsh-mobile-composer-gap, 140px) + 12px) !important;
      left: auto !important;
      right: 16px !important;
      width: 34px !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 50 !important;
      /* Слот по-прежнему пропускает тапы: сама кнопка внутри уже ставит
         pointer-events: auto своими правилами. */
      pointer-events: none !important;
    }
  }`
