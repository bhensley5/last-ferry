import * as T from 'three';

export const bossMoves = {
  antlerSweep: {name:'Ember antlers',answer:'Vault the sweeping antlers',duration:.95},
  broadside: { name: 'Anchor line', answer: 'Sidestep or parry', duration: .46 },
  pincers: { name: 'Twin wakes', answer: 'Stay between the lines', duration: .70 },
  breaker: { name: 'Breaker wave', answer: 'Jump the ring', duration: 1.38 },
  bellfall: { name: 'Falling bells', answer: 'Leave the circles', duration: .36 },
};

const reach = 7.4, lineWidth = .82, bellRadius = 1.38;
const warning = 0xf4ad53, impact = 0xf27654;

function mesh(parent, geometry, color, opacity = 1) {
  const material = new T.MeshBasicMaterial({color, transparent:true, opacity, side:T.DoubleSide, depthWrite:false});
  const shape = new T.Mesh(geometry, material);
  shape.renderOrder = 3;
  parent.add(shape);
  return shape;
}

function ring(parent, x, z, radius, color) {
  const edge = mesh(parent, new T.RingGeometry(.91, 1, 64), color);
  edge.rotation.x = -Math.PI/2;
  edge.position.set(x, .04, z);
  edge.scale.setScalar(radius);
  return edge;
}

// All warnings and hit tests share the same deck-relative footprint. A moving
// platform carries the warning with it; moving the traveler never retargets it.
export class BossAttack {
  constructor(scene, deck, actor, player, move, windup) {
    this.root = new T.Group();
    scene.add(this.root);
    this.deck = deck;
    this.move = move;
    this.windup = windup;
    this.elapsed = 0;
    this.spent = false;
    this.offset = actor.group.position.clone().sub(deck.group.position);
    this.offset.y = .055;
    this.root.position.copy(deck.group.position).add(this.offset);
    const dx = player.position.x - actor.group.position.x, dz = player.position.z - actor.group.position.z;
    this.heading = Math.hypot(dx,dz) > .1 ? Math.atan2(dx,dz) : actor.group.rotation.y;
    this.root.rotation.y = this.heading;
    this.local = new T.Vector3();
    this.marks = [];
    if (move === 'broadside' || move === 'pincers') {
      const centers=move==='pincers' ? [-1.76,1.76] : [0];
      for (const x of centers) {
        const lane=mesh(this.root,new T.PlaneGeometry(lineWidth*2,reach),warning,.28);
        lane.rotation.x=-Math.PI/2;
        lane.position.set(x,0,reach/2);
        const head=mesh(this.root,new T.OctahedronGeometry(.32),impact);
        head.position.set(x,.72,0);
        head.scale.z=2.3;
        this.marks.push({x,lane,head});
      }
    } else if (move==='antlerSweep') {
      const fan=mesh(this.root,new T.CircleGeometry(reach,48,Math.PI*.15,Math.PI*.7),warning,.17);
      fan.rotation.x=Math.PI/2;
      this.sweep=new T.Group();this.root.add(this.sweep);
      const blade=mesh(this.sweep,new T.BoxGeometry(.21,.22,reach),impact);
      blade.position.set(0,.43,reach/2);
      for(let i=1;i<=4;i++){
        const tine=mesh(this.sweep,new T.ConeGeometry(.14,.65,5),warning);
        tine.position.set(0,.73,reach*i/5);tine.rotation.z=-.42;
      }
    } else if (move === 'breaker') {
      this.outer = ring(this.root,0,0,reach,warning);
      this.outer.material.opacity = .42;
      this.wave = ring(this.root,0,0,.55,warning);
    } else {
      const aimed = Math.min(reach,Math.hypot(dx,dz));
      for (const [x,z] of [[0,aimed],[-2.5,aimed-1.5],[2.5,aimed-1.5]]) {
        const edge = ring(this.root,x,z,bellRadius,warning);
        const bell = mesh(this.root,new T.LatheGeometry([
          new T.Vector2(.08,.68),new T.Vector2(.28,.54),new T.Vector2(.36,.15),
          new T.Vector2(.50,0),new T.Vector2(.47,-.08),new T.Vector2(.34,-.05),
        ],16),warning);
        bell.position.set(x,3.3,z);
        this.marks.push({x,z,edge,bell});
      }
    }
  }

  update(dt, player) {
    this.elapsed += dt;
    this.root.position.copy(this.deck.group.position).add(this.offset);
    const progress = T.MathUtils.clamp((this.elapsed-this.windup)/bossMoves[this.move].duration,0,1);
    const tell = Math.min(1,this.elapsed/this.windup);
    const live = this.elapsed >= this.windup;
    // Undo the heading to test the exact line/rings drawn above.
    this.root.updateWorldMatrix(true,false);
    const p = this.root.worldToLocal(this.local.copy(player.position));
    let contact = false;
    if (this.move === 'broadside' || this.move === 'pincers') {
      const front=reach*progress;
      for(const {x,lane,head} of this.marks) {
        lane.material.opacity=live ? .42*(1-progress) : .15+.22*tell;
        head.position.z=front;
        head.rotation.z=this.elapsed*7;
        if(Math.abs(p.x-x)<=lineWidth && p.z>=-.3 && Math.abs(p.z-front)<=.72 && p.y<1.75)contact=true;
      }
    } else if(this.move==='antlerSweep'){
      const angle=(progress-.5)*Math.PI*.7;
      this.sweep.rotation.y=angle;
      const side=p.x*Math.cos(angle)-p.z*Math.sin(angle);
      const along=p.z*Math.cos(angle)+p.x*Math.sin(angle);
      contact=along>=-.12 && along<=reach && Math.abs(side)<.4 && p.y<.83;
    } else if (this.move === 'breaker') {
      const radius = live ? .55+(reach-.55)*progress : .55+.24*Math.sin(tell*Math.PI*4);
      this.wave.scale.setScalar(radius);
      this.wave.material.color.setHex(live ? impact : warning);
      this.outer.visible = !live;
      const distance=Math.hypot(p.x,p.z);
      contact=(Math.abs(distance-radius)<.45 || (progress<.08 && distance<radius)) && p.y<.62;
    } else {
      for (const mark of this.marks) {
        mark.bell.position.y = live ? .05 : .05+3.2*(1-tell*tell*tell);
        mark.bell.rotation.z = live ? 0 : .15*Math.sin(this.elapsed*9);
        mark.edge.material.color.setHex(live ? impact : warning);
        mark.edge.material.opacity = live ? 1-progress : .65+.35*tell;
        if (Math.hypot(p.x-mark.x,p.z-mark.z) <= bellRadius && p.y < 4) contact = true;
      }
    }
    const hit = live && !this.spent && contact && p.y > -.6;
    if (hit) this.spent = true;
    return {hit, live, done:progress >= 1};
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse(node => {
      if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); }
    });
  }
}
