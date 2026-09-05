import {computeWarpOutputSize,type Quad} from './geometry';
import {sides,type EdgeBow} from './curved-edge';
import {createCurvedMapping} from './curved-mapping';
import {warpImageToDataUrl} from './warp';
const vertex=`attribute vec2 a; void main(){gl_Position=vec4(a,0.,1.);}`;
const fragment=`precision highp float;
uniform sampler2D image; uniform mat3 inv; uniform vec2 outputSize,sourceSize;
uniform vec2 qa[4],qb[4],offset[4];
vec2 base(vec2 uv){vec3 p=inv*vec3(uv*(outputSize-1.),1.);return p.xy/p.z;}
vec2 residual(vec2 a,vec2 b,vec2 bow,vec2 uv){vec2 d=b-a;float t=dot(base(uv)-a,d)/dot(d,d);return 4.*t*(1.-t)*bow;}
void main(){vec2 uv=vec2(gl_FragCoord.x,outputSize.y-gl_FragCoord.y)/(outputSize-1.);
vec2 p=base(uv)+(1.-uv.y)*residual(qa[0],qb[0],offset[0],vec2(uv.x,0.))+uv.y*residual(qa[2],qb[2],offset[2],vec2(uv.x,1.))+(1.-uv.x)*residual(qa[3],qb[3],offset[3],vec2(0.,uv.y))+uv.x*residual(qa[1],qb[1],offset[1],vec2(1.,uv.y));
if(p.x<0.||p.y<0.||p.x>=sourceSize.x-1.||p.y>=sourceSize.y-1.)gl_FragColor=vec4(0.);
else gl_FragColor=texture2D(image,(p+.5)/sourceSize);}`;
let cache:{canvas:HTMLCanvasElement;gl:WebGLRenderingContext;program:WebGLProgram;texture:WebGLTexture;source:HTMLImageElement|null;src:string}|null=null;
function gpu() {
 if(cache&&!cache.gl.isContextLost())return cache;
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{preserveDrawingBuffer:true,premultipliedAlpha:false,antialias:false});
 if(!gl)throw new Error('WebGL unavailable');
 const compile=(type:number,text:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader failed');return s;};
 const program=gl.createProgram()!;gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader link failed');
 gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const a=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 cache={canvas,gl,program,texture,source:null,src:''};return cache;
}
export function renderCurved(image:HTMLImageElement,quad:Quad,bows:EdgeBow) {
 const start=performance.now(),{width,height}=computeWarpOutputSize(...quad);
 // Exact historical renderer for zero bow, including its half-pixel convention.
 if(sides.every(k=>bows[k]===0))return {url:warpImageToDataUrl(image,quad),fallback:false,backend:'legacy',ms:performance.now()-start};
 const mapping=createCurvedMapping(quad,bows,width,height);
 if(!mapping.safe)return {url:warpImageToDataUrl(image,quad),fallback:true,backend:'safe fallback',ms:performance.now()-start};
 let url:string,backend='webgl',gpuError='';
 try {
  const {canvas,gl,program}=gpu();
  const limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if(Math.max(image.naturalWidth,image.naturalHeight,width,height)>limit)throw new Error('Texture too large');
  canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);gl.useProgram(program);
  if(cache!.source!==image||cache!.src!==image.src){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);cache!.source=image;cache!.src=image.src;}
  const loc=(n:string)=>gl.getUniformLocation(program,n);
  gl.uniform2f(loc('outputSize'),width,height);gl.uniform2f(loc('sourceSize'),image.naturalWidth,image.naturalHeight);
  const m=mapping.inverse;gl.uniformMatrix3fv(loc('inv'),false,new Float32Array([m[0][0],m[1][0],m[2][0],m[0][1],m[1][1],m[2][1],m[0][2],m[1][2],m[2][2]]));
  gl.uniform2fv(loc('qa[0]'),new Float32Array(mapping.geometry.curves.flatMap(c=>[c.a.x,c.a.y])));
  gl.uniform2fv(loc('qb[0]'),new Float32Array(mapping.geometry.curves.flatMap(c=>[c.b.x,c.b.y])));
  gl.uniform2fv(loc('offset[0]'),new Float32Array(mapping.geometry.curves.flatMap(c=>[c.handle.x-c.mid.x,c.handle.y-c.mid.y])));
  gl.drawArrays(gl.TRIANGLES,0,6);if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU render failed');url=canvas.toDataURL('image/png');
 } catch(error) {gpuError=error instanceof Error?error.message:String(error);backend='canvas';url=warpImageToDataUrl(image,quad,(x,y)=>mapping.map(x/(width-1),y/(height-1)));}
 return {url,fallback:false,backend,gpuError,ms:performance.now()-start};
}
