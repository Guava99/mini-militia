// Design tokens: the one place that defines the look of every HTML screen (HUD, touch controls, future menus).
// Sizes are multiples of one unit, --u, which grows with the screen's short side: about 11px on a phone held
// sideways, up to 16px on a desktop. So the same numbers look right on every screen from 16:9 to 20:9.
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-800-italic.css';
import './base.css';

export const color = {
  cyan: '#2de2e6',
  magenta: '#ff3d9a',
  amber: '#ffb02e',
  violet: '#8a6cff',
  cyanSoft: 'rgba(45, 226, 230, 0.22)',
  magentaSoft: 'rgba(255, 61, 154, 0.22)',
  amberSoft: 'rgba(255, 176, 46, 0.18)',
  ink: '#0c0a1f',
  text: '#f2f0ff',
  textDim: '#a9a3c9',
  panel: 'rgba(12, 10, 31, 0.62)',
  panelBorder: 'rgba(255, 255, 255, 0.14)',
  hp: '#ff5a5f',
  hpHigh: '#ff9a3c',
  good: '#4ade80',
  warn: '#ffb02e',
  bad: '#ff5a5f',
};

/** Font sizes, in units. */
export const font = { family: "'Poppins', system-ui, sans-serif", xs: 0.75, sm: 1, md: 1.3, lg: 2, xl: 3 };
/** Corner radii, in units. */
export const radius = { sm: 0.5, md: 0.9, lg: 1.4, pill: 99 };
/** Gaps and padding, in units. */
export const space = { xs: 0.3, sm: 0.6, md: 1, lg: 1.4, xl: 2 };

/** Size of one unit: 2.6% of the screen's short side, kept between 11px and 16px. */
export const UNIT_CSS = 'clamp(11px, 2.6vmin, 16px)';

let applied = false;

/** Publish the tokens as CSS variables (--cyan, --fs-md, --r-md, --sp-md, ...) so stylesheets share them. */
export function applyTokens() {
  if (applied) return;
  applied = true;
  const vars: string[] = [`--u: ${UNIT_CSS}`, `--font: ${font.family}`];
  const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const [k, v] of Object.entries(color)) vars.push(`--${kebab(k)}: ${v}`);
  for (const [k, v] of Object.entries(font)) if (typeof v === 'number') vars.push(`--fs-${k}: calc(var(--u) * ${v})`);
  for (const [k, v] of Object.entries(radius)) vars.push(`--r-${k}: calc(var(--u) * ${v})`);
  for (const [k, v] of Object.entries(space)) vars.push(`--sp-${k}: calc(var(--u) * ${v})`);
  const style = document.createElement('style');
  style.id = 'design-tokens';
  style.textContent = `:root { ${vars.join('; ')}; }`;
  document.head.append(style);
}
