const TILE_PX = 10;
const BULGE = -0.2;
const TEXTURE_SRC = 'assets/img/rgb.png';

const VERTEX = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_tile;
  uniform float u_bulge;

  void main() {
    vec2 c = gl_FragCoord.xy / u_res * 2.0 - 1.0;
    c *= 1.0 + u_bulge * dot(c, c);
    vec2 uv = (c + 1.0) * 0.5;

    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      gl_FragColor = vec4(0.0);
      return;
    }
    gl_FragColor = texture2D(u_tex, fract((uv - 0.5) * u_res / u_tile + 0.5));
  }
`;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
};

const createProgram = (gl) => {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
};

const createTexture = (gl, image) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
};

const initCrt = async (canvas) => {
  const gl = canvas.getContext('webgl');
  if (!gl) return;

  const image = new Image();
  image.src = TEXTURE_SRC;
  await image.decode();

  const program = createProgram(gl);
  gl.useProgram(program);
  createTexture(gl, image);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const [uRes, uTile, uBulge] = ['u_res', 'u_tile', 'u_bulge'].map(uniform);

  const render = () => {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTile, TILE_PX * dpr);
    gl.uniform1f(uBulge, BULGE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  render();
  addEventListener('resize', render);
  canvas.dataset.gl = '';
};

const canvas = document.querySelector('[data-is="crt"]');
if (canvas) initCrt(canvas).catch(console.error);
