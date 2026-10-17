// 05-styles/19-settings-screen.js — настройки на телефоне во весь экран.
const STYLE_SETTINGS_SCREEN = `@media (max-width: 1023px) {
    /* Диалог настроек на десктопе — панель 342px с колонкой разделов слева:
       на телефоне она оставляла содержимому 154px, и всё сжималось в узкую
       колонку с переносами и обрезками. Здесь диалог занимает экран целиком,
       разделы едут горизонтальной лентой сверху, содержимое получает всю
       ширину и свой скролл. */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) {
      position: fixed !important;
      inset: 0 !important;
      width: 100% !important;
      max-width: none !important;
      height: 100% !important;
      max-height: none !important;
      margin: 0 !important;
      border-radius: 0 !important;
      flex-direction: column !important;
      overflow: hidden !important;
    }
    /* Шапка разделов: заголовок и лента пунктов во всю ширину. */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > nav[class$='_nav'] {
      flex: none !important;
      width: 100% !important;
      max-width: none !important;
      padding: 12px 16px 0 !important;
      gap: 8px !important;
    }
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > nav[class$='_nav'] [class$='_navTitle'] {
      width: 100% !important;
      padding: 0 !important;
    }
    /* Пункты разделов — в строку, с прокруткой по горизонтали. Класс проверяем
       вхождением: у активного пункта к имени класса добавляется «_active». */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > nav[class$='_nav'] [class$='_navList'] {
      flex-direction: row !important;
      overflow-x: auto !important;
      overflow-y: hidden !important;
      gap: 6px !important;
      padding-bottom: 10px !important;
      scrollbar-width: none;
    }
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > nav[class$='_nav'] [class*='_navCell'] {
      flex: none !important;
      width: auto !important;
      white-space: nowrap;
    }
    /* Содержимое — на всю ширину; шапка с действиями переносится, если тесно. */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > [class$='_content'] {
      flex: 1 1 auto !important;
      width: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
    }
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > [class$='_content'] > [class$='_header'] {
      flex-wrap: wrap !important;
      padding: 10px 16px 4px !important;
      gap: 8px !important;
    }
    /* Крестик закрытия — в правом верхнем углу, на одной линии с «Settings».
       Штатно он живёт в шапке содержимого, под лентой разделов: на телефоне это
       далеко от угла, а привычное место закрытия — именно угол. */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > [class$='_content'] > [class$='_header'] > [class$='_close'] {
      position: fixed !important;
      top: 10px !important;
      right: 16px !important;
      z-index: 3;
    }
    /* Список настроек: поля по краям экрана, а не десктопные 24px. */
    [role='dialog'][aria-modal='true']:has(> nav[class$='_nav']) > [class$='_content'] > [class$='_options'] {
      padding: 8px 16px 24px !important;
    }
  }`
