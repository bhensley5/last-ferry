// Standalone editor only; linked games send every wish to the opening session.
const axes = { east: [0, 1], west: [0, -1], north: [2, -1], south: [2, 1], up: [1, 1], down: [1, -1] };
export function localEdit(request, brief) {
  const words = request
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/-/g, ' ')
    .replace(/^(please )/, '')
    .trim();
  const pieces = brief.entities;
  function piece(name) {
    name = name.replace(/^(the |my )/, '').trim();
    if (['platform', 'current platform', 'platform under me'].includes(name))
      return pieces.find((e) => e.id === brief.player.footing);
    return (
      pieces.find((e) => e.id.replaceAll('-', ' ') === name) ||
      (name === 'ferry' && pieces.find((e) => e.kind === 'ferry')) ||
      (name === 'bridge' && pieces.find((e) => e.id.endsWith('bridge')))
    );
  }
  const measure = '(\\d+(?:\\.\\d+)?)\\s*(?:m(?:eters?|etres?)?)?';
  const direction = '(north|south|east|west|up|down)';
  const finish=words.match(/^(?:paint|repaint) (.+?) (red|blue|green|gold|jade|white|black|purple|teal|#[a-f0-9]{6})$/);
  if(finish && piece(finish[1])){
    const paints={red:'#b64138',blue:'#416998',green:'#53815c',gold:'#d2a046',jade:'#408a79',white:'#e5dfd1',black:'#302e33',purple:'#825b94',teal:'#397f88'};
    return [{op:'finish',id:piece(finish[1]).id,paint:paints[finish[2]] || finish[2]}];
  }
  const turn=words.match(/^rotate (.+?)(?: by)? (90|180|270)(?: degrees)?$/);
  if(turn && piece(turn[1])){const e=piece(turn[1]);return [{op:'finish',id:e.id,turn:((e.turn||0)+Number(turn[2]))%360}];}
  if(/^(?:make it foggy|add fog)$/.test(words))return [{op:'weather',fog:.85}];
  if(/^(?:clear the fog|remove fog)$/.test(words))return [{op:'weather',fog:0}];
  const daylight=words.match(/^(?:(?:make it|change (?:it|the time) to|set (?:the )?time to) )?(sunrise|dawn|daytime|day|noon|sunset|dusk|night|nighttime)$/);
  if(daylight){const t=({dawn:'sunrise',daytime:'day',noon:'day',dusk:'sunset',nighttime:'night'})[daylight[1]] || daylight[1];return [{op:'weather',time:t}];}
  if(/^(?:make it rain|start the rain)$/.test(words))return [{op:'weather',rain:.8}];
  if(/^(?:stop the rain|clear the rain)$/.test(words))return [{op:'weather',rain:0}];
  const tide=words.match(/^(raise|lower) the tide(?: by)? (\d+(?:\.\d+)?)\s*(?:m|meters?)?$/);
  if(tide)return [{op:'weather',tide:(brief.weather.tide||0)+Number(tide[2])*(tide[1]==='raise'?1:-1)}];
  const lights=words.match(/^(?:turn|switch) (?:the |harbor )?lights (on|off)$/) || words.match(/^(?:turn|switch) (on|off) (?:the |harbor )?lights$/);
  if(lights)return [{op:'weather',lights:lights[1]==='on'}];
  if(/^(?:calm the (?:water|waves)|stop the waves)$/.test(words))return [{op:'weather',waves:0}];
  if(/^(?:make|add) (?:some )?waves$/.test(words))return [{op:'weather',waves:.8}];
  const swell=words.match(new RegExp('^set (?:the )?waves to '+measure+'$'));
  if(swell)return [{op:'weather',waves:Number(swell[1])}];
  const remove=words.match(/^remove (.+)$/);
  if(remove && piece(remove[1]))return [{op:'removePiece',id:piece(remove[1]).id}];
  const create=words.match(/^(?:make|build|add) (?:a |an )?(?:new )?(platform|wall|skiff|bridge|ferry|garden|lighthouse|windmill|teahouse|market)(?: in front of me)?$/);
  if(create && !(create[1]==='bridge' && !words.includes('new') && !words.includes('in front'))){
    const kind=create[1], [x,y,z]=brief.player.position, angle=brief.player.facing;
    let n=1;while(pieces.some(e=>e.id===kind+'-'+n))n++;
    const wall=kind==='wall';
    return [{op:'build',kind,id:kind+'-'+n,at:[x+Math.sin(angle)*3.5,y+(wall?2:.45),z+Math.cos(angle)*3.5],size:wall?[3,.65]:kind==='bridge'?[2,5]:['skiff','platform','ferry'].includes(kind)?[3,3]:[6,6],...(wall?{height:2}:{})}];
  }
  const stop = words.match(/^(?:stop|park) (.+)$/);
  if (stop && piece(stop[1])) return [{ op: 'stop', id: piece(stop[1]).id }];
  const shuttle = words.match(
    new RegExp('^(?:shuttle|ferry) (.+?) ' + direction + ' ' + measure + '(?: and back)?$'),
  );
  if (shuttle && piece(shuttle[1])) {
    const e = piece(shuttle[1]),
      to = [...e.position],
      [axis, sign] = axes[shuttle[2]];
    to[axis] += sign * Number(shuttle[3]);
    return [{ op: 'shuttle', id: e.id, to, speed: 1.6 }];
  }
  const metricFirst = words.match(new RegExp('^(?:move|shift|slide) (.+?) ' + measure + ' ' + direction + '$'));
  const move = metricFirst ? [metricFirst[0],metricFirst[1],metricFirst[3],metricFirst[2]]
    : words.match(new RegExp('^(?:move|shift|slide) (.+?) ' + direction + '(?: (?:by )?' + measure + ')?$'));
  if (move) {
    const e = piece(move[1]);
    if (!e) return null;
    const to = [...e.position],
      [axis, sign] = axes[move[2]];
    to[axis] += sign * Number(move[3] || 2);
    return [{ op: 'move', id: e.id, to }];
  }
  const alongside =
    words.match(/^(?:move|bring|put|park) (.+?) (?:next to|beside|alongside) (.+)$/) ||
    words.match(/^bring (.+?) (?:over )?to (me)$/);
  if (alongside) {
    const e = piece(alongside[1]);
    const dest = alongside[2] === 'me' ? piece('current platform') : piece(alongside[2]);
    if (!e || !dest || e === dest) return null;
    const to = [...dest.position];
    const dx = e.position[0] - to[0],
      dz = e.position[2] - to[2];
    const axis = Math.abs(dx) >= Math.abs(dz) ? 0 : 2,
      dimension = axis === 0 ? 0 : 1;
    to[axis] +=
      (Math.sign(axis === 0 ? dx : dz) || 1) * ((e.size[dimension] + dest.size[dimension]) / 2 + 0.45);
    return [{ op: 'move', id: e.id, to }];
  }
  const resize = words.match(
    /^(?:make|stretch) (.+?) (wider|longer|narrower|shorter|twice as wide|twice as long)$/,
  );
  if (resize) {
    const e = piece(resize[1]);
    if (!e) return null;
    const size = [...e.size];
    const dimension = /long|short/.test(resize[2]) ? 1 : 0;
    const shrinking = /narrow|short/.test(resize[2]);
    size[dimension] *= resize[2].startsWith('twice') ? 2 : shrinking ? 0.7 : 1.5;
    return [{ op: 'resize', id: e.id, size }];
  }
  const crossing = words.match(
    /^(?:make (?:those |the )?(?:boats|skiffs) (?:into )?a bridge|(?:make|build|form) (?:a |the )?(?:boat |skiff )?bridge)(?: (?:from|between) (.+?) (?:to|and) (.+))?$/,
  );
  if (crossing) {
    const start = crossing[1] ? piece(crossing[1]) : piece('quay') || piece('east pier');
    const end = crossing[2] ? piece(crossing[2]) : piece('ferry wharf') || piece('bell house');
    const boats = pieces.filter((e) => e.kind === 'skiff' && e !== start && e !== end);
    if (!start || !end || !boats.length) return null;
    // Interpolate between the facing edges, not the deck centers.
    const dx = end.position[0] - start.position[0],
      dz = end.position[2] - start.position[2];
    if (!dx && !dz) return null;
    const edge = (e) => Math.min(e.size[0] / (2 * Math.abs(dx)), e.size[1] / (2 * Math.abs(dz)), 0.48);
    const a = edge(start),
      b = 1 - edge(end);
    return boats.map((e, i) => {
      const t = a + ((b - a) * (i + 0.5)) / boats.length;
      return {
        op: 'move',
        id: e.id,
        to: [
          start.position[0] + dx * t,
          start.position[1] + (end.position[1] - start.position[1]) * t,
          start.position[2] + dz * t,
        ],
        duration: 1.35 + i * 0.25,
      };
    });
  }
  return null;
}
