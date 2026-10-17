// 05-styles/01-frame.js — кадр на всю ширину и место для ссылки Relay.
const STYLE_FRAME = `@media (max-width: 1023px) {
    [class$='_frame'] {
      grid-template-columns: 100% !important;
      /* Когда клавиатура открыта, переменную ставит JS; иначе — 100%. */
      height: var(${FRAME_HEIGHT_VAR}, 100%) !important;
      overflow-x: hidden !important;
    }
    /* Ссылка Relay иначе налезает на поле ввода: уводим её вправо-вверх,
       левее штатной кнопки панелей. По высоте — под полосой статистики: та
       занимает самый верх экрана и иначе перекрывала бы пилюлю (видно в новом
       чате, где статистики ещё нет, а Relay остаётся в шапке). */
    #dsh-relay-link {
      top: calc(var(--dsh-mobile-dock-height, 26px) + 8px) !important;
      bottom: auto !important;
      right: 56px !important;
    }
  }`
