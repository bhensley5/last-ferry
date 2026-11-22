import * as T from 'three';
import { Water } from 'three/addons/objects/Water.js';

const images = import.meta.glob('./assets/market/*.webp', { eager: true, query: '?url', import: 'default' });
const loader = new T.TextureLoader();
function photograph(name, color = true) {
  const tex = loader.load(images['./assets/market/' + name + '.webp']);
  tex.wrapS = T.RepeatWrapping;
  if (color) tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export function pierMaterial() {
  const map = photograph('timber'), normalMap = photograph('timber-normal', false);
  for (const texture of [map,normalMap]) {
    texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = 8;
  }
  return new T.MeshStandardMaterial({map,normalMap,normalScale:new T.Vector2(.34,.34),roughness:.84,color:0xd3c5b3});
}

export function marketSky(sky,scene) {
  const mat = sky.material, u = mat.uniforms;
  sky.frustumCulled=false;
  // Remove camera translation for both the playing camera and Water's mirrored camera.
  mat.vertexShader=`varying vec3 p;void main(){
    p=position; vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);
    gl_Position=clip.xyww;
  }`;
  u.shorePhoto = {value:photograph('alpine-shore')};
  u.skyPhoto = {value:null};
  u.shoreLight = {value:new T.Color()};
  u.skyLight = {value:new T.Color()};
  mat.fragmentShader = `varying vec3 p;
    uniform sampler2D shorePhoto, skyPhoto;
    uniform vec3 shoreLight,skyLight,horizon;
    uniform float mist,night;
    void main() {
      vec3 dir=normalize(p);
      vec2 uv=vec2(atan(dir.z,dir.x)/6.2831853+.5, asin(clamp(dir.y,-1.,1.))/3.14159265+.5);
      vec4 ridge=texture2D(shorePhoto,vec2(uv.x+.45,(uv.y-.5)*1.12+.504));
      vec3 clouds=texture2D(skyPhoto,vec2(uv.x+.34,uv.y)).rgb*skyLight;
      vec3 mountains=ridge.rgb*shoreLight;
      // Keep the photographed skyline intact: transition skies in the air, not with
      // a hard color key that would eat snowy ridges and fine branches.
      float blueAir=smoothstep(.05,.38,ridge.b-ridge.r)*smoothstep(.12,.62,ridge.b);
      float altitude=smoothstep(.05,.32,dir.y);
      float skyMix=clamp(altitude+blueAir*.46,0.,1.);
      float air=.19+.23*mist;
      mountains=mix(mountains,horizon*.38,air);
      vec3 color=mix(mountains,clouds,skyMix);
      color=mix(color,horizon*.6,mist*mist*.62*(1.-smoothstep(0.,.4,dir.y)));
      gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`;
  const plates = new Map();
  let last;
  return time => {
    if(time===last)return;
    last=time;
    if (!plates.has(time)) {
      const panorama=photograph(time);
      panorama.mapping=T.EquirectangularReflectionMapping;
      plates.set(time,panorama);
    }
    u.skyPhoto.value=plates.get(time);
    scene.environment=plates.get(time);
    scene.environmentIntensity=time==='night' ? .28 : .82;
    const night=time==='night', day=time==='day';
    u.skyLight.value.setRGB(...(night?[.08,.13,.28]:[1,1,1]));
    u.shoreLight.value.setRGB(...(night?[.10,.17,.36]:day?[.93,1,1.03]:[.83,.60,.60]));
  };
}

export function harborWater(geometry) {
  const water=new Water(geometry,{textureWidth:512,textureHeight:384,clipBias:.002,distortionScale:.34,fog:true,waterColor:0x123f47});
  const mat=water.material, u=mat.uniforms;
  u.amplitude={value:0}; u.deep=u.waterColor; u.glint=u.sunColor;
  mat.vertexShader='uniform float amplitude;\n'+mat.vertexShader.replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );',`
    vec3 surface=position;
    vec2 q=vec2(position.x,-position.y);
    surface.z+=amplitude*(.68*sin(dot(q,vec2(.31,.19))+time*1.85)+.32*sin(dot(q,vec2(-.13,.44))-time*1.31));
    mirrorCoord=modelMatrix*vec4(surface,1.);
  `).replace('modelViewMatrix * vec4( position, 1.0 )','modelViewMatrix * vec4(surface,1.)');
  mat.fragmentShader='uniform float amplitude;\n'+mat.fragmentShader.replace('vec4 noise = getNoise( worldPosition.xz * size );',`
    vec2 q=worldPosition.xz;
    float t=time, footprint=max(length(dFdx(q)),length(dFdy(q)));
    vec2 slope=amplitude*(.68*vec2(.31,.19)*cos(dot(q,vec2(.31,.19))+t*1.85)+.32*vec2(-.13,.44)*cos(dot(q,vec2(-.13,.44))-t*1.31));
    float bend=sin(dot(q,vec2(.27,.14))+t*.59)+.55*sin(dot(q,vec2(-.11,.39))-t*.31);
    slope+=vec2(.038,.059)*cos(dot(q,vec2(1.3,2.6))+bend+t*.86);
    slope+=vec2(-.035,.024)*sin(dot(q,vec2(-4.2,2.2))+2.*bend-t*1.26)*(1.-smoothstep(.10,.5,footprint));
    slope+=vec2(.022,.014)*cos(dot(q,vec2(8.7,5.6))+3.*bend+t*1.51)*(1.-smoothstep(.04,.23,footprint));
    vec4 noise=vec4(-slope.x,-slope.y,1.,0.);
  `).replace('float rf0 = 0.02;', 'float rf0 = 0.075;')
    .replace('( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask()', 'waterColor * .62 + (sunColor * diffuseLight * .17 + scatter) * mix(.42,1.,getShadowMask())')
    .replace('sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5','sunLight( surfaceNormal, eyeDirection, 68.0, 1.1, 0.25');
  // Always capture with this frame's camera and texture matrix. Reusing either while
  // orbiting makes piers appear to swim independently of their reflections.
  u.mirrorSampler.value.generateMipmaps=true;
  u.mirrorSampler.value.minFilter=T.LinearMipmapLinearFilter;
  water.receiveShadow=true;
  return water;
}
