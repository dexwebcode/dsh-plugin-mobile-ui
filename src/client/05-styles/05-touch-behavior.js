// 05-styles/05-touch-behavior.js — интерфейс не увеличивается от нажатий.
const STYLE_TOUCH_BEHAVIOR = `html {
    /* iOS и Android сами увеличивают текст в узкой колонке, если решат, что
       он мелкий. Интерфейс от этого «прыгает» после первого тапа. */
    -webkit-text-size-adjust: 100% !important;
    text-size-adjust: 100% !important;
  }
  html, body {
    /* Двойной тап по кнопке — не зум, а второй тап: без этого браузер
       масштабирует страницу и интерфейс «увеличивается». */
    touch-action: manipulation;
  }
  /* Серая вспышка поверх нажатого элемента читается как «интерфейс
     увеличился»; свою подсветку нажатия рисуем сами. */
  .${BUTTON_CLASS},
  [class$='_sessionRow'],
  [class$='_panelRow'],
  [class$='_iconButton'],
  [class$='_trigger'],
  [class$='_newSession'] {
    -webkit-tap-highlight-color: transparent;
  }`
