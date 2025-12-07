"use client";

import { useMemo, useState } from "react";

const VIEWPORT_WIDTH = 880;
const VIEWPORT_HEIGHT = 520;
const GRID_SPACING_DEFAULT = 0.25;

type Unit = "meters" | "feet";

type Point = {
  x: number;
  y: number;
};

type GeometryType = "line" | "rectangle" | "circle" | "arc";

type GeometryBase = {
  id: string;
  type: GeometryType;
  label: string;
  color: string;
};

type LineGeometry = GeometryBase & {
  type: "line";
  start: Point;
  end: Point;
};

type RectangleGeometry = GeometryBase & {
  type: "rectangle";
  origin: Point;
  width: number;
  height: number;
  extrude?: number;
  offset?: number;
};

type CircleGeometry = GeometryBase & {
  type: "circle";
  center: Point;
  radius: number;
  extrude?: number;
  offset?: number;
};

type ArcGeometry = GeometryBase & {
  type: "arc";
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
};

type Geometry = LineGeometry | RectangleGeometry | CircleGeometry | ArcGeometry;

type Guide = {
  id: string;
  start: Point;
  end: Point;
  label?: string;
  transient?: boolean;
};

type Measurement = {
  id: string;
  start: Point;
  end: Point;
  snappedStart: Point;
  snappedEnd: Point;
  distance: number;
};

const unitScale: Record<Unit, number> = {
  meters: 1,
  feet: 3.28084,
};

const formatNumber = (value: number) => Number.parseFloat(value.toFixed(3));

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const randomColor = () =>
  ["#2563eb", "#ea580c", "#16a34a", "#a855f7", "#eab308"][Math.floor(Math.random() * 5)];

const defaultPoint: Point = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };

const distance2D = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const toRadians = (deg: number) => (deg * Math.PI) / 180;

const rotatePoint = (point: Point, center: Point, angle: number): Point => {
  const radians = toRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
};

const snapToIncrement = (value: number, increment: number) =>
  Math.round(value / increment) * increment;

const boundingBox = (geometry: Geometry) => {
  switch (geometry.type) {
    case "line": {
      const { start, end } = geometry;
      return {
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      };
    }
    case "rectangle": {
      const { origin, width, height } = geometry;
      return {
        minX: origin.x,
        minY: origin.y,
        maxX: origin.x + width,
        maxY: origin.y + height,
      };
    }
    case "circle": {
      const { center, radius } = geometry;
      return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      };
    }
    case "arc": {
      const { center, radius } = geometry;
      return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      };
    }
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
};

const applySnapping = (
  point: Point,
  geometries: Geometry[],
  settings: {
    gridSnap: boolean;
    snapIncrement: number;
    axisSnap: boolean;
    edgeSnap: boolean;
    faceSnap: boolean;
  },
): { snapped: Point; guides: Guide[] } => {
  let snapped: Point = { ...point };
  const guides: Guide[] = [];

  if (settings.gridSnap) {
    snapped = {
      x: snapToIncrement(snapped.x, settings.snapIncrement),
      y: snapToIncrement(snapped.y, settings.snapIncrement),
    };
    guides.push({
      id: `grid-x-${snapped.x.toFixed(2)}`,
      start: { x: snapped.x, y: 0 },
      end: { x: snapped.x, y: VIEWPORT_HEIGHT },
      label: "Grid",
      transient: true,
    });
    guides.push({
      id: `grid-y-${snapped.y.toFixed(2)}`,
      start: { x: 0, y: snapped.y },
      end: { x: VIEWPORT_WIDTH, y: snapped.y },
      label: "Grid",
      transient: true,
    });
  }

  if (settings.axisSnap) {
    if (Math.abs(snapped.x - VIEWPORT_WIDTH / 2) > Math.abs(snapped.y - VIEWPORT_HEIGHT / 2)) {
      snapped = { ...snapped, y: VIEWPORT_HEIGHT / 2 };
      guides.push({
        id: "axis-x",
        start: { x: 0, y: VIEWPORT_HEIGHT / 2 },
        end: { x: VIEWPORT_WIDTH, y: VIEWPORT_HEIGHT / 2 },
        label: "X Axis",
        transient: true,
      });
    } else {
      snapped = { ...snapped, x: VIEWPORT_WIDTH / 2 };
      guides.push({
        id: "axis-y",
        start: { x: VIEWPORT_WIDTH / 2, y: 0 },
        end: { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT },
        label: "Y Axis",
        transient: true,
      });
    }
  }

  if (settings.edgeSnap || settings.faceSnap) {
    let bestMatch: { distance: number; guide: Guide; coordUpdate: Partial<Point> } | null = null;

    geometries.forEach((geometry) => {
      const box = boundingBox(geometry);
      const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };

      const candidates: { guide: Guide; coordUpdate: Partial<Point> }[] = [];

      if (settings.edgeSnap) {
        candidates.push(
          {
            guide: {
              id: `${geometry.id}-edge-x-${box.minX.toFixed(1)}`,
              start: { x: box.minX, y: box.minY },
              end: { x: box.minX, y: box.maxY },
              label: `${geometry.label} edge`,
              transient: true,
            },
            coordUpdate: { x: box.minX },
          },
          {
            guide: {
              id: `${geometry.id}-edge-y-${box.minY.toFixed(1)}`,
              start: { x: box.minX, y: box.minY },
              end: { x: box.maxX, y: box.minY },
              label: `${geometry.label} edge`,
              transient: true,
            },
            coordUpdate: { y: box.minY },
          },
        );
      }

      if (settings.faceSnap) {
        candidates.push({
          guide: {
            id: `${geometry.id}-face-center`,
            start: { x: center.x - 12, y: center.y - 12 },
            end: { x: center.x + 12, y: center.y + 12 },
            label: `${geometry.label} face center`,
            transient: true,
          },
          coordUpdate: center,
        });
      }

      candidates.forEach((candidate) => {
        const previewPoint = { ...snapped, ...candidate.coordUpdate } as Point;
        const delta = distance2D(previewPoint, snapped);
        if (!bestMatch || delta < bestMatch.distance) {
          bestMatch = { distance: delta, guide: candidate.guide, coordUpdate: candidate.coordUpdate };
        }
      });
    });

    if (bestMatch) {
      snapped = { ...snapped, ...bestMatch.coordUpdate } as Point;
      guides.push(bestMatch.guide);
    }
  }

  return { snapped, guides };
};

const TransformControls = ({
  geometry,
  onTransform,
}: {
  geometry: Geometry;
  onTransform: (updated: Geometry) => void;
}) => {
  const [move, setMove] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);

  const applyMove = () => {
    const apply = (point: Point): Point => ({ x: point.x + move.x, y: point.y + move.y });

    if (geometry.type === "line") {
      onTransform({ ...geometry, start: apply(geometry.start), end: apply(geometry.end) });
    } else if (geometry.type === "rectangle") {
      onTransform({ ...geometry, origin: apply(geometry.origin) });
    } else if (geometry.type === "circle" || geometry.type === "arc") {
      onTransform({ ...geometry, center: apply(geometry.center) });
    }
  };

  const applyRotation = () => {
    const angle = rotation;
    if (geometry.type === "line") {
      const center = {
        x: (geometry.start.x + geometry.end.x) / 2,
        y: (geometry.start.y + geometry.end.y) / 2,
      };
      onTransform({
        ...geometry,
        start: rotatePoint(geometry.start, center, angle),
        end: rotatePoint(geometry.end, center, angle),
      });
    } else if (geometry.type === "rectangle") {
      const center = {
        x: geometry.origin.x + geometry.width / 2,
        y: geometry.origin.y + geometry.height / 2,
      };
      const corners = [
        geometry.origin,
        { x: geometry.origin.x + geometry.width, y: geometry.origin.y },
        { x: geometry.origin.x, y: geometry.origin.y + geometry.height },
        { x: geometry.origin.x + geometry.width, y: geometry.origin.y + geometry.height },
      ].map((corner) => rotatePoint(corner, center, angle));
      const minX = Math.min(...corners.map((c) => c.x));
      const minY = Math.min(...corners.map((c) => c.y));
      const maxX = Math.max(...corners.map((c) => c.x));
      const maxY = Math.max(...corners.map((c) => c.y));

      onTransform({
        ...geometry,
        origin: { x: minX, y: minY },
        width: maxX - minX,
        height: maxY - minY,
      });
    } else if (geometry.type === "arc") {
      onTransform({
        ...geometry,
        startAngle: geometry.startAngle + angle,
        endAngle: geometry.endAngle + angle,
      });
    }
  };

  const applyScale = () => {
    const factor = scale;
    if (geometry.type === "line") {
      const center = {
        x: (geometry.start.x + geometry.end.x) / 2,
        y: (geometry.start.y + geometry.end.y) / 2,
      };
      const scalePoint = (point: Point) => ({
        x: center.x + (point.x - center.x) * factor,
        y: center.y + (point.y - center.y) * factor,
      });
      onTransform({ ...geometry, start: scalePoint(geometry.start), end: scalePoint(geometry.end) });
    } else if (geometry.type === "rectangle") {
      onTransform({
        ...geometry,
        width: geometry.width * factor,
        height: geometry.height * factor,
      });
    } else if (geometry.type === "circle" || geometry.type === "arc") {
      const updated = { ...geometry, radius: geometry.radius * factor } as Geometry;
      onTransform(updated);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-white/70 p-4 shadow-sm backdrop-blur">
      <h4 className="text-sm font-semibold text-zinc-900">Transform</h4>
      <div className="mt-3 space-y-3 text-sm text-zinc-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Move</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={move.x}
              onChange={(e) => setMove({ ...move, x: Number(e.target.value) })}
              className="w-20 rounded border border-border px-2 py-1 text-xs"
            />
            <input
              type="number"
              value={move.y}
              onChange={(e) => setMove({ ...move, y: Number(e.target.value) })}
              className="w-20 rounded border border-border px-2 py-1 text-xs"
            />
            <button
              onClick={applyMove}
              className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Rotate</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-20 rounded border border-border px-2 py-1 text-xs"
            />
            <button
              onClick={applyRotation}
              className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Scale</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(clamp(Number(e.target.value), 0.1, 10))}
              className="w-20 rounded border border-border px-2 py-1 text-xs"
            />
            <button
              onClick={applyScale}
              className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Home() {
  const [geometryType, setGeometryType] = useState<GeometryType>("line");
  const [geometries, setGeometries] = useState<Geometry[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [unit, setUnit] = useState<Unit>("meters");
  const [snapIncrement, setSnapIncrement] = useState<number>(GRID_SPACING_DEFAULT);
  const [gridSnap, setGridSnap] = useState(true);
  const [axisSnap, setAxisSnap] = useState(true);
  const [edgeSnap, setEdgeSnap] = useState(true);
  const [faceSnap, setFaceSnap] = useState(true);
  const [extrusionHeight, setExtrusionHeight] = useState(2);
  const [offsetAmount, setOffsetAmount] = useState(0.25);
  const [selectedGeometry, setSelectedGeometry] = useState<string | null>(null);
  const [arcAngles, setArcAngles] = useState({ start: 0, end: 120 });
  const [dimensions, setDimensions] = useState({ width: 200, height: 120, radius: 60 });
  const [snapPreview, setSnapPreview] = useState<Point | null>(null);
  const [guideDraft, setGuideDraft] = useState<{ start: Point; end: Point }>({ start: defaultPoint, end: defaultPoint });

  const unitLabel = unit === "meters" ? "m" : "ft";

  const addGeometry = () => {
    const basePoint = { x: defaultPoint.x + Math.random() * 120 - 60, y: defaultPoint.y + Math.random() * 80 - 40 };
    const { snapped, guides: snapGuides } = applySnapping(basePoint, geometries, {
      gridSnap,
      snapIncrement,
      axisSnap,
      edgeSnap,
      faceSnap,
    });
    setGuides((prev) => {
      const persistent = prev.filter((guide) => !guide.transient);
      return [...persistent, ...snapGuides];
    });

    const base: GeometryBase = {
      id: crypto.randomUUID(),
      type: geometryType,
      label: `${geometryType} ${geometries.length + 1}`,
      color: randomColor(),
    };

    const newGeometry: Geometry = (() => {
      switch (geometryType) {
        case "line":
          return {
            ...base,
            start: { x: snapped.x - 50, y: snapped.y - 30 },
            end: { x: snapped.x + 50, y: snapped.y + 30 },
          } satisfies LineGeometry;
        case "rectangle":
          return {
            ...base,
            origin: { x: snapped.x - dimensions.width / 2, y: snapped.y - dimensions.height / 2 },
            width: dimensions.width,
            height: dimensions.height,
          } satisfies RectangleGeometry;
        case "circle":
          return {
            ...base,
            center: snapped,
            radius: dimensions.radius,
          } satisfies CircleGeometry;
        case "arc":
          return {
            ...base,
            center: snapped,
            radius: dimensions.radius,
            startAngle: arcAngles.start,
            endAngle: arcAngles.end,
          } satisfies ArcGeometry;
      }
    })();

    setGeometries((prev) => [...prev, newGeometry]);
    setSelectedGeometry(newGeometry.id);
  };

  const updateGeometry = (updated: Geometry) => {
    setGeometries((prev) => prev.map((geometry) => (geometry.id === updated.id ? updated : geometry)));
  };

  const addExtrusion = () => {
    if (!selectedGeometry) return;
    setGeometries((prev) =>
      prev.map((geometry) =>
        geometry.id === selectedGeometry && (geometry.type === "rectangle" || geometry.type === "circle")
          ? { ...geometry, extrude: extrusionHeight }
          : geometry,
      ),
    );
  };

  const addOffset = () => {
    if (!selectedGeometry) return;
    setGeometries((prev) =>
      prev.map((geometry) =>
        geometry.id === selectedGeometry && (geometry.type === "rectangle" || geometry.type === "circle")
          ? { ...geometry, offset: offsetAmount }
          : geometry,
      ),
    );
  };

  const addGuideFromTape = () => {
    const { snapped: snappedStart, guides: guideA } = applySnapping(guideDraft.start, geometries, {
      gridSnap,
      snapIncrement,
      axisSnap,
      edgeSnap,
      faceSnap,
    });
    const { snapped: snappedEnd, guides: guideB } = applySnapping(guideDraft.end, geometries, {
      gridSnap,
      snapIncrement,
      axisSnap,
      edgeSnap,
      faceSnap,
    });

    const distance = distance2D(snappedStart, snappedEnd) / unitScale[unit];
    const measurement: Measurement = {
      id: crypto.randomUUID(),
      start: guideDraft.start,
      end: guideDraft.end,
      snappedStart,
      snappedEnd,
      distance,
    };

    setGuides((prev) => [
      ...prev.filter((g) => !g.transient),
      ...guideA,
      ...guideB,
      {
        id: measurement.id,
        start: snappedStart,
        end: snappedEnd,
        label: `${formatNumber(distance)} ${unitLabel}`,
      },
    ]);
    setMeasurements((prev) => [...prev, measurement]);
  };

  const inferredGuides = useMemo(() => guides.filter((guide) => !guide.transient), [guides]);

  const previewGuides = useMemo(() => guides.filter((guide) => guide.transient), [guides]);

  const renderGeometry = (geometry: Geometry) => {
    switch (geometry.type) {
      case "line":
        return (
          <line
            key={geometry.id}
            x1={geometry.start.x}
            y1={geometry.start.y}
            x2={geometry.end.x}
            y2={geometry.end.y}
            stroke={geometry.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      case "rectangle":
        return (
          <rect
            key={geometry.id}
            x={geometry.origin.x}
            y={geometry.origin.y}
            width={geometry.width}
            height={geometry.height}
            fill={geometry.offset ? `${geometry.color}22` : `${geometry.color}11`}
            stroke={geometry.color}
            strokeWidth={3}
            rx={8}
          />
        );
      case "circle":
        return (
          <circle
            key={geometry.id}
            cx={geometry.center.x}
            cy={geometry.center.y}
            r={geometry.radius}
            fill={geometry.offset ? `${geometry.color}22` : `${geometry.color}11`}
            stroke={geometry.color}
            strokeWidth={3}
          />
        );
      case "arc":
        return (
          <path
            key={geometry.id}
            d={`M ${geometry.center.x + geometry.radius * Math.cos(toRadians(geometry.startAngle))} ${
              geometry.center.y + geometry.radius * Math.sin(toRadians(geometry.startAngle))
            } A ${geometry.radius} ${geometry.radius} 0 0 1 ${
              geometry.center.x + geometry.radius * Math.cos(toRadians(geometry.endAngle))
            } ${geometry.center.y + geometry.radius * Math.sin(toRadians(geometry.endAngle))}`}
            fill="none"
            stroke={geometry.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      default:
        return null;
    }
  };

  const extrudeBadges = (geometry: Geometry) => {
    if (geometry.type === "rectangle" || geometry.type === "circle") {
      return (
        <div className="flex flex-wrap gap-2 text-xs">
          {geometry.extrude !== undefined && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Push/Pull: {geometry.extrude} {unitLabel}</span>
          )}
          {geometry.offset !== undefined && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Offset: {geometry.offset} {unitLabel}</span>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-zinc-100 text-zinc-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Parametric Sketch Workspace</p>
            <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
              Draw, extrude, offset, and infer with precision guides
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-zinc-200">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Units</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              className="rounded-full border border-zinc-200 px-3 py-1 text-sm shadow-inner"
            >
              <option value="meters">Meters</option>
              <option value="feet">Feet</option>
            </select>
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <span>Snap</span>
              <input
                type="number"
                min={0.05}
                step={0.05}
                value={snapIncrement}
                onChange={(e) => setSnapIncrement(clamp(Number(e.target.value), 0.05, 10))}
                className="w-20 rounded border border-zinc-200 px-2 py-1 text-sm"
              />
              <span className="text-xs text-zinc-400">{unitLabel}</span>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white">Viewport</span>
                  <p className="text-zinc-500">Dynamic guides visualize snapping to axes, edges, faces, and grid.</p>
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-600">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={gridSnap} onChange={(e) => setGridSnap(e.target.checked)} />
                    Grid
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={axisSnap} onChange={(e) => setAxisSnap(e.target.checked)} />
                    Axis
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={edgeSnap} onChange={(e) => setEdgeSnap(e.target.checked)} />
                    Edges
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={faceSnap} onChange={(e) => setFaceSnap(e.target.checked)} />
                    Faces
                  </label>
                </div>
              </div>
              <div className="relative bg-gradient-to-br from-zinc-50 via-white to-zinc-100">
                <svg
                  viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
                  className="block h-[540px] w-full"
                  onMouseMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const point = {
                      x: ((event.clientX - bounds.left) / bounds.width) * VIEWPORT_WIDTH,
                      y: ((event.clientY - bounds.top) / bounds.height) * VIEWPORT_HEIGHT,
                    };
                    const { snapped, guides: transient } = applySnapping(point, geometries, {
                      gridSnap,
                      snapIncrement,
                      axisSnap,
                      edgeSnap,
                      faceSnap,
                    });
                    setSnapPreview(snapped);
                    setGuides((prev) => [...prev.filter((g) => !g.transient), ...transient]);
                  }}
                  onMouseLeave={() => {
                    setSnapPreview(null);
                    setGuides((prev) => prev.filter((guide) => !guide.transient));
                  }}
                >
                  <rect width={VIEWPORT_WIDTH} height={VIEWPORT_HEIGHT} fill="#f8fafc" />

                  {gridSnap && (
                    <g stroke="#e5e7eb" strokeWidth={1}>
                      {Array.from({ length: Math.floor(VIEWPORT_WIDTH / (snapIncrement * 10)) + 1 }).map((_, i) => (
                        <line
                          key={`gx-${i}`}
                          x1={i * snapIncrement * 10}
                          y1={0}
                          x2={i * snapIncrement * 10}
                          y2={VIEWPORT_HEIGHT}
                        />
                      ))}
                      {Array.from({ length: Math.floor(VIEWPORT_HEIGHT / (snapIncrement * 10)) + 1 }).map((_, i) => (
                        <line
                          key={`gy-${i}`}
                          x1={0}
                          y1={i * snapIncrement * 10}
                          x2={VIEWPORT_WIDTH}
                          y2={i * snapIncrement * 10}
                        />
                      ))}
                    </g>
                  )}

                  <g className="guides">
                    {[...previewGuides, ...inferredGuides].map((guide) => (
                      <g key={guide.id}>
                        <line
                          x1={guide.start.x}
                          y1={guide.start.y}
                          x2={guide.end.x}
                          y2={guide.end.y}
                          stroke={guide.transient ? "#c084fc" : "#22c55e"}
                          strokeWidth={guide.transient ? 1.5 : 2.5}
                          strokeDasharray={guide.transient ? "4 4" : "6 6"}
                          opacity={guide.transient ? 0.6 : 0.8}
                        />
                        {guide.label && (
                          <text
                            x={(guide.start.x + guide.end.x) / 2}
                            y={(guide.start.y + guide.end.y) / 2 - 8}
                            textAnchor="middle"
                            className="text-[10px] fill-zinc-700"
                          >
                            {guide.label}
                          </text>
                        )}
                      </g>
                    ))}
                  </g>

                  <g className="geometry">{geometries.map((geometry) => renderGeometry(geometry))}</g>

                  {snapPreview && (
                    <g>
                      <circle cx={snapPreview.x} cy={snapPreview.y} r={6} fill="#0ea5e9" opacity={0.7} />
                      <text x={snapPreview.x + 10} y={snapPreview.y - 10} className="text-[10px] fill-zinc-700">
                        {formatNumber(snapPreview.x / unitScale[unit])} × {formatNumber(snapPreview.y / unitScale[unit])} {unitLabel}
                      </text>
                    </g>
                  )}

                  {measurements.map((measurement) => (
                    <g key={measurement.id}>
                      <line
                        x1={measurement.snappedStart.x}
                        y1={measurement.snappedStart.y}
                        x2={measurement.snappedEnd.x}
                        y2={measurement.snappedEnd.y}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={(measurement.snappedStart.x + measurement.snappedEnd.x) / 2}
                        y={(measurement.snappedStart.y + measurement.snappedEnd.y) / 2 - 6}
                        className="text-[10px] fill-cyan-700"
                      >
                        {formatNumber(measurement.distance)} {unitLabel}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-zinc-900">Draw tools</h3>
                <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                  Parametric
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">
                Create lines, rectangles, circles, and arcs with real-time snapping to axes, edges, faces, and grid.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {(["line", "rectangle", "circle", "arc"] as GeometryType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setGeometryType(type)}
                    className={`rounded-xl border px-3 py-2 text-left font-medium transition ${
                      geometryType === type
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300"
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3 text-sm text-zinc-700">
                {geometryType !== "line" && (
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs uppercase tracking-wide text-zinc-500">Width/Radius</label>
                    {geometryType === "rectangle" ? (
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={dimensions.width}
                          onChange={(e) => setDimensions({ ...dimensions, width: Number(e.target.value) })}
                          className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                        />
                        <input
                          type="number"
                          value={dimensions.height}
                          onChange={(e) => setDimensions({ ...dimensions, height: Number(e.target.value) })}
                          className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                        />
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={dimensions.radius}
                        onChange={(e) => setDimensions({ ...dimensions, radius: Number(e.target.value) })}
                        className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                )}

                {geometryType === "arc" && (
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs uppercase tracking-wide text-zinc-500">Angles</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={arcAngles.start}
                        onChange={(e) => setArcAngles({ ...arcAngles, start: Number(e.target.value) })}
                        className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                      />
                      <input
                        type="number"
                        value={arcAngles.end}
                        onChange={(e) => setArcAngles({ ...arcAngles, end: Number(e.target.value) })}
                        className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={addGeometry}
                  className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-700"
                >
                  Add {geometryType}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-zinc-900">Push/Pull + Offset</h3>
              <p className="mt-2 text-sm text-zinc-600">
                Extrude faces with push/pull or generate offset faces while snapping to the current guide system.
              </p>
              <div className="mt-4 space-y-3 text-sm text-zinc-700">
                <select
                  value={selectedGeometry ?? ""}
                  onChange={(e) => setSelectedGeometry(e.target.value)}
                  className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
                >
                  <option value="">Select geometry</option>
                  {geometries.map((geometry) => (
                    <option key={geometry.id} value={geometry.id}>
                      {geometry.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs uppercase tracking-wide text-zinc-500">Extrusion</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={extrusionHeight}
                      onChange={(e) => setExtrusionHeight(Number(e.target.value))}
                      className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={addExtrusion}
                      className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                    >
                      Push/Pull
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs uppercase tracking-wide text-zinc-500">Offset</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={offsetAmount}
                      onChange={(e) => setOffsetAmount(Number(e.target.value))}
                      className="w-24 rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={addOffset}
                      className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-400"
                    >
                      Offset Face
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {selectedGeometry && (
              <TransformControls
                geometry={geometries.find((geometry) => geometry.id === selectedGeometry)!}
                onTransform={updateGeometry}
              />
            )}

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-zinc-900">Tape measure & guides</h3>
              <p className="mt-2 text-sm text-zinc-600">
                Use the tape to capture distances, create guides, and visualize snapping increments in {unitLabel}.
              </p>
              <div className="mt-4 space-y-3 text-sm text-zinc-700">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Start</p>
                    <input
                      type="number"
                      value={guideDraft.start.x}
                      onChange={(e) => setGuideDraft({ ...guideDraft, start: { ...guideDraft.start, x: Number(e.target.value) } })}
                      className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={guideDraft.start.y}
                      onChange={(e) => setGuideDraft({ ...guideDraft, start: { ...guideDraft.start, y: Number(e.target.value) } })}
                      className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">End</p>
                    <input
                      type="number"
                      value={guideDraft.end.x}
                      onChange={(e) => setGuideDraft({ ...guideDraft, end: { ...guideDraft.end, x: Number(e.target.value) } })}
                      className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={guideDraft.end.y}
                      onChange={(e) => setGuideDraft({ ...guideDraft, end: { ...guideDraft.end, y: Number(e.target.value) } })}
                      className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={addGuideFromTape}
                  className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500"
                >
                  Measure & Create Guide
                </button>
                {measurements.length > 0 && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                    <p className="font-semibold text-zinc-800">History</p>
                    <ul className="mt-2 space-y-2">
                      {measurements.map((measurement) => (
                        <li key={measurement.id} className="flex items-center justify-between">
                          <span className="font-medium text-zinc-800">Guide {measurement.id.slice(0, 5)}</span>
                          <span>
                            {formatNumber(measurement.distance)} {unitLabel} — ({formatNumber(measurement.snappedStart.x)},
                            {" "}
                            {formatNumber(measurement.snappedStart.y)}) → ({formatNumber(measurement.snappedEnd.x)}, {" "}
                            {formatNumber(measurement.snappedEnd.y)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-zinc-900">Geometry stack</h3>
              <p className="mt-2 text-sm text-zinc-600">Move/rotate/scale selections with transform controls.</p>
              <div className="mt-4 space-y-3 text-sm text-zinc-700">
                {geometries.length === 0 && <p className="text-zinc-500">No geometry yet. Add shapes to begin.</p>}
                {geometries.map((geometry) => (
                  <div
                    key={geometry.id}
                    className={`rounded-xl border px-3 py-2 ${
                      selectedGeometry === geometry.id ? "border-zinc-900 bg-zinc-900/5" : "border-zinc-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-zinc-900">{geometry.label}</p>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">{geometry.type}</p>
                      </div>
                      <button
                        onClick={() => setSelectedGeometry(geometry.id)}
                        className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200"
                      >
                        Select
                      </button>
                    </div>
                    <div className="mt-2 text-xs text-zinc-600">
                      {geometry.type === "line" && (
                        <p>
                          Start ({formatNumber(geometry.start.x)}, {formatNumber(geometry.start.y)}), End (
                          {formatNumber(geometry.end.x)}, {formatNumber(geometry.end.y)})
                        </p>
                      )}
                      {geometry.type === "rectangle" && (
                        <p>
                          Origin ({formatNumber(geometry.origin.x)}, {formatNumber(geometry.origin.y)}) · {formatNumber(geometry.width)} ×
                          {" "}
                          {formatNumber(geometry.height)} {unitLabel}
                        </p>
                      )}
                      {geometry.type === "circle" && (
                        <p>
                          Center ({formatNumber(geometry.center.x)}, {formatNumber(geometry.center.y)}) · Radius {formatNumber(geometry.radius)} {unitLabel}
                        </p>
                      )}
                      {geometry.type === "arc" && (
                        <p>
                          Center ({formatNumber(geometry.center.x)}, {formatNumber(geometry.center.y)}) · Radius {formatNumber(geometry.radius)} · Angles {" "}
                          {formatNumber(geometry.startAngle)} → {formatNumber(geometry.endAngle)}
                        </p>
                      )}
                    </div>
                    <div className="mt-2">{extrudeBadges(geometry)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
