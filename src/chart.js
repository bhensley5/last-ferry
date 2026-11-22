export function chart(world, player, wish, title) {
  const canvas = document.querySelector('#map'),
    ctx = canvas.getContext('2d'),
    label = document.querySelector('#map-label');
  label.textContent='N ↑ · '+title;
  const dots = [];
  let hover = null,
    last = -1;
  function hit(event) {
    const box = canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left) * canvas.width) / box.width,
      y = ((event.clientY - box.top) * canvas.height) / box.height;
    return dots.findLast(
      (d) => Math.abs(x - d.x) <= Math.max(3, d.w / 2) && Math.abs(y - d.y) <= Math.max(3, d.h / 2),
    );
  }
  canvas.onpointermove = (e) => {
    hover = hit(e)?.id;
    const piece=world.get(hover);
    label.textContent = hover ? [piece?.routeName,hover.replaceAll('-', ' ')].filter(Boolean).join(' · ') : 'N ↑ · '+title;
  };
  canvas.onpointerleave = () => {
    hover = null;
    label.textContent = 'N ↑ · '+title;
  };
  canvas.onclick = (e) => {
    const d = hit(e);
    if (d) {
      wish.value = 'Move ' + d.id.replaceAll('-', ' ') + ' ';
      wish.focus();
    }
  };
  return (now, yaw, target) => {
    if (now - last < 95) return;
    last = now;
    dots.length = 0;
    const { width: w, height: h } = canvas;
    const entities = [...world.entities.values()].filter(e=>e.dressing!=='foothill');
    const xValues = entities.flatMap((e) => [
      e.group.position.x - e.size[0] / 2,
      e.group.position.x + e.size[0] / 2,
    ]);
    const zValues = entities.flatMap((e) => [
      e.group.position.z - e.size[1] / 2,
      e.group.position.z + e.size[1] / 2,
    ]);
    const left = Math.min(-13, ...xValues),
      right = Math.max(13, ...xValues),
      top = Math.min(-34, ...zValues),
      bottom = Math.max(9, ...zValues);
    const scale = Math.min((w - 20) / (right - left), (h - 10) / (bottom - top));
    const cx = w / 2 - ((left + right) * scale) / 2,
      cy = h / 2 - ((top + bottom) * scale) / 2;
    ctx.clearRect(0, 0, w, h);
    for (const e of entities) {
      const x = cx + e.group.position.x * scale,
        y = cy + e.group.position.z * scale,
        ew = e.size[0] * scale,
        eh = e.size[1] * scale;
      ctx.fillStyle =
        e.id === hover
          ? '#fff1c8'
          : e.kind === 'ferry'
            ? '#ffbd58'
            : e.kind === 'skiff'
              ? '#ed9579'
              : (e.routeColor || '#89a99b');
      ctx.fillRect(x - ew / 2, y - eh / 2, ew, eh);
      if(['lighthouse','windmill','garden'].includes(e.dressing)){
        ctx.fillStyle=e.dressing==='garden'?'#d59ea6':e.dressing==='lighthouse'?'#fbddaf':'#afcde2';
        ctx.beginPath();ctx.moveTo(x,y-3.5);ctx.lineTo(x+3,y);ctx.lineTo(x,y+3.5);ctx.lineTo(x-3,y);ctx.closePath();ctx.fill();
      }
      if(e.id===target){
        ctx.beginPath();ctx.arc(x,y,5+Math.sin(now*.004),0,Math.PI*2);
        ctx.strokeStyle='#ffcb69';ctx.lineWidth=2;ctx.stroke();
      }
      dots.push({ x, y, w: ew, h: eh, id: e.id });
    }
    ctx.save();
    ctx.translate(cx + player.position.x * scale, cy + player.position.z * scale);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fillStyle = '#fff4c6';
    ctx.fill();
    ctx.strokeStyle = '#683828';
    ctx.stroke();
    ctx.restore();
  };
}
