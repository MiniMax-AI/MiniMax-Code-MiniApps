// @ts-check
// Built-in starting styles. Each is a short design.md written for Page Designer; none of them
// imitates a company or brand. People who want a brand-inspired system can upload their own
// design.md file instead.

export const MAX_STYLE_CHARS = 60_000;

/** @type {readonly { id: string, swatches: readonly string[], name: { en: string, zh: string }, description: { en: string, zh: string }, text: string }[]} */
export const STYLE_PRESETS = [
  {
    id: 'quiet',
    swatches: ['#FFFFFF', '#111418', '#1F6FEB'],
    name: { en: 'Quiet minimal', zh: '安静极简' },
    description: { en: 'White space, one accent, strict grid.', zh: '大量留白、一个强调色、严谨网格。' },
    text: `# Quiet minimal

## Overview
Calm, precise and content-first. The layout does the work; decoration stays out of the way.

## Colors
- Canvas #FFFFFF, subtle surface #F5F6F7, hairline #E4E6E8
- Ink #111418, secondary text #5B6470
- One accent, ocean blue #1F6FEB, used only for links, the primary action and focus

## Typography
- System sans stack (ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", sans-serif)
- Display 48–64px weight 600, letter-spacing -0.02em; body 16–17px, line-height 1.6
- At most two weights per page

## Layout
- 8px spacing scale; 12-column grid, max width 1120px, generous section spacing (96–128px)
- Left-aligned text, short line lengths (60–75 characters)

## Components
- Buttons: 40px tall, 8px radius, solid ink or accent, no shadows
- Cards: 1px hairline border, no shadow, 12px radius
- Dividers instead of boxes wherever possible

## Motion
- 150–200ms ease-out fades only; respect prefers-reduced-motion

## Don't
- No gradients, glows, drop shadows or more than one accent color`,
  },
  {
    id: 'editorial',
    swatches: ['#FAF7F2', '#1C1A17', '#B4532A'],
    name: { en: 'Editorial', zh: '杂志编辑' },
    description: { en: 'Warm paper, serif headlines, long reads.', zh: '暖色纸张、衬线标题，适合长文。' },
    text: `# Editorial

## Overview
A printed magazine on screen: warm paper, confident headlines and a comfortable reading column.

## Colors
- Paper #FAF7F2, rule lines #E7DFD3
- Ink #1C1A17, muted #6B635A
- Accent rust #B4532A for kickers, drop caps and links

## Typography
- Headlines: serif stack (Georgia, "Times New Roman", "Songti SC", serif), 44–72px, weight 600, tight leading 1.1
- Body: serif or sans at 18–19px, line-height 1.7
- Kickers and labels: small caps or uppercase sans at 12px with 0.08em tracking

## Layout
- Main column 640–720px; pull quotes and figures may break out to 960px
- Hairline rules between sections; numbered sections are welcome

## Components
- Pull quotes in large italic serif with a rust rule on the left
- Captions in 13px muted sans under every figure
- Buttons look like text links with an underline, or a thin ink outline

## Motion
- Almost none: gentle fade-in on scroll at most

## Don't
- No rounded "app" cards, gradients or bright UI colors`,
  },
  {
    id: 'soft',
    swatches: ['#FF7A59', '#16A39A', '#FFC845'],
    name: { en: 'Soft & friendly', zh: '柔和友好' },
    description: { en: 'Rounded shapes, coral and teal, warm tone.', zh: '圆润造型、珊瑚橙与青绿，温暖亲切。' },
    text: `# Soft & friendly

## Overview
Approachable and warm, like a well-made consumer app. Rounded shapes and cheerful but balanced color.

## Colors
- Background #FFF8F3, surface #FFFFFF, soft border #F1E6DD
- Ink #2B2523, muted #7A6E68
- Coral #FF7A59 (primary), teal #16A39A (secondary), sunshine #FFC845 (highlights), sky #4BA3F5 (info)

## Typography
- Rounded or system sans ("SF Pro Rounded", ui-rounded, "PingFang SC", sans-serif)
- Headings 36–56px weight 700; body 16px line-height 1.6

## Layout
- Roomy spacing on an 8px scale; content max width 1080px
- Mix full-width colored bands with white cards

## Components
- Cards: 20–24px radius, white, soft shadow 0 8px 24px rgba(43,37,35,0.08)
- Buttons: pill shape, 44px tall, coral fill with white text; secondary buttons tinted teal
- Small illustrations made from simple CSS or inline SVG shapes

## Motion
- Springy 200–300ms transitions on hover and press; respect prefers-reduced-motion

## Don't
- No purple, no harsh black blocks, no sharp corners`,
  },
  {
    id: 'poster',
    swatches: ['#F4F1EA', '#0B0B0B', '#E63B2E'],
    name: { en: 'Bold poster', zh: '大胆海报' },
    description: { en: 'Huge type, hard edges, high contrast.', zh: '超大字号、硬朗边缘、高对比。' },
    text: `# Bold poster

## Overview
Loud and graphic, like a gig poster or a manifesto. Type is the image.

## Colors
- Off-white #F4F1EA and near-black #0B0B0B as the two grounds
- One signal color per page: red #E63B2E or yellow #FFD400

## Typography
- Heavy sans (Helvetica Neue, Arial Black, "PingFang SC" bold, sans-serif)
- Display sizes clamp(64px, 12vw, 180px), weight 800–900, letter-spacing -0.04em, line-height 0.9
- Body 17px; labels uppercase with wide tracking

## Layout
- Strong grid blocks, full-bleed color fields, deliberate asymmetry
- Large numbers and oversized words may overlap section edges

## Components
- Square corners everywhere; thick 3–4px rules
- Buttons: solid black or signal color, uppercase label, no radius
- Marquee or ticker strips are welcome

## Motion
- Snappy, short movements (120ms); a scrolling marquee at most; respect prefers-reduced-motion

## Don't
- No gradients, soft shadows or pastel colors`,
  },
  {
    id: 'night',
    swatches: ['#0E1116', '#2DD4BF', '#F5A524'],
    name: { en: 'Night console', zh: '夜间控制台' },
    description: { en: 'Dark canvas, monospace details, teal and amber.', zh: '深色画布、等宽细节、青绿与琥珀。' },
    text: `# Night console

## Overview
A focused dark interface for tools, dashboards and developer pages. Crisp, technical and calm.

## Colors
- Canvas #0E1116, surface #161B22, raised #1F2630, border #2A313C
- Text #E6EDF3, muted #8B96A5
- Teal #2DD4BF (primary, success), amber #F5A524 (warnings, highlights), red #F2555A (errors)

## Typography
- UI in system sans; numbers, labels and code in ui-monospace, SFMono-Regular, Menlo, monospace
- Headings 28–44px weight 600; body 15px line-height 1.6

## Layout
- Dense but orderly: panels on a 4px/8px grid, max width 1200px
- Status bars, key–value rows and tabular data feel at home

## Components
- Panels: 1px border, 8px radius, no shadow
- Buttons: 36px, teal outline or fill; keyboard hints in small monospace boxes
- Charts drawn with inline SVG or canvas, thin strokes

## Motion
- Subtle 150ms transitions; a blinking caret is the only loop allowed; respect prefers-reduced-motion

## Don't
- No neon glow, no purple, no light backgrounds`,
  },
  {
    id: 'arcade',
    swatches: ['#6EC8FF', '#FF6F59', '#FFC93C'],
    name: { en: 'Pocket arcade', zh: '口袋游戏' },
    description: { en: 'Playful mobile-game look with chunky buttons.', zh: '像精品手游：圆胖按钮、贴纸卡片。' },
    text: `# Pocket arcade

## Overview
Feels like a polished casual mobile game: bright, tactile and a little bit cheeky.

## Colors
- Sky #6EC8FF to #A8E2FF as the backdrop (a gentle vertical blend is fine)
- Coral #FF6F59, sunshine #FFC93C, mint #3DD6A3, white #FFFFFF; ink #23324A
- Never purple

## Typography
- Rounded heavy sans (ui-rounded, "SF Pro Rounded", "PingFang SC", sans-serif)
- Titles 40–64px weight 800 with a 3px ink outline or a hard drop shadow; body 16px weight 600

## Layout
- Centered stage, big tap targets (at least 48px), cards that look like stickers
- Progress bars, stars, counters and badges make good decoration

## Components
- Chunky buttons: 18px radius, solid color, 4–6px darker bottom edge that compresses on press
- Cards: white, 20px radius, 3px ink outline, slight rotation (-2° to 2°)
- Confetti, sparkles or a small mascot drawn in inline SVG or CSS

## Motion
- Bouncy spring animations (scale 0.96 on press, overshoot on appear); idle wobble on mascots
- Respect prefers-reduced-motion by switching to simple fades

## Don't
- No thin gray corporate UI, no tiny text, no purple`,
  },
];

/** @param {string} id */
export function presetById(id) {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}
