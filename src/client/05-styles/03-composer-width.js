// 05-styles/03-composer-width.js — карточка ввода во всю ширину экрана.
const STYLE_COMPOSER_WIDTH = `@media (max-width: 1023px) {
    [class$='_scrollBody'] {
      /* Официальная раскладка держит scrollbar-gutter: stable — место под полосу
         прокрутки зарезервировано всегда, и карточка ввода не дотягивается до
         правого края. auto оставляет место только под настоящую полосу. */
      scrollbar-gutter: auto !important;
      margin-right: 0 !important;
    }
    [class$='_composerSeat'] {
      /* auto-margin прижимает карточку к низу: и в hero-фазе (где официальная
         раскладка центрирует содержимое), и в переписке. Именно auto-margin, а
         не justify-content: flex-end — тот при переполнении делает верх длинной
         переписки недоступным. */
      margin-top: auto !important;
      width: 100% !important;
      max-width: 100% !important;
      left: 0 !important;
      right: 0 !important;
      box-sizing: border-box !important;
      /* Карточка ввода липла к нижнему краю экрана: оставляем 15px, чтобы её
         низ не упирался в край и палец не задевал системную полосу жестов. */
      padding-bottom: 15px !important;
    }
    [class$='_composerHero'] {
      align-self: stretch !important;
      width: 100% !important;
      max-width: 100% !important;
      /* Без border-box padding прибавляется к width: 100%, и карточка
         вылезает за экран ровно на сумму боковых отступов. */
      box-sizing: border-box !important;
      padding: 0 0 10px !important;
    }
    /* Внутренние поля карточки в hero-фазе: официальные 24px под свечение
       на телефоне съедают четверть ширины. Сводим их к тем же 16px от края
       экрана, что и у карточки в переписке. */
    [class$='_composerHero'] > [class$='_root'] {
      padding-left: 16px !important;
      padding-right: 16px !important;
    }
  }`
