// 05-styles/09-header-status.js — белая шапка, плашка статуса и её анимация.
const STYLE_HEADER_STATUS = `@media (max-width: 1023px) {
    /* Шапка: белая верхняя панель. Слева — чёрный кит (кнопка меню), по центру —
       плашка с текущим статусом. Штатные название и счётчик задач из строки
       убираем: на 390px они делят место с кнопками, а статус целиком переезжает
       в слот по центру. */
    header[class*='_header'] {
      position: relative !important;
      background: #fff !important;
    }
    [class$='_crumbs'],
    [class$='_headerActions'] {
      display: none !important;
    }
    /* Кнопки строки прижимаем вправо: левый сосед занят китом. */
    [class$='_titleRow'] {
      justify-content: flex-end !important;
    }
    .${STATUS_CLASS} {
      position: absolute;
      left: 50%;
      top: 11px;
      /* Ровно по центру шапки, независимо от ширины кнопок по краям. */
      transform: translateX(-50%);
      height: 28px;
      /* Этап бывает длинным («Deep diving for 10m 58s») — ширину держим той,
         что осталась между китом слева и кнопками справа. */
      max-width: min(200px, calc(100vw - 190px));
      display: grid;
      align-items: center;
      justify-items: center;
      /* Слот ничего не перехватывает: это подпись, а не кнопка. */
      pointer-events: none;
      z-index: 2;
    }
    .${STATUS_CLASS} > span {
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .${STATUS_CLASS}-run {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      max-width: 100%;
      font-size: 13px;
      font-weight: 500;
      color: var(--dsw-alias-label-secondary, #61666b);
    }
    /* Текст этапа обрезается многоточием. */
    .${STATUS_CLASS}-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }`
