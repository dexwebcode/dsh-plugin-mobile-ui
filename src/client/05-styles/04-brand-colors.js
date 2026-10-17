// 05-styles/04-brand-colors.js — бренд чёрным по белому.
const STYLE_BRAND_COLORS = `@media (max-width: 1023px) {
    [class$='_logoRow'],
    [class$='_railMark'] {
      background: #fff !important;
      color: #000 !important;
    }
    /* Красим только цвет: и кит, и слово набраны с fill="currentColor", и этого
       достаточно.

       Заливку и обводку потомкам не навязываем. В слове есть плашка HARNESS —
       чёрный прямоугольник с белыми буквами; fill: #000 закрашивал буквы вместе
       с плашкой, и в панели вместо бренда получался чёрный прямоугольник. */
    [class$='_logoRow'] *,
    [class$='_railMark'] * {
      color: #000 !important;
    }
  }`
