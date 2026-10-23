export default async function run({ frame, page }) {
  const f = frame ?? page;
  return f.evaluate(() => {
    const v = window.__wdd.debug().visuals;
    let scene = v.root; while (scene.parent) scene = scene.parent;
    let all = 0, hiddenSub = 0, autoOff = 0;
    const big = [];
    const walk = (o, hidden) => {
      all++;
      if (hidden) hiddenSub++;
      if (o.matrixWorldAutoUpdate === false) autoOff++;
      for (const c of o.children) walk(c, hidden || !o.visible);
    };
    walk(scene, false);
    for (const c of scene.children) { let n = 0; c.traverse(() => n++); big.push([c.type + (c.name ? ':' + c.name : ''), n, c.visible]); }
    big.sort((a, b) => b[1] - a[1]);
    return { all, hiddenSub, autoOff, top: big.slice(0, 10) };
  });
}
