'use strict';

var colors = require('./palette');
var info = wx.getSystemInfoSync();
var width = info.windowWidth;
var height = info.windowHeight;
var dpr = info.pixelRatio || 1;
var canvas = wx.createCanvas();
canvas.width = Math.round(width * dpr);
canvas.height = Math.round(height * dpr);
var context = canvas.getContext('2d');
if (!context) throw new Error('Canvas2D is unavailable.');
context.scale(dpr, dpr);
var saved = wx.getStorageSync('orbitPostScore');
var state = { score: typeof saved === 'number' ? saved : 0, frames: 0, shows: 0, hides: 0, imageLoaded: false, active: true, target: { x: width / 2, y: height * 0.47 } };
var pendingFrame = null;
var image = wx.createImage();
var startedAt = null;
var offscreen = wx.createCanvas();
offscreen.width = 2;
offscreen.height = 2;

function text(value, x, y, size, color, face) {
  context.fillStyle = color;
  context.font = size + 'px ' + (face || 'Georgia');
  context.fillText(value, x, y);
}

function draw(timestamp) {
  pendingFrame = null;
  if (!state.active) return;
  state.frames += 1;
  if (startedAt === null) startedAt = timestamp;
  var elapsed = (timestamp - startedAt) / 1000;
  state.target.x = width / 2 + Math.sin(elapsed * 0.65) * width * 0.12;
  state.target.y = height * 0.47 + Math.cos(elapsed * 0.8) * 14;
  context.fillStyle = colors.paper;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#e2dac9';
  context.lineWidth = 1;
  for (var x = 20; x < width; x += 28) {
    for (var y = 20; y < height; y += 28) {
      context.fillStyle = '#dbd1be';
      context.fillRect(x, y, 1, 1);
    }
  }
  text('FIELD NOTES / 01', 28, 45, 12, colors.muted, 'monospace');
  text('Orbit Post', 28, 91, 38, colors.ink);
  text('A little signal, a real canvas.', 28, 119, 15, colors.muted);
  context.strokeStyle = colors.peach;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(width / 2, height * 0.47, width * 0.34, 76, -0.22, 0, Math.PI * 2);
  context.stroke();
  context.save();
  context.translate(state.target.x, state.target.y);
  context.rotate(Math.sin(elapsed * 0.5) * 0.18);
  context.fillStyle = colors.ink;
  context.fillRect(-39, -39, 78, 78);
  if (state.imageLoaded) {
    context.imageSmoothingEnabled = false;
    context.drawImage(image, -31, -31, 62, 62);
  }
  context.restore();
  text('TAP TO COLLECT A SIGNAL', 28, height * 0.67, 11, colors.copper, 'monospace');
  text(String(state.score).padStart(2, '0'), 28, height * 0.67 + 59, 56, colors.ink);
  text('signals saved on this device', 28, height * 0.67 + 85, 14, colors.muted);
  context.fillStyle = colors.ink;
  context.fillRect(28, height - 76, width - 56, 1);
  text('Canvas2D / local PNG / touch', 28, height - 49, 11, colors.muted, 'monospace');
  pendingFrame = requestAnimationFrame(draw);
}

function start() {
  if (pendingFrame === null && state.active) pendingFrame = requestAnimationFrame(draw);
}

image.onload = function () {
  state.imageLoaded = true;
  var probe = offscreen.getContext('2d');
  probe.drawImage(image, 0, 0);
  state.sourcePixels = Array.prototype.slice.call(probe.getImageData(0, 0, 2, 2).data);
  console.info('Canvas2D local PNG ready', state.sourcePixels);
};
image.onerror = function () { throw new Error('Local PNG could not be decoded.'); };
image.src = 'assets/quad.png';
wx.onTouchStart(function (event) {
  if (!state.active || !event.touches || !event.touches.length) return;
  var point = event.touches[0];
  state.lastTouch = { x: point.clientX, y: point.clientY };
  state.score += 1;
  wx.setStorageSync('orbitPostScore', state.score);
  console.info('Signal collected', state.score);
});
wx.onHide(function () {
  state.hides += 1;
  state.active = false;
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
});
wx.onShow(function () { state.shows += 1; state.active = true; start(); });
GameGlobal.__demoGame = {
  kind: '2d', canvas: canvas, offscreen: offscreen, state: state,
  snapshot: function () { return canvas.toDataURL('image/png'); }
};
start();
