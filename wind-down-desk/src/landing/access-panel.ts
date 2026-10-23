/**
 * 23 Oct — the landing's Accessibility button (Best Accessibility Forward Experience): three switches in a native
 * dialog — select by looking, high contrast, larger text. The same settings are spoken in the headset ("look to
 * select", "high contrast", "bigger text"); both write services.access, so the desk follows at once.
 * The settings also apply to this 2D page (body classes a11y-contrast / a11y-large).
 */
import type { AccessPrefs } from '../logic/access.ts';
import { services } from '../services.ts';
import { track } from '../visits.ts';

const SETTING: Record<keyof AccessPrefs, string> = { gazeSelect: 'gaze-select', contrast: 'contrast', largeText: 'large-text' };

function applyPage(prefs: AccessPrefs): void {
  document.body.classList.toggle('a11y-contrast', prefs.contrast);
  document.body.classList.toggle('a11y-large', prefs.largeText);
}

export function mountAccessPanel(): void {
  const open = document.getElementById('access-open');
  const dialog = document.getElementById('access') as HTMLDialogElement | null;
  applyPage(services.access.get());
  services.access.onChange(applyPage);
  if (open == null || dialog == null) return;
  const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[data-access]'));
  const sync = (prefs: AccessPrefs) => {
    for (const input of inputs) input.checked = prefs[input.dataset.access as keyof AccessPrefs] === true;
  };
  services.access.onChange(sync);
  for (const input of inputs) {
    input.addEventListener('change', () => {
      const key = input.dataset.access as keyof AccessPrefs;
      services.access.set({ [key]: input.checked });
      track('access', { setting: `${SETTING[key]}:${input.checked ? 'on' : 'off'}`, via: 'button' });
    });
  }
  open.addEventListener('click', () => {
    sync(services.access.get());
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
}
