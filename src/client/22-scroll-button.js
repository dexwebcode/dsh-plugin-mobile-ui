// 22-scroll-button.js — круглая кнопка «к последнему сообщению» над полем ввода.

/**
 * Держать кнопку «вниз, к последнему сообщению» на месте.
 *
 * Harness рисует её слот (`…_toBottomSlot`) как `position: sticky` с отступом от
 * низа контейнера прокрутки. На телефоне этот контейнер сам прокручивается под
 * мобильной раскладкой, и кнопка едет вместе с перепиской: то уползает вверх
 * вместе с текстом, то оказывается за краем экрана. По замыслу она должна
 * стоять на одном месте — над полем ввода, — поэтому слот фиксируется стилями
 * слоя, а здесь измеряется единственное, чего CSS знать не может: сколько от
 * низа экрана до верха поля ввода.
 *
 * Мерим, а не берём из стилей harness: высота поля меняется вместе с текстом в
 * нём, с переносом строк и с клавиатурой. Расстояние считается по нижней границе
 * раскладки (`innerHeight`) — тогда при открытой клавиатуре, когда кадр слоя уже
 * укорочен до видимой области, кнопка остаётся над полем, а не за клавиатурой.
 *
 * Значение уходит в переменную на корне документа, поэтому перерисовка кнопки
 * harness ничего не теряет: правило в стилях подхватывает её само.
 */
function installScrollButton() {
  if (!isNarrow()) return () => {}

  const root = document.documentElement
  /** Последнее записанное значение: лишних записей в стиль не делаем. */
  let written = 0

  const measure = () => {
    const seat = document.querySelector(COMPOSER_SEAT_SELECTOR)
    if (seat === null) {
      if (written !== 0) {
        written = 0
        root.style.removeProperty(COMPOSER_GAP_VAR)
      }
      return
    }
    const rect = seat.getBoundingClientRect()
    // Ноль — поле ещё не разложено (идёт загрузка сессии): держим прошлое.
    if (rect.height <= 0) return
    const gap = Math.round(window.innerHeight - rect.top)
    if (gap === written || gap < 0) return
    written = gap
    root.style.setProperty(COMPOSER_GAP_VAR, `${gap}px`)
  }

  measure()
  // Высота поля меняется от текста и от клавиатуры, а не только от ширины
  // экрана, поэтому мало слушать `resize`: опрос раз в полсекунды дешевле
  // наблюдателя за всем деревом чата.
  const timer = window.setInterval(measure, 500)
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)

  return () => {
    clearInterval(timer)
    window.removeEventListener('resize', measure)
    window.removeEventListener('orientationchange', measure)
    root.style.removeProperty(COMPOSER_GAP_VAR)
  }
}
