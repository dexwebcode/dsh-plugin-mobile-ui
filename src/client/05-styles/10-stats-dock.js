// 05-styles/10-stats-dock.js — полоса статистики наверху и док очереди над вводом.
const STYLE_STATS_DOCK = `@media (max-width: 1023px) {
    /* Полоса статистики (шаги, скорость, токены, процент памяти) уезжает из
       подвала composer'а на самый верх экрана: внизу она отнимала место у
       карточки ввода, а вверху полоса пустовала.

       В том же подвале живёт ВТОРОЙ док — очередь запросов. Поднимать его
       нельзя: он должен стоять над полем ввода. Поэтому селектор skip-ает
       \`[data-queue-dock]\`, иначе очередь уезжала под полосу статистики.

       Высота берётся из переменной, которую ставит JS по факту замера: по ней
       же кадр уступает полосе место сверху. */
    [class$='_composerSeat'] [class$='_dock']:not([data-queue-dock]),
    [class$='_composerSeat'] [class*='_dock']:has([data-composer-stats]):not([data-queue-dock]) {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: max(26px, var(--dsh-mobile-dock-height, 26px)) !important;
      padding: 0 16px !important;
      background: var(--dsw-alias-bg-base, #fff) !important;
      /* Ниже панели (60) и затемнения (55): открытая панель накрывает полосу,
         а не наоборот. Выше всего, что лежит в потоке. */
      z-index: 50;
    }
    /* Док очереди остаётся над карточкой ввода. Свои ширина и отступы посчитаны
       под десктопную карточку с её боковыми полями — на телефоне карточка
       во всю ширину, поэтому ширина и поля те же 16px от края экрана. Отрицательный
       нижний отступ — как в штатном CSS: панель очереди примыкает к карточке
       снизу, а её скруглённый верх и общая рамка выглядят одним блоком. */
    [class$='_composerSeat'] [data-queue-dock] {
      position: static !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      height: auto !important;
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 0 calc(0px - var(--dsh-composer-stack-gap, 3px) - 3px) !important;
      padding: 0 16px !important;
      box-sizing: border-box !important;
      background: transparent !important;
      z-index: auto !important;
    }
    /* Пустая полоса для нового чата. Harness не рисует статистику, пока в
       сессии нет шагов, и верх страницы при переходе в новый чат пустел. Слой
       показывает такую же полосу с нулями: клон живой, если её уже видели,
       иначе запасной текст. */
    .${EMPTY_STATS_BAR_CLASS} {
      position: fixed;
      top: 0;
      /* По 10px от краёв экрана — те же поля, что ставит JS инлайново. */
      left: 10px;
      right: 10px;
      height: max(26px, var(--dsh-mobile-dock-height, 26px));
      box-sizing: border-box;
      border-radius: 10px;
      background: var(--dsw-alias-bg-base, #fff);
      /* Та же полоса, что и у живой статистики: ниже панели и затемнения. */
      z-index: 50;
    }
    /* У клона живой полосы свои flex, отступы и шрифты (родные классы harness),
       поэтому текстовая раскладка — только для запасного варианта. */
    .${EMPTY_STATS_CLASS} {
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 18px;
      overflow: hidden;
      white-space: nowrap;
      font-size: 12px;
      line-height: 20px;
      color: var(--dsw-alias-label-tertiary, #81858c);
      font-variant-numeric: tabular-nums;
    }
    .${EMPTY_STATS_CLASS} > span {
      flex: none;
    }
    /* Кадр уступает полосе место сверху: без этого она накрыла бы строку с
       названием чата и статусом. Минимум 26px — страховка от переменной,
       в которую однажды попало меньшее значение. */
    [class$='_frame'] {
      box-sizing: border-box !important;
      padding-top: max(26px, var(--dsh-mobile-dock-height, 26px)) !important;
    }
    /* Карточку ввода НЕ поднимаем. Раньше она сдвигалась вверх на высоту
       полосы (минус 5px), чтобы не «висеть» после того, как полоса ушла из
       потока. Но этот сдвиг накрывал нижнюю строку переписки — подпись
       «Deep diving for …» оказывалась за полем ввода. Теперь карточка стоит на
       своём месте, а полоса живёт отдельно вверху. */
  }`
