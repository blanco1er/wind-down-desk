/**
 * Agent memory, spoken side (24 Oct, pure, unit-tested): short answers to the lamp's own questions ("Did you call
 * the dentist?" → "done" / "not yet") and "forget everything". `n` is a normalized utterance (text.ts normalize).
 */

/** Answer to a yes / no question the lamp just asked; null when the sentence is something else. */
export function answerOf(n: string): 'yes' | 'no' | null {
  if (n.split(/\s+/u).length > 6) return null;
  if (/^(no|nope|nah|not yet|not really|not done|keep( it)?|later|not now|no not yet|i didnt|i did not|didnt)\b/u.test(n)) return 'no';
  if (/^(yes|yeah|yep|yup|sure|ok|okay|done|all done|its done|it is done|i did( it)?|did it|finished|forget|forget it)\b/u.test(n)) return 'yes';
  return null;
}

/** "Forget everything" (and close phrasings): erases every evening kept on this device, after one confirmation. */
export function isForgetCommand(n: string): boolean {
  if (n.split(/\s+/u).length > 6) return false;
  return /^(please )?(forget (everything|it all|all of it|all that|my evenings|me)|erase (everything|my memory|my data|my evenings)|delete (everything|my data|my evenings)|clear (my )?(memory|data|evenings))$/u.test(n);
}
