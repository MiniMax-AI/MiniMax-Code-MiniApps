import{o as e,r as t}from"./rolldown-runtime-DAXXjFlN.js";import{t as n}from"./jsx-runtime-CFwixLRt.js";import{t as r}from"./react-BUD3sqOU.js";import{c as i,f as a,h as o,n as s,s as c}from"./timelineTypes-ByqYDMU3.js";import{n as l,o as u,r as d}from"./transitionTypes-Ddocyu6d.js";import{i as f,n as p,t as m}from"./backgroundFill-0BWykgoV.js";import{n as h,o as g}from"./sourceLimit-kmG0lWZ1.js";import{n as _,s as v}from"./keyframes-DEJTOnAx.js";import{i as y,r as b,t as x}from"./sequenceGraph-CcGH3Igr.js";import{n as S,t as C}from"./cube-B1EadsXn.js";import{a as w,i as T,o as E}from"./edit-CIfZdEp_.js";import{r as D}from"./googleFontCatalog-CgoK_900.js";import{a as O,c as k,g as A,h as j,i as M,l as N,m as P,o as F,p as I,s as L,u as R}from"./id3-C6bzcgAm.js";import{D as z,E as B,O as V,T as H,_ as U,a as W,c as G,d as ee,f as te,g as ne,h as re,l as K,m as ie,n as ae,o as oe,p as q,s as se,t as J,u as Y,v as ce,w as le,x as ue}from"./esm-DFkn3VjL.js";import{_ as de,g as fe,h as pe}from"./resolve-BFd4N-f_.js";import{n as X,t as me}from"./captionPages-D_cZ95IN.js";import{a as he,i as ge,o as _e,t as ve}from"./renderStyles-CDxiIOpQ.js";import{n as ye,r as be}from"./captionMotion-CrsWeQoN.js";import{n as xe}from"./lanes-DCbZ4gdC.js";import{a as Se,p as Ce}from"./flexCrop-Co-sOcxG.js";import{a as we,i as Te,r as Ee,s as De}from"./zoom-EtwaISdW.js";import{i as Oe,o as ke,t as Ae}from"./effects-c377Awor.js";import{n as je,t as Me}from"./template-host-BxkOM6IK.js";import{r as Ne,t as Pe}from"./projectFonts-DAMIuY0o.js";var Z=n(),Q=e(r(),1),Fe={"cross-dissolve":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_easingAmount;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 outColor = texture(u_outgoing, v_texCoord);
  vec4 inColor = texture(u_incoming, v_texCoord);

  float smoothP = smoothstep(0.0, 1.0, u_progress);
  float p = mix(u_progress, smoothP, u_easingAmount);

  fragColor = mix(outColor, inColor, p);
}
`,uniforms:()=>({u_easingAmount:1})},"dip-to-black":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_blackDuration;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  float halfDuration = u_blackDuration * 0.5;

  float outEnd = clamp(0.5 - halfDuration, 0.01, 0.49);
  float inStart = clamp(0.5 + halfDuration, 0.51, 0.99);

  float outAlpha = 1.0 - smoothstep(0.0, outEnd, u_progress);
  float inAlpha = smoothstep(inStart, 1.0, u_progress);

  vec4 outColor = texture(u_outgoing, v_texCoord);
  vec4 inColor = texture(u_incoming, v_texCoord);

  vec3 finalColor = (outColor.rgb * outAlpha) + (inColor.rgb * inAlpha);
  float finalAlpha = mix(outColor.a, inColor.a, u_progress);

  fragColor = vec4(finalColor, finalAlpha);
}
`,uniforms:()=>({u_blackDuration:.2})},flash:{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;

uniform vec3 u_flashColor;
uniform float u_flashHold;
uniform float u_overexposure;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    float holdHalf = u_flashHold * 0.5;
    float holdStart = 0.5 - holdHalf;
    float holdEnd = 0.5 + holdHalf;

    float attack = smoothstep(0.0, holdStart, u_progress);
    float decay = 1.0 - smoothstep(holdEnd, 1.0, u_progress);

    float flashBase = min(attack, decay);
    float flashAmount = smoothstep(0.0, 1.0, flashBase);

    float texMix = step(0.5, u_progress);
    vec4 colorOut = texture(u_outgoing, v_texCoord);
    vec4 colorIn = texture(u_incoming, v_texCoord);
    vec4 baseColor = mix(colorOut, colorIn, texMix);

    vec3 exposed = baseColor.rgb * (1.0 + flashAmount * u_overexposure);
    vec3 finalColor = mix(exposed, u_flashColor, flashAmount);

    fragColor = vec4(finalColor, baseColor.a);
}
`,uniforms:()=>({u_flashColor:[1,1,1],u_flashHold:.1,u_overexposure:2})},"luma-blend":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;

uniform float u_intensity;
uniform float u_additiveAmount;
uniform float u_threshold;

in vec2 v_texCoord;
out vec4 fragColor;

const float PI = 3.14159265359;

float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    float p = smoothstep(0.0, 1.0, u_progress);

    vec4 cOut = texture(u_outgoing, v_texCoord);
    vec4 cIn = texture(u_incoming, v_texCoord);

    float lumaOut = luminance(cOut.rgb);
    float lumaIn = luminance(cIn.rgb);

    float curve = sin(p * PI);

    float maskOut = smoothstep(u_threshold, 1.0, lumaOut);
    float maskIn = smoothstep(u_threshold, 1.0, lumaIn);

    float boostOut = 1.0 + maskOut * u_intensity * curve;
    float boostIn = 1.0 + maskIn * u_intensity * curve;

    vec3 modOut = cOut.rgb * (1.0 - p) * boostOut;
    vec3 modIn = cIn.rgb * p * boostIn;

    vec3 screenBlend = 1.0 - (1.0 - clamp(modOut, 0.0, 1.0)) * (1.0 - clamp(modIn, 0.0, 1.0));
    vec3 addBlend = clamp(modOut + modIn, 0.0, 1.0);

    vec3 finalColor = mix(screenBlend, addBlend, u_additiveAmount);

    float finalAlpha = clamp(cOut.a * (1.0 - p) + cIn.a * p, 0.0, 1.0);

    fragColor = vec4(finalColor, finalAlpha);
}
`,uniforms:()=>({u_intensity:2,u_additiveAmount:.5,u_threshold:.3})},"soft-wipe":{frag:`#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_feather;
uniform float u_parallax;

in vec2 v_texCoord;
out vec4 fragColor;

float easeInOutCubic(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
    float p = easeInOutCubic(u_progress);

    float f = max(u_feather, 0.001);
    float wipePos = p * (1.0 + f) - f;

    float edge0 = wipePos;
    float edge1 = wipePos + f;

    float mixVal = smoothstep(edge0, edge1, v_texCoord.x);

    vec2 uvOut = v_texCoord - vec2(p * u_parallax, 0.0);
    vec2 uvIn = v_texCoord + vec2((1.0 - p) * u_parallax, 0.0);

    vec4 colorOut = texture(u_outgoing, uvOut);
    vec4 colorIn = texture(u_incoming, uvIn);

    float shadow = 1.0 - (sin(mixVal * 3.14159265) * 0.15);

    fragColor = mix(colorIn, colorOut, mixVal);
    fragColor.rgb *= shadow;
}
`,uniforms:()=>({u_feather:.4,u_parallax:.05})},"whip-pan":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;

uniform vec2 u_dir;
uniform float u_blurStrength;
uniform float u_bounceback;

in vec2 v_texCoord;
out vec4 fragColor;

const int SAMPLES = 32;

vec4 getScene(vec2 uv, float offset) {
    vec2 tapeUV = uv + u_dir * offset;
    vec2 uvA = tapeUV;
    vec2 uvB = tapeUV - u_dir;

    vec4 cA = texture(u_outgoing, uvA);
    vec4 cB = texture(u_incoming, uvB);

    float mask = 0.0;
    if (u_dir.x > 0.5) mask = smoothstep(0.99, 1.01, tapeUV.x);
    else if (u_dir.x < -0.5) mask = smoothstep(0.01, -0.01, tapeUV.x);
    else if (u_dir.y > 0.5) mask = smoothstep(0.99, 1.01, tapeUV.y);
    else if (u_dir.y < -0.5) mask = smoothstep(0.01, -0.01, tapeUV.y);

    return mix(cA, cB, mask);
}

float ease(float t, float bounce) {
    if (t < 0.5) {
        return 4.0 * t * t * t;
    } else {
        float f = (t - 1.0) * 2.0;
        float b = bounce * 5.0;
        return 1.0 + 0.5 * (f * f * ((b + 1.0) * f + b));
    }
}

void main() {
    float offset = ease(u_progress, u_bounceback);

    float offsetNext = ease(clamp(u_progress + 0.01, 0.0, 1.0), u_bounceback);
    float offsetPrev = ease(clamp(u_progress - 0.01, 0.0, 1.0), u_bounceback);
    float velocity = (offsetNext - offsetPrev) / 0.02;

    float jitter = fract(sin(dot(v_texCoord, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;

    vec4 color = vec4(0.0);
    float blurLength = velocity * u_blurStrength;

    for (int i = 0; i < SAMPLES; i++) {
        float f = (float(i) + jitter + 0.5) / float(SAMPLES);
        float sampleOffset = offset + blurLength * (f - 0.5);
        color += getScene(v_texCoord, sampleOffset);
    }

    fragColor = color / float(SAMPLES);
}
`,uniforms:({direction:e})=>({u_dir:e===`right`?[-1,0]:e===`up`?[0,-1]:e===`down`?[0,1]:[1,0],u_blurStrength:.15,u_bounceback:.1})},"page-curl":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
uniform float u_radius;
uniform vec3 u_paperTint;
uniform float u_glossiness;

in vec2 v_texCoord;
out vec4 fragColor;

#define PI 3.14159265359

// Hash function for procedural noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Value noise for paper grain
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

void main() {
    // Smooth easeInOut for organic flip motion
    float p = u_progress < 0.5
        ? 2.0 * u_progress * u_progress
        : 1.0 - pow(-2.0 * u_progress + 2.0, 2.0) / 2.0;

    vec2 uv = v_texCoord;
    vec2 aspect_uv = vec2(uv.x * u_aspect, uv.y);

    // Fixed angle for a cinematic right-to-left downward flip
    float angle_rad = 15.0 * PI / 180.0;
    vec2 dir = normalize(vec2(-cos(angle_rad), sin(angle_rad)));

    // Calculate bounds to ensure shadows clear the screen
    vec2 c00 = vec2(0.0, 0.0);
    vec2 c10 = vec2(u_aspect, 0.0);
    vec2 c01 = vec2(0.0, 1.0);
    vec2 c11 = vec2(u_aspect, 1.0);

    float d00 = dot(c00, dir);
    float d10 = dot(c10, dir);
    float d01 = dot(c01, dir);
    float d11 = dot(c11, dir);

    float min_d = min(min(d00, d10), min(d01, d11));
    float max_d = max(max(d00, d10), max(d01, d11));

    // Drive the fold position across the screen
    float fold_pos = mix(min_d - u_radius * 2.5, max_d + u_radius * 2.5, p);

    // Distance of current pixel to the fold line
    float d = dot(aspect_uv, dir) - fold_pos;

    vec4 color = texture(u_incoming, uv);

    if (d > u_radius) {
        // Right of fold: flat outgoing page
        color = texture(u_outgoing, uv);

        // Soft shadow cast by the lifted page
        float shadow_out = smoothstep(u_radius, u_radius * 2.5, d);
        color.rgb *= mix(0.75, 1.0, shadow_out);

    } else if (d > 0.0) {
        // Under the curl cylinder
        float ratio = clamp(d / u_radius, 0.0, 1.0);
        float normal_z = sqrt(max(0.0, 1.0 - ratio * ratio));

        // Layer 1: Flat page at the bottom
        vec4 flat_color = texture(u_outgoing, uv);
        float ao = mix(0.25, 1.0, ratio); // Ambient occlusion near crease
        flat_color.rgb *= ao;

        // Layer 2: Bottom of curl (outgoing video bending up)
        float theta_bottom = asin(ratio);
        float L_bottom = u_radius * theta_bottom;
        vec2 aspect_uv_bottom = aspect_uv - dir * (d + L_bottom);
        vec2 uv_bottom = vec2(aspect_uv_bottom.x / u_aspect, aspect_uv_bottom.y);

        vec4 bottom_color = texture(u_outgoing, uv_bottom);

        // Cylinder normal and lighting vector for specular
        vec3 N = vec3(-ratio, 0.0, normal_z);
        vec3 L = normalize(vec3(-0.6, 0.3, 0.7));
        float ndotl = max(0.0, dot(N, L));

        float diffuse = mix(0.7, 1.1, normal_z);
        bottom_color.rgb *= diffuse;

        // Sharp glossy specular highlight
        float specular = pow(ndotl, 64.0) * u_glossiness * 1.5;
        bottom_color.rgb += specular;

        // Edge masking and thickness rim for bottom curl
        float edge_dist_b = min(min(uv_bottom.x, 1.0 - uv_bottom.x), min(uv_bottom.y, 1.0 - uv_bottom.y));
        float fw_b = max(fwidth(edge_dist_b), 0.001);
        float bottom_alpha = smoothstep(-fw_b, fw_b, edge_dist_b);

        float thickness = 0.004;
        float is_edge_b = 1.0 - smoothstep(thickness - fw_b, thickness + fw_b, edge_dist_b);
        bottom_color.rgb = mix(bottom_color.rgb, u_paperTint, is_edge_b);

        // Layer 3: Top of curl (back of the page folding over)
        float theta_top = PI - asin(ratio);
        float L_top = u_radius * theta_top;
        vec2 aspect_uv_top = aspect_uv - dir * (d + L_top);
        vec2 uv_top = vec2(aspect_uv_top.x / u_aspect, aspect_uv_top.y);

        // Procedural paper fiber texture
        float grain = noise(uv_top * 300.0) * 0.06 + noise(uv_top * 900.0) * 0.04;
        vec3 top_color_rgb = u_paperTint * (1.0 - grain);

        // Darken as it curves back down
        top_color_rgb *= mix(0.9, 0.5, normal_z);
        vec4 top_color = vec4(top_color_rgb, flat_color.a);

        // Edge masking and thickness rim for top curl
        float edge_dist_t = min(min(uv_top.x, 1.0 - uv_top.x), min(uv_top.y, 1.0 - uv_top.y));
        float fw_t = max(fwidth(edge_dist_t), 0.001);
        float top_alpha = smoothstep(-fw_t, fw_t, edge_dist_t);

        float is_edge_t = 1.0 - smoothstep(thickness - fw_t, thickness + fw_t, edge_dist_t);
        top_color.rgb = mix(top_color.rgb, u_paperTint * 1.1, is_edge_t); // slight highlight on paper edge

        // Composite layers back-to-front
        color = flat_color;
        if (edge_dist_b > -fw_b) color = mix(color, bottom_color, bottom_alpha);
        if (edge_dist_t > -fw_t) color = mix(color, top_color, top_alpha);

    } else {
        // Left of fold: revealed incoming video
        float dist = -d;

        // Multi-layer shadow onto the incoming clip
        float contact_shadow = smoothstep(u_radius * 0.4, 0.0, dist);
        float diffuse_shadow = smoothstep(u_radius * 3.0, 0.0, dist);

        float combined_shadow = mix(1.0, 0.2, contact_shadow * 0.75 + diffuse_shadow * 0.5);
        color.rgb *= combined_shadow;
    }

    fragColor = color;
}
`,uniforms:()=>({u_radius:.12,u_glossiness:.6,u_paperTint:[.97,.95,.9]})},"rack-focus":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
uniform float u_blurStrength;
uniform float u_chromaticAberration;
uniform float u_contrastLoss;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    float p = u_progress;

    // Asymmetric blur curve: defocus is faster than refocus
    float peak = 0.45;
    float x = (p < peak) ? (p / peak) : ((1.0 - p) / (1.0 - peak));
    float blurAmt = smoothstep(0.0, 1.0, x);

    // Crossfade smoothly during the period of highest blur
    float mixV = smoothstep(0.35, 0.55, p);

    float maxRadius = u_blurStrength * 0.08;
    float radius = blurAmt * maxRadius;

    vec2 dir = v_texCoord - 0.5;

    // Chromatic aberration shifts (red out, blue in)
    vec2 caR = dir * u_chromaticAberration * 0.05 * blurAmt;
    vec2 caB = -dir * u_chromaticAberration * 0.05 * blurAmt;

    vec3 col = vec3(0.0);
    float tot = 0.0;

    if (mixV <= 0.0) {
        for (int i = 0; i < 48; i++) {
            float r = sqrt(float(i) + 0.5) / 6.928203;
            float theta = float(i) * 2.39996323;
            vec2 offset = vec2(cos(theta), sin(theta)) * r * radius;
            offset.y *= u_aspect;
            vec2 uvR = v_texCoord + offset + caR;
            vec2 uvG = v_texCoord + offset;
            vec2 uvB = v_texCoord + offset + caB;
            float valR = texture(u_outgoing, uvR).r;
            float valG = texture(u_outgoing, uvG).g;
            float valB = texture(u_outgoing, uvB).b;
            float weight = 1.0 + r * r * 0.5;
            col += vec3(valR, valG, valB) * weight;
            tot += weight;
        }
    } else if (mixV >= 1.0) {
        for (int i = 0; i < 48; i++) {
            float r = sqrt(float(i) + 0.5) / 6.928203;
            float theta = float(i) * 2.39996323;
            vec2 offset = vec2(cos(theta), sin(theta)) * r * radius;
            offset.y *= u_aspect;
            vec2 uvR = v_texCoord + offset + caR;
            vec2 uvG = v_texCoord + offset;
            vec2 uvB = v_texCoord + offset + caB;
            float valR = texture(u_incoming, uvR).r;
            float valG = texture(u_incoming, uvG).g;
            float valB = texture(u_incoming, uvB).b;
            float weight = 1.0 + r * r * 0.5;
            col += vec3(valR, valG, valB) * weight;
            tot += weight;
        }
    } else {
        for (int i = 0; i < 48; i++) {
            float r = sqrt(float(i) + 0.5) / 6.928203;
            float theta = float(i) * 2.39996323;
            vec2 offset = vec2(cos(theta), sin(theta)) * r * radius;
            offset.y *= u_aspect;
            vec2 uvR = v_texCoord + offset + caR;
            vec2 uvG = v_texCoord + offset;
            vec2 uvB = v_texCoord + offset + caB;
            float valR = mix(texture(u_outgoing, uvR).r, texture(u_incoming, uvR).r, mixV);
            float valG = mix(texture(u_outgoing, uvG).g, texture(u_incoming, uvG).g, mixV);
            float valB = mix(texture(u_outgoing, uvB).b, texture(u_incoming, uvB).b, mixV);
            float weight = 1.0 + r * r * 0.5;
            col += vec3(valR, valG, valB) * weight;
            tot += weight;
        }
    }

    col /= tot;

    // Veiling glare / contrast loss
    vec3 veilingColor = vec3(0.5, 0.48, 0.45);
    col = mix(col, veilingColor, u_contrastLoss * blurAmt * 0.6);

    // Optical vignette tightening
    vec2 physDir = vec2(dir.x, dir.y * u_aspect);
    float dist = length(physDir);
    float vignette = 1.0 - (dist * dist) * 1.5 * blurAmt;
    col *= clamp(vignette, 0.0, 1.0);

    // Slight exposure bump at peak blur
    col *= 1.0 + blurAmt * 0.2;

    float sourceAlpha = mix(texture(u_outgoing, v_texCoord).a, texture(u_incoming, v_texCoord).a, mixV);
    fragColor = vec4(col, sourceAlpha);
}
`,uniforms:()=>({u_blurStrength:.5,u_chromaticAberration:.4,u_contrastLoss:.2})},"organic-dissolve":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_ratio;
uniform float u_time;
uniform vec3 u_glowColor;
uniform float u_glowWidth;
uniform float u_depth;

in vec2 v_texCoord;
out vec4 fragColor;

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gradientNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float a = dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
    float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float time) {
    float val = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    for (int i = 0; i < 2; i++) {
        val += amp * gradientNoise(p * freq + time * 0.03);
        amp *= 0.5;
        freq *= 2.0;
    }
    return val;
}

void main() {
    float p = u_progress;
    float pr = smoothstep(0.0, 1.0, p);

    vec2 uv = v_texCoord;
    vec2 pos = uv * 2.0 - 1.0;
    pos.x *= u_ratio;

    float dist = length(pos);

    float n = fbm(pos * 0.8, u_time * 0.1);
    float shape = dist - n * u_depth;

    float maxDist = length(vec2(u_ratio, 1.0));
    float T = mix(-u_depth * 0.5, maxDist + u_depth * 0.8, pr);

    float edgeSoftness = 0.02;
    float inside = smoothstep(T + edgeSoftness, T - edgeSoftness, shape);

    float glowDist = abs(shape - T);
    float glow = smoothstep(u_glowWidth, 0.0, glowDist);
    glow = pow(glow, 1.6);

    vec4 colorOut = texture(u_outgoing, uv);
    vec4 colorIn = texture(u_incoming, uv);
    vec4 baseColor = mix(colorOut, colorIn, inside);

    float burn = smoothstep(u_glowWidth * 4.0, 0.0, shape - T);
    if (shape > T) {
        baseColor.rgb = mix(baseColor.rgb, vec3(0.0), burn * 0.4);
    }

    vec3 finalColor = baseColor.rgb + u_glowColor * glow * 2.5;

    fragColor = vec4(finalColor, baseColor.a);
}
`,uniforms:({time:e,aspect:t})=>({u_ratio:t,u_time:e,u_glowWidth:.05,u_depth:1.8,u_glowColor:[1,.55,.18]})},"impact-shake":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;

uniform float u_shakeIntensity;
uniform float u_zoomPunch;
uniform float u_chromaticAmount;

in vec2 v_texCoord;
out vec4 fragColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise(float p) {
  float fl = floor(p);
  float fc = fract(p);
  float u = fc * fc * (3.0 - 2.0 * fc);
  return mix(hash(fl), hash(fl + 1.0), u);
}

vec3 sampleWithChromaticAberration(sampler2D tex, vec2 uv, float amount) {
  vec2 dir = uv - 0.5;
  float dist = length(dir);
  if (dist > 0.0) {
      dir /= dist;
  }

  vec2 offsetAmount = dir * amount * dist * 2.0;

  float r = texture(tex, uv + offsetAmount).r;
  float g = texture(tex, uv).g;
  float b = texture(tex, uv - offsetAmount).b;

  return vec3(r, g, b);
}

void main() {
  float distToCut = abs(u_progress - 0.5) * 2.0;
  float intensity = pow(1.0 - distToCut, 3.0);

  float scale = 1.0 + (u_zoomPunch - 1.0) * intensity;

  float t = u_progress * 80.0;
  vec2 shakeOffset = vec2(
    noise(t) * 2.0 - 1.0,
    noise(t + 42.0) * 2.0 - 1.0
  ) * u_shakeIntensity * intensity;

  vec2 uv = (v_texCoord - 0.5) / scale + 0.5 + shakeOffset;

  vec3 color;
  float sourceAlpha;
  float currentChrom = u_chromaticAmount * intensity;

  if (u_progress >= 0.5) {
    color = sampleWithChromaticAberration(u_incoming, uv, currentChrom);
    sourceAlpha = texture(u_incoming, uv).a;
  } else {
    color = sampleWithChromaticAberration(u_outgoing, uv, currentChrom);
    sourceAlpha = texture(u_outgoing, uv).a;
  }

  float flash = pow(intensity, 8.0) * 0.4;
  color += vec3(flash);

  fragColor = vec4(color, sourceAlpha);
}
`,uniforms:()=>({u_shakeIntensity:.03,u_zoomPunch:1.08,u_chromaticAmount:.01})},"anticipation-zoom":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;

uniform float u_windupAmount;
uniform float u_zoomAmount;
uniform float u_incomingStartScale;

in vec2 v_texCoord;
out vec4 fragColor;

#define PI 3.14159265359

vec4 getOutgoing(vec2 uv, float stretch) {
    vec4 col = vec4(0.0);
    const int SAMPLES = 16;
    for(int i = 0; i < SAMPLES; i++) {
        float f = float(i) / float(SAMPLES - 1);
        float s = 1.0 + stretch * f;
        vec2 suv = (uv - 0.5) / s + 0.5;
        col += texture(u_outgoing, suv);
    }
    return col / float(SAMPLES);
}

void main() {
    float p = u_progress;

    float windup = p < 0.3 ? sin(p * PI / 0.3) : 0.0;
    float punch = p >= 0.3 ? pow((p - 0.3) / 0.7, 3.0) : 0.0;

    float scaleOut = 1.0 - (windup * u_windupAmount) + (punch * u_zoomAmount);
    float stretch = punch * 2.0;

    vec2 uvOut = (v_texCoord - 0.5) / scaleOut + 0.5;
    vec4 colorOut = getOutgoing(uvOut, stretch);

    float outAlpha = 1.0 - smoothstep(0.4, 0.85, p);

    float easeOut = 1.0 - pow(1.0 - p, 4.0);
    float scaleIn = mix(u_incomingStartScale, 1.0, easeOut);

    vec2 uvIn = (v_texCoord - 0.5) / scaleIn + 0.5;
    vec4 colorIn = texture(u_incoming, uvIn);

    fragColor = mix(colorIn, colorOut, outAlpha);
}
`,uniforms:()=>({u_windupAmount:.15,u_zoomAmount:6,u_incomingStartScale:.8})},"clean-line-wipe":{frag:`#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_lineWidth;
uniform vec3 u_lineColor;
in vec2 v_texCoord;
out vec4 fragColor;
// Custom bezier-like easing: slow start, fast middle, slow end with overshoot feel
float customEase(float t) {
    // Approximate cubic-bezier(0.7, 0, 0.3, 1) - fast in the middle
    float t2 = t * t;
    float t3 = t2 * t;
    // Hermite interpolation with strong acceleration in center
    return t3 * (10.0 - 15.0 * t + 6.0 * t2);
}
void main() {
    float p = customEase(u_progress);
    // Line position sweeps across the screen
    float pos = p * (1.0 + u_lineWidth * 2.0) - u_lineWidth;
    vec4 cOut = texture(u_outgoing, v_texCoord);
    vec4 cIn  = texture(u_incoming, v_texCoord);
    // Clean wipe split
    vec4 baseColor = mix(cIn, cOut, step(pos, v_texCoord.x));
    // Thin white line at the wipe edge
    float dist = abs(v_texCoord.x - pos);
    float line = smoothstep(u_lineWidth, u_lineWidth * 0.3, dist);
    vec3 finalColor = mix(baseColor.rgb, u_lineColor, line);
    fragColor = vec4(finalColor, baseColor.a);
}
`,uniforms:()=>({u_lineWidth:.006,u_lineColor:[1,1,1]})},"circle-wipe":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_feather;
uniform vec2 u_center;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 a = texture(u_outgoing, v_texCoord);
  vec4 b = texture(u_incoming, v_texCoord);
  vec2 uv = v_texCoord;
  float aspect = 16.0 / 9.0;
  vec2 d = (uv - u_center) * vec2(aspect, 1.0);
  float r = length(d);
  // expand circle radius past corners
  float maxR = length(vec2(aspect, 1.0) * 0.72);
  float edge = u_progress * maxR;
  float soft = max(u_feather, 0.001);
  float m = smoothstep(edge - soft, edge + soft, r);
  fragColor = mix(b, a, m);
}
`,uniforms:()=>({u_feather:.04,u_center:[.5,.5]})},"radial-blur":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_blurStrength;
uniform vec2 u_center;

in vec2 v_texCoord;
out vec4 fragColor;

const int SAMPLES = 16;

vec4 radialSample(sampler2D tex, vec2 uv, float strength) {
  vec2 dir = uv - u_center;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES - 1);
    vec2 p = u_center + dir * (1.0 - strength * t);
    acc += texture(tex, clamp(p, 0.0, 1.0));
  }
  return acc / float(SAMPLES);
}

void main() {
  float p = smoothstep(0.0, 1.0, u_progress);
  float blur = u_blurStrength * sin(p * 3.14159265);
  // outgoing zooms out / blurs, incoming zooms in
  float outScale = 1.0 + p * 0.35;
  float inScale = 1.0 + (1.0 - p) * 0.35;
  vec2 outUv = u_center + (v_texCoord - u_center) * outScale;
  vec2 inUv = u_center + (v_texCoord - u_center) * inScale;
  vec4 a = radialSample(u_outgoing, outUv, blur);
  vec4 b = radialSample(u_incoming, inUv, blur);
  fragColor = mix(a, b, p);
}
`,uniforms:()=>({u_blurStrength:.22,u_center:[.5,.5]})},"glitch-cut":{frag:`#version 300 es
precision highp float;

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_intensity;
uniform float u_time;

in vec2 v_texCoord;
out vec4 fragColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  float p = u_progress;
  float chaos = u_intensity * (1.0 - abs(p * 2.0 - 1.0)); // peak mid-transition
  float band = floor(v_texCoord.y * (18.0 + chaos * 40.0));
  float h = hash(band + floor(u_time * 60.0) + p * 20.0);
  float shift = (h - 0.5) * 0.12 * chaos;
  vec2 uvA = vec2(clamp(v_texCoord.x + shift, 0.0, 1.0), v_texCoord.y);
  vec2 uvB = vec2(clamp(v_texCoord.x - shift * 0.7, 0.0, 1.0), v_texCoord.y);
  vec4 a = texture(u_outgoing, uvA);
  vec4 b = texture(u_incoming, uvB);
  // RGB split on both
  float rgb = 0.01 * chaos;
  a.r = texture(u_outgoing, uvA + vec2(rgb, 0.0)).r;
  a.b = texture(u_outgoing, uvA - vec2(rgb, 0.0)).b;
  b.r = texture(u_incoming, uvB + vec2(rgb, 0.0)).r;
  b.b = texture(u_incoming, uvB - vec2(rgb, 0.0)).b;
  float m = smoothstep(0.25, 0.75, p + (h - 0.5) * 0.2 * chaos);
  fragColor = mix(a, b, m);
}
`,uniforms:({time:e})=>({u_intensity:1,u_time:e})},"dip-to-color":{frag:`#version 300 es
precision highp float;

// Color-flash dissolve (like dip-to-black, but through a tint color).
// Structure mirrors dip-to-black so mid-progress thumbs still show content.

uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform vec3 u_color;
uniform float u_hold;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 outColor = texture(u_outgoing, v_texCoord);
  vec4 inColor = texture(u_incoming, v_texCoord);
  vec3 fill = u_color;

  // u_hold = fraction of timeline spent at solid color (0..0.5)
  float hold = clamp(u_hold, 0.0, 0.5);
  float halfHold = hold * 0.5;
  float outEnd = clamp(0.5 - halfHold, 0.05, 0.49);
  float inStart = clamp(0.5 + halfHold, 0.51, 0.95);

  float outAlpha = 1.0 - smoothstep(0.0, outEnd, u_progress);
  float inAlpha = smoothstep(inStart, 1.0, u_progress);
  // residual = color flash between the two fades
  float colorAlpha = max(0.0, 1.0 - outAlpha - inAlpha);

  vec3 finalColor = outColor.rgb * outAlpha + inColor.rgb * inAlpha + fill * colorAlpha;
  fragColor = vec4(finalColor, mix(outColor.a, inColor.a, u_progress));
}
`,uniforms:()=>({u_color:[.95,.38,.14],u_hold:.12})}},Ie=Object.freeze({texture:`srgb`,framebuffer:`srgb`,unpackConversion:`none`}),Le=`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_opacity;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  vec4 color = texture(u_input, v_texCoord);
  fragColor = vec4(color.rgb, min(color.a, u_opacity));
}`,Re=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texCoord = a_texCoord; }`,ze=`attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texCoord = a_texCoord; }`,Be=0;function Ve(e,t,n){let r=e.createShader(t);if(!r)throw Error(`createShader failed`);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){let t=e.getShaderInfoLog(r)??`unknown error`;throw e.deleteShader(r),Error(`shader compile failed: ${t}`)}return r}function He(e,t){let n=/^\s*#version\s+300\s+es/.test(t),r=Ve(e,e.VERTEX_SHADER,n?Re:ze),i=Ve(e,e.FRAGMENT_SHADER,t),a=e.createProgram();if(!a)throw Error(`createProgram failed`);if(e.attachShader(a,r),e.attachShader(a,i),e.linkProgram(a),e.deleteShader(r),e.deleteShader(i),!e.getProgramParameter(a,e.LINK_STATUS)){let t=e.getProgramInfoLog(a)??`unknown error`;throw e.deleteProgram(a),Error(`program link failed: ${t}`)}return a}function Ue(e){let t=e.createTexture();if(!t)throw Error(`createTexture failed`);return e.bindTexture(e.TEXTURE_2D,t),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),t}function We(e){let t=e.getContext(`webgl2`,{premultipliedAlpha:!1,alpha:!0,preserveDrawingBuffer:!0});if(!t)throw Error(`WebGL2 not available`);let n=t;`drawingBufferColorSpace`in n&&(n.drawingBufferColorSpace=Ie.framebuffer),`unpackColorSpace`in n&&(n.unpackColorSpace=Ie.texture);let r=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,r),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]),t.STATIC_DRAW);let i=Ue(t),a=Ue(t),o=Ue(t),s=new Map,c=[],l=n=>{let r=()=>{let n=Ue(t);t.bindTexture(t.TEXTURE_2D,n),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,e.width,e.height,0,t.RGBA,t.UNSIGNED_BYTE,null);let r=t.createFramebuffer();if(!r)throw Error(`createFramebuffer failed`);return t.bindFramebuffer(t.FRAMEBUFFER,r),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,n,0),{fb:r,tex:n}};for(;c.length<n;)c.push(r());return t.bindFramebuffer(t.FRAMEBUFFER,null),c},u=e=>{let n=s.get(e);return n||(n=He(t,e),s.set(e,n)),n},d=e=>{t.bindBuffer(t.ARRAY_BUFFER,r);let n=t.getAttribLocation(e,`a_position`);t.enableVertexAttribArray(n),t.vertexAttribPointer(n,2,t.FLOAT,!1,16,0);let i=t.getAttribLocation(e,`a_texCoord`);t.enableVertexAttribArray(i),t.vertexAttribPointer(i,2,t.FLOAT,!1,16,8)},f=(e,n,r)=>{t.activeTexture(t.TEXTURE0+n),t.bindTexture(t.TEXTURE_2D,e),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!0),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.NONE),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,t.RGBA,t.UNSIGNED_BYTE,r)},p=(e,n,r)=>{let i=t.getUniformLocation(e,n);i&&(typeof r==`number`?t.uniform1f(i,r):r.length===2?t.uniform2f(i,r[0],r[1]):r.length===3?t.uniform3f(i,r[0],r[1],r[2]):r.length===4&&t.uniform4f(i,r[0],r[1],r[2],r[3]))},m=!!t.getExtension(`OES_texture_float_linear`),h=new Map,g=null,_=(e,n)=>{let r=t.createTexture();if(!r)throw Error(`createTexture failed`);if(t.bindTexture(t.TEXTURE_3D,r),t.pixelStorei(t.UNPACK_ALIGNMENT,1),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),m)t.texImage3D(t.TEXTURE_3D,0,t.RGB32F,e,e,e,0,t.RGB,t.FLOAT,n);else{let r=new Uint8Array(n.length);for(let e=0;e<n.length;e++){let t=n[e];r[e]=t<=0?0:t>=1?255:Math.round(t*255)}t.texImage3D(t.TEXTURE_3D,0,t.RGB8,e,e,e,0,t.RGB,t.UNSIGNED_BYTE,r)}return t.texParameteri(t.TEXTURE_3D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_3D,t.TEXTURE_WRAP_R,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_3D,null),r},v=e=>{if(!e)return g||=_(2,new Float32Array(24)),g;let t=h.get(e.data);return t||(t=_(e.size,e.data),h.set(e.data,t)),t},y=(e,n,r)=>{let i=t.getUniformLocation(e,`u_lut`);return i?(t.activeTexture(t.TEXTURE0+n),t.bindTexture(t.TEXTURE_3D,v(r)),t.uniform1i(i,n),n+1):n},b=(n,r,i,a,o)=>{t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,e.width,e.height);let s=u(n);t.useProgram(s),d(s),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r);let c=t.getUniformLocation(s,`u_outgoing`);c&&t.uniform1i(c,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,i);let l=t.getUniformLocation(s,`u_incoming`);l&&t.uniform1i(l,1),p(s,`u_progress`,Math.max(0,Math.min(1,a))),p(s,`u_resolution`,[e.width,e.height]),p(s,`u_aspect`,e.width/Math.max(1,e.height));for(let[e,t]of Object.entries(o??{}))p(s,e,t);t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.drawArrays(t.TRIANGLE_STRIP,0,4)},x=(n,r,i)=>{if(n.length===0)return r;let a=l(i+n.length);for(let o=0;o<n.length;o++){let s=n[o];t.bindFramebuffer(t.FRAMEBUFFER,a[i+o].fb),t.viewport(0,0,e.width,e.height);let c=u(s.frag);t.useProgram(c),d(c);let l=s.inputFrom??o-1,f=o===0?r:a[i+l]?.tex;if(!f)throw Error(`invalid FX input pass ${l} at ${o}`);t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,f);let m=t.getUniformLocation(c,`u_input`);m&&t.uniform1i(m,0);let h=1;for(let[e,n]of Object.entries(s.samplers??{})){let r=a[i+n]?.tex;if(!r||n>=o)throw Error(`invalid FX sampler ${e}=${n} at ${o}`);t.activeTexture(t.TEXTURE0+h),t.bindTexture(t.TEXTURE_2D,r);let s=t.getUniformLocation(c,e);s&&t.uniform1i(s,h),h+=1}y(c,h,s.lut3d),p(c,`u_width`,e.width),p(c,`u_height`,e.height),p(c,`u_canvas_width`,e.width),p(c,`u_canvas_height`,e.height),p(c,`u_resolution`,[e.width,e.height]),p(c,`u_aspect`,e.width/Math.max(1,e.height));for(let[e,t]of Object.entries(s.uniforms??{}))p(c,e,t);t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.drawArrays(t.TRIANGLE_STRIP,0,4)}return a[i+n.length-1].tex},S=(n,r,i)=>{let a=l(r+1)[r];t.bindFramebuffer(t.FRAMEBUFFER,a.fb),t.viewport(0,0,e.width,e.height);let o=u(Le);t.useProgram(o),d(o),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,n);let s=t.getUniformLocation(o,`u_input`);return s&&t.uniform1i(s,0),p(o,`u_opacity`,Math.max(0,Math.min(1,i))),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.drawArrays(t.TRIANGLE_STRIP,0,4),a.tex},C=!1;Be+=1;let w=()=>{if(C||t.isContextLost())throw Error(`WebGL context lost`)};return{canvas:e,render(e,t,n,r,o){w(),f(i,0,t),f(a,1,n),b(e,i,a,r,o)},renderTransitionWithFx(e,t,n,r,o,s,c,l){w(),f(i,0,t),f(a,1,n);let u=x(r,i,0),d=x(o,a,r.length),p=r.length+o.length,m=S(u,p,l?.outgoing??1),h=S(d,p+1,l?.incoming??1);b(e,m,h,s,c)},renderFx(n,r,i,a){w();let s=u(n);t.viewport(0,0,e.width,e.height),t.useProgram(s),d(s),f(o,0,r);let c=t.getUniformLocation(s,`u_input`);c&&t.uniform1i(c,0),y(s,1,a),p(s,`u_width`,e.width),p(s,`u_height`,e.height),p(s,`u_canvas_width`,e.width),p(s,`u_canvas_height`,e.height),p(s,`u_resolution`,[e.width,e.height]),p(s,`u_aspect`,e.width/Math.max(1,e.height));for(let[e,t]of Object.entries(i??{}))p(s,e,t);t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.drawArrays(t.TRIANGLE_STRIP,0,4)},renderFxChain(n,r){if(w(),n.length===0)return;let i=l(Math.max(0,n.length-1));t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,o),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!0),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.NONE),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,t.RGBA,t.UNSIGNED_BYTE,r);for(let r=0;r<n.length;r++){let a=r===n.length-1;t.bindFramebuffer(t.FRAMEBUFFER,a?null:i[r].fb),t.viewport(0,0,e.width,e.height);let s=u(n[r].frag);t.useProgram(s),d(s);let c=n[r].inputFrom??r-1,l=r===0?o:i[c]?.tex;if(!l)throw Error(`invalid FX input pass ${c} at ${r}`);t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,l);let f=t.getUniformLocation(s,`u_input`);f&&t.uniform1i(f,0);let m=1;for(let[e,a]of Object.entries(n[r].samplers??{})){let n=i[a]?.tex;if(!n||a>=r)throw Error(`invalid FX sampler ${e}=${a} at ${r}`);t.activeTexture(t.TEXTURE0+m),t.bindTexture(t.TEXTURE_2D,n);let o=t.getUniformLocation(s,e);o&&t.uniform1i(o,m),m++}m=y(s,m,n[r].lut3d),p(s,`u_width`,e.width),p(s,`u_height`,e.height),p(s,`u_canvas_width`,e.width),p(s,`u_canvas_height`,e.height),p(s,`u_resolution`,[e.width,e.height]),p(s,`u_aspect`,e.width/Math.max(1,e.height));for(let[e,t]of Object.entries(n[r].uniforms??{}))p(s,e,t);t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),t.drawArrays(t.TRIANGLE_STRIP,0,4)}t.bindFramebuffer(t.FRAMEBUFFER,null)},dispose(){if(!C){C=!0,Be=Math.max(0,Be-1);for(let e of s.values())t.deleteProgram(e);s.clear(),t.deleteBuffer(r),t.deleteTexture(i),t.deleteTexture(a),t.deleteTexture(o);for(let e of h.values())t.deleteTexture(e);h.clear(),g&&=(t.deleteTexture(g),null);for(let{fb:e,tex:n}of c)t.deleteFramebuffer(e),t.deleteTexture(n)}}}}function Ge(e,t){let n=[];for(let r=0;r<e.length;r+=1){let i=e[r],a=e[r-1],o=n[n.length-1];!t&&a!==void 0&&de([a,i])===`${a.text}${i.text}`&&o?o.words.push(i):n.push({startIndex:r,words:[i]})}return n}var Ke={pointerEvents:`none`,zIndex:1},qe={display:`flex`,flexWrap:`wrap`,alignItems:`baseline`,maxWidth:`100%`};function Je({captions:e,items:t}){let n=H(),{fps:r,width:i,height:a}=V(),o=n/r*1e3;return e.sourceEntries?.length?(0,Z.jsx)($e,{captions:e,items:t,ms:o,width:i,height:a}):(0,Z.jsx)(Ye,{captions:e,items:t,ms:o,width:i,height:a,fps:r})}function Ye({captions:e,items:t,ms:n,width:r,height:i,fps:a}){let o=(0,Q.useMemo)(()=>_e(e),[e]),s=me((0,Q.useMemo)(()=>X(e,t,a),[e,t,a]),n)[0]?.page;if(!s)return null;let c=fe(s,n),l=e.bilingual&&e.translation?pe(e.translation,n):null;return(0,Z.jsx)(J,{style:Ke,children:(0,Z.jsx)(`div`,{style:he(o,e.template,r,i,e.layout),children:(0,Z.jsxs)(`div`,{style:ye(e.motionPreset,s,n),children:[o.wholeLine?(0,Z.jsx)(Xe,{page:s,preset:o,height:i,motionPreset:e.motionPreset,ms:n}):(0,Z.jsx)(Ze,{page:s,preset:o,height:i,currentIndex:c,motionPreset:e.motionPreset,ms:n}),l?.text&&(0,Z.jsx)(`div`,{style:Qe(e.template),children:l.text})]})})})}function Xe({page:e,preset:t,height:n,motionPreset:r,ms:i}){return(0,Z.jsx)(`div`,{style:{...ge(t,n,!1,!0),whiteSpace:`pre-wrap`},children:e.words.map((t,n)=>{let a=e.words[n-1],o=a?de([a,t]).slice(a.text.length):t.text;return(0,Z.jsx)(`span`,{style:be(r,t,i),children:o},t.id??n)})})}function Ze({page:e,preset:t,height:n,currentIndex:r,motionPreset:i,ms:a}){let o=Ge(e.words,t.displayMode===`stacked`);return(0,Z.jsx)(`div`,{style:ve(t),children:o.map(e=>(0,Z.jsx)(`span`,{style:qe,children:e.words.map((o,s)=>{let c=e.startIndex+s;return(0,Z.jsx)(`span`,{style:{position:`relative`,...ge(t,n,c===r),...be(i,o,a)},children:o.text},o.id??c)})},e.words[0]?.id??e.startIndex))})}function Qe(e){let t={marginTop:`0.35em`,textTransform:`none`,fontWeight:600,textAlign:`center`};return e===`tiktok`?{...t,fontSize:54,color:`#ffe14d`,textShadow:`0 3px 12px rgba(0,0,0,0.7)`}:e===`netflix`?{...t,fontSize:42,color:`#e8e8e8`,textShadow:`0 2px 6px rgba(0,0,0,0.9)`}:{...t,fontSize:40,color:`#ffe14d`}}function $e({captions:e,items:t,ms:n,width:r,height:i}){let{fps:a}=V(),o=(0,Q.useMemo)(()=>_e(e),[e]),s=(0,Q.useMemo)(()=>X(e,t,a),[e,t,a]),c=(0,Q.useMemo)(()=>xe(s,e,n),[s,e,n]);return c?.length?(0,Z.jsx)(J,{style:Ke,children:c.map((t,a)=>{let s=t.anchor?{anchor:t.anchor,offsetXRatio:t.offsetXRatio,offsetYRatio:t.offsetYRatio,scale:t.scale,rotation:t.rotation,opacity:t.opacity}:e.layout;return(0,Z.jsx)(`div`,{style:he(o,e.template,r,i,s),children:t.lanes.map((t,r)=>(0,Z.jsx)(et,{lane:t,basePreset:o,height:i,motionPreset:e.motionPreset,ms:n},t.entry.id||r))},a)})}):null}function et({lane:e,basePreset:t,height:n,motionPreset:r,ms:i}){let a=e.entry.style?{...t,...e.entry.style}:t,o=a.wholeLine?(0,Z.jsx)(Xe,{page:e.page,preset:a,height:n,motionPreset:r,ms:i}):(0,Z.jsx)(Ze,{page:e.page,preset:a,height:n,currentIndex:e.curIdx,motionPreset:r,ms:i});return(0,Z.jsx)(`div`,{style:ye(r,e.page,i),children:o})}var tt=Symbol.dispose||Symbol.for(`Symbol.dispose`),nt=Symbol.asyncDispose||Symbol.for(`Symbol.asyncDispose`),rt=(e,t,n)=>{if(t!=null){if(typeof t!=`object`&&typeof t!=`function`)throw TypeError(`Object expected to be assigned to "using" declaration`);var r;if(n&&(r=t[nt]),r===void 0&&(r=t[tt]),typeof r!=`function`)throw TypeError(`Object not disposable`);e.push([n,r,t])}else n&&e.push([n]);return t},it=(e,t,n)=>{var r=typeof SuppressedError==`function`?SuppressedError:function(e,t,n,r){return r=Error(n),r.name=`SuppressedError`,r.error=e,r.suppressed=t,r},i=e=>t=n?new r(e,t,`An error was suppressed during disposal`):(n=!0,e),a=r=>{for(;r=e.pop();)try{var o=r[1]&&r[1].call(r[2]);if(r[0])return Promise.resolve(o).then(a,e=>(i(e),a()))}catch(e){i(e)}if(n)throw t};return a()},at=({loop:e,mediaDurationInSeconds:t,playbackRate:n,trimAfter:r,trimBefore:i,sequenceDurationInFrames:a,compFps:o})=>{if(!e||!t)return;let s=Y.calculateMediaDuration({mediaDurationInFrames:t*o,playbackRate:n,trimAfter:r,trimBefore:i});return{numberOfTimes:a/s,startOffset:0,durationInFrames:s}},ot=({loop:e,mediaDurationInSeconds:t,unloopedTimeInSeconds:n,src:r,trimAfter:i,trimBefore:a,fps:o,playbackRate:s,ifNoMediaDuration:c})=>{if(t===null&&e&&c===`fail`)throw Error(`Could not determine duration of ${r}, but "loop" was set.`);let l=e?Y.calculateMediaDuration({trimAfter:i,mediaDurationInFrames:t?t*o:1/0,playbackRate:1,trimBefore:a}):1/0,u=e?n*s*o%l/o:n*s;return(i??null)!==null&&!e&&u>=(i-(a??0))/o?null:u+(a??0)/o},st=({mediaDurationInSeconds:e,ifNoMediaDuration:t,src:n,trimAfter:r,trimBefore:i,fps:a})=>{if(e===null&&t===`fail`)throw Error(`Could not determine duration of ${n}, but "loop" was set.`);return Y.calculateMediaDuration({trimAfter:r,mediaDurationInFrames:e?e*a:1/0,playbackRate:1,trimBefore:i})/a+(i??0)/a},ct=.1,lt=({startFromSecond:e,iterator:t,unscheduleAudioNode:n})=>{let r=!1,i=[],a=-1/0,o=()=>{for(let{node:e}of i){n(e);try{e.stop()}catch{}}i.length=0};return{destroy:()=>{o(),r=!0,t.return().catch(()=>{})},getNextFn:async()=>{let e=await t.next();return e.value&&(a=Math.max(a,e.value.timelineTimestamp+e.value.sourceDurationInSeconds)),e},isDestroyed:()=>r,addQueuedAudioNode:e=>{i.push(e)},guessNextTimestamp:()=>Number.isFinite(a)?a:e,getQueuedPeriod:()=>{let e=-1/0,t=1/0;for(let n of i)e=Math.max(e,n.timestamp+n.sourceDurationInSeconds),t=Math.min(t,n.timestamp);return!Number.isFinite(t)||!Number.isFinite(e)?null:{from:t,until:e}}}},ut=(e,t)=>t?e>=t.from&&e<t.until:!1,dt=({mediaTimestamp:e,targetTime:t,currentTime:n,sequenceStartTime:r})=>{let i=(e<r?r-e:0)+(t<0?-t:0);return t+n+i},ft=({sourceDurationInSeconds:e,sourceOffsetInSeconds:t,offset:n})=>Math.max(0,e-(n-t)),pt=({mediaTimestamp:e,targetTime:t,sequenceStartTime:n,combinedPlaybackRate:r,sourceStartOffsetInSeconds:i})=>{let a=e<n?n-e:0,o=t<0?-t*r:0;return i+a+o},mt=class extends Error{constructor(){super(`Waiter became stale before it got its turn`),this.name=`StaleWaiterError`}},ht=1,gt=[],_t=0,vt=null,yt=()=>{if(_t>=ht)if(vt?.waiter.getPriority()===null)vt.cancel();else return;let e=[];for(let t=gt.length-1;t>=0;t--)if(gt[t].getPriority()===null){let[n]=gt.splice(t,1);e.push(n)}for(let t of e)t.onError(new mt);if(gt.length===0)return;let t=0,n=gt[0].getPriority();if(n===null)throw Error(`Stale waiter should have been removed`);for(let e=1;e<gt.length;e++){let r=gt[e].getPriority();if(r===null)throw Error(`Stale waiter should have been removed`);r<n&&(n=r,t=e)}if(n>2)return;let[r]=gt.splice(t,1);_t++;let i=!1,a=!1,o={waiter:r,cancel:()=>{a=!0,o.settle()},settle:()=>{i||(i=!0,_t--,vt===o&&(vt=null))}};vt=o,r.fn().then(e=>{o.settle(),!a&&r.onDone(e,yt)},e=>{o.settle(),!a&&r.onError(e)})},bt=({getPriority:e,fn:t,onDone:n,onError:r})=>{gt.push({getPriority:e,fn:t,onDone:n,onError:r}),yt()},xt=.5;async function*St({audioSink:e,timeToSeek:t,maximumTimestamp:n}){let r=Math.max(0,t-xt),i=e.buffers(r,n);for await(let e of i){let r=Math.max(e.timestamp,t),i=Math.min(e.timestamp+e.duration,n);i<=r||(yield{buffer:e,timelineTimestamp:r,sourceOffsetInSeconds:r-e.timestamp,sourceDurationInSeconds:i-r})}}async function*Ct({audioSink:e,seekTimeInSeconds:t,loopStartInSeconds:n,segmentEndInSeconds:r,maximumContinuousTimestamp:i}){if(r<=n)throw Error(`Cannot loop audio over an empty range (${n} to ${r})`);let a=t,o=t;for(;;){let t=!1;for await(let n of St({audioSink:e,timeToSeek:a,maximumTimestamp:r})){t=!0;let e=o+(n.timelineTimestamp-a),r=Math.min(n.sourceDurationInSeconds,i-e);if(r<=0||(yield{...n,timelineTimestamp:e,sourceDurationInSeconds:r},e+r>=i))return}if(!t)throw Error(`Audio loop pass from ${a} to ${r} yielded no buffers`);o+=r-a,a=n}}var wt=.1,Tt=e=>e>=wt,Et=({anchor:e,unloopedTimeInSeconds:t,playbackRate:n})=>e.mediaStartInSeconds+(t-e.unloopedStartInSeconds)*n,Dt=({audioTrack:e,delayPlaybackHandleIfNotPremounting:t,sharedAudioContext:n,getSequenceEndTimestamp:r,getSequenceDurationInSeconds:i,getMediaEndTimestamp:a,getStartTime:o,initialMuted:s,drawDebugOverlay:c,initialPlaybackRate:l,initialTrimBefore:u,initialTrimAfter:d,initialSequenceOffset:f,initialSequenceDurationInFrames:p,initialLoop:m,initialFps:h})=>{let g=s,_=1,v={time:-1,playbackRate:l,trimBefore:u,trimAfter:d,sequenceOffset:f,sequenceDurationInFrames:p,loop:m,fps:h},y=n.audioContext.createGain();y.connect(n.gainNode);let b=new F(e),x=null,S=null,C=0,w=0,T=null,E=()=>{T&&=(T.unblock(),null)},D=[],k=()=>{for(let e=D.length-1;e>=0;e--){let t=D[e];t.remaining--,t.remaining<=0&&(t.resolve(),D.splice(e,1))}},A=e=>e<=0?Promise.resolve():new Promise(t=>{D.push({remaining:e,resolve:t})}),j=({buffer:e,mediaTimestamp:t,originalUnloopedMediaTimestamp:r,sourceOffsetInSeconds:i,sourceDurationInSeconds:a,playbackRate:o,scheduleAudioNode:s,logLevel:c})=>{if(!x)throw Error(`Audio buffer iterator not found`);if(g)return;let l=n.audioContext.createBufferSource();l.buffer=e,l.playbackRate.value=o,l.connect(y);let u=s(l,t,r,i,a);if(u.type===`not-started`){Y.Log.verbose({logLevel:c,tag:`audio-scheduling`},`not started, disconnected: %s %s`,t.toFixed(3),e.duration.toFixed(3)),l.disconnect();return}x.addQueuedAudioNode({node:l,timestamp:t,buffer:e,sourceDurationInSeconds:a,scheduledTime:u.scheduledTime,playbackRate:o,scheduledAtAnchor:n.audioSyncAnchor.value})},M=({buffer:e,playbackRate:t,scheduleAudioNode:n,logLevel:i})=>{if(g)return;let a=o(),s=r();if(e.timelineTimestamp+e.sourceDurationInSeconds<=a||e.timelineTimestamp>=s)return;let l=Math.max(e.timelineTimestamp,a),u=Math.min(e.timelineTimestamp+e.sourceDurationInSeconds,s);w+=Math.max(0,u-l),j({buffer:e.buffer.buffer,mediaTimestamp:e.timelineTimestamp,playbackRate:t,scheduleAudioNode:n,logLevel:i,originalUnloopedMediaTimestamp:e.buffer.timestamp,sourceOffsetInSeconds:e.sourceOffsetInSeconds,sourceDurationInSeconds:e.sourceDurationInSeconds}),c()},N=({iterator:e,nonce:t,getTargetTime:n,playbackRate:r,scheduleAudioNode:i,onScheduled:a,onDestroyed:s,onDone:c,logLevel:l,currentTime:u,getAudioContextCurrentTimeMockedInTest:d})=>{bt({getPriority:()=>{if(e.isDestroyed())return s(),null;let t=e.guessNextTimestamp(),r=n(t,u);return r===null?null:dt({mediaTimestamp:t,targetTime:r,currentTime:u,sequenceStartTime:o()})-d()},fn:()=>e.getNextFn(),onDone:(o,f)=>{if(e.isDestroyed()){f(),s();return}if(!o.value){f(),c();return}a(o.value.sourceDurationInSeconds),k(),M({buffer:o.value,playbackRate:r,scheduleAudioNode:i,logLevel:l}),N({iterator:e,nonce:t,getTargetTime:n,playbackRate:r,scheduleAudioNode:i,onScheduled:a,onDestroyed:s,onDone:c,logLevel:l,currentTime:u,getAudioContextCurrentTimeMockedInTest:d}),f()},onError:e=>{if(e instanceof O){s();return}if(e instanceof mt){s();return}throw e}})},P=({nonce:e,playbackRate:r,startFromSecond:s,unloopedStartFromSecond:c,scheduleAudioNode:l,getTargetTime:u,logLevel:d,loop:f,unscheduleAudioNode:p,getAudioContextCurrentTimeMockedInTest:m})=>{if(g)return;let h=a();if(s>=h)return;x?.destroy(),E();let _=t();T=_,S={unloopedStartInSeconds:c,mediaStartInSeconds:s};let v=s+i()*r,y=lt({startFromSecond:s,iterator:f?Ct({audioSink:b,seekTimeInSeconds:s,loopStartInSeconds:o(),segmentEndInSeconds:h,maximumContinuousTimestamp:v}):St({audioSink:b,timeToSeek:s,maximumTimestamp:h}),unscheduleAudioNode:p});C++,x=y;let w=0,D=!1,O=()=>{D||(D=!0,_.unblock())};N({iterator:y,nonce:e,getTargetTime:u,playbackRate:r,scheduleAudioNode:l,onScheduled:e=>{w+=e,Tt(w)&&O()},onDestroyed:()=>{O()},onDone:()=>{O()},logLevel:d,currentTime:n.audioContext.currentTime,getAudioContextCurrentTimeMockedInTest:m})};return{startAudioIterator:P,getAudioBufferIterator:()=>x,getCurrentAnchor:()=>S,destroyIterator:()=>{x?.destroy(),x=null,S=null,E()},seek:({newTime:e,unloopedNewTime:t,nonce:r,playbackRate:i,localPlaybackRate:a,scheduleAudioNode:o,getTargetTime:s,logLevel:c,loop:l,trimBefore:u,trimAfter:d,sequenceOffset:f,sequenceDurationInFrames:p,fps:m,getAudioContextCurrentTimeMockedInTest:h})=>{if(!r.isStale()&&!(v.time===e&&v.playbackRate===i&&v.trimBefore===u&&v.trimAfter===d&&v.sequenceOffset===f&&v.sequenceDurationInFrames===p&&v.loop===l&&v.fps===m)&&(v={time:e,playbackRate:i,trimBefore:u,trimAfter:d,sequenceOffset:f,sequenceDurationInFrames:p,loop:l,fps:m},!g)){if(x&&!x.isDestroyed()){let r=l&&S?Et({anchor:S,unloopedTimeInSeconds:t,playbackRate:a}):e,i=x.getQueuedPeriod();if(ut(r,i?{from:i.from-ct-n.audioContext.baseLatency-n.audioContext.outputLatency,until:i.until}:null)){yt();return}let o=x.guessNextTimestamp();if(o<r&&Math.abs(o-r)<1){yt();return}}P({nonce:r,playbackRate:i,startFromSecond:e,unloopedStartFromSecond:t,scheduleAudioNode:o,getTargetTime:s,logLevel:c,loop:l,unscheduleAudioNode:n.unscheduleAudioNode,getAudioContextCurrentTimeMockedInTest:h})}},getAudioIteratorsCreated:()=>C,getTotalAudioScheduledInSeconds:()=>w,setMuted:e=>{g=e,y.gain.value=g?0:_},setVolume:e=>{_=Math.max(0,e),y.gain.value=g?0:_},scheduleAudioChunk:j,waitForNScheduledNodes:A}},Ot=({context:e,audioTime:t,audioContextState:n,audioSyncAnchor:r,playing:i,audioIteratorManager:a,videoIteratorManager:o,playbackRate:s})=>{let c=r?.value??0,l=[`Debug overlay`,`Video iterators created: ${o?.getVideoIteratorsCreated()}`,`Audio iterators created: ${a?.getAudioIteratorsCreated()}`,`Audio scheduled: ${(a?.getTotalAudioScheduledInSeconds()??0).toFixed(3)}s`,`Frames rendered: ${o?.getFramesRendered()}`,`Audio context state: ${n}`,t?`Audio time: ${((t-c)*s).toFixed(3)}s`:null].filter(Boolean);if(a){let e=a.getAudioBufferIterator()?.getQueuedPeriod();if(e){let n=t?` (${(e.until-(t-c)*s).toFixed(3)}s ahead)`:``;l.push(`Audio queued until ${e.until.toFixed(3)}s${n}`)}l.push(`Playing: ${i}`)}let u=l.length*30+20;e.fillStyle=`rgba(0, 0, 0, 1)`,e.fillRect(20,20,600,u),e.fillStyle=`white`,e.font=`24px sans-serif`,e.textBaseline=`top`;for(let t=0;t<l.length;t++)e.fillText(l[t],30,30+t*30)},kt=async e=>await e.getDurationFromMetadata(void 0,{skipLiveWait:!0})??e.computeDuration(void 0,{skipLiveWait:!0}),At=e=>{if(typeof window<`u`&&window.remotion_mediaCacheSizeInBytes!==void 0&&window.remotion_mediaCacheSizeInBytes!==null)return window.remotion_mediaCacheSizeInBytes<240*1024*1024&&re(Error(`The minimum value for the "mediaCacheSizeInBytes" prop is 240MB (${240*1024*1024}), got: ${window.remotion_mediaCacheSizeInBytes}`)),window.remotion_mediaCacheSizeInBytes>2e4*1024*1024&&re(Error(`The maximum value for the "mediaCacheSizeInBytes" prop is 20GB (${2e4*1024*1024}), got: ${window.remotion_mediaCacheSizeInBytes}`)),Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Using cache size set using "mediaCacheSizeInBytes": ${(window.remotion_mediaCacheSizeInBytes/1024/1024).toFixed(1)} MB`),window.remotion_mediaCacheSizeInBytes;if(typeof window<`u`&&window.remotion_initialMemoryAvailable!==void 0&&window.remotion_initialMemoryAvailable!==null){let t=window.remotion_initialMemoryAvailable/2;return t<500*1024*1024?(Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Using cache size set based on minimum value of 500MB (which is more than half of the available system memory!)`),500*1024*1024):t>2e4*1024*1024?(Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Using cache size set based on maximum value of 20GB (which is less than half of the available system memory)`),2e4*1024*1024):(Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Using cache size set based on available memory (50% of available memory): ${(t/1024/1024).toFixed(1)} MB`),t)}return 1e3*1e3*1e3},jt=null,Mt=e=>(jt===null&&(jt=At(e)),jt),Nt=8*1024*1024,Pt=64*1024*1024,Ft=e=>Math.min(Pt,Math.max(Nt,Math.floor(e/16))),It=e=>Ft(Mt(e)),Lt=e=>{if(!e)return;let t=[];if(e instanceof Headers)e.forEach((e,n)=>{t.push([n.toLowerCase(),e])});else if(Array.isArray(e))for(let[n,r]of e)t.push([n.toLowerCase(),r]);else for(let[n,r]of Object.entries(e))t.push([n.toLowerCase(),r]);return t.sort(([e],[t])=>e<t?-1:+(e>t)),t},Rt=e=>{if(!e)return;let t=Lt(e.headers),n={...e.cache===void 0?null:{cache:e.cache},...e.credentials===void 0?null:{credentials:e.credentials},...t===void 0?null:{headers:t},...e.integrity===void 0?null:{integrity:e.integrity},...e.mode===void 0?null:{mode:e.mode},...e.redirect===void 0?null:{redirect:e.redirect},...e.referrer===void 0?null:{referrer:e.referrer},...e.referrerPolicy===void 0?null:{referrerPolicy:e.referrerPolicy}};return Object.keys(n).length===0?void 0:n},zt=e=>{let t=Rt(e);return t?[t.cache??null,t.credentials??null,t.integrity??null,t.mode??null,t.redirect??null,t.referrer??null,t.referrerPolicy??null,t.headers??null]:null},Bt=({credentials:e,requestInit:t})=>Rt(e===void 0?t:{credentials:e,...t}),Vt={},Ht=({src:e,credentials:t,requestInit:n})=>JSON.stringify([e,t??null,zt(n)]),Ut=({src:e,credentials:t,requestInit:n,logLevel:r})=>{let i=Rt(n),a=Ht({src:e,credentials:t,requestInit:i}),o=Vt[a];if(o)return o.refCount++,{input:o.input,cacheKey:a};let s=Bt({credentials:t,requestInit:i}),c=new M({source:new A(e,{maxCacheSize:It(r),...s?{requestInit:s}:void 0}),formats:I});return Vt[a]={input:c,refCount:1},{input:c,cacheKey:a}},Wt=e=>{let t=Vt[e];t&&(t.refCount--,t.refCount<=0&&(delete Vt[e],t.input.dispose()))},Gt=async({videoTrack:e,audioTracks:t,audioStreamIndex:n})=>n===null?e?await e.getPrimaryPairableAudioTrack()??null:t[0]??null:t[n]??null;function Kt(e){return!!(e.message.includes(`Failed to fetch`)||e.message.includes(`Load failed`)||e.message.includes(`NetworkError when attempting to fetch resource`))}function qt(e){return e.message.includes(`Unsupported configuration`)}var Jt=()=>{let e=0;return{createAsyncOperation:()=>{e++;let t=e;return{isStale:()=>e!==t}}}},Yt=class{isPremounting;isPostmounting;activeHandles=new Set;delayPlayback;constructor({bufferState:e,isPremounting:t,isPostmounting:n}){this.delayPlayback=e.delayPlayback,this.isPremounting=t,this.isPostmounting=n}shouldDelayPlayback(){return!this.isPremounting&&!this.isPostmounting}syncHandles(){for(let e of this.activeHandles)this.shouldDelayPlayback()?e.arm():e.disarm()}setIsPremounting(e){this.isPremounting=e,this.syncHandles()}setIsPostmounting(e){this.isPostmounting=e,this.syncHandles()}createHandle(){let e=!1,t=null,n=!1,r=()=>{e||n||(t=this.delayPlayback().unblock,e=!0)},i=()=>{e&&=(t?.(),t=null,!1)},a={arm:r,disarm:i,dispose:()=>{}};return a.dispose=()=>{n||(n=!0,i(),this.activeHandles.delete(a))},this.activeHandles.add(a),this.shouldDelayPlayback()&&r(),{unblock:a.dispose,[Symbol.dispose]:a.dispose}}},$=e=>Math.round(e*1e3)/1e3,Xt=3,Zt=Symbol(`releaseCanvas`),Qt=e=>{e?.[Zt]?.()},$t=()=>{let e=[];return{makeStableFrame:t=>{let{canvas:n}=t,r=e.pop()??new OffscreenCanvas(n.width,n.height);r.width!==n.width&&(r.width=n.width),r.height!==n.height&&(r.height=n.height);let i=r.getContext(`2d`);if(!i)throw Error(`Could not create canvas context`);i.clearRect(0,0,r.width,r.height),i.drawImage(n,0,0);let a=!1;return{canvas:r,duration:t.duration,timestamp:t.timestamp,[Zt]:()=>{a||(a=!0,e.push(r))}}}}},en=(e,t)=>{let n=e.canvases(t),r=[],i=!1,a=!1,o=!1,s=null,c=$t(),l=e=>c.makeStableFrame(e),u=()=>{if(i||a||o||r.length>=Xt)return;i=!0;let e={promise:n.next(),resolved:null};r.push(e),s=e.promise.then(t=>{if(i=!1,s=null,t.done){e.resolved=t,a=!0;return}if(o){e.resolved={done:!0,value:void 0};return}e.resolved={...t,value:l(t.value)},u()},()=>{i=!1,s=null})};return u(),{next:()=>{let e=r.shift();if(u(),!e){if(a||o)return{type:`ready`,frame:null};let e=s;return{type:`pending`,wait:async()=>{await e;let t=r.shift();if(u(),!t)return null;if(t.resolved)return t.resolved.done?null:t.resolved.value;let n=await t.promise;return n.done?null:l(n.value)}}}return e.resolved?e.resolved.done?{type:`ready`,frame:null}:{type:`ready`,frame:e.resolved.value}:{type:`pending`,wait:async()=>{let t=await e.promise;return e.resolved?e.resolved.done?null:e.resolved.value:t.done?null:l(t.value)}}},closeIterator:async()=>{o=!0;for(let e of r)e.resolved&&!e.resolved.done&&Qt(e.resolved.value);r.length=0,await n.return()}}},tn=e=>{let t=new Map;return{prewarmIteratorForLooping:({timeToSeek:n})=>{t.has(n)||t.set(n,en(e,n))},makeIteratorOrUsePrewarmed:n=>{let r=t.get(n);return r?(t.delete(n),r):en(e,n)},destroy:()=>{for(let e of t.values())e.closeIterator();t.clear()}}},nn=async(e,t)=>{let n=!1,r=t.makeIteratorOrUsePrewarmed(e),i=!1,a=r.next(),o=a&&a.type===`ready`?a.frame:await a.wait(),s=o,c=null,l=e=>{s!==e&&Qt(s),s=e},u=e=>(c=e,c===null&&(i=!0),c),d=()=>{if(c)return{type:`ready`,frame:c};if(i)return{type:`ready`,frame:null};let e=r.next();return e.type===`ready`?{type:`ready`,frame:u(e.frame)}:{type:`pending`,wait:e.wait}},f=e=>e?$(e.timestamp):1/0,p=async({pendingFrameBehavior:e,shouldContinue:t})=>{let n=d();if(n.type===`ready`)return{type:`ready`,timestamp:f(n.frame)};if(e===`restart-iterator`)return{type:`pending`};if(!t())return{type:`cancelled`};let r=u(await n.wait());return t()?{type:`ready`,timestamp:f(r)}:{type:`cancelled`}},m=()=>{if(c){let e=c;l(e);let t={type:`got-frame-or-end`,frame:e};return c=null,t}let e=r.next();return e.type===`pending`?{type:`need-to-wait-for-it`,waitPromise:async()=>{let t=await e.wait();return t?l(t):i=!0,t}}:(e.frame?l(e.frame):i=!0,{type:`got-frame-or-end`,frame:e.frame??null})};return{destroy:()=>{n=!0,Qt(s),c!==s&&Qt(c),s=null,c=null,r.closeIterator().catch(()=>{})},initialFrame:o,isDestroyed:()=>n,tryToSatisfySeek:async(t,n)=>{if(!n.shouldContinue())return{type:`not-satisfied`,reason:`seek was superseded`};let r=$(t);if(s){let i=$(s.timestamp);if(r<i)return s===o&&$(t)>=$(e)?{type:`satisfied`,frame:s}:{type:`not-satisfied`,reason:`iterator is too far, most recently returned ${i}`};let a=await p({pendingFrameBehavior:n.pendingFrameBehavior,shouldContinue:n.shouldContinue});if(a.type===`cancelled`)return{type:`not-satisfied`,reason:`seek was superseded`};if(a.type===`pending`)return{type:`not-satisfied`,reason:`iterator did not have next frame ready`};if(i<=r&&a.timestamp>r)return{type:`satisfied`,frame:s}}if(i)return s?{type:`satisfied`,frame:s}:{type:`not-satisfied`,reason:`iterator ended`};for(;;){if(!n.shouldContinue())return{type:`not-satisfied`,reason:`seek was superseded`};let e=m();if(e.type===`need-to-wait-for-it`)return{type:`not-satisfied`,reason:`iterator did not have frame ready`};if(e.type===`got-frame-or-end`){if(e.frame===null)return i=!0,s?{type:`satisfied`,frame:s}:{type:`not-satisfied`,reason:`iterator ended and did not have frame ready`};let t=$(e.frame.timestamp),a=await p({pendingFrameBehavior:n.pendingFrameBehavior,shouldContinue:n.shouldContinue});if(a.type===`cancelled`)return{type:`not-satisfied`,reason:`seek was superseded`};if(a.type===`pending`)return{type:`not-satisfied`,reason:`iterator did not have next frame ready`};if(t<=r&&a.timestamp>r)return{type:`satisfied`,frame:e.frame};continue}throw Error(`Unreachable`)}}}},{runEffectChain:rn}=Y,an=({previousTime:e,newTime:t,fps:n,playbackRate:r,isPlaying:i})=>{if(!i||t<e)return!1;let a=Math.abs(r)/n;return $(t-e)<=$(a)},on=async({delayPlaybackHandleIfNotPremounting:e,canvas:t,context:n,drawDebugOverlay:r,logLevel:i,getOnVideoFrameCallback:a,videoTrack:o,getLoopSegmentMediaEndTimestamp:s,getStartTime:c,getIsLooping:l,getEffects:u,getEffectChainState:d})=>{let f=0,p=null,m=0,h=null,g=null,_=null,v=()=>{g=null};if(t){let e=await o.getDisplayWidth(),n=await o.getDisplayHeight();(t.width!==e||t.height!==n)&&(t.width=e,t.height=n)}let y=tn(new k(o,{poolSize:3,fit:`contain`,alpha:!0})),b=async e=>{if(n&&t){let r=u(),i=d(t.width,t.height);r.length>0&&i&&t instanceof HTMLCanvasElement?await rn({state:i,source:e.canvas,effects:r,output:t,width:t.width,height:t.height}):(n.clearRect(0,0,t.width,t.height),n.drawImage(e.canvas,0,0))}},x=async e=>{await b(e),g=e,m++,r();let t=a();t&&t(e.canvas),Y.Log.trace({logLevel:i,tag:`@remotion/media`},`[MediaPlayer] Drew frame ${e.timestamp.toFixed(3)}s`)},S=async()=>{if(!g)return;await b(g),r();let e=a();e&&e(g.canvas),Y.Log.trace({logLevel:i,tag:`@remotion/media`},`[MediaPlayer] Redrew frame ${g.timestamp.toFixed(3)}s with updated effects`)},C=async(t,n)=>{let r=[];try{v(),p?.destroy(),h=rt(r,e(),0),_=t;let i=await nn(t,y);if(f++,p=i,i.isDestroyed()||n.isStale()||p.isDestroyed()||!i.initialFrame)return;await x(i.initialFrame)}catch(e){var i=e,a=1}finally{it(r,i,a)}};return{startVideoIterator:C,getVideoIteratorsCreated:()=>f,seek:async({newTime:e,nonce:t,fps:n,playbackRate:r,isPlaying:i})=>{if(!p||_!==null&&$(_)===$(e))return;let a=_;_=e,l()&&s()-e<1&&y.prewarmIteratorForLooping({timeToSeek:c()});let o=a!==null&&an({previousTime:a,newTime:e,fps:n,playbackRate:r,isPlaying:i})?`wait`:`restart-iterator`,u=await p.tryToSatisfySeek(e,{pendingFrameBehavior:o,shouldContinue:()=>!t.isStale()});if(u.type===`satisfied`){await x(u.frame);return}t.isStale()||await C(e,t)},destroy:()=>{v(),y.destroy(),p?.destroy(),n&&t&&n.clearRect(0,0,t.width,t.height),h&&=(h.unblock(),null),p=null},getVideoFrameIterator:()=>p,drawFrame:x,redrawCurrentFrame:S,getFramesRendered:()=>m}},sn=class{tagType;canvas;context;src;logLevel;playbackRate;globalPlaybackRate;audioStreamIndex;sharedAudioContext;audioIteratorManager=null;videoIteratorManager=null;playing=!1;loop=!1;fps;trimBefore;trimAfter;sequenceDurationInFrames;sequenceOffset;totalDuration;debugOverlay=!1;nonceManager;onVideoFrameCallback=null;getEffects;getEffectChainState;initializationPromise=null;premountAwareDelayPlayback;seekPromiseChain=Promise.resolve();constructor({canvas:e,src:t,logLevel:n,sharedAudioContext:r,loop:i,trimBefore:a,trimAfter:o,playbackRate:s,globalPlaybackRate:c,audioStreamIndex:l,fps:u,debugOverlay:d,bufferState:f,isPremounting:p,isPostmounting:m,durationInFrames:h,onVideoFrameCallback:g,playing:_,sequenceOffset:v,credentials:y,requestInit:b,tagType:x,getEffects:S,getEffectChainState:C}){this.canvas=e??null,this.src=t,this.logLevel=n,this.sharedAudioContext=r,this.playbackRate=s,this.globalPlaybackRate=c,this.loop=i,this.trimBefore=a,this.trimAfter=o,this.audioStreamIndex=l,this.fps=u,this.debugOverlay=d,this.premountAwareDelayPlayback=new Yt({bufferState:f,isPremounting:p,isPostmounting:m}),this.sequenceDurationInFrames=h,this.nonceManager=Jt(),this.onVideoFrameCallback=g,this.playing=_,this.sequenceOffset=v;let{input:w,cacheKey:T}=Ut({src:this.src,credentials:y,requestInit:b,logLevel:n});if(this.input=w,this.inputCacheKey=T,this.tagType=x,this.getEffects=S,this.getEffectChainState=C,e){let t=e.getContext(`2d`,{alpha:!0});if(!t)throw Error(`Could not get 2D context from canvas`);this.context=t}else this.context=null}input;inputCacheKey;disposed=!1;isDisposalError(){return this.disposed||this.input.disposed===!0}initialize(e,t){let n=this._initialize(e,t);return this.initializationPromise=n,this.seekPromiseChain=n,n}getStartTime(){return(this.trimBefore??0)/this.fps}getSequenceEndTimestamp(){return this.sequenceDurationInFrames/this.fps*this.playbackRate+this.getStartTime()}getSequenceDurationInSeconds(){return this.sequenceDurationInFrames/this.fps}getMediaEndTimestamp(){return st({mediaDurationInSeconds:this.totalDuration,ifNoMediaDuration:`fail`,src:this.src,trimAfter:this.trimAfter,trimBefore:this.trimBefore,fps:this.fps})}getLoopSegmentMediaEndTimestamp(){return Math.min(this.getMediaEndTimestamp(),this.getSequenceEndTimestamp())}async _initialize(e,t){let n=[];try{rt(n,this.delayPlaybackHandleIfNotPremounting(),0);try{if(this.isDisposalError())return{type:`disposed`};try{await this.input.getFormat()}catch(e){if(this.isDisposalError())return{type:`disposed`};if(Kt(e))throw e;return Y.Log.error({logLevel:this.logLevel,tag:`@remotion/media`},`[MediaPlayer] Failed to recognize format for ${this.src}`,e),{type:`unknown-container-format`}}let[n,r,i]=await Promise.all([kt(this.input),this.input.getPrimaryVideoTrack(),this.input.getAudioTracks()]);if(this.isDisposalError())return{type:`disposed`};this.totalDuration=n;let a=await Gt({videoTrack:r,audioTracks:i,audioStreamIndex:this.audioStreamIndex});if(!r&&!a)return{type:`no-tracks`};if(r&&this.tagType===`video`){if(await r.isLive())throw Error(`Live streams are not currently supported by Remotion. Sorry! Source: `+this.src);if(await r.isRelativeToUnixEpoch())throw Error(`Streams with UNIX timestamps are not currently supported by Remotion. Sorry! Source: `+this.src);if(!await r.canDecode())return r.codec===`prores`?{type:`cannot-decode-prores`}:{type:`cannot-decode`};if(this.isDisposalError())return{type:`disposed`};this.videoIteratorManager=await on({videoTrack:r,delayPlaybackHandleIfNotPremounting:this.delayPlaybackHandleIfNotPremounting,context:this.context,canvas:this.canvas,getOnVideoFrameCallback:()=>this.onVideoFrameCallback,logLevel:this.logLevel,drawDebugOverlay:this.drawDebugOverlay,getLoopSegmentMediaEndTimestamp:()=>this.getLoopSegmentMediaEndTimestamp(),getStartTime:()=>this.getStartTime(),getIsLooping:()=>this.loop,getEffects:this.getEffects,getEffectChainState:this.getEffectChainState})}let o=this.getTrimmedTime(e);if(o===null)throw Error(`should have asserted that the time is not null`);if(a&&this.sharedAudioContext){if(await a.isLive())throw Error(`Live streams are not currently supported by Remotion. Sorry! Source: `+this.src);if(await a.isRelativeToUnixEpoch())throw Error(`Streams with UNIX timestamps are not currently supported by Remotion. Sorry! Source: `+this.src);if(!await a.canDecode())return{type:`cannot-decode`};if(this.isDisposalError())return{type:`disposed`};this.audioIteratorManager=Dt({audioTrack:a,delayPlaybackHandleIfNotPremounting:this.delayPlaybackHandleIfNotPremounting,sharedAudioContext:this.sharedAudioContext,getMediaEndTimestamp:()=>this.getMediaEndTimestamp(),getSequenceEndTimestamp:()=>this.getSequenceEndTimestamp(),getStartTime:()=>this.getStartTime(),initialMuted:t,drawDebugOverlay:this.drawDebugOverlay,initialPlaybackRate:this.playbackRate*this.globalPlaybackRate,getSequenceDurationInSeconds:()=>this.getSequenceDurationInSeconds(),initialTrimBefore:this.trimBefore,initialTrimAfter:this.trimAfter,initialSequenceOffset:this.sequenceOffset,initialSequenceDurationInFrames:this.sequenceDurationInFrames,initialLoop:this.loop,initialFps:this.fps})}let s=this.nonceManager.createAsyncOperation();try{await Promise.all([this.audioIteratorManager?this.audioIteratorManager.startAudioIterator({nonce:s,playbackRate:this.playbackRate*this.globalPlaybackRate,startFromSecond:o,unloopedStartFromSecond:e,scheduleAudioNode:this.scheduleAudioNode,getTargetTime:this.getTargetTime,logLevel:this.logLevel,loop:this.loop,unscheduleAudioNode:this.sharedAudioContext.unscheduleAudioNode,getAudioContextCurrentTimeMockedInTest:()=>this.sharedAudioContext.audioContext.currentTime}):Promise.resolve(),this.videoIteratorManager?this.videoIteratorManager.startVideoIterator(o,s):Promise.resolve()])}catch(e){if(this.isDisposalError())return{type:`disposed`};Y.Log.error({logLevel:this.logLevel,tag:`@remotion/media`},`[MediaPlayer] Failed to start audio and video iterators`,e)}return{type:`success`,durationInSeconds:n}}catch(e){let t=e;if(Kt(t))return Y.Log.error({logLevel:this.logLevel,tag:`@remotion/media`},`[MediaPlayer] Network/CORS error for ${this.src}`,t),{type:`network-error`};throw Y.Log.error({logLevel:this.logLevel,tag:`@remotion/media`},`[MediaPlayer] Failed to initialize`,e),e}}catch(e){var r=e,i=1}finally{it(n,r,i)}}seekToWithQueue=async(e,t)=>{let n=this.nonceManager.createAsyncOperation();await this.seekPromiseChain,this.seekPromiseChain=this.seekToDoNotCallDirectly(e,t,n),await this.seekPromiseChain};async seekTo(e){let t=this.getTrimmedTime(e);if(t===null)throw Error(`should have asserted that the time is not null`);await this.seekToWithQueue(t,e)}async seekToDoNotCallDirectly(e,t,n){if(!n.isStale())try{await Promise.all([this.videoIteratorManager?.seek({newTime:e,nonce:n,fps:this.fps,playbackRate:this.playbackRate,isPlaying:this.playing}),this.audioIteratorManager?.seek({newTime:e,unloopedNewTime:t,nonce:n,playbackRate:this.playbackRate*this.globalPlaybackRate,localPlaybackRate:this.playbackRate,getTargetTime:this.getTargetTime,logLevel:this.logLevel,loop:this.loop,trimBefore:this.trimBefore,trimAfter:this.trimAfter,sequenceOffset:this.sequenceOffset,sequenceDurationInFrames:this.sequenceDurationInFrames,fps:this.fps,scheduleAudioNode:this.scheduleAudioNode,getAudioContextCurrentTimeMockedInTest:()=>this.sharedAudioContext.audioContext.currentTime})])}catch(e){if(this.isDisposalError())return;throw e}}play(){this.playing||(this.playing=!0,this.drawDebugOverlay())}delayPlaybackHandleIfNotPremounting=()=>this.premountAwareDelayPlayback.createHandle();pause(){this.playing&&(this.playing=!1,this.drawDebugOverlay())}setMuted(e){this.audioIteratorManager?.setMuted(e)}setVolume(e){this.audioIteratorManager&&this.audioIteratorManager.setVolume(e)}getTrimmedTime(e){return ot({unloopedTimeInSeconds:e,playbackRate:this.playbackRate,loop:this.loop,trimBefore:this.trimBefore,trimAfter:this.trimAfter,mediaDurationInSeconds:this.totalDuration??null,fps:this.fps,ifNoMediaDuration:`infinity`,src:this.src})}async setTrimBefore(e,t){this.trimBefore!==e&&(this.trimBefore=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}async setTrimAfter(e,t){this.trimAfter!==e&&(this.trimAfter=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}setDebugOverlay(e){this.debugOverlay=e}async setPlaybackRate(e,t){this.playbackRate!==e&&(this.playbackRate=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}async setGlobalPlaybackRate(e,t){this.globalPlaybackRate!==e&&(this.globalPlaybackRate=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}async setFps(e,t){this.fps!==e&&(this.fps=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}setIsPremounting(e){this.premountAwareDelayPlayback.setIsPremounting(e)}setIsPostmounting(e){this.premountAwareDelayPlayback.setIsPostmounting(e)}async setLoop(e,t){this.loop!==e&&(this.loop=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}async setSequenceOffset(e,t){this.sequenceOffset!==e&&(this.sequenceOffset=e,this.audioIteratorManager?.destroyIterator(),await this.seekTo(t))}async setSequenceDurationInFrames(e,t){this.sequenceDurationInFrames!==e&&(this.sequenceDurationInFrames=e,await this.seekTo(t))}async dispose(){if(!this.disposed){if(this.disposed=!0,this.initializationPromise)try{await this.initializationPromise}catch{}this.nonceManager.createAsyncOperation(),this.videoIteratorManager?.destroy(),this.audioIteratorManager?.destroyIterator(),Wt(this.inputCacheKey)}}getTargetTime=(e,t)=>{if(!this.sharedAudioContext)throw Error(`Shared audio context not found`);let n=(t-this.sharedAudioContext.audioSyncAnchor.value)*this.globalPlaybackRate-this.sequenceOffset,r=this.loop?this.audioIteratorManager?.getCurrentAnchor()??null:null,i=r?Et({anchor:r,unloopedTimeInSeconds:n,playbackRate:this.playbackRate}):this.getTrimmedTime(n);return i===null?null:(e-i)/(this.playbackRate*this.globalPlaybackRate)};scheduleAudioNode=(e,t,n,r,i)=>{if(!this.sharedAudioContext)throw Error(`Shared audio context not found`);let a=this.getTargetTime(t,this.sharedAudioContext.audioContext.currentTime),o=this.playbackRate*this.globalPlaybackRate;if(a===null)return{type:`not-started`,reason:`no target for`+t.toFixed(3)+`,`+this.sharedAudioContext.audioContext.currentTime.toFixed(3)};let s=this.getStartTime(),c=pt({mediaTimestamp:t,targetTime:a,sequenceStartTime:s,combinedPlaybackRate:o,sourceStartOffsetInSeconds:r}),l=ft({sourceDurationInSeconds:i,sourceOffsetInSeconds:r,offset:c}),u=dt({mediaTimestamp:t,targetTime:a,sequenceStartTime:s,currentTime:this.sharedAudioContext.audioContext.currentTime});return this.sharedAudioContext.scheduleAudioNode({node:e,mediaTimestamp:t,sourceOffset:r,scheduledTime:u,duration:l,offset:c,originalUnloopedMediaTimestamp:n})};setVideoFrameCallback(e){this.onVideoFrameCallback=e}async redrawVideoEffects(){await this.videoIteratorManager?.redrawCurrentFrame()}drawDebugOverlay=()=>{this.debugOverlay&&this.context&&this.canvas&&Ot({context:this.context,audioTime:this.sharedAudioContext?.audioContext.currentTime??null,audioContextState:this.sharedAudioContext?.audioContext.state??null,audioSyncAnchor:this.sharedAudioContext?.audioSyncAnchor??null,audioIteratorManager:this.audioIteratorManager,playing:this.playing,videoIteratorManager:this.videoIteratorManager,playbackRate:this.playbackRate*this.globalPlaybackRate})};audioSyncAnchorChanged=()=>{this.audioIteratorManager&&this.audioIteratorManager.destroyIterator()}},cn=({onError:e,error:t,disallowFallback:n,isClientSideRendering:r,clientSideError:i})=>{let a=e?.(t);return r?[`fail`,i]:a?[a,t]:n?[`fail`,t]:[`fallback`,t]},ln=({mediaPlayerRef:e,mediaPlayerReady:t,currentTimeRef:n,playing:r,isPlayerBuffering:i,frame:a,trimBefore:o,trimAfter:s,effectiveMuted:c,userPreferredVolume:l,playbackRate:u,globalPlaybackRate:d,fps:f,sequenceOffset:p,loop:m,durationInFrames:h,isPremounting:g,isPostmounting:_,currentTime:v,logLevel:y,label:b})=>{let x=(0,Q.useContext)(Y.SharedAudioContext);(0,Q.useLayoutEffect)(()=>{let t=e.current;t&&(r&&!i?t.play():t.pause())},[i,r,y,t,a,e]),(0,Q.useLayoutEffect)(()=>{if(!x)return;let{remove:t}=x.audioSyncAnchorEmitter.subscribe(t=>{t===`changed`&&e.current?.audioSyncAnchorChanged()});return()=>{t()}},[x,e]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setTrimBefore(o,n.current)},[o,t,e,n]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setTrimAfter(s,n.current)},[s,t,e,n]),(0,Q.useLayoutEffect)(()=>{let n=e.current;!n||!t||n.setMuted(c)},[c,t,e]),(0,Q.useLayoutEffect)(()=>{let n=e.current;!n||!t||n.setVolume(l)},[l,t,e]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setPlaybackRate(u,n.current)},[u,t,e,n]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setGlobalPlaybackRate(d,n.current)},[d,t,e,n]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setLoop(m,n.current)},[m,t,e,n]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setSequenceDurationInFrames(h,n.current)},[h,t,e,n]),(0,Q.useLayoutEffect)(()=>{let t=e.current;t&&t.setIsPremounting(g)},[g,t,e]),(0,Q.useLayoutEffect)(()=>{let t=e.current;t&&t.setIsPostmounting(_)},[_,t,e]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setFps(f,n.current)},[f,t,e,n]),(0,Q.useLayoutEffect)(()=>{let r=e.current;!r||!t||r.setSequenceOffset(p,n.current)},[p,t,e,n]),(0,Q.useLayoutEffect)(()=>{let n=e.current;!n||!t||(n.seekTo(v).catch(()=>{}),Y.Log.trace({logLevel:y,tag:`@remotion/media`},`[${b}] Updating target time to ${v.toFixed(3)}s`))},[v,y,t,b,e])},{useUnsafeVideoConfig:un,Timeline:dn,SharedAudioContext:fn,usePlayerMutedState:pn,useMediaVolumeState:mn,useFrameForVolumeProp:hn,evaluateVolume:gn,warnAboutTooHighVolume:_n,usePreload:vn,SequenceContext:yn}=Y,bn=({src:e,playbackRate:t,logLevel:n,muted:r,volume:i,loopVolumeCurveBehavior:a,loop:o,trimAfter:s,trimBefore:c,name:l,showInTimeline:u,_remotionInternalStack:d,disallowFallbackToHtml5Audio:f,toneFrequency:p,audioStreamIndex:m,fallbackHtml5AudioProps:h,onError:g,credentials:_,requestInit:v,setMediaDurationInSeconds:y,style:b})=>{let x=un(),S=H(),C=(0,Q.useRef)(null),w=(0,Q.useRef)(c),T=(0,Q.useRef)(s),[E]=(0,Q.useState)(v),[D,O]=(0,Q.useState)(!1),[k,A]=(0,Q.useState)(!1),[j]=dn.usePlayingState(),{playbackRate:M}=Y.usePlaybackRate(),N=(0,Q.useContext)(fn),P=le(),[F]=pn(),[I]=mn(),L=gn({frame:hn(a??`repeat`),volume:i,mediaVolume:I});if(_n(L),!x)throw Error(`No video config found`);if(!e)throw TypeError("No `src` was passed to <NewAudioForPreview>.");let R=S/x.fps,z=(0,Q.useRef)(R);z.current=R;let B=vn(e),V=(0,Q.useContext)(yn),U=!!V?.premounting,W=!!V?.postmounting,G=(V?.absoluteFrom??0)/x.fps,ee=(0,Q.useContext)(Y.BufferingContextReact);if(!ee)throw Error(`useMediaPlayback must be used inside a <BufferingContext>`);let te=r||F||L<=0,ne=Y.useIsPlayerBuffering(ee),re=(0,Q.useRef)(j&&!ne),K=(0,Q.useRef)(U),ie=(0,Q.useRef)(W),oe=(0,Q.useRef)(M),q=(0,Q.useRef)(t),se=(0,Q.useRef)(te),J=(0,Q.useRef)(x.durationInFrames),ce=(0,Q.useRef)(G);return ln({mediaPlayerRef:C,mediaPlayerReady:D,currentTimeRef:z,playing:j,isPlayerBuffering:ne,frame:S,trimBefore:c,trimAfter:s,effectiveMuted:te,userPreferredVolume:L,playbackRate:t,globalPlaybackRate:M,fps:x.fps,sequenceOffset:G,loop:o,durationInFrames:x.durationInFrames,isPremounting:U,isPostmounting:W,currentTime:R,logLevel:n,label:`AudioForPreview`}),(0,Q.useEffect)(()=>{if(!N||!N.audioContext)return;let{audioContext:e,gainNode:t,audioSyncAnchor:r,scheduleAudioNode:i,unscheduleAudioNode:a}=N;if(t){try{let s=new sn({src:B,logLevel:n,sharedAudioContext:{audioContext:e,gainNode:t,audioSyncAnchor:r,scheduleAudioNode:i,unscheduleAudioNode:a},loop:o,trimAfter:T.current,trimBefore:w.current,fps:x.fps,canvas:null,playbackRate:q.current,audioStreamIndex:m??null,debugOverlay:!1,bufferState:P,isPostmounting:ie.current,isPremounting:K.current,globalPlaybackRate:oe.current,durationInFrames:J.current,onVideoFrameCallback:null,playing:re.current,sequenceOffset:ce.current,credentials:_,requestInit:E,tagType:`audio`,getEffects:()=>[],getEffectChainState:()=>null});C.current=s,s.initialize(z.current,se.current).then(e=>{if(e.type===`disposed`)return;let t=(e,t)=>{let[r,i]=cn({onError:g,error:e,disallowFallback:f,isClientSideRendering:!1,clientSideError:e});if(r===`fail`)throw i;Y.Log.warn({logLevel:n,tag:`@remotion/media`},t),A(!0)};if(e.type===`unknown-container-format`){t(Error(`Unknown container format ${B}.`),`Unknown container format for ${B} (Supported formats: https://www.remotion.dev/docs/mediabunny/formats), falling back to <Html5Audio>`);return}if(e.type===`network-error`){t(Error(`Network error fetching ${B}.`),`Network error fetching ${B}, falling back to <Html5Audio>`);return}if(e.type===`cannot-decode`){t(Error(`Cannot decode ${B}.`),`Cannot decode ${B}, falling back to <Html5Audio>`);return}if(e.type===`no-tracks`){t(Error(`No video or audio tracks found for ${B}.`),`No video or audio tracks found for ${B}, falling back to <Html5Audio>`);return}if(e.type===`cannot-decode-prores`)throw Error(`Encountered ProRes media for ${B}. But this should never happen, since you used the <Audio> tag. Please report this as a bug.`);e.type===`success`&&(O(!0),y(e.durationInSeconds),Y.Log.trace({logLevel:n,tag:`@remotion/media`},`[AudioForPreview] MediaPlayer initialized successfully`))}).catch(e=>{let[t,r]=cn({onError:g,error:e,disallowFallback:f,isClientSideRendering:!1,clientSideError:e});if(t===`fail`)throw r;Y.Log.error({logLevel:n,tag:`@remotion/media`},`[AudioForPreview] Failed to initialize MediaPlayer`,e),A(!0)})}catch(e){let[t,r]=cn({error:e,onError:g,disallowFallback:f,isClientSideRendering:!1,clientSideError:e});if(t===`fail`)throw r;Y.Log.error({logLevel:n,tag:`@remotion/media`},`[AudioForPreview] MediaPlayer initialization failed`,r),A(!0)}return()=>{C.current&&=(Y.Log.trace({logLevel:n,tag:`@remotion/media`},`[AudioForPreview] Disposing MediaPlayer`),C.current.dispose(),null),O(!1),A(!1)}}},[B,n,N,o,x.fps,m,f,P,g,_,E,y]),k&&!f?(0,Z.jsx)(ae,{src:e,muted:r,volume:i,startFrom:c,endAt:s,playbackRate:t,loopVolumeCurveBehavior:a,name:l,loop:o,showInTimeline:u,style:b??void 0,_remotionInternalStack:d??void 0,toneFrequency:p,audioStreamIndex:m,pauseWhenBuffering:h?.pauseWhenBuffering,crossOrigin:h?.crossOrigin,...h}):null},xn=({loop:e=!1,src:t,logLevel:n,muted:r,name:i,volume:a,loopVolumeCurveBehavior:o,playbackRate:s=1,trimAfter:c,trimBefore:l,showInTimeline:u,_remotionInternalStack:d,disallowFallbackToHtml5Audio:f,toneFrequency:p,audioStreamIndex:m,fallbackHtml5AudioProps:h,onError:g,credentials:_,requestInit:v,setMediaDurationInSeconds:y,style:b})=>{let x=vn(t),S=Y.useLogLevel(),C=H(),w=V(),T=C/w.fps;if(!(0,Q.useMemo)(()=>ot({unloopedTimeInSeconds:T,playbackRate:s,loop:e,trimBefore:l,trimAfter:c,mediaDurationInSeconds:1/0,fps:w.fps,ifNoMediaDuration:`infinity`,src:t})!==null,[T,s,t,c,l,w.fps,e]))return null;if(!y)throw Error(`setMediaDurationInSeconds is required`);return(0,Z.jsx)(bn,{audioStreamIndex:m,src:x,playbackRate:s,logLevel:n??S,muted:r??!1,volume:a??1,loopVolumeCurveBehavior:o??`repeat`,loop:e,trimAfter:c,trimBefore:l,name:i,showInTimeline:u??!0,_remotionInternalStack:d,disallowFallbackToHtml5Audio:f??!1,toneFrequency:p,onError:g,credentials:_,requestInit:v,fallbackHtml5AudioProps:h,setMediaDurationInSeconds:y,style:b})},Sn=()=>{let e=Promise.resolve(void 0);return t=>{let n=e.then(()=>t());return e=n.then(()=>{},()=>{}),n}},Cn={u8:1,s16:2,s32:4,f32:4,"u8-planar":1,"s16-planar":2,"s32-planar":4,"f32-planar":4},wn=e=>e.numberOfFrames*e.numberOfChannels*Cn[e.format],Tn=()=>{let e=[],t={};return{addFrame:n=>{e.push(n.timestamp),t[n.timestamp]=n},clearBeforeThreshold:n=>{for(let r of e.slice())if(r+t[r].duration<n){if(r===e[e.length-1])continue;t[r].close(),delete t[r],e.splice(e.indexOf(r),1)}},deleteAll:()=>{for(let n of e)t[n].close(),delete t[n];e.length=0},getSamples:(n,r)=>{let i=[];for(let a=0;a<e.length;a++){let o=e[a],s=t[o];if(!(s.timestamp+s.duration-1e-10<=n)){if(s.timestamp>=n+r-1e-10)break;i.push(s)}}return i},getOldestTimestamp:()=>e[0],getNewestTimestamp:()=>{if(e.length===0)return null;let n=t[e[e.length-1]];return n.timestamp+n.duration},getOpenTimestamps:()=>e,getTotalSize:()=>{let n=0;for(let r of e)n+=wn(t[r]);return n}}},En=1.5,Dn=.2,On={},kn=(e,t)=>{On[e]||(On[e]=!0,Y.Log.warn({logLevel:t,tag:`@remotion/media`},`Audio from ${e} will need to be read from the beginning. https://www.remotion.dev/docs/media/support#matroska-limitation`))},An=({audioSampleSink:e,isMatroska:t,startTimestamp:n,src:r,actualMatroskaTimestamps:i,logLevel:a})=>{let o=e.samples(t?0:Math.max(0,n-En));t&&kn(r,a);let s=null,c=Tn(),l=Date.now(),u=async()=>{l=Date.now();let{value:e,done:t}=await o.next();if(t)return s=c.getNewestTimestamp(),null;let n=i.getRealTimestamp(e.timestamp);return n!==null&&n!==e.timestamp&&e.setTimestamp(n),i.observeTimestamp(e.timestamp),i.observeTimestamp(e.timestamp+e.duration),c.addFrame(e),e},d=async(e,t)=>{if(l=Date.now(),s!==null&&e>s)return c.clearBeforeThreshold(s-Dn),[];let n=c.getSamples(e,t),r=c.getNewestTimestamp();if(r!==null&&r>=e+t-1e-10)return n;for(;;){let r=await u(),i=s===null?e:Math.min(e,s);if(c.clearBeforeThreshold(i-Dn),r===null)break;if(!(r.timestamp+r.duration-1e-10<=e)){if(r.timestamp>=e+t-1e-10)break;n.push(r)}}return n},f=()=>{let e=c.getOpenTimestamps();if(e.length>0){let t=e[0],n=e[e.length-1];Y.Log.verbose({logLevel:a,tag:`@remotion/media`},`Open audio samples for src`,r,`${t.toFixed(3)}...${n.toFixed(3)}`)}},p=()=>({count:c.getOpenTimestamps().length,size:c.getTotalSize()}),m=e=>{let t=c.getOldestTimestamp()??n;return s!==null&&e>s||t<e&&Math.abs(t-e)<10},h=()=>{c.deleteAll(),o.return().then(e=>{e.value&&e.value.close()}),s=null},g=Promise.resolve([]);return{src:r,getSamples:(e,t)=>(g=g.then(()=>d(e,t)),g),waitForCompletion:async()=>(await g,!0),canSatisfyRequestedTime:m,logOpenFrames:f,getCacheStats:p,getLastUsed:()=>l,prepareForDeletion:h,startTimestamp:n,clearBeforeThreshold:c.clearBeforeThreshold,getOldestTimestamp:c.getOldestTimestamp,getNewestTimestamp:c.getNewestTimestamp}},jn=({getTotalCacheStats:e})=>{let t=[],n=!1,r=({timeInSeconds:e,src:n,audioSampleSink:r,isMatroska:i,actualMatroskaTimestamps:a,logLevel:o})=>{let s=An({audioSampleSink:r,isMatroska:i,startTimestamp:e,src:n,actualMatroskaTimestamps:a,logLevel:o});return t.push(s),s},i=()=>{let e=null,n=null;for(let r of t){let t=r.getLastUsed();(e===null||t<e)&&(e=t,n=r)}return n},a=()=>{let e=i();e&&(e.prepareForDeletion(),t.splice(t.indexOf(e),1))},o=e=>{let n=new Set;for(let r=0;r<t.length;r++){let i=t[r],a=`${i.src}-${i.getOldestTimestamp()}-${i.getNewestTimestamp()}`;n.has(a)&&(i.prepareForDeletion(),t.splice(t.indexOf(i),1),Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Deleted duplicate iterator for ${i.src}`)),n.add(a)}},s=async({src:i,timeInSeconds:s,audioSampleSink:c,isMatroska:l,actualMatroskaTimestamps:u,logLevel:d,maxCacheSize:f})=>{if(n)throw Error(`Media cache has already been disposed`);let p=0;for(;(await e()).totalSize>f&&p<3;)a(),p++;(await e()).totalSize>f&&p>=3&&Y.Log.warn({logLevel:d,tag:`@remotion/media`},`Audio cache: Exceeded max cache size after 3 attempts. Still ${(await e()).totalSize} bytes used, target was ${f} bytes.`);for(let e of t)if(e.src===i&&await e.waitForCompletion()&&e.canSatisfyRequestedTime(s))return e;for(let e=0;e<t.length;e++){let n=t[e];n.src===i&&n.startTimestamp===s&&(n.prepareForDeletion(),t.splice(t.indexOf(n),1))}if(o(d),n)throw Error(`Media cache has already been disposed`);return r({src:i,timeInSeconds:s,audioSampleSink:c,isMatroska:l,actualMatroskaTimestamps:u,logLevel:d})},c=()=>{let e=0,n=0;for(let r of t){let{count:t,size:i}=r.getCacheStats();e+=t,n+=i}return{count:e,totalSize:n}},l=()=>{for(let e of t)e.logOpenFrames()},u=()=>{for(let e of t)e.prepareForDeletion();t.length=0},d=()=>{n||(n=!0,u())},f=Sn();return{getIterator:({src:e,timeInSeconds:t,audioSampleSink:n,isMatroska:r,actualMatroskaTimestamps:i,logLevel:a,maxCacheSize:o})=>f(()=>s({src:e,timeInSeconds:t,audioSampleSink:n,isMatroska:r,actualMatroskaTimestamps:i,logLevel:a,maxCacheSize:o})),getCacheStats:c,getIteratorMostInThePast:i,logOpenFrames:l,deleteDuplicateIterators:o,clearAll:u,dispose:d}},Mn=null,Nn=()=>new OffscreenCanvas(1,1).getContext(`webgl2`)!==null,Pn=()=>(Mn===null&&(Mn=Nn()),Mn),Fn=e=>{let t=[];return{observeTimestamp:n=>{e&&t.push(n)},getRealTimestamp:n=>e?t.find(e=>Math.abs(n-e)<.001)??null:n}},In=()=>null,Ln=async e=>{try{return await e.getFormat()}catch(e){return Kt(e)?`network-error`:null}},Rn=(e,t,n,r)=>{let i=Bt({credentials:n,requestInit:r}),a=new M({formats:I,source:new A(e,{getRetryDelay:In,maxCacheSize:It(t),...i?{requestInit:i}:void 0})});return{promise:(async()=>{let n=await Ln(a),r=n===P||n===j,i=async()=>{if(n===`network-error`)return`network-error`;if(n===null)return`unknown-container-format`;let r=await a.getPrimaryVideoTrack();if(!r)return`no-video-track`;if(await r.isLive())throw Error(`Live streams are not currently supported by Remotion. Sorry! Source: `+e);if(await r.isRelativeToUnixEpoch())throw Error(`Streams with UNIX timestamps are not currently supported by Remotion. Sorry! Source: `+e);if(!await r.canDecode())return r.codec===`prores`?`cannot-decode-prores`:`cannot-decode`;let i=new R(r);return(await new N(r).getFirstPacket({verifyKeyPackets:!0}))?.sideData.alpha&&!Pn()&&Y.Log.warn({logLevel:t,tag:`@remotion/media`},`WebGL2 is not available, using the non-fast CPU path to decode alpha for ${e}.`),{sampleSink:i}},o=null,s=()=>o||(o=i(),o),c={},l=async e=>{if(n===null)return`unknown-container-format`;if(n===`network-error`)return`network-error`;let[t,r]=await Promise.all([a.getPrimaryVideoTrack(),a.getAudioTracks()]),i=await Gt({videoTrack:t,audioTracks:r,audioStreamIndex:e});return i?await i.canDecode()?{sampleSink:new L(i)}:`cannot-decode-audio`:`no-audio-track`},u=e=>{let t=e===null?-1:e;return c[t]||(c[t]=l(e)),c[t]};return{getVideo:()=>s(),getAudio:e=>u(e),actualMatroskaTimestamps:Fn(r),isMatroska:r,getDuration:()=>kt(a)}})(),dispose:()=>a.dispose()}},zn=({src:e,credentials:t,requestInit:n})=>JSON.stringify([e,t,zt(n)]),Bn=()=>{let e={},t={},n=!1;return{getSink:(r,i,a,o)=>{if(n)return Promise.reject(Error(`Media cache has already been disposed`));let s=Rt(o),c=zn({src:r,credentials:a,requestInit:s}),l=e[c];if(!l){Y.Log.verbose({logLevel:i,tag:`@remotion/media`},`Sink for ${r} was not found, creating new sink`);let n=Rn(r,i,a,s);l=n.promise,e[c]=l,t[c]=n.dispose}return l},dispose:()=>{if(n)return;n=!0;let r=null;for(let n of Object.keys(t))try{t[n]()}catch(e){r??=e}finally{delete t[n],delete e[n]}if(r!==null)throw r}}},Vn=e=>e.length===0?`(none)`:e.length===1?e[0].toFixed(3):`${e[0].toFixed(3)}...${e[e.length-1].toFixed(3)}`,Hn=3,Un=e=>e.format===null?e.codedHeight*e.codedWidth*Hn:e.allocationSize(),Wn=3,Gn=async({logLevel:e,src:t,videoSampleSink:n,initialTimestampRequest:r})=>{let i=n.samples($(r)),a={},o=[],s=!1,c=Date.now(),l=0,u=0,d=e=>{let t=o.indexOf(e);if(t===-1)throw Error(`Frame ${e} not found`);let n=o[t+1];return n===void 0?null:n-e},f=e=>{let t=d(e);return t===null?s?a[e].duration??0:null:t},p=e=>d(e)??a[e].duration??0,m=e=>{l-=Un(a[e]),o.splice(o.indexOf(e),1),a[e].close(),delete a[e]},h=({logLevel:e,timestampInSeconds:n})=>{let r=[];for(let e of o.slice()){if(s&&e===o[o.length-1]||!a[e])continue;let t=f(e);t!==null&&e+t<n&&(m(e),r.push(e))}r.length>0&&Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Deleted ${r.length} frame${r.length===1?``:`s`} ${Vn(r)} for src ${t} because it is lower than ${n}. Remaining: ${Vn(o)}`)},g=e=>{let t=o[o.length-1];if(t===void 0)return!1;if(!a[t]||$(t)>=$(e))return!0;let n=f(t);return n!==null&&$(t+n)>$(e)},_=(e,t)=>{a[e.timestamp]&&m(e.timestamp),a[e.timestamp]=e,o.push(e.timestamp),l+=Un(e),c=Date.now(),Y.Log.trace({logLevel:t,tag:`@remotion/media`},`Added frame at ${e.timestamp}sec to bank`)},v=async(t,n,r)=>{for(;!g(t);){let a=await i.next();if(a.value&&_(a.value,n),a.done){s=!0;break}h({logLevel:e,timestampInSeconds:t-Jn(r)})}c=Date.now()},y=async(t,n)=>{c=Date.now();let r=t;s&&$(r)>$(o[o.length-1])&&(r=o[o.length-1]),await v(r,e,n);for(let e=o.length-1;e>=0;e--){let t=a[o[e]];if(!t)return null;if($(t.timestamp)<=$(r)||Math.abs(t.timestamp-r)<=.001)return t}return a[o[0]]??null},b=async(e,t)=>await y(e,t)!==null,x=()=>({size:l,timestamps:o}),S=()=>c,C=Sn(),w=await i.next();if(!w.value)throw Error(`No first frame found`);let T=w.value.timestamp;Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Creating keyframe bank from ${T}sec`),_(w.value,e);let E=()=>{if(o.length===0)return null;let e=o[0],t=o[o.length-1];return{firstTimestamp:e,lastTimestamp:t+p(t)}};return{getFrameFromTimestamp:(e,t)=>(u++,C(()=>y(e,t)).finally(()=>{u--})),prepareForDeletion:(e,t)=>{let n=E();n&&Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Preparing for deletion (${t}) of keyframe bank from ${n?.firstTimestamp}sec to ${n?.lastTimestamp}sec`);let r=0;for(let e of o.slice())a[e]&&(m(e),r++);return i.return(),o.length=0,{framesDeleted:r}},hasTimestampInSecond:(e,t)=>(u++,C(()=>b(e,t)).finally(()=>{u--})),addFrame:_,deleteFramesBeforeTimestamp:h,src:t,getOpenFrameCount:x,getLastUsed:S,isBusy:()=>u>0,canSatisfyTimestamp:e=>{if(o.length===0)return!1;let t=$(e),n=$(o[0]),i=E();if(!i)return!1;let a=$(o[o.length-1]),c=$(i.lastTimestamp);return s&&t>a?!0:t<n?n===T&&t>=r:!(t-Wn>c)},getRangeOfTimestamps:E}},Kn=50,qn=({getTotalCacheStats:e})=>{let t={},n=!1,r={},i=new WeakMap,a=({src:e,bank:r,logLevel:i})=>n?(r.prepareForDeletion(i,`media cache was disposed`),!1):(t[e]=t[e]??[],t[e].push(r),!0),o=e=>{let n=0,r=0;for(let i in t)for(let a of t[i]){let{size:t,timestamps:o}=a.getOpenFrameCount();n+=o.length,r+=t,t!==0&&Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Open frames for src ${i}: ${Vn(o)}`)}Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Video cache stats: ${n} open frames, ${r} bytes`)},s=()=>{let e=0,n=0;for(let r in t)for(let i of t[r]){let{timestamps:t,size:r}=i.getOpenFrameCount();e+=t.length,n+=r}return{count:e,totalSize:n}},c=()=>{let e=null,n=null,r=0;for(let i in t)for(let a of t[i]){if(r++,a.isBusy())continue;let o=t[i].indexOf(a),s=a.getLastUsed();(e===null||s<e)&&(e=s,n={src:i,bank:a,index:o})}return n?{mostInThePastBank:n,numberOfBanks:r}:{mostInThePastBank:null,numberOfBanks:r}},l=e=>{let{mostInThePastBank:n,numberOfBanks:r}=c();if(r<2||n===null)return{finish:!0};let{bank:i,src:a,index:o}=n,s=i.getRangeOfTimestamps(),{framesDeleted:l}=i.prepareForDeletion(e,`deleted oldest keyframe bank to stay under max cache size`);return t[a].splice(o,1),s&&Y.Log.verbose({logLevel:e,tag:`@remotion/media`},`Deleted ${l} frames for src ${a} from ${s?.firstTimestamp}sec to ${s?.lastTimestamp}sec to free up memory.`),{finish:!1}},u=(t,n)=>{let r=e(),i=0;for(;r.totalSize>n&&i<3;){let{finish:a}=l(t);if(a)break;Y.Log.verbose({logLevel:t,tag:`@remotion/media`},`Deleted oldest keyframe bank to stay under max cache size`,(r.totalSize/1024/1024).toFixed(1),`out of`,(n/1024/1024).toFixed(1)),r=e(),i++}r.totalSize>n&&i>=3&&Y.Log.warn({logLevel:t,tag:`@remotion/media`},`Exceeded max cache size after 3 attempts. Remaining cache size: ${(r.totalSize/1024/1024).toFixed(1)} MB, target was ${(n/1024/1024).toFixed(1)} MB.`)},d=({timestampInSeconds:e,src:n,logLevel:a,fps:s})=>{let c=e-Jn(s);if(!t[n])return;let l=t[n],u=r[n]??0;for(let e of l){if(e.isBusy())continue;let r=e.getRangeOfTimestamps();if(!r)continue;let o=i.get(e);if(!(o!==void 0&&u-o<Kn))if(r.lastTimestamp<c){e.prepareForDeletion(a,`cleared before threshold `+c),Y.Log.verbose({logLevel:a,tag:`@remotion/media`},`[Video] Cleared frames for src ${n} from ${r.firstTimestamp}sec to ${r.lastTimestamp}sec`);let i=l.indexOf(e);delete t[n][i]}else e.deleteFramesBeforeTimestamp({timestampInSeconds:c,logLevel:a})}t[n]=t[n].filter(e=>e!==void 0),o(a)},f=async({timestamp:e,videoSampleSink:n,src:r,logLevel:i})=>{let o=(t[r]??[])?.find(t=>t.canSatisfyTimestamp(e));if(!o){Y.Log.trace({logLevel:i,tag:`@remotion/media`},`Creating new keyframe bank for src ${r} at timestamp ${e}`);let t=await Gn({videoSampleSink:n,logLevel:i,src:r,initialTimestampRequest:e});return a({src:r,bank:t,logLevel:i})?t:null}if(o.canSatisfyTimestamp(e))return Y.Log.trace({logLevel:i,tag:`@remotion/media`},`Keyframe bank exists and satisfies timestamp ${e}`),o;Y.Log.verbose({logLevel:i,tag:`@remotion/media`},`Keyframe bank exists but frame at time ${e} does not exist anymore.`),o.prepareForDeletion(i,`already existed but evicted`),t[r]=t[r].filter(e=>e!==o);let s=await Gn({videoSampleSink:n,initialTimestampRequest:e,logLevel:i,src:r});return a({src:r,bank:s,logLevel:i})?s:null},p=async({timestamp:e,videoSampleSink:t,src:a,logLevel:o,maxCacheSize:s,fps:c})=>{if(n)return null;r[a]=(r[a]??0)+1,u(o,s),d({timestampInSeconds:e,src:a,logLevel:o,fps:c});let l=await f({timestamp:e,videoSampleSink:t,src:a,logLevel:o});return l&&i.set(l,r[a]),l},m=e=>{let n=Object.keys(t);for(let r of n){let n=t[r];for(let t of n)t.prepareForDeletion(e,`clearAll`);t[r]=[]}t={},r={}},h=e=>{n||(n=!0,m(e))},g=Sn();return{requestKeyframeBank:({timestamp:e,videoSampleSink:t,src:n,logLevel:r,maxCacheSize:i,fps:a})=>g(()=>p({timestamp:e,videoSampleSink:t,src:n,logLevel:r,maxCacheSize:i,fps:a})),getCacheStats:s,clearAll:m,dispose:h}},Jn=e=>.2*30/e,Yn=()=>{let e=Bn(),t={keyframe:null,audio:null},n=()=>{let{keyframe:e,audio:n}=t;if(e===null||n===null)throw Error(`Media cache managers have not been initialized`);let r=e.getCacheStats(),i=n.getCacheStats();return{count:r.count+i.count,totalSize:r.totalSize+i.totalSize}},r=qn({getTotalCacheStats:n}),i=jn({getTotalCacheStats:n});t.keyframe=r,t.audio=i;let a=Sn(),o=Sn(),s=!1;return{sinkManager:e,keyframeManager:r,audioManager:i,getTotalCacheStats:n,isDisposed:()=>s,queueFrameExtraction:a,queueAudioExtraction:o,dispose:t=>{if(!s){s=!0;try{r.dispose(t)}finally{try{i.dispose()}finally{e.dispose()}}}}}},Xn=Yn(),Zn=e=>{let t=Q.useContext(Y.RenderResourceManagerContext);return t===null?Xn:t.getOrCreateResource({key:`@remotion/media/cache`,create:()=>{let t=Yn();return{resource:t,dispose:()=>t.dispose(e)}}})},Qn=e=>{let t=Q.useContext(Y.MaxMediaCacheSizeContext);return t===null?Mt(e):t},$n=(e,t)=>{if(t!==1)for(let n=0;n<e.length;n++){let r=e[n]*t;r<-32768?e[n]=-32768:r>32767?e[n]=32767:e[n]=r}},er=2,tr=()=>typeof window<`u`&&window.remotion_sampleRate?window.remotion_sampleRate:48e3,nr=e=>e%1<1e-7?Math.floor(e):e%1>.9999999?Math.ceil(e):e,rr=({srcNumberOfChannels:e,sourceChannels:t,destination:n,targetFrames:r,chunkSize:i})=>{let a=(n,r,i)=>{let a=nr(n),o=nr(r),s=Math.floor(a),c=Math.ceil(a),l=a-s,u=o-Math.floor(o),d=Math.floor(o),f=0,p=0;if(l>0){let n=t[s*e+i];f+=n*(1-l),p+=1-l}for(let n=c;n<d;n++){let r=t[n*e+i];f+=r,p+=1}if(u>0){let n=t[d*e+i];f+=n*u,p+=u}return f/p};for(let t=0;t<r;t++){let r=t*i,o=r+i;if(er===e)for(let i=0;i<e;i++)n[t*e+i]=a(r,o,i);if(e===1){let e=a(r,o,0);n[t*2+0]=e,n[t*2+1]=e}else if(e===4){let e=a(r,o,0),i=a(r,o,1),s=a(r,o,2),c=a(r,o,3),l=.5*(e+s),u=.5*(i+c);n[t*2+0]=l,n[t*2+1]=u}else if(e===6){let e=a(r,o,0),i=a(r,o,1),s=a(r,o,2),c=a(r,o,3),l=a(r,o,4),u=Math.sqrt(1/2),d=e+u*(s+c),f=i+u*(s+l);n[t*2+0]=d,n[t*2+1]=f}else for(let i=0;i<e;i++)n[t*er+i]=a(r,o,i)}},ir=({behavior:e,loop:t,assetDurationInSeconds:n,fps:r,frame:i,startsAt:a})=>!t||e===`extend`?i+a:i%(Math.floor(n*r)-a)+a,ar=`s16`,or=e=>{let t=Math.abs(e%1);return t<1e-7?e<0?Math.ceil(e):Math.floor(e):t>.9999999?e<0?Math.floor(e):Math.ceil(e):e},sr=e=>{let t=or(e);return Math.ceil(t)},cr=({audioData:e,trimStartInSeconds:t,trimEndInSeconds:n,playbackRate:r,audioDataTimestamp:i,isLast:a})=>{let{numberOfChannels:o,sampleRate:s,numberOfFrames:c}=e,l=s/tr(),u=Math.floor(or(t*e.sampleRate)),d=c-n*e.sampleRate-u,f=a?sr(d):Math.round(d),p=a?sr(d/l/r):Math.round(d/l/r);if(p===0)throw Error(`Cannot resample - the given sample rate would result in less than 1 sample`);let m=new Int16Array(o*f);if(e.format===`f32`||e.format===`f32-planar`){let t=f*4,n=new ArrayBuffer(o*t);for(let r=0;r<o;r++)e.copyTo(new Float32Array(n,r*t,f),{planeIndex:r,frameOffset:u,frameCount:f,format:`f32-planar`});let r=new AudioData({format:`f32-planar`,sampleRate:s,numberOfFrames:f,numberOfChannels:o,timestamp:e.timestamp,data:n});r.copyTo(m,{planeIndex:0,format:ar,frameOffset:0,frameCount:f}),r.close()}else e.copyTo(m,{planeIndex:0,format:ar,frameOffset:u,frameCount:f});let h=new Int16Array(p*er),g=f/p,_=u/e.sampleRate*1e6;return p===f&&er===o&&r===1?{data:m,numberOfFrames:p,timestamp:i*1e6+or(_),durationInMicroSeconds:or(p/tr()*1e6)}:(rr({srcNumberOfChannels:o,sourceChannels:m,destination:h,targetFrames:p,chunkSize:g}),{data:h,numberOfFrames:p,timestamp:i*1e6+or(_),durationInMicroSeconds:or(p/tr()*1e6)})},lr=e=>{let t=0,n=0,{timestamp:r}=e[0];for(let r of e)t+=r.numberOfFrames,n+=r.durationInMicroSeconds;let i=new Int16Array(t*er),a=0;for(let t of e)i.set(t.data,a),a+=t.data.length;return{data:i,numberOfFrames:t,timestamp:or(r),durationInMicroSeconds:or(n)}},ur=async({src:e,timeInSeconds:t,durationInSeconds:n,logLevel:r,loop:i,playbackRate:a,audioStreamIndex:o,trimBefore:s,trimAfter:c,fps:l,maxCacheSize:u,credentials:d,requestInit:f,mediaCache:p})=>{let{getAudio:m,actualMatroskaTimestamps:h,isMatroska:g,getDuration:_}=await p.sinkManager.getSink(e,r,d,f),v=null;i&&(v=await _());let y=await m(o);if(y===`network-error`)return`network-error`;if(y===`no-audio-track`)return{data:null,durationInSeconds:null};if(y===`cannot-decode-audio`)return`cannot-decode`;if(y===`unknown-container-format`)return`unknown-container-format`;let b=ot({loop:i,mediaDurationInSeconds:v,unloopedTimeInSeconds:t,src:e,trimAfter:c,playbackRate:a,trimBefore:s,fps:l,ifNoMediaDuration:`fail`});if(b===null)return{data:null,durationInSeconds:v};try{let t=await p.audioManager.getIterator({src:e,timeInSeconds:b,audioSampleSink:y.sampleSink,isMatroska:g,actualMatroskaTimestamps:h,logLevel:r,maxCacheSize:u}),i=n*a,o=await t.getSamples(b,i);p.audioManager.logOpenFrames();let s=[];for(let e=0;e<o.length;e++){let t=o[e];if(Math.abs(t.timestamp-(b+i))*t.sampleRate<1||t.timestamp+t.duration<=b)continue;let n=e===0,r=e===o.length-1,c=t.toAudioData(),l=0,u=0,d=null;if(n&&(l=or(b-t.timestamp),l<0)){let e=Math.ceil(or(-l*tr()));d={data:new Int16Array(e*er),numberOfFrames:e,timestamp:b*1e6,durationInMicroSeconds:e/tr()*1e6},l=0}r&&(u=Math.max(0,t.timestamp+t.duration-(b+i)));let f=cr({audioData:c,trimStartInSeconds:l,trimEndInSeconds:u,playbackRate:a,audioDataTimestamp:t.timestamp,isLast:r});c.close(),f.numberOfFrames!==0&&(d&&s.push(d),s.push(f))}return s.length===0?{data:null,durationInSeconds:v}:{data:lr(s),durationInSeconds:v}}catch(e){let t=e;if(Kt(t))return`network-error`;if(qt(t))return`cannot-decode`;throw e}},dr=e=>e.mediaCache.queueAudioExtraction(()=>ur(e)),fr=async({src:e,timeInSeconds:t,logLevel:n,loop:r,trimAfter:i,trimBefore:a,playbackRate:o,fps:s,maxCacheSize:c,credentials:l,requestInit:u,mediaCache:d})=>{let f=await d.sinkManager.getSink(e,n,l,u),[p,m]=await Promise.all([f.getVideo(),r?f.getDuration():Promise.resolve(null)]),h=r?m:null;if(p===`no-video-track`)throw Error(`No video track found for ${e}`);if(p===`cannot-decode`)return{type:`cannot-decode`,durationInSeconds:h};if(p===`cannot-decode-prores`)return{type:`cannot-decode-prores`,durationInSeconds:h};if(p===`unknown-container-format`)return{type:`unknown-container-format`};if(p===`network-error`)return{type:`network-error`};if(p===`cannot-decode-alpha`)return{type:`cannot-decode-alpha`,durationInSeconds:h};let g=ot({loop:r,mediaDurationInSeconds:h,unloopedTimeInSeconds:t,src:e,trimAfter:i,playbackRate:o,trimBefore:a,fps:s,ifNoMediaDuration:`fail`});if(g===null)return{type:`success`,frame:null,rotation:0,durationInSeconds:await f.getDuration()};try{let t=await d.keyframeManager.requestKeyframeBank({videoSampleSink:p.sampleSink,timestamp:g,src:e,logLevel:n,maxCacheSize:c,fps:s});if(!t)return{type:`success`,frame:null,rotation:0,durationInSeconds:await f.getDuration()};let r=await t.getFrameFromTimestamp(g,s),i=r?.rotation??0;return{type:`success`,frame:r?.toVideoFrame()??null,rotation:i,durationInSeconds:await f.getDuration()}}catch(t){return Y.Log.info({logLevel:n,tag:`@remotion/media`},`Error decoding ${e} at time ${g}: ${t}`,t),{type:`cannot-decode`,durationInSeconds:h}}},pr=e=>e.mediaCache.queueFrameExtraction(()=>fr(e)),mr=async({frame:e,rotation:t})=>{if(t===0){let t=await createImageBitmap(e);return e.close(),t}let n=t===90||t===270?e.displayHeight:e.displayWidth,r=t===90||t===270?e.displayWidth:e.displayHeight,i=new OffscreenCanvas(n,r),a=i.getContext(`2d`);if(!a)throw Error(`Could not get 2d context`);i.width=n,i.height=r,t===90?a.translate(n,0):t===180?a.translate(n,r):t===270&&a.translate(0,r),a.rotate(Math.PI/180*t),a.drawImage(e,0,0);let o=await createImageBitmap(i);return e.close(),o},hr=async({src:e,timeInSeconds:t,logLevel:n,durationInSeconds:r,playbackRate:i,includeAudio:a,includeVideo:o,loop:s,audioStreamIndex:c,trimAfter:l,trimBefore:u,fps:d,maxCacheSize:f,credentials:p,requestInit:m,mediaCache:h})=>{try{let[g,_]=await Promise.all([o?pr({src:e,timeInSeconds:t,logLevel:n,loop:s,trimAfter:l,playbackRate:i,trimBefore:u,fps:d,maxCacheSize:f,credentials:p,requestInit:m,mediaCache:h}):null,a?dr({src:e,timeInSeconds:t,durationInSeconds:r,logLevel:n,loop:s,playbackRate:i,audioStreamIndex:c,trimAfter:l,fps:d,trimBefore:u,maxCacheSize:f,credentials:p,requestInit:m,mediaCache:h}):null]);return g?.type===`cannot-decode`?{type:`cannot-decode`,durationInSeconds:g.durationInSeconds}:g?.type===`cannot-decode-prores`?{type:`cannot-decode-prores`,durationInSeconds:g.durationInSeconds}:g?.type===`unknown-container-format`?{type:`unknown-container-format`}:g?.type===`cannot-decode-alpha`?{type:`cannot-decode-alpha`,durationInSeconds:g.durationInSeconds}:g?.type===`network-error`?{type:`network-error`}:_===`unknown-container-format`?{type:`unknown-container-format`}:_===`network-error`?{type:`network-error`}:_===`cannot-decode`?{type:`cannot-decode`,durationInSeconds:g?.type===`success`?g.durationInSeconds:null}:{type:`success`,frame:g?.frame?await mr({frame:g.frame,rotation:g.rotation}):null,audio:_?.data??null,durationInSeconds:_?.durationInSeconds??null}}catch(e){if(Kt(e))return{type:`network-error`};throw e}},gr=e=>{e.postMessage({type:`main-tab-ready`}),setInterval(()=>{e.postMessage({type:`main-tab-ready`})},300)},_r=()=>{typeof window<`u`&&window.remotion_broadcastChannel&&window.remotion_isMainTab&&(window.remotion_broadcastChannel.addEventListener(`message`,async e=>{let t=e.data;if(t.type===`request`)try{let e=await hr({src:t.src,timeInSeconds:t.timeInSeconds,logLevel:t.logLevel,durationInSeconds:t.durationInSeconds,playbackRate:t.playbackRate,includeAudio:t.includeAudio,includeVideo:t.includeVideo,loop:t.loop,audioStreamIndex:t.audioStreamIndex,trimAfter:t.trimAfter,trimBefore:t.trimBefore,fps:t.fps,maxCacheSize:t.maxCacheSize,credentials:t.credentials,requestInit:t.requestInit,mediaCache:Xn});if(e.type===`cannot-decode`){let n={type:`response-cannot-decode`,id:t.id,durationInSeconds:e.durationInSeconds};window.remotion_broadcastChannel.postMessage(n);return}if(e.type===`cannot-decode-prores`){let n={type:`response-cannot-decode-prores`,id:t.id,durationInSeconds:e.durationInSeconds};window.remotion_broadcastChannel.postMessage(n);return}if(e.type===`cannot-decode-alpha`){let n={type:`response-cannot-decode-alpha`,id:t.id,durationInSeconds:e.durationInSeconds};window.remotion_broadcastChannel.postMessage(n);return}if(e.type===`network-error`){let e={type:`response-network-error`,id:t.id};window.remotion_broadcastChannel.postMessage(e);return}if(e.type===`unknown-container-format`){let e={type:`response-unknown-container-format`,id:t.id};window.remotion_broadcastChannel.postMessage(e);return}let{frame:n,audio:r,durationInSeconds:i}=e,a=n?await createImageBitmap(n):null;n&&n.close();let o={type:`response-success`,id:t.id,frame:a,audio:r,durationInSeconds:i??null};window.remotion_broadcastChannel.postMessage(o)}catch(e){let n={type:`response-error`,id:t.id,errorStack:e.stack??`No stack trace`};window.remotion_broadcastChannel.postMessage(n)}else if(t.type!==`main-tab-ready`)throw Error(`Invalid message: `+JSON.stringify(t))}),gr(window.remotion_broadcastChannel))},vr=null,yr=e=>vr||(vr=new Promise(t=>{let n=r=>{r.data.type===`main-tab-ready`&&(t(),e.removeEventListener(`message`,n))};e.addEventListener(`message`,n)}),vr);_r();var br=async({src:e,timeInSeconds:t,logLevel:n,durationInSeconds:r,playbackRate:i,includeAudio:a,includeVideo:o,isClientSideRendering:s,loop:c,audioStreamIndex:l,trimAfter:u,trimBefore:d,fps:f,maxCacheSize:p,credentials:m,requestInit:h,mediaCache:g})=>{if(s||window.remotion_isMainTab)return hr({logLevel:n,src:e,timeInSeconds:t,durationInSeconds:r,playbackRate:i,includeAudio:a,includeVideo:o,loop:c,audioStreamIndex:l,trimAfter:u,trimBefore:d,fps:f,maxCacheSize:p,credentials:m,requestInit:h,mediaCache:g});await yr(window.remotion_broadcastChannel);let _=crypto.randomUUID(),v=new Promise((e,t)=>{let n=r=>{let i=r.data;if(i&&i.type!==`main-tab-ready`&&i.id===_){if(i.type===`response-success`){e({type:`success`,frame:i.frame?i.frame:null,audio:i.audio?i.audio:null,durationInSeconds:i.durationInSeconds?i.durationInSeconds:null}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-error`){t(i.errorStack),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-cannot-decode`){e({type:`cannot-decode`,durationInSeconds:i.durationInSeconds}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-cannot-decode-prores`){e({type:`cannot-decode-prores`,durationInSeconds:i.durationInSeconds}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-network-error`){e({type:`network-error`}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-unknown-container-format`){e({type:`unknown-container-format`}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}if(i.type===`response-cannot-decode-alpha`){e({type:`cannot-decode-alpha`,durationInSeconds:i.durationInSeconds}),window.remotion_broadcastChannel.removeEventListener(`message`,n);return}throw Error(`Invalid message: ${JSON.stringify(i)}`)}};window.remotion_broadcastChannel.addEventListener(`message`,n)}),y={type:`request`,src:e,timeInSeconds:t,id:_,logLevel:n,durationInSeconds:r,playbackRate:i,includeAudio:a,includeVideo:o,loop:c,audioStreamIndex:l,trimAfter:u,trimBefore:d,fps:f,maxCacheSize:p,credentials:m,requestInit:Rt(h)};window.remotion_broadcastChannel.postMessage(y);let b;return Promise.race([v.then(e=>(clearTimeout(b),e)),new Promise((n,r)=>{b=setTimeout(()=>{r(Error(`Timeout while extracting frame at time ${t}sec from ${e}`))},Math.max(3e3,window.remotion_puppeteerTimeout-5e3))})])},xr=({volume:e,playbackRate:t,src:n,muted:r,loopVolumeCurveBehavior:i,delayRenderRetries:a,delayRenderTimeoutInMilliseconds:o,logLevel:s,loop:c,fallbackHtml5AudioProps:l,audioStreamIndex:u,showInTimeline:d,style:f,name:p,disallowFallbackToHtml5Audio:m,toneFrequency:h,trimAfter:g,trimBefore:_,onError:v,credentials:y,requestInit:b})=>{let x=Y.useLogLevel(),S=s??x,C=H(),w=Y.useTimelinePosition(),T=Y.useUnsafeVideoConfig(),{registerRenderAsset:E,unregisterRenderAsset:D}=(0,Q.useContext)(Y.RenderAssetManager),O=Y.useMediaStartsAt(),k=z();if(!T)throw Error(`No video config found`);if(!n)throw TypeError("No `src` was passed to <Audio>.");let{fps:A}=T,{delayRender:j,continueRender:M}=B(),[N,P]=(0,Q.useState)(!1),[F]=(0,Q.useState)(b),I=(0,Q.useContext)(Y.SequenceContext),L=(0,Q.useMemo)(()=>`media-audio-${ue(n)}-${I?.cumulatedFrom}-${I?.relativeFrom}-${I?.durationInFrames}`,[n,I?.cumulatedFrom,I?.relativeFrom,I?.durationInFrames]),R=Qn(S),V=Zn(S),U=Y.useAudioEnabled();return(0,Q.useLayoutEffect)(()=>{let s=C/A,l=1/A,d=!(!U||r);if(!d||N)return;let f=j(`Extracting audio for frame ${C}`,{retries:a??void 0,timeoutInMilliseconds:o??void 0});return br({src:n,timeInSeconds:s,durationInSeconds:l,playbackRate:t??1,logLevel:S,includeAudio:d,includeVideo:!1,isClientSideRendering:k.isClientSideRendering,loop:c??!1,audioStreamIndex:u??null,trimAfter:g,trimBefore:_,fps:A,maxCacheSize:R,credentials:y,requestInit:F,mediaCache:V}).then(t=>{if(V.isDisposed())return;let r=(e,t,n)=>{let[r,i]=cn({onError:v,error:e,disallowFallback:m??!1,isClientSideRendering:k.isClientSideRendering,clientSideError:t});r===`fail`&&re(i),Y.Log.warn({logLevel:S,tag:`@remotion/media`},n),P(!0)};if(t.type===`unknown-container-format`){r(Error(`Unknown container format ${n}.`),Error(`Cannot render audio "${n}": Unknown container format. See supported formats: https://www.remotion.dev/docs/mediabunny/formats`),`Unknown container format for ${n} (Supported formats: https://www.remotion.dev/docs/mediabunny/formats), falling back to <Html5Audio>`);return}if(t.type===`cannot-decode`){r(Error(`Cannot decode ${n}.`),Error(`Cannot render audio "${n}": The audio could not be decoded by the browser.`),`Cannot decode ${n}, falling back to <Html5Audio>`);return}if(t.type===`cannot-decode-alpha`)throw Error(`Cannot decode alpha component for ${n}, and 'disallowFallbackToHtml5Audio' was set. But this should never happen, since you used the <Audio> tag. Please report this as a bug.`);if(t.type===`cannot-decode-prores`)throw Error(`Encountered ProRes media for ${n}. But this should never happen, since you used the <Audio> tag. Please report this as a bug.`);if(t.type===`network-error`){r(Error(`Network error fetching ${n}.`),Error(`Cannot render audio "${n}": Network error while fetching the audio (possibly CORS).`),`Network error fetching ${n}, falling back to <Html5Audio>`);return}let{audio:a,durationInSeconds:o}=t,s=ir({behavior:i??`repeat`,loop:c??!1,assetDurationInSeconds:o??0,fps:A,frame:C,startsAt:O}),l=Y.evaluateVolume({volume:e,frame:s,mediaVolume:1});Y.warnAboutTooHighVolume(l),a&&l>0&&($n(a.data,l),E({type:`inline-audio`,id:L,audio:k.isClientSideRendering?a.data:Array.from(a.data),frame:w,timestamp:a.timestamp,duration:a.numberOfFrames/tr()*1e6,toneFrequency:h??1})),M(f)}).catch(e=>{V.isDisposed()||re(e)}),()=>{M(f),D(L)}},[w,M,j,a,o,m,k.isClientSideRendering,A,C,L,S,c,i,r,t,E,n,O,D,e,u,h,g,_,N,R,U,v,y,F,V]),N?(0,Z.jsx)(oe,{src:n,playbackRate:t,muted:r,loop:c,volume:e,delayRenderRetries:a,delayRenderTimeoutInMilliseconds:o,style:f,loopVolumeCurveBehavior:i,audioStreamIndex:u,useWebAudioApi:l?.useWebAudioApi,onError:l?.onError,toneFrequency:h,acceptableTimeShiftInSeconds:l?.acceptableTimeShiftInSeconds,preservePitch:l?.preservePitch??!0,name:p,showInTimeline:d}):null},{validateMediaProps:Sr}=Y,Cr={src:{type:`asset`,default:void 0,description:`Source`,keyframable:!1},...Y.baseSchema,...Y.premountSchema,volume:{type:`number`,min:0,max:20,step:.01,default:1,description:`Volume`,hiddenFromList:!1},playbackRate:{type:`number`,min:.1,step:.01,default:1,description:`Playback rate`,hiddenFromList:!1,keyframable:!1},loop:{type:`boolean`,default:!1,description:`Loop`}},wr=K.withSchema({Component:e=>{let{name:t,showInTimeline:n,controls:r,from:i,durationInFrames:a,freeze:o,hidden:s,style:c,premountFor:l,postmountFor:u,...d}=e,f=z(),p=r?Y.getStackForControls(r):null,[m]=Y.useMediaVolumeState(),h=Y.useMediaStartsAt(),g=V(),_=Math.min(a??1/0,Math.max(0,g.durationInFrames-(i??0))),v=Y.useBasicMediaInTimeline({src:e.src,volume:e.volume,playbackRate:e.playbackRate??1,trimBefore:e.trimBefore,trimAfter:e.trimAfter,sequenceDurationInFrames:_,mediaType:`audio`,displayName:t??`<Audio>`,mediaVolume:m,mediaStartsAt:h,loop:e.loop??!1}),[y,b]=(0,Q.useState)(null),x=(0,Q.useMemo)(()=>at({loop:e.loop??!1,mediaDurationInSeconds:y,playbackRate:e.playbackRate??1,trimAfter:e.trimAfter,trimBefore:e.trimBefore,sequenceDurationInFrames:_,compFps:g.fps}),[e.loop,y,e.playbackRate,e.trimAfter,e.trimBefore,_,g.fps]),S=(0,Q.useMemo)(()=>({type:`audio`,data:v}),[v]),{effectivePostmountFor:C,effectivePremountFor:w,freezeFrame:T,isPremountingOrPostmounting:E,postmountingActive:D,premountingActive:O,premountingStyle:k}=Y.usePremounting({from:i??0,durationInFrames:v.duration,premountFor:l??null,postmountFor:u??null,style:c??null,styleWhilePremounted:null,styleWhilePostmounted:null,hideWhilePremounted:`display-none`});if(typeof e.src!=`string`)throw TypeError(`The \`<Audio>\` tag requires a string for \`src\`, but got ${JSON.stringify(e.src)} instead.`);return Sr({playbackRate:e.playbackRate,volume:e.volume},`Audio`),_===0?null:(0,Z.jsx)(W,{frame:T,active:E,children:(0,Z.jsx)(q,{layout:`none`,from:i??0,durationInFrames:v.duration,freeze:o,_remotionInternalIsMedia:S,_remotionInternalPremountDisplay:w||null,_remotionInternalPostmountDisplay:C||null,_remotionInternalIsPremounting:O,_remotionInternalIsPostmounting:D,name:t??`<Audio>`,_remotionInternalDocumentationLink:t===void 0?`https://www.remotion.dev/docs/media/audio`:void 0,controls:r,_remotionInternalLoopDisplay:x,showInTimeline:n??!0,hidden:s,children:f.isRendering?(0,Z.jsx)(xr,{...d,style:k??void 0}):(0,Z.jsx)(xn,{name:t,...d,style:k,_remotionInternalStack:p,setMediaDurationInSeconds:b})})})},componentName:`<Audio>`,componentIdentity:`dev.remotion.media.Audio`,schema:Cr,supportsEffects:!1}),Tr=({durationInFrames:e,loop:t,playbackRate:n,trimAfter:r,trimBefore:i})=>{if(t||r===void 0)return e;let a=Y.calculateMediaDuration({trimAfter:r,trimBefore:i,playbackRate:n,mediaDurationInFrames:1/0});return Math.min(e??1/0,a)},Er=`https://www.remotion.dev/docs/videos/prores`,Dr=e=>`Cannot decode "${e}": it is encoded with Apple ProRes, which WebCodecs does not support natively. ProRes decoding is not enabled by default. Register the ProRes decoder by calling registerProresDecoder() from "@mediabunny/prores" in your entry point, before registerRoot(). See ${Er}.`,Or=class extends Error{constructor(e){super(Dr(e)),this.name=`ProResDecoderNotEnabledError`}},kr=new Map,Ar=(e,t)=>{let{width:n,height:r}=t;if(n===0||r===0)return;let i=kr.get(e);(!i||i.width!==n||i.height!==r)&&(i=new OffscreenCanvas(n,r),kr.set(e,i));let a=i.getContext(`2d`);a&&(a.clearRect(0,0,n,r),a.drawImage(t,0,0))},jr=e=>kr.get(e)??null,Mr=/\bobject-(contain|cover|fill|none|scale-down)\b/,Nr=!1,Pr=!1,Fr=({style:e,className:t,logLevel:n})=>{!Nr&&e?.objectFit&&(Nr=!0,Y.Log.warn({logLevel:n,tag:`@remotion/media`},"Use the `objectFit` prop instead of the `style` prop.")),!Pr&&t&&Mr.test(t)&&(Pr=!0,Y.Log.warn({logLevel:n,tag:`@remotion/media`},"Use the `objectFit` prop instead of `object-*` CSS class names."))},{useUnsafeVideoConfig:Ir,Timeline:Lr,SharedAudioContext:Rr,usePlayerMutedState:zr,useMediaVolumeState:Br,useFrameForVolumeProp:Vr,evaluateVolume:Hr,warnAboutTooHighVolume:Ur,usePreload:Wr,SequenceContext:Gr,useEffectChainState:Kr}=Y,qr=({src:e,style:t,playbackRate:n,logLevel:r,className:i,muted:a,volume:o,loopVolumeCurveBehavior:s,onVideoFrame:c,showInTimeline:l,loop:u,trimAfter:d,trimBefore:f,_remotionInternalStack:p,disallowFallbackToOffthreadVideo:m,fallbackOffthreadVideoProps:h,audioStreamIndex:g,debugOverlay:_,headless:v,onError:y,credentials:b,requestInit:x,objectFit:S,_experimentalInitiallyDrawCachedFrame:C,effects:w,setMediaDurationInSeconds:T,refForOutline:E,...D})=>{let O=Wr(e),k=(0,Q.useRef)(null),A=Ir(),j=H(),M=(0,Q.useRef)(null),N=(0,Q.useRef)(f),P=(0,Q.useRef)(d),F=(0,Q.useRef)(c),[I]=(0,Q.useState)(x),[L,R]=(0,Q.useState)(!1),[z,B]=(0,Q.useState)(!1),[V]=Lr.usePlayingState(),{playbackRate:U}=Y.usePlaybackRate(),W=(0,Q.useContext)(Rr),G=le(),ee=(0,Q.useCallback)(e=>{k.current=e,E.current=e},[E]),te=(0,Q.useCallback)(e=>{E.current=e},[E]),[ne]=zr(),[re]=Br(),K=Hr({frame:Vr(s),volume:o,mediaVolume:re});if(!A)throw Error(`No video config found`);Ur(K);let ie=Kr(),ae=(0,Q.useRef)(w);ae.current=w;let oe=(0,Q.useRef)(y);oe.current=y;let q=(0,Q.useRef)(ie);q.current=ie;let J=(0,Q.useContext)(Gr),ce=!!J?.premounting,ue=!!J?.postmounting,de=(J?.absoluteFrom??0)/A.fps,fe=j/A.fps,pe=(0,Q.useRef)(fe);pe.current=fe;let X=Wr(O),me=(0,Q.useContext)(Y.BufferingContextReact);if(!me)throw Error(`useMediaPlayback must be used inside a <BufferingContext>`);let he=a||ne||K<=0,ge=Y.useIsPlayerBuffering(me),_e=(0,Q.useRef)(V&&!ge),ve=(0,Q.useRef)(ce),ye=(0,Q.useRef)(ue),be=(0,Q.useRef)(U),xe=(0,Q.useRef)(n),Se=(0,Q.useRef)(he),Ce=(0,Q.useRef)(A.durationInFrames),we=(0,Q.useRef)(de),Te=(0,Q.useRef)(!1),Ee=(0,Q.useRef)(ce);Ee.current=ce,(0,Q.useLayoutEffect)(()=>{if(!C)return;let e=k.current;if(!e)return;let t=jr(O);if(!t)return;e.width=t.width,e.height=t.height;let n=e.getContext(`2d`,{alpha:!0});n&&n.drawImage(t,0,0)},[C,O]),(0,Q.useLayoutEffect)(()=>{if(C)return()=>{let e=k.current;!e||!Te.current||Ee.current||Ar(O,e)}},[C,O]),(0,Q.useEffect)(()=>{let e=W?.audioContext&&W.gainNode?{audioContext:W.audioContext,gainNode:W.gainNode,audioSyncAnchor:W.audioSyncAnchor,scheduleAudioNode:W.scheduleAudioNode,unscheduleAudioNode:W.unscheduleAudioNode}:null;try{let t=new sn({canvas:k.current,src:X,logLevel:r,sharedAudioContext:e,loop:u,trimAfter:P.current,trimBefore:N.current,fps:A.fps,playbackRate:xe.current,audioStreamIndex:g,debugOverlay:_,bufferState:G,isPremounting:ve.current,isPostmounting:ye.current,globalPlaybackRate:be.current,durationInFrames:Ce.current,onVideoFrameCallback:F.current??null,playing:_e.current,sequenceOffset:we.current,credentials:b,requestInit:I,tagType:`video`,getEffects:()=>ae.current,getEffectChainState:(e,t)=>q.current?.get(e,t)});M.current=t,t.initialize(pe.current,Se.current).then(e=>{if(e.type===`disposed`)return;let t=(e,t)=>{let[n,i]=cn({onError:oe.current,error:e,disallowFallback:m,isClientSideRendering:!1,clientSideError:e});if(n===`fail`)throw i;Y.Log.warn({logLevel:r,tag:`@remotion/media`},t),B(!0)};if(e.type===`unknown-container-format`){t(Error(`Unknown container format ${X}.`),`Unknown container format for ${X} (Supported formats: https://www.remotion.dev/docs/mediabunny/formats), falling back to <OffthreadVideo>`);return}if(e.type===`network-error`){t(Error(`Network error fetching ${X}.`),`Network error fetching ${X}, falling back to <OffthreadVideo>`);return}if(e.type===`cannot-decode`){t(Error(`Cannot decode ${X}.`),`Cannot decode ${X}, falling back to <OffthreadVideo>`);return}if(e.type===`cannot-decode-prores`)throw new Or(X);if(e.type===`no-tracks`){t(Error(`No video or audio tracks found for ${X}.`),`No video or audio tracks found for ${X}, falling back to <OffthreadVideo>`);return}e.type===`success`&&(R(!0),T(e.durationInSeconds),Te.current=!0)}).catch(e=>{if(e instanceof Or)throw oe.current?.(e),e;let[t,n]=cn({onError:oe.current,error:e,disallowFallback:m,isClientSideRendering:!1,clientSideError:e});if(t===`fail`)throw n;Y.Log.error({logLevel:r,tag:`@remotion/media`},`[VideoForPreview] Failed to initialize MediaPlayer`,n),B(!0)})}catch(e){let[t,n]=cn({error:e,onError:oe.current,disallowFallback:m,isClientSideRendering:!1,clientSideError:e});if(t===`fail`)throw n;Y.Log.error({logLevel:r,tag:`@remotion/media`},`[VideoForPreview] MediaPlayer initialization failed`,n),B(!0)}return()=>{M.current&&=(Y.Log.trace({logLevel:r,tag:`@remotion/media`},`[VideoForPreview] Disposing MediaPlayer`),M.current.dispose(),null),R(!1),B(!1),Te.current=!1}},[g,G,_,m,r,u,X,W,A.fps,b,I,T]),Fr({style:t,className:i,logLevel:r});let De=(0,Q.useMemo)(()=>[Y.OBJECTFIT_CONTAIN_CLASS_NAME,i].filter(Y.truthy).join(` `),[i]);ln({mediaPlayerRef:M,mediaPlayerReady:L,currentTimeRef:pe,playing:V,isPlayerBuffering:ge,frame:j,trimBefore:f,trimAfter:d,effectiveMuted:he,userPreferredVolume:K,playbackRate:n,globalPlaybackRate:U,fps:A.fps,sequenceOffset:de,loop:u,durationInFrames:A.durationInFrames,isPremounting:ce,isPostmounting:ue,currentTime:fe,logLevel:r,label:`VideoForPreview`}),(0,Q.useLayoutEffect)(()=>{let e=M.current;!e||!L||e.setDebugOverlay(_)},[_,L]),(0,Q.useLayoutEffect)(()=>{let e=M.current;!e||!L||e.setVideoFrameCallback(c??null)},[c,L]),(0,Q.useLayoutEffect)(()=>{let e=M.current;!e||!L||e.redrawVideoEffects().catch(()=>{})},[w,L,M]);let Oe=(0,Q.useMemo)(()=>({...t,objectFit:S}),[S,t]);return z&&!m?(0,Z.jsx)(se,{...D,ref:te,src:O,style:Oe,className:i,muted:a,volume:o,trimAfter:d,trimBefore:f,playbackRate:n,loopVolumeCurveBehavior:s,name:`<Html5Video> (fallback)`,loop:u,showInTimeline:l,_remotionInternalStack:p??void 0,...h}):v?null:(0,Z.jsx)(`canvas`,{...D,ref:ee,style:Oe,className:De})},Jr=e=>{let t=H(),n=V(),r=t/n.fps;return(0,Q.useMemo)(()=>ot({unloopedTimeInSeconds:r,playbackRate:e.playbackRate,loop:e.loop,trimBefore:e.trimBefore,trimAfter:e.trimAfter,mediaDurationInSeconds:1/0,fps:n.fps,ifNoMediaDuration:`infinity`,src:e.src})!==null,[r,e.loop,e.playbackRate,e.src,n.fps,e.trimBefore,e.trimAfter])?(0,Z.jsx)(qr,{...e}):null},Yr=({volume:e,playbackRate:t,src:n,muted:r,loopVolumeCurveBehavior:i,delayRenderRetries:a,delayRenderTimeoutInMilliseconds:o,onVideoFrame:s,logLevel:c,loop:l,style:u,className:d,fallbackOffthreadVideoProps:f,audioStreamIndex:p,disallowFallbackToOffthreadVideo:m,_remotionInternalStack:h,toneFrequency:g,trimAfterValue:_,trimBeforeValue:v,headless:y,onError:b,credentials:x,requestInit:S,objectFit:C,effects:w,...T})=>{if(!n)throw TypeError("No `src` was passed to <Video>.");let E=H(),D=Y.useTimelinePosition(),{fps:O}=V(),{registerRenderAsset:k,unregisterRenderAsset:A}=(0,Q.useContext)(Y.RenderAssetManager),j=Y.useMediaStartsAt(),M=(0,Q.useContext)(Y.SequenceContext),N=(0,Q.useMemo)(()=>`media-video-${ue(n)}-${M?.cumulatedFrom}-${M?.relativeFrom}-${M?.durationInFrames}`,[n,M?.cumulatedFrom,M?.relativeFrom,M?.durationInFrames]),P=z(),{delayRender:F,continueRender:I,cancelRender:L}=B(),R=(0,Q.useRef)(null),[U,W]=(0,Q.useState)(!1),[G]=(0,Q.useState)(S),te=Y.useAudioEnabled(),ne=Y.useVideoEnabled(),re=Qn(c),K=Zn(c),ie=Y.useEffectChainState(),[ae,oe]=(0,Q.useState)(null);if(ae)throw ae;(0,Q.useLayoutEffect)(()=>{if(!R.current&&!y||U)return;if(!R.current?.getContext&&!y)return oe(Error(`Canvas does not have .getContext() method available. This could be because <Video> was mounted inside an <svg> tag.`));let u=E/O,d=1/O,f=F(`Extracting frame at time ${u} from ${n}`,{retries:a??void 0,timeoutInMilliseconds:o??void 0});return br({src:n,timeInSeconds:u,durationInSeconds:d,playbackRate:t,logLevel:c,includeAudio:!(!te||r),includeVideo:ne,isClientSideRendering:P.isClientSideRendering,loop:l,audioStreamIndex:p,trimAfter:_,trimBefore:v,fps:O,maxCacheSize:re,credentials:x,requestInit:G,mediaCache:K}).then(async t=>{if(K.isDisposed()){t.type===`success`&&t.frame?.close();return}let r=(e,t,n,r)=>{if(P.isClientSideRendering){L(t);return}let[i,a]=cn({onError:b,error:e,disallowFallback:m,isClientSideRendering:P.isClientSideRendering,clientSideError:e});if(i===`fail`){L(a);return}window.remotion_isMainTab&&Y.Log.warn({logLevel:c,tag:`@remotion/media`},n),W({durationInSeconds:r})};if(t.type===`unknown-container-format`){r(Error(`Unknown container format ${n}.`),Error(`Cannot render video "${n}": Unknown container format. See supported formats: https://www.remotion.dev/docs/mediabunny/formats`),`Unknown container format for ${n} (Supported formats: https://www.remotion.dev/docs/mediabunny/formats), falling back to <OffthreadVideo>`,null);return}if(t.type===`cannot-decode`){r(Error(`Cannot decode ${n}.`),Error(`Cannot render video "${n}": The video could not be decoded by the browser.`),`Cannot decode ${n}, falling back to <OffthreadVideo>`,t.durationInSeconds);return}if(t.type===`cannot-decode-prores`){let e=new Or(n);b?.(e),L(e);return}if(t.type===`cannot-decode-alpha`){r(Error(`Cannot decode alpha component for ${n}.`),Error(`Cannot render video "${n}": The alpha channel could not be decoded by the browser.`),`Cannot decode alpha component for ${n}, falling back to <OffthreadVideo>`,t.durationInSeconds);return}if(t.type===`network-error`){r(Error(`Network error fetching ${n}.`),Error(`Cannot render video "${n}": Network error while fetching the video (possibly CORS).`),`Network error fetching ${n} (no CORS?), falling back to <OffthreadVideo>`,null);return}let{frame:a,audio:o,durationInSeconds:u}=t;if(a){s?.(a);let e=R.current?.getContext(`2d`,{alpha:!0});if(e&&(e.canvas.width=a.width,e.canvas.height=a.height,e.canvas.style.aspectRatio=`${e.canvas.width} / ${e.canvas.height}`,e.drawImage(a,0,0),w.length>0&&(!await Y.runEffectChain({state:ie.get(a.width,a.height),source:e.canvas,effects:w,output:e.canvas,width:a.width,height:a.height})||K.isDisposed()))){a.close();return}a.close()}else if(ne){let e=R.current?.getContext(`2d`,{alpha:!0});e&&e.clearRect(0,0,e.canvas.width,e.canvas.height)}let d=ir({behavior:i,loop:l,assetDurationInSeconds:u??0,fps:O,frame:E,startsAt:j}),p=Y.evaluateVolume({volume:e,frame:d,mediaVolume:1});Y.warnAboutTooHighVolume(p),o&&p>0&&($n(o.data,p),k({type:`inline-audio`,id:N,audio:P.isClientSideRendering?o.data:Array.from(o.data),frame:D,timestamp:o.timestamp,duration:o.numberOfFrames/tr()*1e6,toneFrequency:g})),I(f)}).catch(e=>{K.isDisposed()||L(e)}),()=>{I(f),A(N)}},[D,I,F,a,o,P.isClientSideRendering,O,E,N,c,l,i,r,s,t,k,n,j,A,e,U,p,m,g,_,v,te,ne,re,L,y,b,x,ie,w,G,K]),Fr({style:u,className:d,logLevel:c});let q=(0,Q.useMemo)(()=>[Y.OBJECTFIT_CONTAIN_CLASS_NAME,d].filter(Y.truthy).join(` `),[d]),se=(0,Q.useMemo)(()=>({...u,objectFit:C}),[C,u]);if(U){let c=(0,Z.jsx)(Y.InnerOffthreadVideo,{...T,src:n,playbackRate:t??1,muted:r??!1,acceptableTimeShiftInSeconds:f?.acceptableTimeShiftInSeconds,loopVolumeCurveBehavior:i??`repeat`,delayRenderRetries:a??void 0,delayRenderTimeoutInMilliseconds:o??void 0,name:`Fallback to <OffthreadVideo>`,style:se,allowAmplificationDuringRender:!0,transparent:f?.transparent??!0,toneMapped:f?.toneMapped??!0,audioStreamIndex:p??0,className:d,onVideoFrame:s,volume:e,id:N,onError:f?.onError,toneFrequency:g,showInTimeline:!1,crossOrigin:f?.crossOrigin,onAutoPlayError:f?.onAutoPlayError??null,pauseWhenBuffering:f?.pauseWhenBuffering??!1,trimAfter:_,trimBefore:v,useWebAudioApi:f?.useWebAudioApi??!1,preservePitch:f?.preservePitch??!0,startFrom:void 0,endAt:void 0,_remotionInternalStack:h,_remotionInternalNativeLoopPassed:!1});if(l){if(!U.durationInSeconds){let e=Error(`Cannot render video ${n}: @remotion/media was unable to render, and fell back to <OffthreadVideo>. Also, "loop" was set, but <OffthreadVideo> does not support looping and @remotion/media could also not determine the duration of the video.`);throw L(e),e}return(0,Z.jsx)(ee,{layout:`none`,durationInFrames:Y.calculateMediaDuration({trimAfter:_,mediaDurationInFrames:U.durationInSeconds*O,playbackRate:t,trimBefore:v}),children:c})}return c}return y?null:(0,Z.jsx)(`canvas`,{...T,ref:R,style:se,className:q})},{validateMediaTrimProps:Xr,resolveTrimProps:Zr,validateMediaProps:Qr,useCropStyle:$r}=Y,ei={src:{type:`asset`,default:void 0,description:`Source`,keyframable:!1},...Y.baseSchema,...Y.premountSchema,volume:{type:`number`,min:0,max:20,step:.01,default:1,description:`Volume`,hiddenFromList:!1},playbackRate:{type:`number`,min:.1,step:.01,default:1,description:`Playback rate`,hiddenFromList:!1,keyframable:!1},muted:{type:`boolean`,default:!1,description:`Muted`},loop:{type:`boolean`,default:!1,description:`Loop`},...Y.transformSchema,...K.backgroundSchema,...K.borderSchema,...K.borderRadiusSchema,...K.cropSchema},ti=({src:e,audioStreamIndex:t,className:n,delayRenderRetries:r,delayRenderTimeoutInMilliseconds:i,disallowFallbackToOffthreadVideo:a,fallbackOffthreadVideoProps:o,logLevel:s,loop:c,loopVolumeCurveBehavior:l,muted:u,onVideoFrame:d,playbackRate:f,style:p,trimAfter:m,trimBefore:h,volume:g,_remotionInternalStack:_,toneFrequency:v,showInTimeline:y,debugOverlay:b,headless:x,onError:S,credentials:C,requestInit:w,controls:T,objectFit:E,_experimentalInitiallyDrawCachedFrame:D,effects:O,setMediaDurationInSeconds:k,refForOutline:A,...j})=>{let M=z();if(typeof e!=`string`)throw TypeError(`The \`<Video>\` tag requires a string for \`src\`, but got ${JSON.stringify(e)} instead.`);Xr({startFrom:void 0,endAt:void 0,trimBefore:h,trimAfter:m});let{trimBeforeValue:N,trimAfterValue:P}=Zr({startFrom:void 0,endAt:void 0,trimBefore:h,trimAfter:m});return Qr({playbackRate:f,volume:g},`Video`),M.isRendering?(0,Z.jsx)(Yr,{...j,audioStreamIndex:t??0,className:n,delayRenderRetries:r??null,delayRenderTimeoutInMilliseconds:i??null,disallowFallbackToOffthreadVideo:a??!1,fallbackOffthreadVideoProps:o,logLevel:s,loop:c,loopVolumeCurveBehavior:l,muted:u,onVideoFrame:d,playbackRate:f,src:e,_remotionInternalStack:_,style:p,volume:g,toneFrequency:v,trimAfterValue:P,trimBeforeValue:N,headless:x,onError:S,credentials:C,requestInit:w,objectFit:E,effects:O}):(0,Z.jsx)(Jr,{...j,setMediaDurationInSeconds:k,audioStreamIndex:t??0,className:n,logLevel:s,loop:c,loopVolumeCurveBehavior:l,muted:u,onVideoFrame:d,playbackRate:f,src:e,style:p,volume:g,showInTimeline:y,trimAfter:P,trimBefore:N,_remotionInternalStack:_??null,disallowFallbackToOffthreadVideo:a,fallbackOffthreadVideoProps:o,debugOverlay:b??!1,headless:x??!1,onError:S,credentials:C,requestInit:w,controls:T,objectFit:E,effects:O,_experimentalInitiallyDrawCachedFrame:D,refForOutline:A})},ni=K.withSchema({Component:({src:e,audioStreamIndex:t,className:n,delayRenderRetries:r,delayRenderTimeoutInMilliseconds:i,disallowFallbackToOffthreadVideo:a,fallbackOffthreadVideoProps:o,logLevel:s,loop:c,loopVolumeCurveBehavior:l,muted:u,name:d,onVideoFrame:f,playbackRate:p,showInTimeline:m,style:h,trimAfter:g,trimBefore:_,volume:v,toneFrequency:y,debugOverlay:b,headless:x,onError:S,credentials:C,requestInit:w,controls:T,objectFit:E,_experimentalInitiallyDrawCachedFrame:D,effects:O,durationInFrames:k,from:A,freeze:j,hidden:M,premountFor:N,postmountFor:P,styleWhilePremounted:F,styleWhilePostmounted:I,cropLeft:L,cropRight:R,cropTop:z,cropBottom:B,...H})=>{let U=T?Y.getStackForControls(T)??void 0:void 0,G=Y.useLogLevel(),[ee]=Y.useMediaVolumeState(),te=Y.useMediaStartsAt(),ne=V(),re=Math.min(k??1/0,Math.max(0,ne.durationInFrames-(A??0))),K=Tr({durationInFrames:k,loop:c??!1,playbackRate:p??1,trimAfter:g,trimBefore:_}),ie=Y.useBasicMediaInTimeline({src:e,volume:v,playbackRate:p??1,trimBefore:_,trimAfter:g,sequenceDurationInFrames:re,mediaType:`video`,displayName:d??`<Video>`,mediaVolume:ee,mediaStartsAt:te,loop:c??!1}),[ae,oe]=(0,Q.useState)(null),se=(0,Q.useMemo)(()=>at({loop:c??!1,mediaDurationInSeconds:ae,playbackRate:p??1,trimAfter:g,trimBefore:_,sequenceDurationInFrames:re,compFps:ne.fps}),[c,ae,p,g,_,re,ne.fps]),J=(0,Q.useMemo)(()=>({type:`video`,data:ie}),[ie]),ce=Y.useMemoizedEffects({effects:O??[],overrideId:T?.overrideId??null}),le=Y.useMemoizedEffectDefinitions(O??[]),ue=Q.useRef(null),{effectivePostmountFor:de,effectivePremountFor:fe,freezeFrame:pe,isPremountingOrPostmounting:X,postmountingActive:me,premountingActive:he,premountingStyle:ge}=Y.usePremounting({from:A??0,durationInFrames:K??1/0,premountFor:N??null,postmountFor:P??null,style:h??null,styleWhilePremounted:F??null,styleWhilePostmounted:I??null,hideWhilePremounted:`display-none`}),_e=$r({cropLeft:L,cropRight:R,cropTop:z,cropBottom:B,style:ge,componentName:`<Video />`});return re===0?null:(0,Z.jsx)(W,{frame:pe,active:X,children:(0,Z.jsx)(q,{layout:`none`,from:A??0,durationInFrames:K,freeze:j,_remotionInternalIsMedia:J,_remotionInternalPremountDisplay:fe||null,_remotionInternalPostmountDisplay:de||null,_remotionInternalIsPremounting:he,_remotionInternalIsPostmounting:me,name:d??`<Video>`,_remotionInternalDocumentationLink:d===void 0?`https://www.remotion.dev/docs/media/video`:void 0,controls:T,_remotionInternalLoopDisplay:se,_remotionInternalEffects:le,outlineRef:ue,showInTimeline:m??!0,hidden:M,children:(0,Z.jsx)(ti,{...H,audioStreamIndex:t??0,className:n,delayRenderRetries:r??null,delayRenderTimeoutInMilliseconds:i??null,disallowFallbackToOffthreadVideo:a??!1,fallbackOffthreadVideoProps:o??{},logLevel:s??G,loop:c??!1,loopVolumeCurveBehavior:l??`repeat`,muted:u??!1,onVideoFrame:f,playbackRate:p??1,showInTimeline:m??!0,src:e,style:_e??{},trimAfter:g,trimBefore:_,volume:v??1,toneFrequency:y??1,_remotionInternalStack:U,debugOverlay:b??!1,headless:x??!1,onError:S,credentials:C,requestInit:w,controls:T,objectFit:E??`contain`,_experimentalInitiallyDrawCachedFrame:D??!1,effects:ce,setMediaDurationInSeconds:oe,refForOutline:ue})})})},componentName:`<Video>`,componentIdentity:`dev.remotion.media.Video`,schema:ei,supportsEffects:!0});function ri(e,t){return e.current||=t(),e.current}function ii(e){let t=e.current;e.current=null,t?.dispose()}function ai(e,t){let n=Number.isFinite(t)?Math.max(1,Math.floor(t)):1;return n===1?1:Math.max(0,Math.min(1,e/(n-1)))}function oi(e,t){let n=Math.max(2**-52,t.fps),r=ai(t.sequenceFrame,t.durationInFrames),i=(t.windowStartFrame+t.sequenceFrame)/n,a=t.width/Math.max(1,t.height);return{frag:e.frag,progress:r,time:i,aspect:a,uniforms:e.uniforms({time:i,aspect:a,direction:t.direction}),colorPipeline:Ie}}function si(e,t,n){let r=t/Math.max(2**-52,n);return{passes:ke(e,r),time:r,colorPipeline:Ie}}function ci(e){return e.fallbackReason?{...e,phase:`fallback`}:null}function li(e){let t=d.has(e.type);return t&&e.texturable&&e.hasShader&&(e.mode===`render`||e.selected)?{adapter:`gl-transition`,fidelity:`exact`,fallbackAdapter:`css-transition`}:t?e.hasShader?e.texturable?{adapter:`css-transition`,fidelity:`approximate`,fallbackAdapter:`css-transition`}:{adapter:`css-transition`,fidelity:`approximate`,fallbackAdapter:`css-transition`,fallbackReason:`unsupported-media`}:{adapter:`css-transition`,fidelity:`approximate`,fallbackAdapter:`css-transition`,fallbackReason:`missing-shader`}:{adapter:`css-transition`,fidelity:`approximate`,fallbackAdapter:`css-transition`,fallbackReason:`unsupported-transition`}}function ui(e){return e.declared&&e.texturable?{adapter:`gl-effect`,fidelity:`exact`}:{adapter:`source-fallback`,fidelity:`fallback`,fallbackReason:e.texturable?`missing-shader`:`unsupported-media`}}function di(e){if(e.effects.length===0)return null;let t=ui({declared:e.effects.every(({assetId:t})=>Object.prototype.hasOwnProperty.call(e.registeredEffects,t)),texturable:e.texturable});return ci({kind:`effect`,targetId:e.targetId,adapter:t.adapter,fallbackReason:t.fallbackReason})}function fi(e){let t=e instanceof Error?e.message:String(e);return/webgl2?\s+(?:is\s+)?not available|webgl.*(?:unavailable|context lost)/i.test(t)?`webgl-unavailable`:`shader-error`}function pi(e){return(e.effects??[]).filter(e=>e.assetId in Ae).map(e=>({fx:e,def:Ae[e.assetId]}))}function mi(e){return pi(e)[0]??null}function hi(e){let t=e;return{width:t.videoWidth??t.naturalWidth??t.displayWidth??t.width??0,height:t.videoHeight??t.naturalHeight??t.displayHeight??t.height??0}}function gi(e,t){let{width:n,height:r}=hi(t);e.width!==n&&(e.width=n),e.height!==r&&(e.height=r);let i=e.getContext(`2d`);i&&(i.clearRect(0,0,n,r),n&&r&&i.drawImage(t,0,0,n,r))}function _i(e){let t=(0,Q.useRef)(e),n=(0,Q.useRef)(null);return(0,Q.useLayoutEffect)(()=>{t.current=e},[e]),{capturedRef:n,onVideoFrame:(0,Q.useCallback)(e=>{let r=n.current?.canvas??document.createElement(`canvas`);gi(r,e),n.current={canvas:r,frame:t.current}},[])}}function vi(e,t,n=0,r=0){let i=1;return n>0&&(i=Math.min(i,e/n)),r>0&&(i=Math.min(i,(t-e)/r)),Math.max(0,Math.min(1,i))}function yi(e,t,n=!1){let r=e.keyframes?.opacity,i=r?.length?_(r,t):e.transform?.opacity??1,a=n?0:Math.max(0,Math.min(1,i));return vi(t,e.durationInFrames,e.fadeInFrames,e.fadeOutFrames)*a}function bi(e,t,n,r={width:0,height:0}){let i=n=>{let r=e.keyframes?.[n];return r?.length?_(r,t):void 0},a=e.transform,o=i(`scale`),s=i(`scaleX`)??a?.scaleX??o??a?.scale??1,c=i(`scaleY`)??a?.scaleY??o??a?.scale??1,l=o!==void 0||i(`scaleX`)!==void 0||i(`scaleY`)!==void 0||a?.scale!==void 0||a?.scaleX!==void 0||a?.scaleY!==void 0,u=a||i(`x`)!==void 0||i(`y`)!==void 0||i(`rotation`)!==void 0||l?`translate(${i(`x`)??a?.x??0}%, ${i(`y`)??a?.y??0}%) rotate(${i(`rotation`)??a?.rotation??0}deg) scale(${s}, ${c})`:void 0,d=a?.crop,f=Ce(d)?Se(d,r.width,r.height):void 0,p=yi(e,t,n),m=e.filters;return{opacity:p,borderRadius:Math.max(0,i(`borderRadius`)??a?.borderRadius??0),foregroundStyle:{transform:u,transformOrigin:`50% 50%`,transformBox:`border-box`,filter:m?`brightness(${m.brightness??1}) contrast(${m.contrast??1}) saturate(${m.saturate??1}) blur(${m.blur??0}px)`:void 0,clipPath:f}}}function xi(e){return e===`webcodecs`||e===`offthread`}var Si=(0,Q.createContext)(`webcodecs`);function Ci(e,t,n=!1){return n||t.isClientSideRendering||t.isPlayer||!t.isRendering?`webcodecs`:e}function wi(e=!1){return Ci((0,Q.useContext)(Si),z(),e)}var Ti=.001;function Ei(e,t){return(e??0)+Ti*t}function Di(e){let t=e.split(/[?#]/,1)[0]??``;return/\.webm$/i.test(t)}var Oi=e=>e instanceof HTMLVideoElement?e.readyState>=2&&!e.seeking:e.complete;function ki(e,t,n,r=1){let i=hi(t);if(!i.width||!i.height)return;let a=(n===`cover`?Math.max(e.canvas.width/i.width,e.canvas.height/i.height):Math.min(e.canvas.width/i.width,e.canvas.height/i.height))*r,o=i.width*a,s=i.height*a;e.drawImage(t,(e.canvas.width-o)/2,(e.canvas.height-s)/2,o,s)}function Ai(e,t,n,r,i,a){if(e.clearRect(0,0,e.canvas.width,e.canvas.height),e.save(),e.globalAlpha=a,!i){ki(e,t,n),e.restore();return}let o=m(r,e.canvas.width,e.canvas.height),s=r.filters;e.save(),e.filter=p(o,s),ki(e,t,`cover`,o.overscanScale),e.restore(),e.save(),e.filter=`brightness(${s?.brightness??1}) contrast(${s?.contrast??1}) saturate(${s?.saturate??1}) blur(${s?.blur??0}px)`,ki(e,t,`contain`),e.restore(),e.restore()}function ji({item:e,trim:t,fit:n,elRef:r,decoder:i,onVideoFrame:a}){let{fps:o}=V(),s={width:`100%`,height:`100%`,objectFit:n};return e.kind===`image`?(0,Z.jsx)(G,{ref:r,src:e.src,style:s}):i===`offthread`?(0,Z.jsx)(te,{src:e.src,trimBefore:Ei(t,o),playbackRate:e.playbackRate??1,muted:!0,transparent:Di(e.src),onVideoFrame:a,style:s}):i===`webcodecs`?(0,Z.jsx)(ni,{src:e.src,trimBefore:t,playbackRate:e.playbackRate??1,muted:!0,headless:!0,onVideoFrame:a}):(0,Z.jsx)(ie,{ref:r,src:e.src,trimBefore:t,playbackRate:e.playbackRate??1,muted:!0,style:s})}function Mi({type:e,direction:t,L:n,windowStart:r,outgoing:i,incoming:a,trimOut:o,trimIn:s,width:c,height:l,fit:u,outgoingBackgroundFill:d=!1,incomingBackgroundFill:f=!1,customFrag:p,customUniforms:m,previewTargetId:h,onPreviewStatus:g,onReadyChange:_}){let v=H(),{fps:y}=V(),b=ce().isRendering,x=wi(),w=b?x:null,T=(0,Q.useRef)(null),E=(0,Q.useRef)(null),D=(0,Q.useRef)(null),O=(0,Q.useRef)(null),{capturedRef:k,onVideoFrame:A}=_i(v),{capturedRef:j,onVideoFrame:M}=_i(v),N=(0,Q.useRef)(null),P=(0,Q.useRef)(!1),[F,I]=(0,Q.useState)(!1),L=(0,Q.useMemo)(()=>{let e=()=>{let e=document.createElement(`canvas`);return e.width=c,e.height=l,e};return{out:e(),in:e()}},[c,l]),R=(0,Q.useMemo)(()=>e===`custom-shader`?p?{frag:p,uniforms:()=>m??{}}:void 0:Fe[e],[e,p,m]),z=(0,Q.useMemo)(()=>pi(i),[i]),B=(0,Q.useMemo)(()=>pi(a),[a]),W=(0,Q.useMemo)(()=>[R?.frag??``,...z.map(({def:e})=>e.frag),...B.map(({def:e})=>e.frag)].join(`\0`),[R?.frag,B,z]);return(0,Q.useEffect)(()=>{if(!g||!h)return;let e=h;return()=>{g({kind:`transition`,targetId:e,adapter:`gl-transition`,phase:`inactive`})}},[g,h]),(0,Q.useLayoutEffect)(()=>{let o=T.current;if(!o||!R)return;let s=b?U(`gl-transition ${e} f${v}`):null,p=!1,m=0,x=(e,t)=>{_?.(e===`ready`),!(!h||!g)&&g({kind:`transition`,targetId:h,adapter:e===`ready`?`gl-transition`:`css-transition`,phase:e,fallbackReason:t})},w=()=>{!p&&s!=null&&(p=!0,ne(s))},A=()=>{o.style.opacity=`0`,P.current&&(P.current=!1,I(!1))},M=N.current?.definitionKey===W?N.current.reason:null;if(M)return A(),x(`fallback`,M),w(),()=>w();let F=[...z,...B];for(let{def:e}of F)e.cube&&S(e.cube);let V=!1,H=()=>{V||(V=!0,x(`fallback`,`media-loading`))},G=(e,t,n)=>{if(b&&e.kind!==`image`)return n?.frame===v?n.canvas:null;let r=t.current;return r&&Oi(r)?r:null},ee=()=>{let e=G(i,D,k.current),s=G(a,O,j.current);if(!e||!s||F.some(({def:e})=>e.cube&&!C(e.cube))){A(),H(),m=requestAnimationFrame(ee);return}try{let p=ri(E,()=>We(o)),m=L.out.getContext(`2d`),h=L.in.getContext(`2d`);if(!m||!h)throw Error(`2d context unavailable`);let g=r+v,_=yi(i,g-i.startFrame),b=yi(a,g-a.startFrame);Ai(m,e,u,i,d,_),Ai(h,s,u,a,f,b);let S=oi(R,{sequenceFrame:v,durationInFrames:n,windowStartFrame:r,fps:y,width:c,height:l,direction:t}),C=si(z.map(({fx:e,def:t})=>({def:t,overrides:e.overrides})),g-i.startFrame,y),w=si(B.map(({fx:e,def:t})=>({def:t,overrides:e.overrides})),g-a.startFrame,y);p.renderTransitionWithFx(S.frag,L.out,L.in,C.passes,w.passes,S.progress,S.uniforms,{outgoing:_,incoming:b}),o.style.opacity=`1`,P.current||(P.current=!0,I(!0)),x(`ready`)}catch(e){let t=fi(e);N.current={definitionKey:W,reason:t},ii(E),A(),x(`fallback`,t),console.error(`[gl-transition]`,e)}w()};return ee(),()=>{cancelAnimationFrame(m),w()}},[W,R,t,u,y,v,l,a,f,j,B,n,g,_,k,i,d,z,h,b,L,e,c,r]),(0,Q.useEffect)(()=>()=>{ii(E)},[c,l,R?.frag]),(0,Z.jsxs)(J,{children:[(0,Z.jsxs)(J,{"aria-hidden":!0,style:{opacity:0,pointerEvents:`none`},children:[(0,Z.jsx)(J,{children:(0,Z.jsx)(ji,{item:i,trim:o,fit:u,elRef:D,decoder:w,onVideoFrame:A})}),(0,Z.jsx)(J,{children:(0,Z.jsx)(ji,{item:a,trim:s,fit:u,elRef:O,decoder:w,onVideoFrame:M})})]}),(0,Z.jsx)(`canvas`,{ref:T,width:c,height:l,style:{position:`absolute`,inset:0,width:`100%`,height:`100%`,opacity:+!!F,pointerEvents:`none`}})]})}var Ni=[`color`,`textColor`,`fillColor`,`titleColor`,`inkColor`],Pi=[`fontSize`,`textSize`,`titleSize`],Fi=[`text`,`title`,`caption`,`quoteText`,`nameText`,`titleText`,`line1Text`,`keyword`,`subText`,`subtitle`,`content`,`label`],Ii=[`fontWeight`,`weight`],Li=[`align`,`textAlign`],Ri=[400,700,900],zi=e=>typeof e==`string`&&/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(e.trim()),Bi=e=>typeof e==`number`&&Number.isFinite(e)&&e>0,Vi=e=>typeof e==`string`;function Hi(e,t,n){for(let r of t)if(n(e[r]))return r;return null}function Ui(e){return e===`left`||e===`right`?e:`center`}function Wi(e){if(e.kind===`text`){let t=e.props??{};return{colorKey:`color`,fontSizeKey:`fontSize`,color:zi(t.color)?t.color:`#ffffff`,fontSize:Bi(t.fontSize)?t.fontSize:96,fontSizeMin:24,fontSizeMax:300,fontSizeStep:2,textKey:`text`,text:typeof t.text==`string`?t.text:``,fontWeightKey:`fontWeight`,fontWeight:Bi(t.fontWeight)?t.fontWeight:700,alignKey:`align`,align:Ui(t.align)}}if(e.kind!==`motion-graphic`)return null;let t=e.props??{},n=Hi(t,Ni,zi),r=Hi(t,Pi,Bi),i=Hi(t,Fi,Vi)??(typeof t.text==`string`?`text`:null)??(typeof t.title==`string`?`title`:null);if(!n&&!r&&!i)return null;let a=r&&Bi(t[r])?t[r]:48,o=a<=4,s=Hi(t,Ii,Bi),c=Hi(t,Li,e=>e===`left`||e===`center`||e===`right`);return{colorKey:n,fontSizeKey:r,color:n&&zi(t[n])?t[n]:`#ffffff`,fontSize:a,fontSizeMin:o?.02:12,fontSizeMax:o?.2:300,fontSizeStep:o?.002:2,textKey:i,text:i&&typeof t[i]==`string`?t[i]:``,fontWeightKey:s,fontWeight:s&&Bi(t[s])?t[s]:700,alignKey:c,align:c?Ui(t[c]):`center`}}function Gi(e,t){if(!e.fontSizeKey)return e.fontSize;let n=t>0?1.12:1/1.12,r=e.fontSize*n,i=Math.min(e.fontSizeMax,Math.max(e.fontSizeMin,r)),a=e.fontSizeStep;return Math.round(i/a)*a}function Ki(e){let t=Ri.findIndex(t=>t>=e);return Ri[t<0?0:(t+1)%Ri.length]}function qi(e){return e===`left`?`center`:e===`center`?`right`:`left`}function Ji(e){return Wi(e)!==null}function Yi(e){let t=Math.max(0,Math.min(1,e));return t*t*(3-2*t)}function Xi(e,t,n){let r=1-Math.abs(2*t-1);if(e===`cross-dissolve`)return{opacity:Yi(t)};if(e===`luma-blend`)return{opacity:Yi(t),filter:`brightness(${1+r*.6})`};if(e===`dip-to-black`)return{opacity:+(t>=.5),overlay:{background:`#000`,opacity:r}};if(e===`flash`)return{opacity:+(t>=.5),overlay:{background:`#fff`,opacity:r*r}};if(e===`soft-wipe`){let e=`${Math.max(0,100-t*100).toFixed(2)}%`;return{opacity:1,clipPath:n===`right`?`inset(0 0 0 ${e})`:n===`up`?`inset(0 0 ${e} 0)`:n===`down`?`inset(${e} 0 0 0)`:`inset(0 ${e} 0 0)`}}let i=(1-t)*100;return{opacity:1,transform:`translate${n===`up`||n===`down`?`Y`:`X`}(${(n===`right`||n===`down`?-1:1)*i}%)`}}function Zi(e){return e===`flash`?`#fff`:`#000`}function Qi({entrance:e,children:t}){return(0,Z.jsx)(J,{style:{opacity:e.opacity,transform:e.transform,filter:e.filter,clipPath:e.clipPath},children:t})}function $i({p:e,dir:t}){if(e<=0||e>=1)return null;let n=t===`left`||t===`right`,r=`${(e*100).toFixed(2)}%`;return(0,Z.jsx)(`div`,{style:{position:`absolute`,transform:`translate(-2px, -2px)`,background:`#fff`,boxShadow:`0 0 12px rgba(255,255,255,.9)`,...n?{top:0,bottom:0,width:4,[t===`right`?`right`:`left`]:r}:{left:0,right:0,height:4,[t===`down`?`bottom`:`top`]:r}}})}function ea({style:e,entrance:t,line:n,p:r,dir:i,children:a}){return(0,Z.jsxs)(J,{style:e,children:[(0,Z.jsx)(Qi,{entrance:t,children:a}),t.overlay&&(0,Z.jsx)(J,{style:{background:t.overlay.background,opacity:t.overlay.opacity}}),n&&(0,Z.jsx)($i,{p:r,dir:i})]})}function ta({type:e,frames:t,dir:n,line:r,isolated:i=!1,children:a}){let o=H(),s=Math.max(0,Math.min(1,o/Math.max(1,t))),c=Xi(e,s,n);return(0,Z.jsx)(ea,{style:i?{background:Zi(e)}:void 0,entrance:c,line:r,p:s,dir:n,children:a})}var na={"clean-line-wipe":`soft-wipe`,"page-curl":`soft-wipe`,"impact-shake":`whip-pan`,"rack-focus":`luma-blend`,"organic-dissolve":`luma-blend`,"anticipation-zoom":`luma-blend`,"radial-blur":`luma-blend`,"glitch-cut":`flash`,"dip-to-color":`dip-to-black`};function ra(e){return l.has(e)?e:na[e]??`cross-dissolve`}function ia(e){let t=e.items.filter(e=>e.kind===`motion-graphic`&&e.code);return Promise.all(t.map(async e=>{try{await je(e.code)}catch(t){let n=t instanceof Error?t.message:String(t);throw Error(`${e.name} — compile error:\n${n}`)}})).then(()=>void 0)}function aa({state:e,dependencies:t=[],children:n}){let{delayRender:r,continueRender:i,cancelRender:a}=B(),[o]=(0,Q.useState)(()=>[e,...t]),[s]=(0,Q.useState)(()=>r(`Preparing project fonts and templates`)),[c,l]=(0,Q.useState)(!1),[u,d]=(0,Q.useState)(null);return(0,Q.useEffect)(()=>{let e=!0,t=!1,n=()=>{t||(t=!0,i(s))},r=n=>{if(t)return;t=!0;let r=n instanceof Error?n:Error(String(n));e&&d(r.message);try{a(r)}catch{}};return Promise.resolve().then(()=>Promise.all(o.flatMap(e=>[Ne(e),ia(e)]))).then(()=>{e&&l(!0)},e=>r(e)),()=>{e=!1,n()}},[s,o,i,a]),(0,Q.useEffect)(()=>{c&&i(s)},[c,s,i]),u?(0,Z.jsx)(J,{style:{color:`#f88`,fontFamily:`monospace`,fontSize:20,padding:40,whiteSpace:`pre-wrap`},children:u}):c?n():null}function oa(e,t=[]){let n=[e,...t],r=n.flatMap(e=>e.items.filter(e=>e.kind===`motion-graphic`&&e.code).map(e=>e.code));return JSON.stringify([n.flatMap(Pe),r])}function sa({item:e,frameOffset:t=0,hiddenByCaptions:n=!1,children:r}){let i=H()+t,{width:a,height:o}=V(),s=bi(e,i,n,{width:a,height:o}),c=r(s.borderRadius);if(e.zoom){let t=Ee(e.zoom,i,e.durationInFrames);c=(0,Z.jsx)(J,{style:{transform:`scale(${t.magnification})`,transformOrigin:`${t.focalX*100}% ${t.focalY*100}%`},children:c})}let{clipPath:l,...u}=s.foregroundStyle;return(0,Z.jsx)(J,{style:{opacity:s.opacity,...u,clipPath:l},children:c})}function ca(e,t,n){if(e.has(t)===n)return e;let r=new Set(e);return n?r.add(t):r.delete(t),r}function la(e,t,n,r){return n.some(n=>r.has(n.key)&&n.itemIds.includes(e)&&t>=n.from&&t<n.from+n.durationInFrames)}function ua({itemId:e,sequenceFrom:t,windows:n,readyWindows:r,children:i}){return(0,Z.jsx)(J,{style:la(e,H()+t,n,r)?{visibility:`hidden`}:void 0,children:i})}function da(e,t,n){let r=e.canvas.width,i=e.canvas.height,a=t,o=a.videoWidth??a.naturalWidth??a.displayWidth??a.width??0,s=a.videoHeight??a.naturalHeight??a.displayHeight??a.height??0;if(e.clearRect(0,0,r,i),!o||!s)return;let c=n===`cover`?Math.max(r/o,i/s):Math.min(r/o,i/s),l=o*c,u=s*c;e.drawImage(t,(r-l)/2,(i-u)/2,l,u)}function fa({item:e,fit:t,width:n,height:r,frameOffset:i=0,onPreviewStatus:a}){let o=H()+i,{fps:s}=V(),c=ce().isRendering,l=wi(),u=(0,Q.useRef)(null),d=(0,Q.useRef)(null),f=(0,Q.useRef)(null),p=(0,Q.useRef)(null),m=(0,Q.useRef)(null),g=(0,Q.useRef)(null),_=(0,Q.useRef)(!1),[v,y]=(0,Q.useState)(!1),b=h(e,i),x=(0,Q.useMemo)(()=>{let e=document.createElement(`canvas`);return e.width=n,e.height=r,e},[n,r]),w=(0,Q.useMemo)(()=>pi(e),[e]),T=(0,Q.useMemo)(()=>w.map(({def:e})=>`${e.id}:${e.frag}`).join(`\0`),[w]),E=(0,Q.useMemo)(()=>JSON.stringify([o,t,n,r,w.map(({fx:e})=>[e.id,e.overrides])]),[o,t,n,r,w]),D=(0,Q.useCallback)(e=>{let n=x.getContext(`2d`);n&&(da(n,e,t),g.current=E)},[t,E,x]),O=(0,Q.useRef)({fit:t,renderKey:E});(0,Q.useLayoutEffect)(()=>{O.current={fit:t,renderKey:E}},[t,E]);let k=(0,Q.useCallback)(e=>{let t=x.getContext(`2d`);if(!t)return;let n=O.current;da(t,e,n.fit),g.current=n.renderKey},[x]);(0,Q.useEffect)(()=>{if(!a)return;let t=e.id;return()=>{a({kind:`effect`,targetId:t,adapter:`gl-effect`,phase:`inactive`})}},[e.id,a]),(0,Q.useEffect)(()=>{let n=u.current;if(!n||w.length===0)return;let r=c?U(`clip-fx ${w.map(({def:e})=>e.id).join(`,`)}`):null,i=!1,l=0,h=(t,n)=>{a?.({kind:`effect`,targetId:e.id,adapter:`gl-effect`,phase:t,fallbackReason:n})},v=()=>{!i&&r!=null&&(i=!0,ne(r))},b=m.current?.definitionKey===T?m.current.reason:null;if(b)return h(`fallback`,b),v(),()=>v();let D=!1,O=()=>{D||(D=!0,h(`fallback`,`media-loading`))};for(let{def:e}of w)e.cube&&S(e.cube);let k=()=>{let r=e.kind!==`image`;if(!(r?g.current===E:p.current?.complete)){O(),l=requestAnimationFrame(k);return}if(w.some(({def:e})=>e.cube&&!C(e.cube))){O(),l=requestAnimationFrame(k);return}try{let e=ri(f,()=>We(n)),i=x.getContext(`2d`);if(!i)throw Error(`2d context unavailable`);!r&&p.current&&da(i,p.current,t);let a=si(w.map(({fx:e,def:t})=>({def:t,overrides:e.overrides})),o,s);e.renderFxChain(a.passes,x),n.style.opacity=`1`,d.current&&(d.current.style.opacity=`0`),!c&&!_.current&&(_.current=!0,y(!0)),h(`ready`)}catch(e){let t=fi(e);m.current={definitionKey:T,reason:t},ii(f),h(`fallback`,t),console.error(`[clip-fx]`,e)}v()};return k(),()=>{cancelAnimationFrame(l),v()}},[w,T,t,x,e.id,e.kind,o,s,c,E,a]),(0,Q.useEffect)(()=>()=>{ii(f)},[n,r,T]);let A=v;return w.length===0?null:(0,Z.jsxs)(J,{children:[(0,Z.jsx)(J,{ref:d,style:{opacity:+!A,pointerEvents:`none`},children:e.kind===`image`?(0,Z.jsx)(G,{ref:p,src:e.src,style:{width:`100%`,height:`100%`,objectFit:t}}):l===`offthread`?(0,Z.jsx)(te,{src:e.src,trimBefore:Ei(b,s),playbackRate:e.playbackRate??1,muted:!0,transparent:Di(e.src),onVideoFrame:k,style:{width:`100%`,height:`100%`,objectFit:t}}):(0,Z.jsx)(ni,{src:e.src,trimBefore:b,playbackRate:e.playbackRate??1,muted:!0,headless:c,onVideoFrame:D,style:{width:`100%`,height:`100%`},objectFit:t})}),(0,Z.jsx)(`canvas`,{ref:u,width:n,height:r,style:{position:`absolute`,inset:0,width:`100%`,height:`100%`,opacity:+!!A}})]})}function pa(e){let t=Math.max(0,Math.min(1,(e??100)/100));return t===0?{dry:1,wet:0}:t===1?{dry:0,wet:1}:{dry:Math.cos(t*Math.PI/2),wet:Math.sin(t*Math.PI/2)}}function ma({browserRenderer:e,...t}){return e?(0,Z.jsx)(wr,{...t}):(0,Z.jsx)(ae,{...t,preservePitch:!0})}function ha({browserRenderer:e,style:t,...n}){let r=wi(e),{fps:i}=V();if(r===`offthread`)return(0,Z.jsx)(te,{...n,trimBefore:Ei(n.trimBefore,i),style:t,transparent:Di(n.src)});let{objectFit:a,...o}=t??{};return(0,Z.jsx)(ni,{...n,style:o,objectFit:a})}function ga({item:e,browserRenderer:t,volume:n,...r}){if(!e.denoisedSrc)return(0,Z.jsx)(ma,{browserRenderer:t,...r,src:e.src,volume:n});let i=pa(e.denoiseStrength),a=e=>typeof n==`function`?t=>n(t)*e:(n??1)*e;return(0,Z.jsxs)(Z.Fragment,{children:[i.dry>0&&(0,Z.jsx)(ma,{browserRenderer:t,...r,src:e.src,volume:a(i.dry)}),i.wet>0&&(0,Z.jsx)(ma,{browserRenderer:t,...r,src:e.denoisedSrc,volume:a(i.wet)})]})}function _a({item:e,fit:t,canvasW:n,canvasH:r,borderRadius:i,children:a}){let o=e.kind===`solid`?n:e.width??n,s=e.kind===`solid`?r:e.height??r,c=e.kind===`solid`?{x:0,y:0,width:n,height:r}:De({width:n,height:r},{width:o,height:s},t),l=Te(i,c);return(0,Z.jsx)(J,{children:(0,Z.jsx)(`div`,{style:{position:`absolute`,left:c.x,top:c.y,width:c.width,height:c.height,overflow:l?`hidden`:void 0,borderRadius:l?`${l}px`:void 0},children:a})})}function va(e,t,n){if(!n?.length)return 1;let r=1;for(let i of n){if(i.enabled===!1||!u(i.type))continue;let n=Math.max(1,i.durationInFrames);i.outgoingItemId===e.id&&t>=e.durationInFrames-n&&(r*=1-Math.min(1,Math.max(0,(t-e.durationInFrames+n)/n))),i.incomingItemId===e.id&&t<n&&(r*=Math.min(1,Math.max(0,t/n)))}return r}function ya({item:e,fps:t,muted:n,gainAt:r,transitions:i,premountFor:a,browserRenderer:o}){let s=t=>n?0:v(e,t);if(!e.src)return null;if(g(e)){let n=new Set(e.deletedWordIdx??[]);return(0,Z.jsx)(Z.Fragment,{children:E(e.transcript,n,t,e.startFrame,{...T(e),window:w(e)}).map((t,n)=>(0,Z.jsx)(q,{from:t.fromFrame,durationInFrames:t.durFrames,premountFor:a,name:e.name,children:(0,Z.jsx)(ga,{item:e,browserRenderer:o,trimBefore:t.srcStartFrame,trimAfter:t.srcEndFrame,volume:n=>s(t.fromFrame-e.startFrame+n)*r(t.fromFrame+n)*vi(t.fromFrame-e.startFrame+n,e.durationInFrames,e.fadeInFrames,e.fadeOutFrames)*va(e,t.fromFrame-e.startFrame+n,i)})},`${e.id}_${n}`))})}return(0,Z.jsx)(q,{from:e.startFrame,durationInFrames:e.durationInFrames,premountFor:a,name:e.name,children:(0,Z.jsx)(ga,{item:e,browserRenderer:o,trimBefore:e.srcInFrame??0,playbackRate:e.playbackRate??1,volume:t=>s(t)*r(e.startFrame+t)*vi(t,e.durationInFrames,e.fadeInFrames,e.fadeOutFrames)*va(e,t,i)})})}function ba({items:e,muted:t,gainAt:n,premountFor:r,browserRenderer:i}){let a=e[0],o=e.at(-1);if(!a||!o)return null;let s=o.startFrame+o.durationInFrames-a.startFrame;return(0,Z.jsx)(q,{from:a.startFrame,durationInFrames:s,premountFor:r,name:`${a.name}:audio`,children:(0,Z.jsx)(ga,{item:a,browserRenderer:i,trimBefore:a.srcInFrame??0,playbackRate:a.playbackRate??1,volume:r=>{let i=a.startFrame+r,o=e.find(e=>i>=e.startFrame&&i<e.startFrame+e.durationInFrames);if(!o||t)return 0;let s=i-o.startFrame;return v(o,s)*n(i)*vi(s,o.durationInFrames,o.fadeInFrames,o.fadeOutFrames)}})})}function xa({group:e,fit:t,muted:n,canvasW:r,canvasH:i,premountFor:a,browserRenderer:o}){let s=H(),c=e[0],l=e.at(-1);if(!c||!l||!c.src)return null;let u=l.startFrame+l.durationInFrames-c.startFrame,d=c.startFrame+s,f=e.find(e=>d>=e.startFrame&&d<e.startFrame+e.durationInFrames)??c,p=d-f.startFrame,m=bi(f,p,!1,{width:r,height:i}),h=f.width??r,g=f.height??i,_=De({width:r,height:i},{width:h,height:g},t),v=Te(m.borderRadius,_),y={width:`100%`,height:`100%`,objectFit:we(t)},b=(0,Z.jsx)(ha,{browserRenderer:o,src:c.src,trimBefore:c.srcInFrame??0,playbackRate:c.playbackRate??1,volume:0,muted:n,style:y});if(f.zoom){let e=Ee(f.zoom,p,f.durationInFrames);b=(0,Z.jsx)(J,{style:{transform:`scale(${e.magnification})`,transformOrigin:`${e.focalX*100}% ${e.focalY*100}%`},children:b})}return(0,Z.jsx)(q,{from:c.startFrame,durationInFrames:u,premountFor:a,name:`${c.name}:visual`,children:(0,Z.jsx)(J,{style:{opacity:m.opacity,transform:m.foregroundStyle.transform,transformOrigin:m.foregroundStyle.transformOrigin,transformBox:m.foregroundStyle.transformBox,filter:m.foregroundStyle.filter,clipPath:m.foregroundStyle.clipPath},children:(0,Z.jsx)(J,{children:(0,Z.jsx)(`div`,{style:{position:`absolute`,left:_.x,top:_.y,width:_.width,height:_.height,overflow:v?`hidden`:void 0,borderRadius:v},children:b})})})})}function Sa({item:e,frameOffset:t,canvasW:n,canvasH:r,browserRenderer:i}){let a=m(e,n,r),o=yi(e,H()+t),s=h(e,t),c=e.filters,l={width:`100%`,height:`100%`,objectFit:`cover`,transform:`scale(${a.overscanScale})`,filter:p(a,c)},u=mi(e);return(0,Z.jsx)(J,{"aria-hidden":!0,style:{opacity:o,overflow:`hidden`,pointerEvents:`none`},children:u?(0,Z.jsx)(J,{style:l,children:(0,Z.jsx)(fa,{item:e,fit:`cover`,width:n,height:r,frameOffset:t})}):e.kind===`image`?(0,Z.jsx)(G,{src:e.src,style:l}):(0,Z.jsx)(ha,{browserRenderer:i,src:e.src,trimBefore:s,playbackRate:e.playbackRate??1,volume:0,muted:!0,style:l})})}function Ca({props:e,trimBefore:t,volume:n}){let{item:r,fit:i,canvasW:a,canvasH:o,borderRadius:s,frameOffset:c,onPreviewStatus:l,groupedAudio:u,browserRenderer:d}=e,f=De({width:a,height:o},{width:r.width??a,height:r.height??o},i);return(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(_a,{item:r,fit:i,canvasW:a,canvasH:o,borderRadius:s,children:(0,Z.jsx)(fa,{item:r,fit:i===`contain`?`cover`:i,width:Math.max(1,Math.round(f.width)),height:Math.max(1,Math.round(f.height)),frameOffset:c,onPreviewStatus:l})}),r.kind!==`image`&&!u&&(0,Z.jsx)(ga,{item:r,browserRenderer:d,trimBefore:t,playbackRate:r.playbackRate??1,volume:n})]})}function wa({props:e,trimBefore:t,volume:n}){let{item:r,fit:i,canvasW:a,canvasH:o,borderRadius:s,groupedAudio:c,browserRenderer:l,muted:u}=e,d={width:`100%`,height:`100%`,objectFit:we(i)};return(0,Z.jsx)(_a,{item:r,fit:i,canvasW:a,canvasH:o,borderRadius:s,children:r.kind===`image`||r.kind===`gif`||r.kind===`svg`?(0,Z.jsx)(G,{src:r.src,style:d}):r.denoisedSrc?(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(ha,{browserRenderer:l,src:r.src,trimBefore:t,playbackRate:r.playbackRate??1,volume:0,muted:!0,style:d}),!c&&(0,Z.jsx)(ga,{item:r,browserRenderer:l,trimBefore:t,playbackRate:r.playbackRate??1,volume:n})]}):(0,Z.jsx)(ha,{browserRenderer:l,src:r.src,trimBefore:t,playbackRate:r.playbackRate??1,volume:c?0:n,muted:c||u,style:d})})}function Ta(e){let{item:t,frameOffset:n,muted:r,groupedAudio:i,gainAt:a}=e,o=h(t,n),s=e=>{let i=e+n;return i<0||i>=t.durationInFrames?0:(r?0:v(t,i))*a(t.startFrame+i)*vi(i,t.durationInFrames,t.fadeInFrames,t.fadeOutFrames)};return ui({declared:!!mi(t),texturable:t.kind===`video`||t.kind===`image`}).adapter===`gl-effect`?(0,Z.jsx)(Ca,{props:e,trimBefore:o,volume:s}):(0,Z.jsx)(wa,{props:{...e,groupedAudio:i},trimBefore:o,volume:s})}var Ea=.01;function Da(e,t,n){let r=e.denoisedSrc||e.src,i=t.denoisedSrc||t.src;return!r||r!==i||e.track!==t.track||(e.denoisedSrc||t.denoisedSrc)&&(e.src!==t.src||(e.denoiseStrength??100)!==(t.denoiseStrength??100))||e.startFrame+e.durationInFrames!==t.startFrame||Math.abs((e.playbackRate??1)-(t.playbackRate??1))>Ea||n.has(`${e.id}:${t.id}`)?!1:Math.abs(h(e,e.durationInFrames)-h(t,0))<=Ea}function Oa(e,t){let n=new Set((t??[]).filter(e=>e.enabled!==!1&&u(e.type)).map(e=>`${e.outgoingItemId}:${e.incomingItemId}`)),r=e.filter(e=>e.kind===`video`&&!!e.src).sort((e,t)=>e.track.localeCompare(t.track)||e.startFrame-t.startFrame),i=[];for(let e of r){let t=i.at(-1);t?.length&&Da(t.at(-1),e,n)?t.push(e):i.push([e])}return i.filter(e=>e.length>1)}function ka(e){let{item:t}=e;return t.kind===`video`&&!!t.src&&!t.denoisedSrc&&!e.hasGlEffect&&!e.hasBackgroundFill&&!e.hasExtendBefore&&!e.hasExtendAfter&&!e.hasEntrance&&!t.transform&&!t.keyframes&&!t.filters}function Aa({item:e,canvasW:t,canvasH:n,borderRadius:r}){return(0,Z.jsx)(_a,{item:e,fit:`cover`,canvasW:t,canvasH:n,borderRadius:r,children:(0,Z.jsx)(J,{style:{background:String(e.props?.color??`#1a1a1a`)}})})}function ja({watermark:e,canvasH:t}){let n={position:`absolute`,color:`#ffffff`,opacity:Math.max(0,Math.min(1,e.opacity)),fontSize:Math.round(t*.035),fontWeight:700,fontFamily:`Geist, system-ui, -apple-system, sans-serif`,textShadow:`0 2px 8px rgba(0,0,0,0.6)`,whiteSpace:`nowrap`},r=Math.round(t*.04);return e.position[0]===`t`?n.top=r:n.bottom=r,e.position[1]===`l`?n.left=r:n.right=r,(0,Z.jsx)(J,{style:{pointerEvents:`none`},children:(0,Z.jsx)(`div`,{style:n,children:e.text})})}function Ma({item:e,canvasW:t,canvasH:n,fit:r}){let i=e.width??1920,a=e.height??1080,o=r===`cover`?Math.max(t/i,n/a):Math.min(t/i,n/a),s=e.props??{},c=s.align===`left`||s.align===`right`?s.align:`center`,l=c===`left`?`flex-start`:c===`right`?`flex-end`:`center`,u=String(s.fontFamily??``).trim(),d=u?D(u,`system-ui, -apple-system, sans-serif`):`Geist, system-ui, -apple-system, sans-serif`,f=s.fontStyle?String(s.fontStyle):`normal`,p=Number(s.fontWeight??700),m=Number(s.fontSize??96),h=String(s.color??`#ffffff`),g=s.letterSpacing===void 0?`normal`:typeof s.letterSpacing==`number`?`${s.letterSpacing}px`:String(s.letterSpacing),_=s.lineHeight===void 0?1.2:Number(s.lineHeight),v=s.textShadow===void 0?`0 3px 16px rgba(0,0,0,0.55)`:String(s.textShadow),y=!!(s.bgEnabled??!1),b=(0,Z.jsx)(`div`,{style:{color:h,fontSize:m,fontWeight:p,fontStyle:f,fontFamily:d,letterSpacing:g,lineHeight:_,textAlign:c,textShadow:v,whiteSpace:`pre-wrap`,width:y?void 0:`100%`},children:String(s.text??`文字`)}),x=b;if(y){let e=s.bgColor===void 0?`rgba(10, 15, 26, 0.85)`:String(s.bgColor),t=s.bgBorder===void 0?`1px solid rgba(255, 255, 255, 0.16)`:String(s.bgBorder),n=s.bgRadius===void 0?9999:Number(s.bgRadius),r=s.bgPaddingX===void 0?32:Number(s.bgPaddingX),i=s.bgPaddingY===void 0?10:Number(s.bgPaddingY),a=s.bgBlur===void 0?20:Number(s.bgBlur),o=s.bgShadow===void 0?`0 12px 36px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4)`:String(s.bgShadow);x=(0,Z.jsx)(`div`,{style:{display:`inline-flex`,alignItems:`center`,justifyContent:`center`,background:e,backdropFilter:a>0?`blur(${a}px)`:void 0,WebkitBackdropFilter:a>0?`blur(${a}px)`:void 0,border:t,borderRadius:n,padding:`${i}px ${r}px`,boxShadow:o,maxWidth:`88%`},children:b})}return(0,Z.jsx)(J,{style:{justifyContent:`center`,alignItems:`center`,overflow:`hidden`},children:(0,Z.jsx)(`div`,{style:{width:i,height:a,flexShrink:0,transform:`scale(${o})`,display:`flex`,alignItems:`center`,justifyContent:l,padding:`0 96px`,boxSizing:`border-box`},children:x})})}function Na({item:e,canvasW:t,canvasH:n,fit:r,borderRadius:i}){let a=e.width??1920,o=e.height??1080,s=r===`cover`?Math.max(t/a,n/o):Math.min(t/a,n/o);try{let c=Me(e.code??``);return(0,Z.jsx)(_a,{item:e,fit:r,canvasW:t,canvasH:n,borderRadius:i,children:(0,Z.jsx)(`div`,{style:{position:`absolute`,inset:0,display:`flex`,justifyContent:`center`,alignItems:`center`},children:(0,Z.jsx)(`div`,{style:{width:a,height:o,position:`relative`,flexShrink:0,transform:`scale(${s})`},children:(0,Z.jsx)(c,{item:{props:e.props??{},width:a,height:o}})})})})}catch(t){return(0,Z.jsx)(J,{style:{color:`#f88`,fontFamily:`monospace`,fontSize:20,padding:40,whiteSpace:`pre-wrap`},children:e.name+` — compile error:
`+(t instanceof Error?t.message:String(t))})}}var Pa=t({TimelineComposition:()=>za}),Fa=`repeating-conic-gradient(#242424 0% 25%, #1c1c1c 0% 50%) 50% / 40px 40px`;function Ia({item:e,project:t,parentWidth:n,parentHeight:r,fit:i,frameOffset:a,browserRenderer:o,sequenceLimits:s,muted:c}){let l=H(),u=l+a,d=(0,Q.useMemo)(()=>{if(!t||!e.timelineId)return null;let n=t.timelines.find(t=>t.id===e.timelineId);return n?{child:n,durationInFrames:y(t,n.id,s).durationInFrames}:null},[e.timelineId,t,s]);if(!d)throw new x({code:`SEQUENCE_TIMELINE_MISSING`,itemId:e.id,referencedTimelineId:e.timelineId,path:[e.timelineId??``]});let{child:f,durationInFrames:p}=d,m=b(l,Math.min(p-1,h(e,u))),g=i===`cover`?Math.max(n/f.width,r/f.height):Math.min(n/f.width,r/f.height);return(0,Z.jsx)(J,{style:{justifyContent:`center`,alignItems:`center`,overflow:`hidden`},children:(0,Z.jsx)(`div`,{style:{width:f.width,height:f.height,position:`relative`,flexShrink:0,transform:`scale(${g})`},children:(0,Z.jsx)(q,{from:m,durationInFrames:p,layout:`none`,children:(0,Z.jsx)(Ra,{state:f,project:t,timelineId:f.id,transparent:!0,browserRenderer:o,sequenceLimits:s,forceMuted:c})})})})}function La({status:e,listener:t}){return(0,Q.useEffect)(()=>{if(!t)return;let n={kind:e.kind,targetId:e.targetId,adapter:e.adapter,phase:e.phase,fallbackReason:e.fallbackReason};return t(n),()=>t({...n,phase:`inactive`})},[t,e.kind,e.targetId,e.adapter,e.phase,e.fallbackReason]),null}function Ra({state:e,project:t,transparent:n,browserRenderer:r=!1,selectedItemId:d,onSelectedPreviewStatus:p,sequenceLimits:m,forceMuted:g=!1}){let[_,v]=(0,Q.useState)(()=>new Set),y=(0,Q.useCallback)((e,t)=>{v(n=>ca(n,e,t))},[]);if(e.fxDefs)for(let t of Object.values(e.fxDefs))t.id in Ae||Oe(t);let b=t=>e.tracks?.[t]?.hidden??!1,x=t=>g||(e.tracks?.[t]?.muted??!1),S=a(e).filter(t=>o(e,t)===`video`),C=[...e.items.filter(e=>i(e.kind)&&S.includes(e.track)&&!b(e.track))].sort((e,t)=>e.track===t.track?e.startFrame-t.startFrame:S.indexOf(t.track)-S.indexOf(e.track)),w=e.items.filter(e=>e.kind===`audio`&&e.src&&!b(e.track)),T=s(e),E=e.items.filter(t=>e.tracks?.[t.track]?.role===`anchor`&&!b(t.track)&&!x(t.track)&&!!t.src).map(e=>[e.startFrame,e.startFrame+e.durationInFrames]),D=(t,n)=>{let r=e.tracks?.[t];return r?.role!==`follower`||!E.some(([e,t])=>n>=e&&n<t)?1:10**((r.audioRouting?.duckDepthDb??-12)/20)},O=e.fit??`contain`,k=ce(),A=k.isRendering?0:Math.round(e.fps*1),j=Oa(C,e.transitions),M=new Set(j.flatMap(e=>e.map(e=>e.id))),N=new Map(e.items.map(e=>[e.id,e])),P=e=>!!e&&c(e.kind)&&e.kind!==`svg`&&e.kind!==`gif`,F=(e.transitions??[]).filter(e=>e.enabled!==!1).filter(e=>!u(e.type)),I=new Map,L=new Map,R=new Map,z=[],B=[],V=k.isPlayer?e.items.find(e=>e.id===d):void 0,H=V?di({targetId:V.id,effects:V.effects??[],registeredEffects:Ae,texturable:P(V)}):null;H&&B.push(H);for(let e of F){let t=Math.floor(e.durationInFrames/2),n=N.get(e.outgoingItemId),r=N.get(e.incomingItemId);L.set(e.incomingItemId,t),R.set(e.outgoingItemId,e.durationInFrames-t);let i=k.isPlayer&&e.incomingItemId===d,a=li({mode:k.isPlayer?`player`:`render`,selected:i,type:e.type,texturable:P(n)&&P(r),hasShader:e.type!==`custom-shader`||!!e.customFrag});if(a.adapter===`gl-transition`){let a=r.startFrame-t,o=ra(e.type);I.set(e.incomingItemId,{type:o,frames:e.durationInFrames,dir:e.direction??`left`,line:e.type===`clean-line-wipe`,isolated:!1}),z.push({key:e.id,type:e.type,direction:e.direction??`left`,from:a,L:e.durationInFrames,outgoing:n,incoming:r,trimOut:h(n,a-n.startFrame),trimIn:h(r,a-r.startFrame),previewTargetId:i?e.id:void 0,...e.type===`custom-shader`?{customFrag:e.customFrag,customUniforms:e.customUniforms}:{}});continue}let o=k.isPlayer?ra(e.type):l.has(e.type)?e.type:`cross-dissolve`;if(I.set(e.incomingItemId,{type:o,frames:e.durationInFrames,dir:e.direction??`left`,line:e.type===`clean-line-wipe`,isolated:!1}),i){let t=ci({kind:`transition`,targetId:e.id,adapter:a.adapter,fallbackReason:a.fallbackReason});t&&B.push(t)}}let U=z.map(e=>({key:e.key,from:e.from,durationInFrames:e.L,itemIds:[e.outgoing.id,e.incoming.id]})),W=j.flatMap(t=>{let n=[];for(let r of t)if(ka({item:r,hasGlEffect:!!mi(r),hasBackgroundFill:f(e,r),hasExtendBefore:!!L.get(r.id),hasExtendAfter:!!R.get(r.id),hasEntrance:!!I.get(r.id)})){let e=n.at(-1);e?e.push(r):n.push([r])}else n.push([]);return n.filter(e=>e.length>1)}),G=new Set(W.flatMap(e=>e.map(e=>e.id)));return(0,Z.jsxs)(J,{style:{background:n?void 0:Fa},children:[B.map(e=>(0,Z.jsx)(La,{status:e,listener:p},`${e.kind}:${e.targetId}`)),W.map(t=>(0,Z.jsx)(xa,{group:t,fit:O,muted:x(t[0].track),canvasW:e.width,canvasH:e.height,premountFor:A,browserRenderer:r},`sv:${t[0].id}`)),C.map(n=>{if(G.has(n.id))return null;let i=L.get(n.id)??0,a=R.get(n.id)??0,o=I.get(n.id),s=(e.captionsHidden===!0||e.captionsHidden===void 0&&T.length>0&&T.every(e=>!e.captions?.enabled))&&Wi(n)!==null,c=f(e,n),l=(0,Z.jsx)(sa,{item:n,frameOffset:-i,hiddenByCaptions:s,children:a=>n.kind===`sequence`?(0,Z.jsx)(_a,{item:n,fit:O,canvasW:e.width,canvasH:e.height,borderRadius:a,children:(0,Z.jsx)(Ia,{item:n,project:t,parentWidth:e.width,parentHeight:e.height,fit:O,frameOffset:-i,browserRenderer:r,sequenceLimits:m,muted:x(n.track)})}):n.kind===`motion-graphic`?(0,Z.jsx)(Na,{item:n,canvasW:e.width,canvasH:e.height,fit:O,borderRadius:a}):n.kind===`text`?(0,Z.jsx)(Ma,{item:n,canvasW:e.width,canvasH:e.height,fit:O}):n.kind===`solid`?(0,Z.jsx)(Aa,{item:n,canvasW:e.width,canvasH:e.height,borderRadius:a}):(0,Z.jsx)(Ta,{item:n,frameOffset:-i,fit:c?`contain`:O,muted:x(n.track),groupedAudio:M.has(n.id),gainAt:e=>D(n.track,e),canvasW:e.width,canvasH:e.height,borderRadius:a,browserRenderer:r,onPreviewStatus:k.isPlayer&&n.id===d&&!H?p:void 0})}),u=(0,Z.jsxs)(Z.Fragment,{children:[c&&(0,Z.jsx)(Sa,{item:n,frameOffset:-i,canvasW:e.width,canvasH:e.height,browserRenderer:r}),l]});return(0,Z.jsx)(q,{from:n.startFrame-i,durationInFrames:n.durationInFrames+i+a,premountFor:A,name:n.name,children:(0,Z.jsx)(ua,{itemId:n.id,sequenceFrom:n.startFrame-i,windows:U,readyWindows:_,children:o?(0,Z.jsx)(ta,{type:o.type,frames:o.frames,dir:o.dir,line:o.line,isolated:o.isolated,children:u}):u})},n.id)}),z.map(t=>(0,Z.jsx)(q,{from:t.from,durationInFrames:t.L,premountFor:A,name:`tr:${t.type}`,children:(0,Z.jsx)(Mi,{type:t.type,direction:t.direction,L:t.L,windowStart:t.from,outgoing:t.outgoing,incoming:t.incoming,trimOut:t.trimOut,trimIn:t.trimIn,width:e.width,height:e.height,fit:O,outgoingBackgroundFill:f(e,t.outgoing),incomingBackgroundFill:f(e,t.incoming),customFrag:t.customFrag,customUniforms:t.customUniforms,previewTargetId:t.previewTargetId,onPreviewStatus:t.previewTargetId?p:void 0,onReadyChange:e=>y(t.key,e)})},t.key)),w.map(t=>(0,Z.jsx)(ya,{item:t,fps:e.fps,muted:x(t.track),gainAt:e=>D(t.track,e),transitions:e.transitions,premountFor:A,browserRenderer:r},t.id)),j.map(e=>(0,Z.jsx)(ba,{items:e,muted:x(e[0].track),gainAt:t=>D(e[0].track,t),premountFor:A,browserRenderer:r},`audio:${e[0].id}`)),T.map(({id:t,captions:n})=>n?.enabled?(0,Z.jsx)(Je,{captions:n,items:e.items},t):null),e.watermark?.enabled&&e.watermark.text&&(0,Z.jsx)(ja,{watermark:e.watermark,canvasH:e.height})]})}function za(e){let t=`id`in e.state&&typeof e.state.id==`string`?e.state.id:void 0,n=e.timelineId??t??e.project?.activeTimelineId;if(e.state.items.some(e=>e.kind===`sequence`)&&(!e.project||!n)){let t=e.state.items.find(e=>e.kind===`sequence`);throw new x({code:`SEQUENCE_TIMELINE_MISSING`,itemId:t.id,referencedTimelineId:t.timelineId,path:[t.timelineId??``]})}let r=e.project&&n?y(e.project,n,e.sequenceLimits):null,i=r?r.timelineIds.filter(e=>e!==n).map(t=>e.project.timelines.find(e=>e.id===t)).filter(e=>!!e):[],a=xi(e.serverVideoDecoder)?e.serverVideoDecoder:`webcodecs`;return(0,Z.jsx)(Si.Provider,{value:a,children:(0,Z.jsx)(aa,{state:e.state,dependencies:i,children:()=>(0,Z.jsx)(Ra,{...e,timelineId:n})},oa(e.state,i))})}export{qi as a,We as c,Ji as i,Fe as l,Pa as n,Ki as o,Gi as r,Wi as s,za as t};