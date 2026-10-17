// 05-styles/12-menu-button.js — кнопка-кит в шапке телефона.
const STYLE_MENU_BUTTON = `@media (max-width: 1023px) {
    .${BUTTON_CLASS} {
      display: flex;
      /* Кит живёт прямо в шапке, слева: не плавает поверх контента, а занимает
         место в строке с плашкой статуса и кнопками справа.

         Верх — по строке с названием, а не по центру всей шапки: под строкой
         ещё лежат вкладки «Chat / Trajectory», и 50% ставили кита ниже кнопок
         справа. Строка начинается в 10px от верха шапки и высотой 30px, кит
         34px — значит 8px, и центры совпадают. */
      position: absolute !important;
      /* 20px, а не 10: кит встаёт по левому краю строки с названием — у шапки
         тот же отступ 20px слева. */
      left: 20px;
      top: 8px;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: none;
      /* Белая кнопка, чёрный кит — классический знак DeepSeek. */
      background: transparent;
      color: #000;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 0;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .${BUTTON_CLASS} svg {
      display: block;
      /* currentColor: цвет кита задаётся цветом текста кнопки. */
      color: #000;
      /* 25px вместо 30px: в шапке кит читался крупнее, чем нужно. */
      width: 25px;
      height: 25px;
    }
    .${BUTTON_CLASS}:active {
      background: rgb(0 0 0 / 6%);
    }
  }`
