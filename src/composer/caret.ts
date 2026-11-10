/** Posición en pantalla del carácter `index` de un textarea (para selecciones con teclado). */
export function caretPoint(ta: HTMLTextAreaElement, index: number) {
  const cs = getComputedStyle(ta);
  const div = document.createElement("div");
  const props = [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
  ] as const;
  for (const p of props) div.style[p] = cs[p];
  Object.assign(div.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    top: "0",
    left: "-9999px",
    borderStyle: "solid",
  });
  div.textContent = ta.value.slice(0, index);
  const span = document.createElement("span");
  span.textContent = "\u200b";
  div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const point = {
    x: r.left + span.offsetLeft,
    y: r.top + span.offsetTop - ta.scrollTop,
  };
  div.remove();
  return point;
}

/**
 * Desplaza el contenedor con scroll más cercano para que el carácter `index` quede a la vista.
 * El textarea crece con el texto, así que quien hace scroll es el modal o la página.
 */
export function revealCaret(ta: HTMLTextAreaElement, index: number) {
  let box: HTMLElement | null = ta.parentElement;
  while (box) {
    const { overflowY } = getComputedStyle(box);
    if (/(auto|scroll)/.test(overflowY) && box.scrollHeight > box.clientHeight)
      break;
    box = box.parentElement;
  }
  const view = box
    ? box.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };
  const line = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const margin = line * 2;
  const { y } = caretPoint(ta, index);
  let dy = 0;
  if (y < view.top + margin) dy = y - view.top - margin;
  else if (y + line > view.bottom - margin)
    dy = y + line - view.bottom + margin;
  if (!dy) return;
  if (box) box.scrollBy({ top: dy });
  else window.scrollBy({ top: dy });
}
