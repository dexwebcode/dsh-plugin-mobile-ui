// 05-styles/06-composer-font.js — шрифт composer 16px против зума при фокусе.
const STYLE_COMPOSER_FONT = `@media (max-width: 1023px) {
    /* iOS увеличивает страницу, когда фокус попадает в поле с шрифтом меньше
       16px: официальный composer набран 14px. Поднимаем до 16px — масштаб
       остаётся 1. */
    [class$='_composerSeat'] {
      font-size: 16px !important;
    }
    [class$='_input'],
    [class$='_input'] p {
      font-size: 16px !important;
    }
  }`
