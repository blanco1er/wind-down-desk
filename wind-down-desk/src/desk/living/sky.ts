/**
 * Living places — a rare shooting star (one every 1–3 min) over the starry places and the campfire.
 * One thin streak at 60 m, drawn only for the 1.6 s it lives (the CPU shows / hides it; the shader moves it):
 * a soft fade in and out (no flash), pale blue-white, an 8–12° trail.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from '@iwsdk/core';
import { PHOTO_ANGLES, type Uniforms } from './pano.ts';

export function createShootingStar(shared: Uniforms): Mesh {
  const g = new BufferGeometry();
  // x: 0 tail … 1 head, y: −1 … 1 across.
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      ${PHOTO_ANGLES}
      uniform float uTime;
      uniform vec4 uStar;      // start time, speed factor, slant (−0.6 … 0.6), 0
      uniform vec4 uStarDir;   // start yaw (rad, photo frame), start pitch (rad)
      varying float vAlong;
      varying float vAcross;
      varying float vLife;
      varying vec3 vDir;
      void main() {
        float t = clamp((uTime - uStar.x) / 1.1, 0.0, 1.0);
        vLife = t;
        // Travels down and sideways across the sky.
        float travel = (0.05 + t * 0.16) * uStar.y;
        float yaw = uStarDir.x * DEG + travel * DEG * (0.55 + uStar.z);
        float pitch = uStarDir.y * DEG - travel * DEG * 0.75;
        float len = 0.16 * smoothstep(0.0, 0.35, t);
        float yaw0 = yaw - len * DEG * (0.55 + uStar.z);
        float pitch0 = pitch + len * DEG * 0.75;
        vec3 head = photoDir(yaw, pitch);
        vec3 tail = photoDir(yaw0, pitch0);
        vec3 dirA = normalize(mix(tail, head, position.x));
        vec3 across = normalize(cross(head - tail + vec3(1e-5), dirA));
        vec3 p = cameraPosition + (dirA + across * position.y * 0.0012) * 60.0;
        vAlong = position.x;
        vAcross = position.y;
        vDir = dirA;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLivingFade;
      uniform vec4 uState;
      varying float vAlong;
      varying float vAcross;
      varying float vLife;
      varying vec3 vDir;
      void main() {
        float env = sin(3.14159 * vLife);
        float a = pow(vAlong, 2.2) * exp(-vAcross * vAcross * 3.0) * env * env * uLivingFade;
        a *= mix(smoothstep(-0.4, -0.14, vDir.y), 1.0, uState.w);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * a * 0.9, 1.0);
      }
    `,
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.8;
  mesh.visible = false;
  return mesh;
}
