"""Trace a supplied mask or color region into bounded, ordered drawing strokes.

Requires Pillow; no network, model, editor or host access. Writes JSON to stdout.
"""
import argparse
import json
import math
from collections import defaultdict

from PIL import Image, ImageColor


def trace(mask, width, height):
    edges = defaultdict(set)
    def inside(x, y):
        return 0 <= x < width and 0 <= y < height and mask[y * width + x]
    for y in range(height):
        for x in range(width):
            if not inside(x, y):
                continue
            if not inside(x, y - 1): edges[x, y].add((x + 1, y))
            if not inside(x + 1, y): edges[x + 1, y].add((x + 1, y + 1))
            if not inside(x, y + 1): edges[x + 1, y + 1].add((x, y + 1))
            if not inside(x - 1, y): edges[x, y + 1].add((x, y))
    remaining = sum(map(len, edges.values()))
    loops = []
    while edges:
        start = current = next(iter(edges))
        previous = None
        loop = [start]
        while True:
            candidates = edges.get(current)
            if not candidates:
                raise ValueError("Open boundary: mask contour could not be closed")
            def order(point):
                if previous is None: return (0, point)
                ax, ay = current[0] - previous[0], current[1] - previous[1]
                bx, by = point[0] - current[0], point[1] - current[1]
                cross, dot = ax * by - ay * bx, ax * bx + ay * by
                return (0 if cross > 0 else 1 if dot > 0 else 2 if cross < 0 else 3, point)
            following = min(candidates, key=order)
            candidates.remove(following)
            if not candidates:
                del edges[current]
            remaining -= 1
            if remaining < 0:
                raise ValueError("Boundary traversal exceeded its edge budget")
            previous, current = current, following
            loop.append(current)
            if current == start:
                break
        loops.append(loop)
    assert remaining == 0
    return loops


def area(loop):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(loop, loop[1:])) / 2


def smooth(loop, radius):
    points = loop[:-1]
    if not radius: return loop
    offsets = range(-radius, radius + 1)
    result = [tuple(sum(points[(i + k) % len(points)][axis] for k in offsets) / len(offsets)
                    for axis in (0, 1)) for i in range(len(points))]
    return result + [result[0]]


def simplify(points, epsilon):
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        a, b = points[first], points[last]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dy * dy
        farthest, index = epsilon, None
        for i in range(first + 1, last):
            p = points[i]
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) if length else 0
            distance = math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
            if distance > farthest: farthest, index = distance, i
        if index is not None:
            keep.add(index)
            pending.extend(((first, index), (index, last)))
    return [points[i] for i in sorted(keep)]


def strokes(points, maximum):
    """Split by arc length, preserving endpoints and every connecting segment."""
    result, stroke, used = [], [points[0]], 0.0
    for target in points[1:]:
        current = stroke[-1]
        distance = math.dist(current, target)
        while distance > maximum - used + 1e-8:
            fraction = (maximum - used) / distance
            end = tuple(a + (b - a) * fraction for a, b in zip(current, target))
            stroke.append(end)
            result.append(stroke)
            stroke, current, used = [end], end, 0.0
            distance = math.dist(current, target)
        stroke.append(target)
        used += distance
        if used >= maximum - 1e-8:
            result.append(stroke)
            stroke, used = [target], 0.0
    if len(stroke) > 1: result.append(stroke)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", help="white foreground mask, or image when --color is used")
    parser.add_argument("--color", help="foreground RGB color, e.g. '#4080c0'")
    parser.add_argument("--tolerance", type=float, default=70, help="RGB distance, 0..442")
    parser.add_argument("--width", type=int, default=1000, help="output canvas width; aspect ratio preserved")
    parser.add_argument("--min-area", type=float, default=12, help="minimum region area in analysis pixels")
    parser.add_argument("--smooth", type=int, default=1, help="circular smoothing radius, 0..4")
    parser.add_argument("--epsilon", type=float, default=0.6, help="simplification tolerance in analysis pixels")
    parser.add_argument("--stroke-length", type=float, default=100, help="maximum output pixels per stroke")
    args = parser.parse_args()
    values = (args.tolerance, args.min_area, args.epsilon, args.stroke_length)
    if not all(math.isfinite(v) for v in values) or not (0 <= args.tolerance <= 442 and
            1 <= args.width <= 4096 and 0 <= args.smooth <= 4 and args.min_area >= 0 and
            0 <= args.epsilon <= 5 and 10 <= args.stroke_length <= 1000):
        parser.error("parameters outside supported ranges")
    with Image.open(args.image) as source:
        original = source.size
        image = source.convert("RGBA")
    image.thumbnail((640, 640))
    width, height = image.size
    target = ImageColor.getrgb(args.color) if args.color else None
    mask = [a >= 128 and (sum((v - t) ** 2 for v, t in zip((r, g, b), target)) <= args.tolerance ** 2
            if target else (r + g + b) / 3 >= 128) for r, g, b, a in image.getdata()]
    loops = sorted((loop for loop in trace(mask, width, height) if abs(area(loop)) >= args.min_area),
                   key=lambda loop: abs(area(loop)), reverse=True)
    if not loops: parser.error("no matching region; inspect the mask/color selection")
    if len(loops) > 64: parser.error("more than 64 regions; use a cleaner mask or increase --min-area")
    scale = args.width / width
    output, contours = [], []
    for loop in loops:
        points = [(round(x * scale, 2), round(y * scale, 2))
                  for x, y in simplify(smooth(loop, args.smooth), args.epsilon)]
        first = len(output)
        output.extend({"points": part} for part in strokes(points, args.stroke_length))
        contours.append({"firstStroke": first, "strokeCount": len(output) - first,
            "signedArea": round(area(loop) * scale * scale, 2),
            "bounds": [min(p[0] for p in points), min(p[1] for p in points),
                       max(p[0] for p in points), max(p[1] for p in points)]})
    if len(output) > 512: parser.error("more than 512 strokes; simplify the mask or increase --stroke-length")
    print(json.dumps({"sourceSize": original, "analysisSize": [width, height],
        "canvasSize": [args.width, round(height * scale)], "regions": len(loops),
        "contours": contours, "strokes": output}, indent=2))


if __name__ == "__main__":
    main()
