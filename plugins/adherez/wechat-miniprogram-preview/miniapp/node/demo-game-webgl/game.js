'use strict';

var sources = require('./shaders');
var info = wx.getSystemInfoSync();
var canvas = wx.createCanvas();
canvas.width = Math.round(info.windowWidth * (info.pixelRatio || 1));
canvas.height = Math.round(info.windowHeight * (info.pixelRatio || 1));
var gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!gl) throw new Error('WebGL is unavailable; this demo does not fall back to Canvas2D.');
var state = { frames: 0, shows: 0, hides: 0, taps: 0, active: true, textureReady: false, angle: 0, inverted: false };
var pendingFrame = null;
var startedAt = null;

function shader(type, text) {
  var value = gl.createShader(type);
  gl.shaderSource(value, text);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
  return value;
}
var program = gl.createProgram();
var vertex = shader(gl.VERTEX_SHADER, sources.vertex);
var fragment = shader(gl.FRAGMENT_SHADER, sources.fragment);
gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.deleteShader(vertex); gl.deleteShader(fragment); gl.useProgram(program);
var buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
var position = gl.getAttribLocation(program, 'position');
gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
var texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
var image = wx.createImage();
var phase = gl.getUniformLocation(program, 'phase');
var invert = gl.getUniformLocation(program, 'invert');
var sampler = gl.getUniformLocation(program, 'atlas');

function render(timestamp) {
  pendingFrame = null;
  if (!state.active) return;
  state.frames += 1;
  if (startedAt === null) startedAt = timestamp;
  state.angle = (timestamp - startedAt) / 18000;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.055, 0.09, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  if (state.textureReady) {
    gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sampler, 0); gl.uniform1f(phase, state.angle); gl.uniform1f(invert, state.inverted ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  pendingFrame = requestAnimationFrame(render);
}
function start() { if (pendingFrame === null && state.active) pendingFrame = requestAnimationFrame(render); }
function readCenter() {
  var pixel = new Uint8Array(4);
  gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return { pixel: Array.prototype.slice.call(pixel), error: gl.getError() };
}
image.onload = function () {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  state.textureReady = true;
  state.uploadError = gl.getError();
  if (state.uploadError !== 0) throw new Error('PNG texture upload failed: ' + state.uploadError);
  console.info('WebGL PNG texture uploaded; tap to invert the atlas.');
};
image.onerror = function () { throw new Error('Local WebGL texture could not be decoded.'); };
image.src = 'assets/atlas.png';
wx.onTouchStart(function () { if (state.active) { state.taps += 1; state.inverted = !state.inverted; console.info('Atlas tap', state.taps); } });
wx.onHide(function () { state.hides += 1; state.active = false; if (pendingFrame !== null) cancelAnimationFrame(pendingFrame); pendingFrame = null; });
wx.onShow(function () { state.shows += 1; state.active = true; start(); });
GameGlobal.__demoGame = { kind: 'webgl', canvas: canvas, state: state, readCenter: readCenter, snapshot: function () { return canvas.toDataURL('image/png'); } };
start();
