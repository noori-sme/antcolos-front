import type { MtLoopPosition } from "@/types";

/**
 * Where the truck is, at a glance.
 *
 * ★ WHAT THIS IS, AND WHAT IT IS CAREFUL NOT TO BE ★
 *
 * It is a thumbnail. A dispatcher scanning a lane of empty trucks is asking
 * "roughly where is this one" — east coast, midwest, somewhere I have freight —
 * and a 86×52 silhouette answers that in less time than reading a city name.
 *
 * It is NOT a map in the sense of anything measured off it. The outline is a
 * rough polygon and the projection is a straight linear fit over the
 * continental bounding box; nothing derived from geometry may be computed from
 * what is drawn here. Distance, deadhead, proximity and geofencing all read
 * `MtLoopPosition.point` — which is absent unless this membership holds precise
 * location — and decline when it is missing.
 *
 * ★ THE TWO MARKS SAY DIFFERENT THINGS, AND THE DIFFERENCE IS THE POINT ★
 *
 *   filled dot    an exact fix. This is where the truck is.
 *   dashed ring   city precision. A coordinate exists and this membership is
 *                 not entitled to it, so the mark is on the CITY, drawn so it
 *                 cannot be read as a fix. City-only is a permission outcome,
 *                 never a gap in the data, and the caption says so in words.
 *
 * No position at all — no ELD share, no permission, no signal — renders
 * nothing. An empty map frame implies a truck somewhere on it.
 */

/** The continental bounding box the outline below was drawn to. */
const WEST = -125;
const EAST = -66;
const NORTH = 49;
const SOUTH = 24;

/** A rough continental silhouette. Indicative, never measured against. */
const OUTLINE =
  "M5,8 L30,6 L55,5 L74,5 L88,3 L93,9 L89,15 L87,21 L85,27 L83,33 L85,40 "
  + "L86,48 L82,44 L74,45 L64,45 L57,52 L52,45 L44,45 L34,42 L26,39 L16,37 "
  + "L9,28 L6,18 Z";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Linear, and deliberately so: a projection nobody can be tempted to measure. */
function place(point: { latitude: number; longitude: number }) {
  return {
    x: clamp(((point.longitude - WEST) / (EAST - WEST)) * 100, 3, 97),
    y: clamp(((NORTH - point.latitude) / (NORTH - SOUTH)) * 60, 3, 57),
  };
}

export function MiniMap({
  position, width = 86, height = 52,
}: {
  position: MtLoopPosition;
  width?: number;
  height?: number;
}) {
  // Nowhere to put a mark is not a map. Rendering the outline alone would say
  // "the truck is somewhere in America", which nobody needs a picture for.
  if (!position.mapPoint) return null;

  const { x, y } = place(position.mapPoint);
  /*
   * The mark keeps its size on screen, not in the viewBox.
   *
   * A 52px thumbnail scales a viewBox radius down with everything else, which
   * turned a dot into a speck and a dashed ring into nothing at all — and the
   * difference between those two marks is the only thing this component exists
   * to say. Both are scaled back up so they read the same at any size.
   */
  const k = 86 / width;
  const exact = position.precision === "exact";
  const where = [position.city, position.state].filter(Boolean).join(", ");
  const label = exact
    ? `${where || "The truck"}, exact position`
    : `${where || "The truck"}, city precision only`;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 60"
      role="img"
      aria-label={label}
      className="rounded-xs border border-border bg-surface-sunken"
    >
      <path
        d={OUTLINE}
        className="fill-border stroke-border-strong"
        strokeWidth={1.2 * k}
        strokeLinejoin="round"
      />
      {exact ? (
        <>
          <circle cx={x} cy={y} r={4.6 * k} className="fill-st-info" opacity={0.22} />
          <circle cx={x} cy={y} r={2.4 * k} className="fill-st-info" />
        </>
      ) : (
        // Hollow and dashed on purpose. A filled dot here would be a confident
        // claim about a coordinate this membership was refused.
        <circle
          cx={x}
          cy={y}
          r={4.2 * k}
          fill="none"
          className="stroke-st-info"
          strokeWidth={1.8 * k}
          strokeDasharray={`${2.2 * k} ${1.8 * k}`}
        />
      )}
    </svg>
  );
}

/** The caption under the map. Says which precision, in words, every time. */
export function PositionCaption({ position }: { position: MtLoopPosition }) {
  const where = [position.city, position.state].filter(Boolean).join(", ");
  return (
    <span className="text-[0.6875rem] leading-tight text-fg-subtle">
      {where || "Position not named"}
      {position.precision === "exact" ? null : (
        <>
          {" · "}
          <span title="A coordinate exists. This workspace is not entitled to it.">
            city only
          </span>
        </>
      )}
    </span>
  );
}
