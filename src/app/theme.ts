/**
 * Light, dark, or match the system. The choice is saved per browser; with no
 * saved choice the page follows prefers-color-scheme. The inline script in
 * index.html applies a saved choice before first paint.
 */

type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'orbit:theme';

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable */
  }
}

export function initThemeSwitch(group: HTMLElement) {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('[data-theme-option]')];

  const sync = (choice: ThemeChoice) => {
    for (const b of buttons) {
      const on = b.dataset.themeOption === choice;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };

  const select = (choice: ThemeChoice, focus = false) => {
    apply(choice);
    sync(choice);
    if (focus) buttons.find((b) => b.dataset.themeOption === choice)?.focus();
  };

  group.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('[data-theme-option]');
    if (b) select(b.dataset.themeOption as ThemeChoice);
  });

  // Arrow keys move between options, as in any radio group.
  group.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(i + step + buttons.length) % buttons.length];
    select(next.dataset.themeOption as ThemeChoice, true);
  });

  sync(read());
}
