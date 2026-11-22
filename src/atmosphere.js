// Linear sky colors are shared with the water, sun, and distance haze.
import * as T from 'three';

const skies = {
  sunrise: {
    horizon: [1, 0.51, 0.34],
    top: [0.2, 0.38, 0.68],
    sun: [0.9, 0.22, -0.65],
    fog: 0xf0bfab,
    sea: 0x528e98,
    key: 0xffb181,
    strength: 2.3,
    fill: 1.7,
  },
  day: {
    horizon: [0.67, 0.86, 0.97],
    top: [0.075, 0.38, 0.75],
    sun: [-0.45, 0.92, -0.25],
    fog: 0xc5dfdf,
    sea: 0x298e99,
    key: 0xfff1cb,
    strength: 2.9,
    fill: 2.2,
  },
  sunset: {
    horizon: [0.83, 0.48, 0.38],
    top: [0.08, 0.18, 0.34],
    sun: [-0.34, 0.18, -1],
    fog: 0xceaba5,
    sea: 0x246a78,
    key: 0xffcf9d,
    strength: 2.25,
    fill: 2,
  },
  night: {
    horizon: [0.115, 0.14, 0.26],
    top: [0.009, 0.018, 0.069],
    sun: [0.32, 0.59, -0.85],
    fog: 0x545b80,
    sea: 0x193b57,
    key: 0xaecaff,
    strength: 1.22,
    fill: 1.22,
  },
};
export function atmosphere(scene, sky, water, sun, ambient, offset) {
  const uniforms = sky.material.uniforms;
  const points = [];
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * 32 - 16,
      y = Math.random() * 17,
      z = Math.random() * 32 - 16;
    points.push(x, y, z, x - 0.12, y + 0.5, z);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  const rain = new T.LineSegments(
    geo,
    new T.ShaderMaterial({
      uniforms: { clock: { value: 0 }, strength: { value: 0 }, wind: { value: 0 } },
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float anchor;uniform float clock,wind;void main(){vec3 p=position;
      p.y=mod(anchor-clock*13.,17.)+position.y-anchor;
      p.x=mod(position.x+.24*(position.y-anchor)+clock*wind*3.+16.,32.)-16.-.24*(position.y-anchor);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: 'uniform float strength;void main(){gl_FragColor=vec4(.71,.83,.89,strength*.55);}',
    }),
  );
  // Wrap whole drops together rather than stretching a line across the rain volume.
  const anchors = new Float32Array(points.length / 3);
  for (let i = 0; i < anchors.length; i += 2) anchors[i] = anchors[i + 1] = points[i * 3 + 1];
  geo.setAttribute('anchor', new T.BufferAttribute(anchors, 1));
  rain.frustumCulled = false;
  scene.add(rain);
  let last = '';
  return (w, player, time) => {
    const key = [w.time, w.fog, w.rain].join(':');
    if (key !== last) {
      const p = skies[w.time] || skies.sunset;
      uniforms.horizon.value.fromArray(p.horizon);
      uniforms.zenith.value.fromArray(p.top);
      uniforms.sunDir.value.fromArray(p.sun).normalize();
      uniforms.mist.value = w.fog;
      uniforms.night.value = Number(w.time === 'night');
      scene.fog.color.setHex(p.fog);
      scene.fog.density = (water.isWater ? .0012 + .020*w.fog*w.fog : .002 + w.fog*.026) + w.rain*.004;
      water.material.uniforms.glint.value.setRGB(...(w.time==='night'?[.14,.2,.31]:w.time==='day'?[.55,.58,.49]:[.73,.37,.17]));
      water.material.uniforms.deep.value.setHex(p.sea);
      if(water.isWater) {
        water.material.uniforms.deep.value.setHex(w.time==='night'?0x0c2637:w.time==='day'?0x20535b:0x193f47);
        water.material.uniforms.glint.value.setHex(p.key);
      }
      sun.color.setHex(p.key);
      sun.intensity = p.strength * (1 - w.rain * 0.38);
      ambient.intensity = p.fill;
      offset.copy(uniforms.sunDir.value).multiplyScalar(17);
      last = key;
    }
    rain.visible = w.rain > 0;
    if (rain.visible) {
      rain.position.copy(player);
      rain.material.uniforms.clock.value = time;
      rain.material.uniforms.wind.value = w.wind;
      rain.material.uniforms.strength.value = w.rain;
    }
  };
}
