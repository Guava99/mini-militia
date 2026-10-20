// Tiny DOM helpers shared by the HTML UI layers.

/** Create an element with a class, optionally inside a parent. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.append(e);
  return e;
}

/** Change text only when it differs: touching the page every frame for nothing costs battery. */
export function setText(e: HTMLElement, s: string) {
  if (e.textContent !== s) e.textContent = s;
}

/** Set a 0..1 bar fill with a GPU-friendly transform, skipping changes too small to see. */
export function setFill(e: HTMLElement, f: number) {
  const v = Math.round(Math.max(0, Math.min(1, f)) * 200) / 200;
  if (e.dataset.f === String(v)) return;
  e.dataset.f = String(v);
  e.style.transform = `scaleX(${v})`;
}
