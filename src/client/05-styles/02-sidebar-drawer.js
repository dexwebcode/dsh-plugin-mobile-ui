// 05-styles/02-sidebar-drawer.js — выдвижная панель и её затемнение.
const STYLE_SIDEBAR_DRAWER = `@media (max-width: 1023px) {
    [class$='_sidebarCol'] {
      position: fixed !important;
      top: 0;
      bottom: 0;
      left: 0;
      /* Правый край панели проходит между кнопкой нового чата и «⋮»: справа
         видно «⋮» в углу, а «+» уже перекрыт. Расстояние от правого края экрана
         до «⋮» — 20px, кнопка «+» кончается за 60px, поэтому 56px попадает
         ровно в промежуток и не зависит от ширины экрана. */
      width: min(calc(100vw - 56px), 420px) !important;
      z-index: 60;
      transform: translateX(-105%);
      visibility: hidden;
      transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.26s;
    }
    /* Внутренняя колонка панели в harness зафиксирована на 280px: в широкой
       панели строки оставались бы узкими посреди пустого места. Боковые поля
       сведены к 2px вместо штатных 12px — строки стали на 10px шире и слева,
       и справа. */
    [class$='_sidebarCol'] [class*='_quietBars'] {
      width: 100% !important;
      padding-left: 2px !important;
      padding-right: 2px !important;
    }
    /* Всё, что ниже строки с логотипом, отступает от краёв панели на 20px:
       строки сессий и кнопки не липнут к краям широкой панели. Сама строка с
       китом остаётся во всю ширину — иначе он перестал бы совпадать по линии с
       вкладками в шапке. */
    [class$='_sidebarCol'] [class*='_quietBars'] > *:not([class*='_logoRow']) {
      margin-left: 20px !important;
      margin-right: 20px !important;
    }
    /* Атрибут присутствует, только когда панель свёрнута. */
    [class$='_frame']:not([data-sidebar-collapsed]) [class$='_sidebarCol'] {
      transform: none;
      visibility: visible;
      box-shadow: 0 12px 40px rgb(0 0 0 / 30%);
    }
    /* Верхняя строка панели — логотип DeepSeek Harness и кнопка сворачивания —
       стоит на 15px выше строки шапки: при открытии панели бренд оказывался
       заметно выше кита и плашки. Опускаем строку так, чтобы её центр совпал с
       центром кита (51px от верха экрана). */
    [class$='_sidebarCol'] [class$='_logoRow'] {
      margin-top: 15px !important;
      /* Левый край кита совпадает с левым краем «New Session»: у строки те же
         20px отступа, что и у содержимого панели. */
      padding-left: 20px !important;
      /* Заливка строки в harness белая, а сама панель — #f9fafb: вокруг логотипа
         читался белый квадрат. Строка не sticky (position: static), список
         сессий скроллится ниже, поэтому фон не нужен вовсе. */
      background: transparent !important;
    }
    /* Кнопка сворачивания сдвинута влево на те же 20px, что и строки ниже:
       её правый край совпадает с правым краем «New Session». */
    [class$='_sidebarCol'] [class$='_logoRow'] [class*='_toggle'] {
      margin-right: 20px !important;
    }
    /* Затемнение включается ТОЛЬКО по состоянию, которое посчитал JS: если
       панель на самом деле не выехала, экран не темнеет и не блокируется. */
    [${PANEL_ATTR}='open'] .${BACKDROP_CLASS} {
      opacity: 1;
      /* Затемнение само ловит тап. Иначе нажатие проходит на содержимое под
         ним, и один тап успевал и закрыть панель, и нажать кнопку, которую
         человек не видел. */
      pointer-events: auto;
    }
  }`
