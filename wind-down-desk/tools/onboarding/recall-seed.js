// Seeds "last night" for the recall check (run through tools/wdd-eval.mjs, then reload): 3 things let go,
// 2 kept for tomorrow. Dates follow src/logic/memory.ts eveningDate (an evening runs until 05:00).
for (const k of Object.keys(localStorage)) if (/^(wind-down-desk|wdd\.|iwsdk_|@immersive-web)/.test(k) && k !== 'wdd.internal') localStorage.removeItem(k);
const ev = new Date(Date.now() - 5 * 3600e3 - 86400e3);
const p = (n) => String(n).padStart(2, '0');
const date = `${ev.getFullYear()}-${p(ev.getMonth() + 1)}-${p(ev.getDate())}`;
localStorage.setItem('wind-down-desk.memory.v1', JSON.stringify({
  version: 1,
  nights: [{ date, tomorrow: ['Call the dentist', 'Reply to the landlord'], later: [], letGo: ['That comment', 'The slow reply', 'Being late'], plan: [], planKept: false, rituals: ['unload'] }],
  stars: [{ text: 'That comment', date, seed: 11 }, { text: 'The slow reply', date, seed: 977 }, { text: 'Being late', date, seed: 40211 }],
  laterPool: [], morningSeen: date, done: [],
}));
localStorage.setItem('wdd.style', 'talk');
return date;
