/** The 12 shapes of a shape object. `css` shapes are a bordered box (cheap, crisp corners); the rest are SVG paths in a 0..100 box stretched to the object. */
export type ShapeId = "rect" | "rounded" | "ellipse" | "diamond" | "triangle" | "hexagon" | "parallelogram" | "star" | "arrow" | "cylinder" | "cloud" | "speech";

const star = (): string => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 21 : 50, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a) + 3).toFixed(1)}`); }
  return `M${pts.join("L")}Z`;
};

export const SHAPES: { id: ShapeId; label: string; css?: boolean; path?: string; extra?: string; inset?: string }[] = [
  { id: "rect", label: "Rectangle", css: true },
  { id: "rounded", label: "Rounded rectangle", css: true },
  { id: "ellipse", label: "Ellipse", css: true, inset: "12%" },
  { id: "diamond", label: "Diamond", path: "M50 0L100 50L50 100L0 50Z", inset: "22%" },
  { id: "triangle", label: "Triangle", path: "M50 0L100 100L0 100Z", inset: "26% 22% 6%" },
  { id: "hexagon", label: "Hexagon", path: "M25 0L75 0L100 50L75 100L25 100L0 50Z", inset: "8% 16%" },
  { id: "parallelogram", label: "Parallelogram", path: "M20 0L100 0L80 100L0 100Z", inset: "6% 18%" },
  { id: "star", label: "Star", path: star(), inset: "30% 26% 14%" },
  { id: "arrow", label: "Arrow", path: "M0 30L60 30L60 4L100 50L60 96L60 70L0 70Z", inset: "26% 24% 26% 6%" },
  { id: "cylinder", label: "Cylinder", path: "M0 14Q0 0 50 0Q100 0 100 14L100 86Q100 100 50 100Q0 100 0 86Z", extra: "M0 14Q0 28 50 28Q100 28 100 14", inset: "26% 6% 8%" },
  { id: "cloud", label: "Cloud", path: "M26 82A20 20 0 0 1 20 44A24 24 0 0 1 66 30A22 22 0 0 1 90 54A17 17 0 0 1 76 82Z", inset: "26% 12% 18%" },
  { id: "speech", label: "Speech bubble", path: "M4 4H96V70H42L20 96L26 70H4Z", inset: "6% 6% 34%" },
];
export const SHAPE_IDS = SHAPES.map((s) => s.id);
export const shapeOf = (id: unknown) => SHAPES.find((s) => s.id === id) ?? SHAPES[0];
