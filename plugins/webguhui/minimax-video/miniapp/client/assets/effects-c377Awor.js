import{r as e}from"./rolldown-runtime-DAXXjFlN.js";import{r as t}from"./cube-B1EadsXn.js";var n=`#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler2D u_input;
uniform sampler3D u_lut;
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

vec3 linearToBt709(vec3 lin) {
  lin = max(lin, vec3(0.0));
  vec3 lo = lin * 4.5;
  vec3 hi = 1.099 * pow(lin, vec3(0.45)) - 0.099;
  return mix(lo, hi, step(0.018, lin));
}

vec3 bt709ToLinear(vec3 encoded) {
  encoded = clamp(encoded, vec3(0.0), vec3(1.0));
  vec3 lo = encoded / 4.5;
  vec3 hi = pow((encoded + 0.099) / 1.099, vec3(1.0 / 0.45));
  return mix(lo, hi, step(0.081, encoded));
}

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 encoded = linearToBt709(src.rgb);
  vec3 graded = texture(
    u_lut,
    clamp(encoded, vec3(0.0), vec3(1.0))
  ).rgb;
  fragColor = vec4(bt709ToLinear(mix(encoded, graded, u_intensity)), src.a);
}
`,r=`#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_threshold;
uniform float u_softness;
uniform float u_gamma;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_input, v_texCoord);
  vec3 rgb = color.rgb;

  // Use max channel instead of luminance — preserves colored edges better
  float maxChan = max(rgb.r, max(rgb.g, rgb.b));

  // Raw alpha calculation with threshold and softness
  float baseAlpha = smoothstep(u_threshold, u_threshold + u_softness, maxChan);
  float alpha = pow(baseAlpha, u_gamma);

  // Edge color decontamination: boost dark-edge pixels to prevent dark fringing
  float edgeMask = 1.0 - smoothstep(0.0, 0.6, alpha);
  vec3 correctedRgb = mix(rgb, rgb / max(maxChan, 0.15) * 0.5, edgeMask);

  // Screen-style intensity boost
  vec3 finalRgb = 1.0 - (1.0 - correctedRgb) * (1.0 - correctedRgb * 0.2 * u_intensity);

  // Clamp and output premultiplied alpha
  fragColor = vec4(clamp(finalRgb, 0.0, 1.0) * alpha, alpha);
}
`,i=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_width;
uniform float u_height;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_width_ratio;
uniform float u_height_ratio;
uniform float u_block_size;
uniform float u_feather;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 res = vec2(u_width, u_height);
  vec2 px = v_texCoord * res;
  vec2 center = vec2(u_center_x, u_center_y) * res;
  vec2 halfSize = vec2(u_width_ratio * res.x, u_height_ratio * res.y) * 0.5;
  // Pixelate: snap UV to nearest block center
  // Avoid division by zero by clamping block size to a small minimum
  float safe_block_size = max(u_block_size, 1.0);
  vec2 blockUV = (floor(px / safe_block_size) + 0.5) * safe_block_size / res;
  blockUV = clamp(blockUV, 0.0, 1.0);
  vec4 pixelated = texture(u_input, blockUV);
  vec4 original  = texture(u_input, v_texCoord);
  // Box SDF for region boundary
  vec2 d = abs(px - center) - halfSize;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  // Feathered blend: inside region = pixelated, outside = original
  float mask = 1.0 - smoothstep(-max(u_feather, 0.01), 0.0, dist);
  fragColor = mix(original, pixelated, mask);
}
`,a=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_width;
uniform float u_height;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_radius;
uniform float u_magnification;
uniform float u_border_width;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 res    = vec2(u_width, u_height);
  vec2 px     = v_texCoord * res;
  vec2 center = vec2(u_center_x, u_center_y) * res;
  float r     = u_radius * min(res.x, res.y) * 0.5;
  float bw    = u_border_width;
  float dist  = length(px - center);
  vec2 magUV  = clamp((center + (px - center) / u_magnification) / res, 0.0, 1.0);
  vec4 orig   = texture(u_input, v_texCoord);
  vec4 mag    = texture(u_input, magUV);
  float inner  = 1.0 - smoothstep(r - 1.5, r + 1.5, dist);
  float outer  = 1.0 - smoothstep((r + bw) - 1.5, (r + bw) + 1.5, dist);
  float border = clamp(outer - inner, 0.0, 1.0);
  vec4 col = orig;
  col = mix(col, vec4(1.0, 1.0, 1.0, 1.0), border);
  col = mix(col, mag, inner);
  fragColor = col;
}
`,o=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_canvas_width;
uniform float u_canvas_height;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_rect_width;
uniform float u_rect_height;
uniform float u_corner_radius;
uniform float u_feather;
uniform float u_invert;
in vec2 v_texCoord;
out vec4 fragColor;
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec4 color = texture(u_input, v_texCoord);
  vec2 res = vec2(u_canvas_width, u_canvas_height);
  vec2 pixelPos = v_texCoord * res;
  // The user coordinate system is 0-1, map it to pixel space
  vec2 center = vec2(u_center_x, u_center_y) * res;
  // Box half-dimensions in pixel space
  vec2 b = vec2(u_rect_width * u_canvas_width, u_rect_height * u_canvas_height) * 0.5;
  // Prevent corner radius from exceeding half of the shortest side
  float r = min(u_corner_radius, min(b.x, b.y));
  // Calculate the signed distance field for the rounded box
  float dist = sdRoundedBox(pixelPos - center, b, r);
  // Prevent division by zero if feather is set to exactly 0
  float f = max(u_feather, 0.001);
  // Calculate the smooth edge mask based on distance
  float mask = smoothstep(f * 0.5, -f * 0.5, dist);
  if (u_invert > 0.5) {
    mask = 1.0 - mask;
  }
  fragColor = vec4(color.rgb, color.a * mask);
}
`,s=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_width;
uniform float u_height;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_radius;
uniform float u_feather;
uniform float u_invert;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_input, v_texCoord);
  vec2 res = vec2(u_width, u_height);
  vec2 pixelPos = v_texCoord * res;
  // The user coordinate system is 0-1, so we map it to pixel space
  vec2 center = vec2(u_center_x, u_center_y) * res;
  // Radius is given as a fraction of the shortest dimension to stay a perfect circle
  float r = u_radius * min(res.x, res.y) * 0.5;
  float dist = length(pixelPos - center) - r;
  // Prevent division by zero if feather is set to exactly 0
  float f = max(u_feather, 0.001);
  // Calculate the smooth edge mask based on the distance
  float mask = smoothstep(f * 0.5, -f * 0.5, dist);
  if (u_invert > 0.5) {
    mask = 1.0 - mask;
  }
  fragColor = vec4(color.rgb, color.a * mask);
}
`,c=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_scanlineIntensity;
uniform float u_curvature;
uniform float u_noiseAmount;
uniform float u_rgbShift;
uniform float u_brightness;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;
vec2 distort(vec2 uv) {
  uv -= 0.5;
  float d = dot(uv, uv);
  uv *= 1.0 + u_curvature * d;
  uv += 0.5;
  return uv;
}
float rand(vec2 co) {
  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}
void main() {
  vec2 uv = distort(v_texCoord);
  // Pipeline convention: FBO textures carry premultiplied RGBA. Curved-screen
  // distortion outside [0,1] and vignette corners must fade to transparent,
  // not opaque black, otherwise track-composite output blocks tracks below.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float wobble = sin(uv.y * 50.0 + u_time * 5.0) * 0.001;
  vec2 uvShift = vec2(wobble, 0.0);
  float r = texture(u_input, uv + uvShift + vec2(u_rgbShift, 0.0)).r;
  float g = texture(u_input, uv + uvShift).g;
  float b = texture(u_input, uv + uvShift - vec2(u_rgbShift, 0.0)).b;
  // Carry source alpha so an opaque video stays opaque while an empty
  // (transparent) area of the scene framebuffer stays transparent.
  float srcAlpha = texture(u_input, uv + uvShift).a;
  vec3 col = vec3(r, g, b) * u_brightness;
  float scan = sin(uv.y * 800.0) * 0.5 + 0.5;
  col -= scan * u_scanlineIntensity;
  float noise = (rand(uv + fract(u_time)) - 0.5) * u_noiseAmount;
  col += noise;
  float vignette = 1.0 - length(v_texCoord - 0.5) * 1.2;
  float vignFactor = smoothstep(0.0, 0.2, vignette);
  col *= vignFactor;
  // Scale alpha by the same vignette factor so the corners fade to
  // transparent rather than to opaque black, preserving the premultiplied
  // invariant (rgb stays ≤ alpha for an opaque source).
  fragColor = vec4(col, srcAlpha * vignFactor);
}
`,l=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_time;
uniform float u_strength;
uniform float u_speed;
uniform float u_zoom;
uniform float u_rotation;
uniform float u_breathe;
in vec2 v_texCoord;
out vec4 fragColor;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}
void main() {
  float t = u_time * u_speed;
  vec2 pos = v_texCoord - 0.5;
  float shakeX = (fbm(vec2(t, 0.0)) - 0.5) * u_strength * 0.05;
  float shakeY = (fbm(vec2(0.0, t)) - 0.5) * u_strength * 0.05;
  float angle = (fbm(vec2(t * 0.5, t * 0.5)) - 0.5) * u_rotation * 0.1;
  float breath = 1.0 + (sin(t * 0.5) * 0.02 * u_breathe);
  float zoom = u_zoom * breath;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 uv = (rot * pos) / zoom + 0.5 + vec2(shakeX, shakeY);
  // Pipeline convention is premultiplied RGBA in FBO textures. Out-of-bounds
  // pixels (when the shake offset pushes UV outside [0,1]) must be transparent
  // so tracks below can show through; opaque black would block them.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
  } else {
    fragColor = texture(u_input, uv);
  }
}
`,u=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_focusY;
uniform float u_focusWidth;
uniform float u_tiltAngle;
uniform float u_blurStrength;
uniform float u_blurSide;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
    float aspect = u_resolution.x / u_resolution.y;
    float dx = (v_texCoord.x - 0.5) * aspect;
    float dy = v_texCoord.y - u_focusY;
    float signed_dist = dy * cos(u_tiltAngle) - dx * sin(u_tiltAngle);
    float active_dist = abs(signed_dist);
    if (u_blurSide == 1.0) active_dist = max(0.0, signed_dist);
    else if (u_blurSide == 2.0) active_dist = max(0.0, -signed_dist);
    float maxBlur = u_blurStrength * 4.0;
    float blurAmt = min(maxBlur, max(0.0, active_dist - u_focusWidth * 0.5) * u_blurStrength * 4.0) * 0.7071;
    if (blurAmt < 0.5) { fragColor = texture(u_input, v_texCoord); return; }
    float goldenAngle = 2.39996323;
    vec4 color = vec4(0.0); float tot = 0.0;
    for(int i = 0; i < 16; i++) {
        float r = sqrt(float(i) + 0.5) / 4.0;
        float theta = float(i) * goldenAngle;
        vec2 offset = vec2(cos(theta), sin(theta)) * r * blurAmt / u_resolution;
        float weight = exp(-r * r * 2.0);
        color += texture(u_input, v_texCoord + offset) * weight;
        tot += weight;
    }
    fragColor = color / tot;
}
`,d=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_focusY;
uniform float u_focusWidth;
uniform float u_tiltAngle;
uniform float u_blurStrength;
uniform float u_blurSide;
uniform float u_saturation;
uniform float u_vignette;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
    float aspect = u_resolution.x / u_resolution.y;
    float dx = (v_texCoord.x - 0.5) * aspect;
    float dy = v_texCoord.y - u_focusY;
    float signed_dist = dy * cos(u_tiltAngle) - dx * sin(u_tiltAngle);
    float active_dist = abs(signed_dist);
    if (u_blurSide == 1.0) active_dist = max(0.0, signed_dist);
    else if (u_blurSide == 2.0) active_dist = max(0.0, -signed_dist);
    float maxBlur = u_blurStrength * 4.0;
    float blurAmt = min(maxBlur, max(0.0, active_dist - u_focusWidth * 0.5) * u_blurStrength * 4.0) * 0.7071;
    vec4 color = vec4(0.0);
    if (blurAmt < 0.5) {
        color = texture(u_input, v_texCoord);
    } else {
        float goldenAngle = 2.39996323; float tot = 0.0;
        for(int i = 0; i < 16; i++) {
            float r = sqrt(float(i) + 0.5) / 4.0;
            float theta = float(i) * goldenAngle + 1.570796;
            vec2 offset = vec2(cos(theta), sin(theta)) * r * blurAmt / u_resolution;
            float weight = exp(-r * r * 2.0);
            color += texture(u_input, v_texCoord + offset) * weight;
            tot += weight;
        }
        color /= tot;
    }
    float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(lum), color.rgb, u_saturation);
    float v_rf = length(v_texCoord - 0.5);
    // Vignette: fade to transparent (scale both rgb and alpha) so the dimmed
    // corners let tracks below show through (pipeline carries premultiplied RGBA).
    float vignAmt = u_vignette * smoothstep(0.2, 0.8, v_rf);
    float vignFactor = mix(1.0, 0.1, vignAmt);
    color *= vignFactor;
    fragColor = color;
}
`,f=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_gridSize;
uniform vec3 u_color;
in vec2 v_texCoord;
out vec4 fragColor;

const int chars[16] = int[16](
  9367, 9389, 5101, 18575, 29874, 18855, 23530, 29847,
  31143, 23407, 29647, 27502, 31599, 29679, 27566, 31727
);

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
  vec2 uvPx = v_texCoord * u_resolution;
  vec2 cellSizePx = vec2(max(4.0, u_gridSize));

  vec2 cellId = floor(uvPx / cellSizePx);
  vec2 cellUv = fract(uvPx / cellSizePx);

  vec2 cellCenterUv = (cellId + 0.5) * cellSizePx / u_resolution;

  vec3 vidColor = texture(u_input, cellCenterUv).rgb;
  float lum = dot(vidColor, vec3(0.299, 0.587, 0.114));

  float rnd = random(cellId);

  // Pipeline convention: FBO textures carry premultiplied alpha; the display
  // pass converts back to straight for the canvas. Track-composite shaders
  // that produce opaque output on dark/void pixels block every track below
  // them in the DOM stack — see canvas/composition-worker/eligibility.ts on
  // why per-track canvases can't be merged: MG/captions/JSX need DOM and
  // must stay on their own layer.
  if (lum < 0.05 + rnd * 0.08) {
    fragColor = vec4(0.0);
    return;
  }

  float mappedLum = clamp((lum + rnd * 0.3 - 0.15), 0.0, 1.0);
  int charIdx = int(mappedLum * 15.99);

  vec2 localUv = cellUv * vec2(5.0, 7.0) - vec2(1.0, 1.0);
  vec2 gridPos = floor(localUv);
  vec2 gridFract = fract(localUv);

  float charAlpha = 0.0;
  int cx = int(gridPos.x);
  int cy = int(gridPos.y);

  if (cx >= 0 && cx < 3 && cy >= 0 && cy < 5) {
    int bitIdx = cy * 3 + cx;
    int charData = chars[charIdx];
    float bitOn = float((charData >> bitIdx) & 1);
    float box = smoothstep(0.65, 0.2, max(abs(gridFract.x - 0.5), abs(gridFract.y - 0.5)));
    charAlpha = bitOn * box;
  }

  float distToCenter = length(cellUv - 0.5);
  float cellGlow = smoothstep(0.8, 0.0, distToCenter) * lum * 0.4;

  float intensity = clamp(charAlpha + cellGlow, 0.0, 1.0);
  vec3 finalColor = u_color * intensity * (0.6 + lum * 1.2);

  fragColor = vec4(finalColor, intensity);
}
`,p=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec2 u_direction;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 sum = vec4(0.0);
  sum += texture(u_input, v_texCoord - 4.0 * texel * u_direction) * 0.016216;
  sum += texture(u_input, v_texCoord - 3.0 * texel * u_direction) * 0.054054;
  sum += texture(u_input, v_texCoord - 2.0 * texel * u_direction) * 0.1216216;
  sum += texture(u_input, v_texCoord - 1.0 * texel * u_direction) * 0.1945946;
  sum += texture(u_input, v_texCoord) * 0.227027;
  sum += texture(u_input, v_texCoord + 1.0 * texel * u_direction) * 0.1945946;
  sum += texture(u_input, v_texCoord + 2.0 * texel * u_direction) * 0.1216216;
  sum += texture(u_input, v_texCoord + 3.0 * texel * u_direction) * 0.054054;
  sum += texture(u_input, v_texCoord + 4.0 * texel * u_direction) * 0.016216;
  fragColor = sum;
}
`,m=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform sampler2D u_bloom;
uniform float u_glow;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 base = texture(u_input, v_texCoord);
  vec4 bloom = texture(u_bloom, v_texCoord);
  vec3 color = base.rgb + bloom.rgb * u_glow;
  float alpha = clamp(base.a + bloom.a * u_glow, 0.0, 1.0);
  fragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`,h=`#version 300 es
precision highp float;

// Chroma key / green-screen removal using YCbCr distance, adjustable tolerance/feathering, and spill suppression.
uniform sampler2D u_input;
uniform vec3 u_keyColor;    // Key color to remove; defaults to pure green (0,1,0)
uniform float u_similarity; // Chroma-distance tolerance; larger values remove a wider range
uniform float u_smoothness; // Feather width at the tolerance edge for a smooth, anti-aliased transition
uniform float u_spill;      // Key-color spill suppression on retained pixels, from 0 to 1

in vec2 v_texCoord;
out vec4 fragColor;

// Convert RGB to YCbCr (BT.601). Comparing Cb/Cr resists luminance changes better than direct RGB distance.
vec2 chroma(vec3 rgb) {
  float cb = -0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
  float cr = 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec2(cb, cr);
}

void main() {
  vec4 color = texture(u_input, v_texCoord);
  vec3 rgb = color.rgb;

  vec2 pixelCbCr = chroma(rgb);
  vec2 keyCbCr = chroma(u_keyColor);
  float dist = distance(pixelCbCr, keyCbCr);

  // Treat dist < similarity as the key color, then feather alpha to opaque across the smoothness width.
  float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, dist);

  // Suppress reflected key color around retained edges by pulling it toward desaturated gray.
  // Pixels closer to the key color receive more correction, scaled by u_spill.
  float spillAmount = (1.0 - smoothstep(u_similarity, u_similarity + u_smoothness * 3.0, dist)) * u_spill;
  float gray = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 despilled = mix(rgb, vec3(gray), spillAmount);

  // Follow the pipeline's premultiplied-alpha convention.
  fragColor = vec4(despilled * alpha, alpha);
}
`,g=`#version 300 es
precision highp float;

// Three-way color wheels (lift/gamma/gain): shadow offset, midtone exponent, and highlight gain; 0.5 gray is neutral.
// Apply out = pow(clamp(in * gain + lift), gamma) per channel, then use intensity for dry/wet blending.
uniform sampler2D u_input;
uniform vec3 u_liftColor;   // 0.5 is neutral; deviation sets the shadow tint direction
uniform vec3 u_gammaColor;  // 0.5 is neutral; values above 0.5 brighten that midtone channel
uniform vec3 u_gainColor;   // 0.5 is neutral; values above 0.5 boost that highlight channel
uniform float u_intensity;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 lift = (u_liftColor - 0.5) * 0.5;            // -0.25 .. +0.25
  vec3 gain = 0.25 + u_gainColor * 1.5;             // 0.25 .. 1.75, 0.5 -> 1
  vec3 gamma = exp2((0.5 - u_gammaColor) * 2.0);    // 0.5 maps to 1; lower values darken midtones
  vec3 graded = pow(clamp(c.rgb * gain + lift, 0.0, 1.0), gamma);
  fragColor = vec4(mix(c.rgb, graded, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,_=`#version 300 es
precision highp float;

// Per-channel levels: remap input black/white points, apply midtone gamma, then map output black/white points.
uniform sampler2D u_input;
uniform float u_inBlack;
uniform float u_inWhite;
uniform float u_gamma;
uniform float u_outBlack;
uniform float u_outWhite;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 v = clamp((c.rgb - u_inBlack) / max(u_inWhite - u_inBlack, 1e-4), 0.0, 1.0);
  v = pow(v, vec3(1.0 / max(u_gamma, 0.05)));
  v = u_outBlack + v * (u_outWhite - u_outBlack);
  fragColor = vec4(clamp(v, 0.0, 1.0), c.a);
}
`,v=`#version 300 es
precision highp float;

// Highlights/shadows: soft luminance masks lift shadows toward white while protecting highlights, and adjust highlights separately.
uniform sampler2D u_input;
uniform float u_shadows;        // -1..1; positive values lift shadows
uniform float u_highlights;     // -1..1; negative values recover highlights
uniform float u_shadowRange;    // Upper luminance bound of the shadow mask
uniform float u_highlightRange; // Highlight-mask width

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = texture(u_input, v_texCoord);
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float shadowMask = 1.0 - smoothstep(0.0, max(u_shadowRange, 0.05), luma);
  float highlightMask = smoothstep(1.0 - max(u_highlightRange, 0.05), 1.0, luma);
  vec3 rgb = c.rgb;
  rgb += u_shadows * shadowMask * 0.45 * (1.0 - rgb);
  rgb *= 1.0 + u_highlights * highlightMask * 0.6;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`,y=`#version 300 es
precision highp float;

// Local-contrast clarity: estimate mean luminance with a Poisson-disk unsharp sample and adjust midtones by the difference.
// Positive values sharpen; negative values soften. ponytail: one 12-tap pass approximates a large-radius blur.
// Upgrade to a separable two-pass Gaussian blur if the FX registry gains sampler declarations.
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_amount; // -1..1
uniform float u_radius; // Pixels

in vec2 v_texCoord;
out vec4 fragColor;

const vec2 TAPS[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457),
  vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

float lumaOf(vec3 rgb) { return dot(rgb, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec2 px = max(u_radius, 1.0) / max(u_resolution, vec2(1.0));
  float localMean = lumaOf(c.rgb);
  for (int i = 0; i < 12; i++) {
    localMean += lumaOf(texture(u_input, v_texCoord + TAPS[i] * px).rgb);
  }
  localMean /= 13.0;
  float luma = lumaOf(c.rgb);
  float detail = luma - localMean;
  // Weight midtones while protecting the black and white extremes from clipping and amplified noise.
  float midWeight = smoothstep(0.0, 0.25, luma) * (1.0 - smoothstep(0.75, 1.0, luma));
  float boosted = luma + detail * u_amount * 1.6 * midWeight;
  vec3 rgb = c.rgb * (luma > 1e-4 ? boosted / luma : 1.0);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`,b=`#version 300 es
precision highp float;

// HSL secondary correction: select a feathered hue-arc segment and adjust hue, saturation, and lightness only inside it.
// Fade the mask on low-saturation pixels to avoid tinting neutral gray areas.
uniform sampler2D u_input;
uniform float u_hueCenter;  // 0..360
uniform float u_hueWidth;   // Selection half-width in degrees
uniform float u_softness;   // Feather width in degrees
uniform float u_hueShift;   // -60..60 degrees
uniform float u_satMul;     // 0..2
uniform float u_lumaMul;    // 0.5..1.5

in vec2 v_texCoord;
out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 hsv = rgb2hsv(c.rgb);
  float hueDeg = hsv.x * 360.0;
  float dist = abs(hueDeg - u_hueCenter);
  dist = min(dist, 360.0 - dist); // Circular hue distance
  float mask = 1.0 - smoothstep(u_hueWidth, u_hueWidth + max(u_softness, 0.5), dist);
  mask *= smoothstep(0.04, 0.18, hsv.y); // Fade neutral gray areas
  vec3 adjusted = hsv;
  adjusted.x = fract((hueDeg + u_hueShift) / 360.0 + 1.0);
  adjusted.y = clamp(hsv.y * u_satMul, 0.0, 1.0);
  adjusted.z = clamp(hsv.z * u_lumaMul, 0.0, 1.0);
  vec3 outRgb = mix(c.rgb, hsv2rgb(adjusted), mask);
  fragColor = vec4(outRgb, c.a);
}
`,x=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform float u_softness;
uniform float u_roundness;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec2 uv = v_texCoord * 2.0 - 1.0;
  uv.x *= mix(1.0, u_roundness, 0.5);
  float d = length(uv);
  float edge = 1.0 - u_amount * 0.85;
  float vig = smoothstep(edge, edge - max(u_softness, 0.01), d);
  fragColor = vec4(c.rgb * vig, c.a);
}
`,S=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform float u_size;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float s = max(u_size, 0.5);
  vec2 g = floor(v_texCoord * vec2(320.0, 180.0) / s);
  float n = hash(g + floor(u_time * 24.0));
  float grain = (n - 0.5) * 2.0 * u_amount;
  fragColor = vec4(clamp(c.rgb + grain, 0.0, 1.0), c.a);
}
`,C=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform float u_angle;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 dir = vec2(cos(u_angle), sin(u_angle)) * u_amount;
  float r = texture(u_input, v_texCoord + dir).r;
  float g = texture(u_input, v_texCoord).g;
  float b = texture(u_input, v_texCoord - dir).b;
  float a = texture(u_input, v_texCoord).a;
  fragColor = vec4(r, g, b, a);
}
`,w=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_blockSize;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = floor(u_time * 12.0);
  float row = floor(v_texCoord.y * max(u_blockSize, 2.0));
  float slice = hash(row + t);
  float shift = 0.0;
  if (slice > 0.72) shift = (hash(row * 3.1 + t) - 0.5) * 2.0 * u_intensity * 0.12;
  vec2 uv = v_texCoord + vec2(shift, 0.0);
  float ch = hash(row * 7.7 + t);
  vec4 c = texture(u_input, clamp(uv, 0.0, 1.0));
  if (ch > 0.88) {
    float r = texture(u_input, clamp(uv + vec2(u_intensity * 0.03, 0.0), 0.0, 1.0)).r;
    float b = texture(u_input, clamp(uv - vec2(u_intensity * 0.03, 0.0), 0.0, 1.0)).b;
    c.r = r; c.b = b;
  }
  if (slice > 0.94) c.rgb = 1.0 - c.rgb;
  fragColor = c;
}
`,ee=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_threshold;
uniform float u_intensity;
uniform float u_radius;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 base = texture(u_input, v_texCoord);
  vec2 px = u_radius / max(u_resolution, vec2(1.0));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float w = exp(-0.5 * float(x * x + y * y));
      vec3 s = texture(u_input, v_texCoord + vec2(float(x), float(y)) * px).rgb;
      float lum = dot(s, vec3(0.299, 0.587, 0.114));
      float m = smoothstep(u_threshold, u_threshold + 0.2, lum);
      acc += s * m * w;
      wsum += w;
    }
  }
  vec3 bloom = acc / max(wsum, 0.001);
  fragColor = vec4(clamp(base.rgb + bloom * u_intensity, 0.0, 1.0), base.a);
}
`,T=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_blockSize;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  float b = max(u_blockSize, 1.0);
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 blocks = res / b;
  vec2 uv = (floor(v_texCoord * blocks) + 0.5) / blocks;
  fragColor = texture(u_input, uv);
}
`,E=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_levels;
uniform float u_contrast;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float lv = max(u_levels, 2.0);
  vec3 g = (c.rgb - 0.5) * u_contrast + 0.5;
  vec3 p = floor(clamp(g, 0.0, 1.0) * (lv - 1.0) + 0.5) / (lv - 1.0);
  fragColor = vec4(p, c.a);
}
`,D=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec3 u_shadowColor;
uniform vec3 u_highlightColor;
uniform float u_contrast;
uniform float u_intensity;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 duo = mix(u_shadowColor, u_highlightColor, lum);
  fragColor = vec4(mix(c.rgb, duo, u_intensity), c.a);
}
`,O=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_mode; // 0 left→right, 1 right→left, 2 top→bottom, 3 bottom→top
uniform float u_axis;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 uv = v_texCoord;
  float m = floor(u_mode + 0.5);
  if (m < 0.5) {
    if (uv.x > u_axis) uv.x = u_axis - (uv.x - u_axis);
  } else if (m < 1.5) {
    if (uv.x < u_axis) uv.x = u_axis + (u_axis - uv.x);
  } else if (m < 2.5) {
    if (uv.y > u_axis) uv.y = u_axis - (uv.y - u_axis);
  } else {
    if (uv.y < u_axis) uv.y = u_axis + (u_axis - uv.y);
  }
  fragColor = texture(u_input, clamp(uv, 0.0, 1.0));
}
`,k=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_strength;
uniform float u_zoom;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 uv = v_texCoord * 2.0 - 1.0;
  float r = length(uv);
  float k = u_strength;
  float f = 1.0 + k * r * r;
  uv = uv * f / max(u_zoom, 0.2);
  uv = uv * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = texture(u_input, uv);
}
`,A=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_segments;
uniform float u_angle;
uniform float u_zoom;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 uv = v_texCoord - 0.5;
  float r = length(uv) / max(u_zoom, 0.2);
  float a = atan(uv.y, uv.x) + u_angle;
  float seg = max(u_segments, 2.0);
  float slice = 6.2831853 / seg;
  a = mod(a, slice);
  a = abs(a - slice * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r + 0.5;
  fragColor = texture(u_input, clamp(p, 0.0, 1.0));
}
`,j=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_strength;
uniform float u_threshold;
uniform vec3 u_color;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float l = lum(texture(u_input, v_texCoord).rgb);
  float lx = lum(texture(u_input, v_texCoord + vec2(px.x, 0.0)).rgb) - lum(texture(u_input, v_texCoord - vec2(px.x, 0.0)).rgb);
  float ly = lum(texture(u_input, v_texCoord + vec2(0.0, px.y)).rgb) - lum(texture(u_input, v_texCoord - vec2(0.0, px.y)).rgb);
  float e = length(vec2(lx, ly));
  e = smoothstep(u_threshold, u_threshold + 0.15, e);
  vec4 base = texture(u_input, v_texCoord);
  fragColor = vec4(clamp(base.rgb + u_color * e * u_strength, 0.0, 1.0), base.a);
}
`,M=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec2 px = u_amount / max(u_resolution, vec2(1.0));
  vec4 acc = vec4(0.0);
  acc += texture(u_input, v_texCoord) * 0.2;
  acc += texture(u_input, v_texCoord + vec2(px.x, 0.0)) * 0.15;
  acc += texture(u_input, v_texCoord - vec2(px.x, 0.0)) * 0.15;
  acc += texture(u_input, v_texCoord + vec2(0.0, px.y)) * 0.15;
  acc += texture(u_input, v_texCoord - vec2(0.0, px.y)) * 0.15;
  acc += texture(u_input, v_texCoord + px) * 0.1;
  acc += texture(u_input, v_texCoord - px) * 0.1;
  fragColor = acc;
}
`,N=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_angle;
uniform float u_spread;
uniform vec3 u_tint;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec2 uv = v_texCoord - 0.5;
  float ca = cos(u_angle), sa = sin(u_angle);
  float x = uv.x * ca + uv.y * sa;
  float pulse = 0.85 + 0.15 * sin(u_time * 1.7);
  float band = exp(-pow(x / max(u_spread, 0.05), 2.0)) * pulse;
  vec3 leak = u_tint * band * u_intensity;
  // screen blend so highlights bloom without crushing
  vec3 outc = 1.0 - (1.0 - c.rgb) * (1.0 - leak);
  fragColor = vec4(clamp(outc, 0.0, 1.0), c.a);
}
`,P=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_contrast;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  g = (g - 0.5) * u_contrast + 0.5;
  vec3 sep = vec3(
    clamp(g * 1.15 + 0.08, 0.0, 1.0),
    clamp(g * 0.95 + 0.02, 0.0, 1.0),
    clamp(g * 0.72, 0.0, 1.0)
  );
  fragColor = vec4(mix(c.rgb, sep, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,F=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 inv = 1.0 - c.rgb;
  fragColor = vec4(mix(c.rgb, inv, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,I=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_dotSize;
uniform float u_contrast;
uniform float u_intensity;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  g = clamp((g - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float cell = max(u_dotSize, 2.0);
  vec2 px = v_texCoord * u_resolution;
  vec2 cellUv = mod(px, cell) - cell * 0.5;
  float dist = length(cellUv);
  float radius = (1.0 - g) * cell * 0.45;
  float dotMask = 1.0 - smoothstep(radius - 0.8, radius + 0.8, dist);
  vec3 halfTone = mix(vec3(1.0), vec3(0.05), dotMask);
  fragColor = vec4(mix(c.rgb, halfTone, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,L=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform float u_angle;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
const int SAMPLES = 12;
void main() {
  vec2 dir = vec2(cos(u_angle), sin(u_angle)) / max(u_resolution, vec2(1.0));
  float a = u_amount * 8.0;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) / float(SAMPLES - 1) - 0.5) * 2.0;
    acc += texture(u_input, clamp(v_texCoord + dir * a * t, 0.0, 1.0));
  }
  fragColor = acc / float(SAMPLES);
}
`,R={key:`invert`,label:`反转`,default:0,min:0,max:1,step:1},z={"builtin:fx-luma-key":{id:`builtin:fx-luma-key`,name:`黑底叠加`,desc:`把黑色背景变透明、保留亮部，像 Screen 混合——叠加火焰/烟雾/漏光/粒子等黑底素材。`,frag:r,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:3,step:.05},{key:`threshold`,label:`阈值`,default:.03,min:0,max:.2,step:.005},{key:`softness`,label:`柔和`,default:.3,min:.05,max:.8,step:.01},{key:`gamma`,label:`Gamma`,default:.7,min:.3,max:2,step:.05}]},"builtin:fx-local-mosaic":{id:`builtin:fx-local-mosaic`,name:`局部马赛克`,desc:`对矩形区域打码，可调位置/尺寸/块大小/羽化。`,frag:i,props:[{key:`center_x`,label:`中心 X`,default:.5,min:0,max:1,step:.01},{key:`center_y`,label:`中心 Y`,default:.3,min:0,max:1,step:.01},{key:`width_ratio`,label:`宽度`,default:.2,min:0,max:1,step:.01},{key:`height_ratio`,label:`高度`,default:.2,min:0,max:1,step:.01},{key:`block_size`,label:`块大小`,default:20,min:1,max:200,step:1},{key:`feather`,label:`羽化`,default:4,min:0,max:100,step:1}]},"builtin:fx-magnify":{id:`builtin:fx-magnify`,name:`放大镜`,desc:`在指定圆心加一个放大镜头，可调半径/倍率/边框。`,frag:a,props:[{key:`center_x`,label:`中心 X`,default:.5,min:0,max:1,step:.01},{key:`center_y`,label:`中心 Y`,default:.5,min:0,max:1,step:.01},{key:`radius`,label:`半径`,default:.15,min:.01,max:1,step:.01},{key:`magnification`,label:`倍率`,default:2,min:1,max:8,step:.1},{key:`border_width`,label:`边框`,default:4,min:0,max:20,step:1}]},"builtin:fx-rect-mask":{id:`builtin:fx-rect-mask`,name:`方形蒙版`,desc:`把画面裁成圆角矩形，可调位置/尺寸/圆角/羽化/反转。`,frag:o,props:[{key:`center_x`,label:`中心 X`,default:.5,min:0,max:1,step:.01},{key:`center_y`,label:`中心 Y`,default:.5,min:0,max:1,step:.01},{key:`width`,label:`宽度`,default:.5,min:0,max:1,step:.01,uniform:`u_rect_width`},{key:`height`,label:`高度`,default:.5,min:0,max:1,step:.01,uniform:`u_rect_height`},{key:`corner_radius`,label:`圆角`,default:0,min:0,max:1e3,step:1},{key:`feather`,label:`羽化`,default:2,min:0,max:200,step:1},R]},"builtin:fx-circle-mask":{id:`builtin:fx-circle-mask`,name:`圆形蒙版`,desc:`把画面裁成柔边圆形，可调圆心/半径/羽化/反转。`,frag:s,props:[{key:`center_x`,label:`中心 X`,default:.5,min:0,max:1,step:.01},{key:`center_y`,label:`中心 Y`,default:.5,min:0,max:1,step:.01},{key:`radius`,label:`半径`,default:.3,min:0,max:1,step:.01},{key:`feather`,label:`羽化`,default:2,min:0,max:200,step:1},R]},"builtin:fx-crt":{id:`builtin:fx-crt`,name:`CRT 复古显像管`,desc:`模拟 CRT 显像管：扫描线/屏幕弯曲/RGB 偏移/噪点/暗角。动画。`,frag:c,props:[{key:`scanlineIntensity`,label:`扫描线`,default:.4,min:0,max:1,step:.01},{key:`curvature`,label:`弯曲`,default:.15,min:0,max:1,step:.01},{key:`noiseAmount`,label:`噪点`,default:.05,min:0,max:1,step:.01},{key:`rgbShift`,label:`RGB 偏移`,default:.002,min:0,max:.05,step:.001},{key:`brightness`,label:`亮度`,default:1.1,min:0,max:3,step:.05}]},"builtin:fx-ascii-rain":{id:`builtin:fx-ascii-rain`,name:`ASCII 字符雨`,desc:`在视频亮部生成蓝色发光 ASCII 字符雨。`,frag:f,pipeline:e=>{let t=typeof e.u_blurRadius==`number`?e.u_blurRadius:2;return[{frag:f,uniforms:e},{frag:p,uniforms:{u_direction:[t,0]}},{frag:p,uniforms:{u_direction:[0,t]}},{frag:m,inputFrom:0,samplers:{u_bloom:2},uniforms:e}]},props:[{key:`gridSize`,label:`字符大小`,default:8,min:4,max:32,step:1},{key:`glow`,label:`发光强度`,default:1.5,min:0,max:4,step:.1},{key:`blurRadius`,label:`泛光范围`,default:2,min:0,max:8,step:.5},{key:`color`,label:`字符颜色`,kind:`color`,default:[0,.7490196078431373,1],uniform:`u_color`}]},"builtin:fx-shake":{id:`builtin:fx-shake`,name:`手持运镜`,desc:`fbm 噪声抖动 + 旋转/缩放/呼吸，模拟手持相机运动。动画。`,frag:l,props:[{key:`strength`,label:`强度`,default:1.2,min:0,max:5,step:.1},{key:`speed`,label:`速度`,default:1.8,min:0,max:10,step:.1},{key:`zoom`,label:`缩放`,default:1.15,min:1,max:2,step:.01},{key:`rotation`,label:`旋转`,default:.9,min:0,max:5,step:.1},{key:`breathe`,label:`呼吸`,default:.7,min:0,max:3,step:.1}]},"builtin:fx-tilt-shift":{id:`builtin:fx-tilt-shift`,name:`移轴镜头`,desc:`模拟移轴镜头：一条焦点带清晰、上下渐糊 + 饱和度/暗角。两遍可分离高斯模糊。`,frag:u,passes:[u,d],props:[{key:`focusY`,label:`焦点位置`,default:.5,min:0,max:1,step:.01},{key:`focusWidth`,label:`焦点带宽`,default:.2,min:0,max:1,step:.01},{key:`tiltAngle`,label:`倾角`,default:0,min:-3.14159,max:3.14159,step:.01},{key:`blurStrength`,label:`模糊强度`,default:12,min:0,max:40,step:.5},{key:`blurSide`,label:`模糊侧(0双/1上/2下)`,default:0,min:0,max:2,step:1},{key:`saturation`,label:`饱和度`,default:1.3,min:0,max:3,step:.05},{key:`vignette`,label:`暗角`,default:.2,min:0,max:1,step:.01}]},"builtin:fx-chroma-key":{id:`builtin:fx-chroma-key`,name:`色度键/绿幕`,desc:`按键色（默认绿幕）抠除背景，可调容差/羽化/溢色抑制。`,frag:h,props:[{key:`keyColor`,label:`键色`,kind:`color`,default:[0,1,0],uniform:`u_keyColor`},{key:`similarity`,label:`容差`,default:.18,min:0,max:.6,step:.01},{key:`smoothness`,label:`羽化`,default:.08,min:.001,max:.4,step:.005},{key:`spill`,label:`溢色抑制`,default:.5,min:0,max:1,step:.01}]},"builtin:fx-color-wheels":{id:`builtin:fx-color-wheels`,name:`三路色轮`,desc:`调色台三路色轮：lift 暗部偏移、gamma 中间调、gain 亮部增益，均以 0.5 灰为中性，逐通道作用。`,frag:g,props:[{key:`liftColor`,label:`暗部 Lift`,kind:`color`,default:[.5,.5,.5],uniform:`u_liftColor`},{key:`gammaColor`,label:`中间调 Gamma`,kind:`color`,default:[.5,.5,.5],uniform:`u_gammaColor`},{key:`gainColor`,label:`亮部 Gain`,kind:`color`,default:[.5,.5,.5],uniform:`u_gainColor`},{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:fx-levels":{id:`builtin:fx-levels`,name:`色阶`,desc:`输入黑/白场重映射 + 中间调 Gamma + 输出黑/白场（逐通道），配合 inspect_color 的黑白点读数使用。`,frag:_,props:[{key:`inBlack`,label:`输入黑场`,default:0,min:0,max:.5,step:.005},{key:`inWhite`,label:`输入白场`,default:1,min:.5,max:1,step:.005},{key:`gamma`,label:`Gamma`,default:1,min:.2,max:3,step:.02},{key:`outBlack`,label:`输出黑场`,default:0,min:0,max:.5,step:.005},{key:`outWhite`,label:`输出白场`,default:1,min:.5,max:1,step:.005}]},"builtin:fx-highlights-shadows":{id:`builtin:fx-highlights-shadows`,name:`高光/阴影`,desc:`按亮度软掩膜分别调整：提亮暗部（保护高光）、回收或增强高光。`,frag:v,props:[{key:`shadows`,label:`阴影`,default:0,min:-1,max:1,step:.02},{key:`highlights`,label:`高光`,default:0,min:-1,max:1,step:.02},{key:`shadowRange`,label:`阴影范围`,default:.35,min:.1,max:.7,step:.01},{key:`highlightRange`,label:`高光范围`,default:.35,min:.1,max:.7,step:.01}]},"builtin:fx-clarity":{id:`builtin:fx-clarity`,name:`清晰度`,desc:`中间调局部对比（亮度 unsharp）：正值增质感，负值柔化肤质。`,frag:y,props:[{key:`amount`,label:`强度`,default:.35,min:-1,max:1,step:.02},{key:`radius`,label:`半径(px)`,default:24,min:4,max:64,step:1}]},"builtin:fx-hsl-qualify":{id:`builtin:fx-hsl-qualify`,name:`HSL 定向调整`,desc:`二级校色：只对选中的色相区间（中心±宽度+羽化）做色相偏移/饱和度/明度调整；肤色、天空、品牌色定向修。`,frag:b,props:[{key:`hueCenter`,label:`色相中心(°)`,default:25,min:0,max:360,step:1},{key:`hueWidth`,label:`选区宽(°)`,default:25,min:5,max:90,step:1},{key:`softness`,label:`羽化(°)`,default:20,min:1,max:60,step:1},{key:`hueShift`,label:`色相偏移(°)`,default:0,min:-60,max:60,step:1},{key:`satMul`,label:`饱和度×`,default:1,min:0,max:2,step:.02},{key:`lumaMul`,label:`明度×`,default:1,min:.5,max:1.5,step:.01}]},"builtin:fx-vignette":{id:`builtin:fx-vignette`,name:`暗角`,desc:`四周压暗，突出中心主体。可调强度/柔和/圆度。`,frag:x,props:[{key:`amount`,label:`强度`,default:.55,min:0,max:1,step:.01},{key:`softness`,label:`柔和`,default:.45,min:.05,max:1,step:.01},{key:`roundness`,label:`圆度`,default:1,min:.5,max:2,step:.01}]},"builtin:fx-film-grain":{id:`builtin:fx-film-grain`,name:`胶片颗粒`,desc:`动态胶片噪点质感。动画。`,frag:S,props:[{key:`amount`,label:`强度`,default:.18,min:0,max:.6,step:.01},{key:`size`,label:`颗粒大小`,default:1.2,min:.5,max:4,step:.1}]},"builtin:fx-rgb-split":{id:`builtin:fx-rgb-split`,name:`RGB 分离`,desc:`通道错位色差，赛博/故障感。`,frag:C,props:[{key:`amount`,label:`偏移`,default:.008,min:0,max:.05,step:.001},{key:`angle`,label:`方向`,default:0,min:0,max:6.2832,step:.05}]},"builtin:fx-glitch":{id:`builtin:fx-glitch`,name:`故障闪烁`,desc:`横向切片错位 + 偶发反色/色差。动画。`,frag:w,props:[{key:`intensity`,label:`强度`,default:.7,min:0,max:2,step:.05},{key:`blockSize`,label:`切片密度`,default:28,min:4,max:80,step:1}]},"builtin:fx-bloom":{id:`builtin:fx-bloom`,name:`光晕 Bloom`,desc:`亮部溢光，电影高光感。`,frag:ee,props:[{key:`threshold`,label:`阈值`,default:.55,min:0,max:1,step:.01},{key:`intensity`,label:`强度`,default:.85,min:0,max:3,step:.05},{key:`radius`,label:`半径`,default:2.5,min:.5,max:8,step:.1}]},"builtin:fx-pixelate":{id:`builtin:fx-pixelate`,name:`像素化`,desc:`整帧像素块风格化。`,frag:T,props:[{key:`blockSize`,label:`块大小`,default:12,min:2,max:80,step:1}]},"builtin:fx-posterize":{id:`builtin:fx-posterize`,name:`色调分离`,desc:`减少色阶，插画/海报感。`,frag:E,props:[{key:`levels`,label:`色阶`,default:5,min:2,max:16,step:1},{key:`contrast`,label:`对比`,default:1.15,min:.5,max:2.5,step:.05}]},"builtin:fx-duotone":{id:`builtin:fx-duotone`,name:`双色调`,desc:`按亮度映射阴影色与高光色。`,frag:D,props:[{key:`shadowColor`,label:`阴影色`,kind:`color`,default:[.08,.12,.35],uniform:`u_shadowColor`},{key:`highlightColor`,label:`高光色`,kind:`color`,default:[1,.72,.35],uniform:`u_highlightColor`},{key:`contrast`,label:`对比`,default:1.2,min:.5,max:2.5,step:.05},{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:fx-mirror":{id:`builtin:fx-mirror`,name:`镜像对称`,desc:`左右/上下镜像拼贴。mode: 0左→右 1右→左 2上→下 3下→上。`,frag:O,props:[{key:`mode`,label:`模式`,default:0,min:0,max:3,step:1},{key:`axis`,label:`轴线`,default:.5,min:.1,max:.9,step:.01}]},"builtin:fx-fisheye":{id:`builtin:fx-fisheye`,name:`鱼眼`,desc:`桶形畸变广角效果。`,frag:k,props:[{key:`strength`,label:`强度`,default:.55,min:0,max:1.5,step:.01},{key:`zoom`,label:`缩放`,default:1.05,min:.5,max:2,step:.01}]},"builtin:fx-kaleidoscope":{id:`builtin:fx-kaleidoscope`,name:`万花筒`,desc:`径向分片镜像，万花筒图案。`,frag:A,props:[{key:`segments`,label:`分片`,default:6,min:2,max:16,step:1},{key:`angle`,label:`旋转`,default:0,min:0,max:6.2832,step:.05},{key:`zoom`,label:`缩放`,default:1,min:.4,max:2,step:.01}]},"builtin:fx-edge-glow":{id:`builtin:fx-edge-glow`,name:`边缘发光`,desc:`Sobel 边缘检测叠加彩色描边。`,frag:j,props:[{key:`strength`,label:`强度`,default:1.4,min:0,max:4,step:.05},{key:`threshold`,label:`阈值`,default:.08,min:0,max:.5,step:.01},{key:`color`,label:`颜色`,kind:`color`,default:[.4,.9,1],uniform:`u_color`}]},"builtin:fx-soft-blur":{id:`builtin:fx-soft-blur`,name:`柔焦模糊`,desc:`轻量全图柔焦。`,frag:M,props:[{key:`amount`,label:`模糊量`,default:2.5,min:0,max:12,step:.1}]},"builtin:fx-light-leak":{id:`builtin:fx-light-leak`,name:`漏光`,desc:`胶片漏光色带，轻微呼吸动画。`,frag:N,props:[{key:`intensity`,label:`强度`,default:.55,min:0,max:1.5,step:.01},{key:`angle`,label:`角度`,default:.7,min:0,max:6.2832,step:.05},{key:`spread`,label:`宽度`,default:.35,min:.05,max:1,step:.01},{key:`tint`,label:`色调`,kind:`color`,default:[1,.45,.2],uniform:`u_tint`}]},"builtin:fx-sepia":{id:`builtin:fx-sepia`,name:`棕褐色`,desc:`经典 Sepia 复古染色。`,frag:P,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01},{key:`contrast`,label:`对比`,default:1.1,min:.5,max:2,step:.05}]},"builtin:fx-invert":{id:`builtin:fx-invert`,name:`反色`,desc:`RGB 反相，负片/故障风格。`,frag:F,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:fx-halftone":{id:`builtin:fx-halftone`,name:`半色调网点`,desc:`印刷网点/漫画圆点风格。`,frag:I,props:[{key:`dotSize`,label:`网点大小`,default:8,min:2,max:32,step:1},{key:`contrast`,label:`对比`,default:1.3,min:.5,max:2.5,step:.05},{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:fx-motion-blur":{id:`builtin:fx-motion-blur`,name:`运动模糊`,desc:`定向拖影，表现速度感。`,frag:L,props:[{key:`amount`,label:`模糊量`,default:2.5,min:0,max:12,step:.1},{key:`angle`,label:`方向`,default:0,min:0,max:6.2832,step:.05}]}},B=`builtin:fx-rect-mask.builtin:fx-circle-mask.builtin:fx-local-mosaic.builtin:fx-magnify.builtin:fx-tilt-shift.builtin:fx-crt.builtin:fx-ascii-rain.builtin:fx-shake.builtin:fx-luma-key.builtin:fx-chroma-key.builtin:fx-color-wheels.builtin:fx-levels.builtin:fx-highlights-shadows.builtin:fx-clarity.builtin:fx-hsl-qualify.builtin:fx-vignette.builtin:fx-film-grain.builtin:fx-rgb-split.builtin:fx-glitch.builtin:fx-bloom.builtin:fx-pixelate.builtin:fx-posterize.builtin:fx-duotone.builtin:fx-mirror.builtin:fx-fisheye.builtin:fx-kaleidoscope.builtin:fx-edge-glow.builtin:fx-soft-blur.builtin:fx-light-leak.builtin:fx-sepia.builtin:fx-invert.builtin:fx-halftone.builtin:fx-motion-blur`.split(`.`),V=[...B.filter(e=>e in z),...Object.keys(z).filter(e=>!B.includes(e))],H={"builtin:slog3-s709":{id:`builtin:slog3-s709`,name:`Sony S-Log3 → s709`,desc:`Sony S-Log3 / S-Gamut3.Cine → Rec.709。.cube 三维查找表（Sony_Slog3_s709.cube, 33³）+ 通用 lut.frag（sampler3D，BT.709 编解码包夹）`,frag:n,cube:`/luts/Sony_Slog3_s709.cube`,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:canon-log3-709":{id:`builtin:canon-log3-709`,name:`Canon Log 3 → BT.709`,desc:`Canon Cinema Gamut / Canon Log 3 → Canon 709。.cube 三维查找表（CinemaGamut_CanonLog3-to-Canon709_33_Ver.1.0.cube, 33³）+ 通用 lut.frag`,frag:n,cube:`/luts/CinemaGamut_CanonLog3-to-Canon709_33_Ver.1.0.cube`,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01}]},"builtin:look-teal-orange":{id:`builtin:look-teal-orange`,name:`青橙电影感`,desc:`阴影偏青、高光偏橙的好莱坞调色。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_contrast;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 g = (c.rgb - 0.5) * u_contrast + 0.5;
  float lum = dot(g, vec3(0.299, 0.587, 0.114));
  // push shadows teal, highlights orange
  vec3 teal = vec3(0.15, 0.45, 0.55);
  vec3 orange = vec3(0.95, 0.55, 0.25);
  vec3 grade = mix(teal * lum * 1.4, orange * (0.4 + lum * 0.9), smoothstep(0.25, 0.75, lum));
  // keep some original chroma
  vec3 mixed = mix(g, mix(g * 0.55 + grade * 0.45, grade, 0.35), 1.0);
  fragColor = vec4(mix(c.rgb, clamp(mixed, 0.0, 1.0), u_intensity), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.85,min:0,max:1,step:.01},{key:`contrast`,label:`对比`,default:1.1,min:.6,max:1.8,step:.02}]},"builtin:look-mono":{id:`builtin:look-mono`,name:`黑白胶片`,desc:`高对比黑白 + 轻微动态颗粒。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_contrast;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float y = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  y = clamp((y - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float n = (hash(v_texCoord * 400.0 + floor(u_time * 20.0)) - 0.5) * u_grain;
  vec3 mono = vec3(clamp(y + n, 0.0, 1.0));
  fragColor = vec4(mix(c.rgb, mono, u_intensity), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:1,min:0,max:1,step:.01},{key:`contrast`,label:`对比`,default:1.25,min:.6,max:2.2,step:.02},{key:`grain`,label:`颗粒`,default:.08,min:0,max:.4,step:.01}]},"builtin:look-warm":{id:`builtin:look-warm`,name:`暖调复古`,desc:`偏暖色温与轻度褪色，复古质感。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_temperature;
uniform float u_fade;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 w = c.rgb;
  w.r *= 1.0 + u_temperature * 0.25;
  w.b *= 1.0 - u_temperature * 0.2;
  w = mix(w, vec3(dot(w, vec3(0.3))), u_fade * 0.35); // slight desat
  w = mix(w, w * vec3(1.05, 0.95, 0.8), 0.35); // warm matte
  fragColor = vec4(mix(c.rgb, clamp(w, 0.0, 1.0), u_intensity), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`temperature`,label:`色温`,default:.7,min:0,max:1.5,step:.02},{key:`fade`,label:`褪色`,default:.35,min:0,max:1,step:.01}]},"builtin:look-cool":{id:`builtin:look-cool`,name:`冷调青蓝`,desc:`偏冷色温，阴影加压蓝。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_temperature;
uniform float u_shadows;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 col = c.rgb;
  col.b *= 1.0 + u_temperature * 0.22;
  col.r *= 1.0 - u_temperature * 0.12;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.75, 0.9, 1.15), (1.0 - lum) * u_shadows);
  fragColor = vec4(mix(c.rgb, clamp(col, 0.0, 1.0), u_intensity), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.85,min:0,max:1,step:.01},{key:`temperature`,label:`冷度`,default:.75,min:0,max:1.5,step:.02},{key:`shadows`,label:`阴影蓝`,default:.55,min:0,max:1,step:.01}]},"builtin:look-sunset":{id:`builtin:look-sunset`,name:`日落暖金`,desc:`高光偏金、阴影压暖的黄昏感。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_warmth;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 warm = c.rgb * vec3(1.0 + 0.25 * u_warmth, 1.0, 1.0 - 0.15 * u_warmth);
  warm.r = clamp(warm.r + 0.08 * u_warmth, 0.0, 1.5);
  warm.b = clamp(warm.b - 0.05 * u_warmth + g * 0.05, 0.0, 1.0);
  // soft highlight lift toward peach
  warm = mix(warm, vec3(1.0, 0.78, 0.55), smoothstep(0.55, 1.0, g) * 0.18 * u_warmth);
  fragColor = vec4(mix(c.rgb, warm, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`warmth`,label:`暖度`,default:1,min:0,max:1.5,step:.02}]},"builtin:look-cyber":{id:`builtin:look-cyber`,name:`赛博霓虹`,desc:`阴影青蓝、高光品红的霓虹科幻调。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_contrast;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  vec3 x = (c.rgb - 0.5) * u_contrast + 0.5;
  // crush mids toward magenta/cyan split
  float g = dot(x, vec3(0.299, 0.587, 0.114));
  vec3 shadows = mix(x, vec3(0.05, 0.35, 0.55), 0.45);
  vec3 highs = mix(x, vec3(1.0, 0.25, 0.75), 0.35);
  vec3 look = mix(shadows, highs, smoothstep(0.25, 0.75, g));
  look.b = clamp(look.b + 0.08, 0.0, 1.2);
  fragColor = vec4(mix(c.rgb, look, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.85,min:0,max:1,step:.01},{key:`contrast`,label:`对比`,default:1.2,min:.6,max:2,step:.02}]},"builtin:look-bleach":{id:`builtin:look-bleach`,name:`漂白旁路`,desc:`低饱和 + 抬黑的漂白旁路电影感。`,frag:`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_fade;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_input, v_texCoord);
  float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  // desaturate + lift blacks (bleach bypass-ish)
  vec3 desat = mix(c.rgb, vec3(g), 0.55);
  desat = mix(desat, desat * desat * (3.0 - 2.0 * desat), 0.25); // soft contrast
  desat = mix(desat, vec3(0.5), u_fade * 0.35); // faded lift
  desat = clamp(desat * 1.08, 0.0, 1.0);
  fragColor = vec4(mix(c.rgb, desat, clamp(u_intensity, 0.0, 1.0)), c.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`fade`,label:`褪色`,default:.45,min:0,max:1,step:.01}]},"builtin:look-fuji-chrome":{id:`builtin:look-fuji-chrome`,name:`富士 Classic Chrome`,desc:`低饱和、柔和对比、中灰偏冷——旅行/街拍纪录片感（灵感自富士胶片模拟，非官方 LUT）。`,frag:`#version 300 es
precision highp float;
// Inspired by Fuji Classic Chrome film sim: muted chroma, soft S-curve,
// cool-leaning mids and a documentary travel-editorial look. Not an official LUT.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_fade;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 softContrast(vec3 c, float k) {
  // gentle S-curve
  vec3 x = clamp(c, 0.0, 1.0);
  return mix(x, x * x * (3.0 - 2.0 * x), k);
}

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // desaturate (chrome = restrained)
  c = mix(vec3(lum), c, 0.72);
  // lift blacks slightly (matte print)
  c = mix(c, max(c, vec3(0.06)), u_fade * 0.45);
  c = softContrast(c, 0.28);
  // cool mids + slightly warm highs
  c.b = clamp(c.b + 0.04 * (1.0 - lum), 0.0, 1.0);
  c.r = clamp(c.r + 0.025 * smoothstep(0.45, 0.95, lum), 0.0, 1.0);
  c.g = clamp(c.g * 0.98, 0.0, 1.0);
  // fine grain
  float n = (hash(v_texCoord * 520.0 + floor(u_time * 18.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.92,min:0,max:1,step:.01},{key:`fade`,label:`褪色`,default:.4,min:0,max:1,step:.01},{key:`grain`,label:`颗粒`,default:.06,min:0,max:.35,step:.01}]},"builtin:look-fuji-portra":{id:`builtin:look-fuji-portra`,name:`富士人像 Pro Neg`,desc:`奶油肤色、粉柔高光、抬黑阴影——人像/生活感（灵感自 Portra / Pro Neg）。`,frag:`#version 300 es
precision highp float;
// Inspired by Kodak/Fuji portrait stock (Portra / Pro Neg Hi): soft pastel,
// creamy skin, lifted shadows, gentle warm bias. Not an official LUT.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_warmth;
uniform float u_softness;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // soft contrast (low mid punch)
  c = mix(c, (c - 0.5) * 0.88 + 0.5, u_softness);
  // lift shadows, roll off highlights
  c = mix(c, max(c, vec3(0.08 + lum * 0.05)), 0.35);
  c = min(c, vec3(0.96));
  // warm pastel: peach mids, soft green control
  c.r = clamp(c.r * (1.0 + 0.12 * u_warmth), 0.0, 1.2);
  c.g = clamp(c.g * (1.0 + 0.04 * u_warmth) - 0.02, 0.0, 1.1);
  c.b = clamp(c.b * (1.0 - 0.1 * u_warmth) + 0.02, 0.0, 1.0);
  // slight desat on high chroma (skin-friendly)
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float sat = maxc - minc;
  c = mix(vec3(lum), c, mix(1.0, 0.82, smoothstep(0.15, 0.55, sat)));
  float n = (hash(v_texCoord * 380.0 + floor(u_time * 12.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`warmth`,label:`暖度`,default:.85,min:0,max:1.5,step:.02},{key:`softness`,label:`柔和`,default:.7,min:0,max:1,step:.02},{key:`grain`,label:`颗粒`,default:.05,min:0,max:.3,step:.01}]},"builtin:look-fuji-velvia":{id:`builtin:look-fuji-velvia`,name:`富士 Velvia 风光`,desc:`高饱和绿/蓝、通透对比——景区/自然风光（灵感自 Velvia 反转片）。`,frag:`#version 300 es
precision highp float;
// Inspired by Fuji Velvia / vivid landscape stock: punchy greens & blues,
// deep contrast, saturated travel photos. Not an official LUT.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = (c - 0.5) * u_contrast + 0.5;
  // boost green/blue channels selectively (landscape)
  c.g = clamp(c.g * (1.0 + 0.18 * u_saturation), 0.0, 1.25);
  c.b = clamp(c.b * (1.0 + 0.14 * u_saturation), 0.0, 1.2);
  c.r = clamp(c.r * (1.0 + 0.06 * u_saturation), 0.0, 1.15);
  c = mix(vec3(lum), c, 0.55 + 0.45 * u_saturation);
  // slightly cooler shadows
  c.b = clamp(c.b + 0.03 * (1.0 - lum), 0.0, 1.0);
  float n = (hash(v_texCoord * 450.0 + floor(u_time * 16.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.88,min:0,max:1,step:.01},{key:`saturation`,label:`饱和`,default:1.1,min:.4,max:1.8,step:.02},{key:`contrast`,label:`对比`,default:1.15,min:.7,max:1.8,step:.02},{key:`grain`,label:`颗粒`,default:.04,min:0,max:.25,step:.01}]},"builtin:look-ricoh-gr":{id:`builtin:look-ricoh-gr`,name:`理光 GR 街拍`,desc:`硬一点对比、冷中性灰、城市纪实——GR 随手拍感（灵感自理光街拍审美）。`,frag:`#version 300 es
precision highp float;
// Inspired by Ricoh GR street aesthetic: hard-ish contrast, cool-neutral
// mids, crisp edges feel, slight green-gray city cast. Not an official profile.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_contrast;
uniform float u_cool;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.2, 289.7))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // punchy mid contrast (street snap)
  c = (c - 0.5) * u_contrast + 0.5;
  // slight green-gray + cool (GR "realistic" street)
  c.g = clamp(c.g * (1.0 + 0.04 * u_cool), 0.0, 1.1);
  c.b = clamp(c.b * (1.0 + 0.08 * u_cool), 0.0, 1.15);
  c.r = clamp(c.r * (1.0 - 0.05 * u_cool), 0.0, 1.05);
  // mild desat for documentary
  c = mix(vec3(lum), c, 0.88);
  // crush deep blacks a bit
  c = max(c - vec3(0.02), vec3(0.0));
  c *= 1.04;
  float n = (hash(v_texCoord * 600.0 + floor(u_time * 22.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`contrast`,label:`对比`,default:1.22,min:.8,max:1.8,step:.02},{key:`cool`,label:`冷调`,default:.75,min:0,max:1.5,step:.02},{key:`grain`,label:`颗粒`,default:.07,min:0,max:.35,step:.01}]},"builtin:look-kodak-gold":{id:`builtin:look-kodak-gold`,name:`柯达金 Gold`,desc:`暖黄绿怀旧、软对比——千禧年随手拍 / 家庭相册感（灵感自 Kodak Gold）。`,frag:`#version 300 es
precision highp float;
// Inspired by Kodak Gold / consumer color negative: warm yellow-green nostalgia,
// soft contrast and a millennium snapshot feel. Not an official LUT.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_yellow;
uniform float u_fade;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(15.3, 92.1))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // soft S + lift
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);
  c = mix(c, max(c, vec3(0.07)), u_fade * 0.5);
  // gold: push yellow (r+g), pull blue
  c.r = clamp(c.r * (1.0 + 0.14 * u_yellow), 0.0, 1.2);
  c.g = clamp(c.g * (1.0 + 0.1 * u_yellow) + 0.02, 0.0, 1.15);
  c.b = clamp(c.b * (1.0 - 0.16 * u_yellow), 0.0, 1.0);
  // slight green cast in shadows (old consumer neg)
  c.g = clamp(c.g + 0.03 * (1.0 - lum) * u_yellow, 0.0, 1.1);
  c = mix(vec3(lum), c, 0.9);
  float n = (hash(v_texCoord * 340.0 + floor(u_time * 14.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.9,min:0,max:1,step:.01},{key:`yellow`,label:`金黄`,default:1,min:0,max:1.5,step:.02},{key:`fade`,label:`褪色`,default:.4,min:0,max:1,step:.01},{key:`grain`,label:`颗粒`,default:.08,min:0,max:.4,step:.01}]},"builtin:look-disposable":{id:`builtin:look-disposable`,name:`拍立得 / 一次性`,desc:`软糊、绿偏、粗颗粒、暗角——拍立得与一次性相机那味。`,frag:`#version 300 es
precision highp float;
// Inspired by disposable, instant, and cheap point-and-shoot cameras: soft focus feel via
// mild blur-like desat, green-magenta cast, heavy grain, vignette-ish edges.
// Not an official film stock.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_cast;
uniform float u_grain;
uniform float u_vignette;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(19.1, 67.3))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  // low contrast, lifted black / crushed white
  c = mix(c, vec3(0.15 + lum * 0.7), 0.35);
  c = mix(vec3(lum), c, 0.75);
  // green-yellow cast + slight magenta in highs
  c.g = clamp(c.g + 0.06 * u_cast, 0.0, 1.1);
  c.r = clamp(c.r + 0.03 * u_cast * smoothstep(0.5, 1.0, lum), 0.0, 1.1);
  c.b = clamp(c.b - 0.04 * u_cast + 0.03 * smoothstep(0.6, 1.0, lum), 0.0, 1.0);
  // vignette
  vec2 uv = v_texCoord * 2.0 - 1.0;
  float v = smoothstep(1.4, 0.35, length(uv));
  c *= mix(1.0, v, u_vignette);
  // chunky grain
  float n = (hash(v_texCoord * 280.0 + floor(u_time * 10.0)) - 0.5) * u_grain;
  float n2 = (hash(v_texCoord * 90.0 + 3.7) - 0.5) * u_grain * 0.5;
  c = clamp(c + n + n2, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.92,min:0,max:1,step:.01},{key:`cast`,label:`偏色`,default:.9,min:0,max:1.5,step:.02},{key:`grain`,label:`颗粒`,default:.16,min:0,max:.5,step:.01},{key:`vignette`,label:`暗角`,default:.45,min:0,max:1,step:.01}]},"builtin:look-cinestill":{id:`builtin:look-cinestill`,name:`CineStill 夜景`,desc:`钨丝灯冷青、高光微溢——夜街/霓虹（灵感自 CineStill 800T）。`,frag:`#version 300 es
precision highp float;
// Inspired by CineStill 800T night look: cool tungsten base, cyan-ish
// highlight bloom suggestion, contrasty night city. Not an official LUT.
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_cyan;
uniform float u_contrast;
uniform float u_grain;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(33.7, 91.2))) * 43758.5453); }

void main() {
  vec4 src = texture(u_input, v_texCoord);
  vec3 c = src.rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = (c - 0.5) * u_contrast + 0.5;
  // tungsten → cooler shadows, cyan-magenta split
  c.b = clamp(c.b + 0.1 * u_cyan * (1.0 - lum), 0.0, 1.2);
  c.g = clamp(c.g + 0.04 * u_cyan, 0.0, 1.15);
  c.r = clamp(c.r - 0.05 * u_cyan * (1.0 - lum) + 0.06 * smoothstep(0.55, 1.0, lum), 0.0, 1.15);
  // highlight glow suggestion (lift brights toward cyan-white)
  float hi = smoothstep(0.65, 0.95, lum);
  c = mix(c, min(c * vec3(0.9, 1.05, 1.12) + 0.08, vec3(1.0)), hi * 0.45 * u_cyan);
  float n = (hash(v_texCoord * 500.0 + floor(u_time * 20.0)) - 0.5) * u_grain;
  c = clamp(c + n, 0.0, 1.0);
  fragColor = vec4(mix(src.rgb, c, clamp(u_intensity, 0.0, 1.0)), src.a);
}
`,props:[{key:`intensity`,label:`强度`,default:.88,min:0,max:1,step:.01},{key:`cyan`,label:`青冷`,default:.95,min:0,max:1.5,step:.02},{key:`contrast`,label:`对比`,default:1.18,min:.7,max:1.8,step:.02},{key:`grain`,label:`颗粒`,default:.09,min:0,max:.4,step:.01}]}},U=[`builtin:slog3-s709`,`builtin:canon-log3-709`,`builtin:look-fuji-chrome`,`builtin:look-fuji-portra`,`builtin:look-fuji-velvia`,`builtin:look-ricoh-gr`,`builtin:look-kodak-gold`,`builtin:look-disposable`,`builtin:look-cinestill`,`builtin:look-teal-orange`,`builtin:look-mono`,`builtin:look-warm`,`builtin:look-cool`,`builtin:look-sunset`,`builtin:look-cyber`,`builtin:look-bleach`],W=[...U.filter(e=>e in H),...Object.keys(H).filter(e=>!U.includes(e))];function G(e,t){let n=t?.[e.key];if(e.kind===`color`)return Array.isArray(n)&&n.length===3&&n.every(Number.isFinite)?n.map(e=>Math.min(1,Math.max(0,e))):[...e.default];let r=typeof n==`number`&&Number.isFinite(n)?n:e.default;return Math.min(e.max,Math.max(e.min,r))}function K(e,t){let n={};for(let r of e.props)n[r.uniform??`u_${r.key}`]=G(r,t);return n}function q(e,n){let r=[];for(let{def:i,overrides:a}of e){let e={...K(i,a),u_time:n},o;i.cube&&(o=t(i.cube)??void 0,o||(e.u_intensity=0));let s=i.pipeline?.(e)??i.passes?.map(t=>({frag:t,uniforms:e}))??[{frag:i.frag,uniforms:e,lut3d:o}],c=r.length;for(let e of s)r.push({...e,inputFrom:e.inputFrom==null?void 0:e.inputFrom+c,samplers:e.samplers?Object.fromEntries(Object.entries(e.samplers).map(([e,t])=>[e,t+c])):void 0})}return r}var J=e({ALL_FX:()=>Y,CUSTOM_FX:()=>X,FX_EFFECTS:()=>z,FX_IDS:()=>V,FX_ORDER:()=>B,LUT_EFFECTS:()=>H,LUT_FRAG:()=>Z,LUT_IDS:()=>W,LUT_ORDER:()=>U,fxUniform:()=>G,fxUniforms:()=>K,registerCustomFx:()=>$,serializableDefsFor:()=>Q,unregisterCustomFx:()=>te}),Y={...z,...H},X={},Z=n;function Q(e){let t=[];for(let{assetId:n}of e){if(n.startsWith(`builtin:`))continue;let e=Y[n];!e||e.pipeline||t.push({id:e.id,name:e.name,desc:e.desc,frag:e.frag,props:e.props,...e.passes?{passes:e.passes}:{},...e.cube?{cube:e.cube}:{}})}return t}function $(e){return X[e.id]=e,Y[e.id]=e,e}function te(e){return e in X?(delete X[e],delete Y[e],!0):!1}export{Q as a,H as c,V as d,$ as i,W as l,X as n,q as o,J as r,K as s,Y as t,z as u};