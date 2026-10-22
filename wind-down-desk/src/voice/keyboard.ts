/**
 * "Write…" without a microphone: a real text field takes the focus.
 * - On Meta Quest, focusing a page input during an immersive session brings up the system keyboard
 *   [NON VÉRIFIÉ on a headset: Quest Browser behaviour, to check on device].
 * - On a desktop (play-test), the play-test panel claims the request (`wdd:write`, preventDefault) and focuses its own
 *   field; otherwise this small field appears at the bottom of the page.
 * The text goes through the same path as a spoken sentence (`onText`).
 */
let field: HTMLInputElement | null = null;
let pending: ((text: string) => void) | null = null;

export function requestWrite(purpose: 'unload' | 'release', prompt: string, onText: (text: string) => void): void {
  const claimed = !window.dispatchEvent(new CustomEvent('wdd:write', { cancelable: true, detail: { purpose, prompt, onText } }));
  if (claimed) return;
  pending = onText;
  if (field == null) {
    field = document.createElement('input');
    field.type = 'text';
    field.autocomplete = 'off';
    field.enterKeyHint = 'done';
    field.setAttribute('aria-label', prompt);
    Object.assign(field.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      width: 'min(480px, calc(100vw - 32px))',
      zIndex: '100000',
      font: '500 16px system-ui, sans-serif',
      padding: '12px 16px',
      borderRadius: '16px',
      border: '1px solid rgba(255,244,230,.2)',
      background: 'rgba(28,23,19,.86)',
      color: '#fbf6ee',
    });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = field?.value.trim() ?? '';
        if (field != null) field.value = '';
        field?.blur();
        if (text.length > 0) pending?.(text);
      } else if (e.key === 'Escape') {
        field?.blur();
      }
    });
    field.addEventListener('blur', () => {
      if (field != null) field.style.display = 'none';
    });
    document.body.appendChild(field);
  }
  field.placeholder = prompt;
  field.style.display = 'block';
  field.focus();
}
