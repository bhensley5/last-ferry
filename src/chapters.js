// Trail chapters compile to the same editable pieces and encounters as a hand-built map.
export function chapterCatalog(files) {
  return Object.entries(files).filter(([,level])=>level.chapter)
    .map(([path,level])=>({id:path.split('/').pop().replace(/\.json$/,''),...level.chapter,level}))
    .sort((a,b)=>a.order-b.order);
}

function connect(from,to,approach=to.approach??{},prefix=to.id) {
  const dx=to.at[0]-from.at[0], dz=to.at[2]-from.at[2];
  if ((!dx && !dz) || (dx && dz)) throw new Error('Trail needs a cardinal bend before '+to.id);
  const axis=dx?0:2, side=axis===0?0:1, sign=Math.sign(dx||dz);
  const gap=approach.gap??0, width=approach.width??5.6;
  const start=from.at[axis]+sign*(from.size[side]/2+gap);
  const end=to.at[axis]-sign*(to.size[side]/2+gap);
  const length=(end-start)*sign;
  if(length<=0)throw new Error('Overlapping trail landmarks: '+to.id);
  if(approach.ride){
    const edge=(site,offset)=>site.at.map((v,i)=>i===axis?v+offset:v);
    const a=edge(from,sign*(from.size[side]/2+2.15)),b=edge(to,-sign*(to.size[side]/2+2.15));
    return [{id:prefix+'-lift',kind:'dock',dressing:approach.ride,at:a,size:[4.2,4.2],
      path:[a,b],depart:'board',trip:'loop',speed:approach.speed??2.8}];
  }
  const stones=approach.steps??0;
  const count=stones || Math.ceil(length/(approach.style==='ropeSpan'?76:38)), dy=to.at[1]-from.at[1];
  return Array.from({length:count},(_,i)=>{
    const at=[...from.at], distance=length/count;
    at[axis]=start+(i+.5)*sign*distance;
    const low=from.at[1]+dy*i/count, high=low+dy/count;
    if(stones){
      const slab=distance-(approach.jumpGap??1.7);
      if(slab<1)throw Error('Stepping stones too short: '+prefix);
      at[1]=(low+high)/2;
      at[axis===0?2:0]+=(i%2?1:-1)*.65;
      return {id:prefix+'-stone-'+(i+1),kind:'dock',at,size:dx?[slab,width]:[width,slab],dressing:'lotusStone',axis};
    }
    at[1]=Math.min(low,high)+(approach.raised??0);
    return {id:approach.pieceId && count===1?approach.pieceId:prefix+'-path-'+(i+1),kind:'dock',at,size:dx?[distance,width]:[width,distance],
      dressing:approach.style??'pilgrimRoad', grade:(dy/count)*sign,axis};
  });
}

function foothillPieces({columns,width,bands}) {
  return bands.flatMap(({north,south,height,cut},row)=>columns.flatMap((x,col)=>{
    const left=x-width/2,right=x+width/2;
    const intervals=cut ? [[left,Math.min(right,cut[0])],[Math.max(left,cut[1]),right]] : [[left,right]];
    return intervals.filter(([a,b])=>b>a).map(([a,b],i)=>({
      id:'foothill-'+(row+1)+'-'+(col+1)+(i?'-east':''),
      at:[(a+b)/2,height,(south+north)/2],size:[b-a,south-north],kind:'dock',dressing:'foothill'
    }));
  }));
}

export function expandChapter(source) {
  if(!source.trail)return source;
  const {trail,branches=[],foothills,roster={},entities=[],encounters=[],...level}=source;
  const pieces=[...entities], cast=[...encounters];
  if(foothills)pieces.push(...foothillPieces(foothills));
  const sites=new Map(),landings=new Map();
  function addSite(site){
    if(sites.has(site.id))throw Error('Duplicate trail site: '+site.id);
    sites.set(site.id,site);
    const landing={kind:'dock',id:site.id,at:site.at,size:site.size,dressing:site.dressing};
    landings.set(site.id,landing);pieces.push(landing);
    for(const {id,role,offset=[0,0]} of site.guards??[]){
      if(!roster[role])throw new Error('Unknown encounter role: '+role);
      cast.push({...structuredClone(roster[role]),id,arena:site.id,at:[site.at[0]+offset[0],site.at[1],site.at[2]+offset[1]]});
    }
  }
  for(const [index,site] of trail.entries()){
    if(index)pieces.push(...connect(trail[index-1],site));
    addSite(site);
  }
  for(const branch of branches){
    let prev=sites.get(branch.from);
    const end=sites.get(branch.to);
    if(!prev||!end)throw Error('Unknown branch junction: '+branch.id);
    const onward=trail[trail.findIndex(s=>s.id===branch.from)+1];
    if(onward && branch.via.length){
      const exits=landings.get(branch.from).trailExits??=[];
      const bearing=site=>Math.atan2(site.at[0]-prev.at[0],site.at[2]-prev.at[2]);
      if(!exits.length)exits.push({bearing:bearing(onward),color:'#d5ad69'});
      exits.push({bearing:bearing(branch.via[0]),color:branch.color});
    }
    const begin=pieces.length;
    for(const site of branch.via){
      pieces.push(...connect(prev,site));
      addSite(site);
      prev=site;
    }
    pieces.push(...connect(prev,end,branch.exit??{},branch.id+'-return'));
    for(const piece of pieces.slice(begin)){
      piece.routeName=branch.name;piece.routeColor=branch.color;
    }
  }
  return {...level,entities:pieces,encounters:cast};
}
