import { useEffect, useRef } from 'react';

// The Go Farther identity orb, alive: a procedural sun (WebGL) rendered into a
// small circular canvas. Cheap at this size (a ~60px buffer, not fullscreen),
// but still guarded for phones — capped DPR, paused when off-screen or the app
// is backgrounded, calmed under reduced-motion, and its GL context released on
// unmount. Falls back to a 2D-canvas sun, then to nothing, so it can never throw
// in a webview without WebGL.

const VERT = `attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}`;

const FRAG = `precision highp float;
uniform vec2 uRes;
uniform float uTime;

float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
float fbm3(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<3;i++){ s+=a*noise(p); p*=2.11; a*=0.5; } return s; }
vec3 ramp(float x){
  vec3 c0=vec3(0.59,0.165,0.024),c1=vec3(0.815,0.33,0.055),c2=vec3(0.98,0.54,0.118),c3=vec3(1.0,0.73,0.243),c4=vec3(1.0,0.871,0.463),c5=vec3(1.0,0.957,0.769),c6=vec3(1.0,0.988,0.922);
  vec3 col=mix(c0,c1,smoothstep(0.0,0.18,x));
  col=mix(col,c2,smoothstep(0.18,0.42,x)); col=mix(col,c3,smoothstep(0.42,0.64,x));
  col=mix(col,c4,smoothstep(0.64,0.82,x)); col=mix(col,c5,smoothstep(0.82,0.96,x));
  col=mix(col,c6,smoothstep(0.96,1.12,x)); return col;
}
float flame(float ang,float r,float R,float a0,float w,float hm,float seed,float t){
  float da=atan(sin(ang-a0),cos(ang-a0)); float env=exp(-da*da/(2.0*w*w)); if(env<0.01) return 0.0;
  vec2 dir=vec2(cos(ang),sin(ang)); float pulse=0.75+0.35*sin(t*0.55+seed);
  float n1=fbm3(vec3(dir*6.0+seed,t*0.85)); float n2=fbm3(vec3(dir*20.0+seed*1.7,t*1.5));
  float h=hm*pulse*env*(0.30+0.55*n1+0.40*n2); float above=max(r-R,0.0);
  float f=pow(clamp(1.0-above/max(h,1e-4),0.0,1.0),1.6); return f*env*step(R-0.004,r);
}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/min(uRes.x,uRes.y);
  float t=uTime; float r=length(uv); float ang=atan(uv.y,uv.x); float R=0.34;
  vec3 col=vec3(0.0);
  vec2 cell=floor(gl_FragCoord.xy/22.0); float hs=hash(vec3(cell,7.0));
  if(hs>0.82){
    vec2 stc=vec2(hash(vec3(cell,11.0)),hash(vec3(cell,13.0))); vec2 fp=fract(gl_FragCoord.xy/22.0);
    float dd=length(fp-stc)*22.0; float b=pow(hash(vec3(cell,17.0)),3.0)*0.9+0.12;
    float tw=0.65+0.35*sin(t*(0.8+2.0*hs)+hs*40.0); float s=smoothstep(1.8,0.0,dd)*b*tw;
    s*=smoothstep(R*1.08,R*2.4,r); col+=s*vec3(1.0,0.97,0.92);
  }
  float rr=clamp(r/R,0.0,1.0); float mu=sqrt(max(0.0,1.0-rr*rr)); float limb=1.0-0.66*(1.0-mu);
  float sxn=uv.x/R,syn=uv.y/R; float szn=sqrt(max(0.0,1.0-sxn*sxn-syn*syn));
  float phi=t*0.35; float cp=cos(phi),sp2=sin(phi);
  vec3 sq=vec3(sxn*cp+szn*sp2,syn,-sxn*sp2+szn*cp);
  vec3 w3=vec3(fbm3(sq*10.0+vec3(t*0.18))-0.5,fbm3(sq*10.0+vec3(40.0+t*0.18))-0.5,0.0)*0.09;
  float g1=fbm((sq+w3)*42.0+vec3(t*0.30)); float g2=fbm3((sq-w3)*95.0+vec3(33.0+t*0.50));
  float gran=0.70*(g1-0.5)+0.45*(g2-0.5); float I=limb*(1.0+0.34*gran);
  vec3 u1=normalize(vec3(0.35,0.18,0.92)),u2=normalize(vec3(-0.55,-0.30,0.78));
  float spots=0.95*exp(-(1.0-dot(sq,u1))/0.0011)+0.90*exp(-(1.0-dot(sq,u2))/0.0008);
  spots+=0.34*(0.95*exp(-(1.0-dot(sq,u1))/0.0074)+0.90*exp(-(1.0-dot(sq,u2))/0.0054));
  spots=clamp(spots,0.0,1.0)*step(0.001,szn);
  float fac=max(fbm3(sq*17.0+vec3(80.0+t*0.12))-0.5,0.0)*clamp((rr-0.55)*2.2,0.0,1.0)*0.24;
  I=I*(1.0-0.88*spots)+fac; vec3 disk=ramp(clamp(I,0.0,1.15));
  vec2 dir=vec2(cos(ang),sin(ang)); float edgeN=fbm3(vec3(dir*9.0,t*1.1));
  float ring=exp(-pow((r-R)/0.0043,2.0))*(0.55+0.7*edgeN);
  float fh=0.005+0.012*fbm3(vec3(dir*16.0,t*1.6+5.0)); float fringe=pow(clamp(1.0-max(r-R,0.0)/fh,0.0,1.0),2.0)*step(R,r)*0.5;
  float prom=0.0;
  prom+=flame(ang,r,R,-0.34,0.16,0.059,11.0,t); prom+=flame(ang,r,R,2.60,0.13,0.046,23.0,t);
  prom+=flame(ang,r,R,-1.88,0.09,0.033,37.0,t); prom+=flame(ang,r,R,0.92,0.08,0.025,51.0,t);
  float erupt=pow(max(sin(t*0.22),0.0),6.0); prom+=flame(ang,r,R,1.85,0.11,0.076*erupt+0.011,73.0,t);
  prom=clamp(prom,0.0,1.0); vec3 promCol=prom*vec3(0.95,0.40,0.07)+prom*prom*vec3(0.45,0.30,0.08);
  float d=max(r-R,0.0); float breathe=1.0+0.08*sin(t*0.5)+0.04*sin(t*0.21+2.0);
  float streamers=0.85+0.34*fbm3(vec3(dir*2.2,t*0.15));
  vec3 glow=exp(-d/0.0086)*0.80*vec3(1.0,0.80,0.43)+exp(-d/0.030)*0.46*vec3(1.0,0.65,0.24)+exp(-d/0.084)*0.30*vec3(1.0,0.47,0.11)+exp(-d/0.21)*0.17*vec3(1.0,0.36,0.055)+exp(-d/0.44)*0.09*vec3(0.98,0.275,0.031);
  glow*=breathe*streamers;
  float ins=smoothstep(R+0.0015,R-0.0015,r);
  vec3 outside=col+glow+promCol+ring*vec3(1.0,0.38,0.07)+fringe*vec3(1.0,0.42,0.08);
  vec3 insideCol=disk+glow*0.10+ring*vec3(1.0,0.38,0.07)*0.35;
  vec3 final=mix(outside,insideCol,ins);
  final=final*(1.02-0.06*final);
  gl_FragColor=vec4(clamp(final,0.0,1.0),1.0);
}`;

function initGL(canvas: HTMLCanvasElement): { gl: WebGLRenderingContext; uRes: WebGLUniformLocation | null; uTime: WebGLUniformLocation | null } | null {
  const opts = { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false } as const;
  const gl = (canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return { gl, uRes: gl.getUniformLocation(prog, 'uRes'), uTime: gl.getUniformLocation(prog, 'uTime') };
}

// 2D fallback: a simpler radiant sun, so the orb still glows where WebGL is off.
function draw2D(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34;
  ctx.clearRect(0, 0, w, h);
  const breathe = 1 + 0.06 * Math.sin(t * 0.6);
  let g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.6 * breathe);
  g.addColorStop(0, 'rgba(255,150,40,0.55)'); g.addColorStop(0.45, 'rgba(255,100,18,0.20)'); g.addColorStop(1, 'rgba(250,70,8,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const flick = 1 + 0.02 * Math.sin(t * 7) + 0.012 * Math.sin(t * 13.7);
  g = ctx.createRadialGradient(cx - R * 0.12, cy - R * 0.14, 0, cx, cy, R * flick);
  g.addColorStop(0, '#fffce8'); g.addColorStop(0.35, '#ffe184'); g.addColorStop(0.7, '#ffae3a'); g.addColorStop(0.94, '#f0670c'); g.addColorStop(1, '#d24905');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * flick, 0, 6.2832); ctx.fill();
}

export default function SunOrb({ size = 60, className = '' }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(1, Math.round(size * dpr));
    canvas.width = px; canvas.height = px;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const slowMo = reduce ? 0.12 : 1.0;
    const start = performance.now();
    let raf = 0;
    let visible = true;   // on screen
    let awake = true;     // app foregrounded

    let webgl: ReturnType<typeof initGL> = null;
    let ctx2d: CanvasRenderingContext2D | null = null;
    try { webgl = initGL(canvas); } catch { webgl = null; }
    if (!webgl) { try { ctx2d = canvas.getContext('2d'); } catch { ctx2d = null; } }
    if (!webgl && !ctx2d) return; // no canvas support — orb stays empty, never throws

    if (webgl) { webgl.gl.viewport(0, 0, px, px); webgl.gl.uniform2f(webgl.uRes, px, px); }

    const frame = () => {
      const t = (performance.now() - start) / 1000 * slowMo;
      if (webgl) { webgl.gl.uniform1f(webgl.uTime, t); webgl.gl.drawArrays(webgl.gl.TRIANGLES, 0, 3); }
      else if (ctx2d) draw2D(ctx2d, px, px, t);
      // Reduced motion: render one frame, then idle (no continuous animation).
      if (reduce) { raf = 0; return; }
      raf = (visible && awake) ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => { if (!raf && visible && awake) raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);

    // Pause when scrolled off-screen or the app is backgrounded — no point
    // burning the GPU on an orb nobody can see.
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } })
      : null;
    io?.observe(canvas);
    const onVis = () => { awake = !document.hidden; if (awake) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      try { webgl?.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
    };
  }, [size]);

  return <canvas ref={ref} className={`sun-orb ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true" />;
}
