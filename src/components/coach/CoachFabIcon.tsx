/**
 * Brand mark for the Coach FAB / sheet header: heavy "G" monogram + AI spark.
 * Color via `currentColor`. Decorative — always `aria-hidden`.
 * Glyph fills most of the viewBox so a 56px FAB reads as a solid brand mark.
 *
 * The spark sits on the G’s upper-trailing shoulder, so centering only the G
 * reads right-heavy. Both shapes live in a group shifted so the *combined*
 * bounding box is optically centered in the circle.
 */
export default function CoachFabIcon({
  size = 48,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      {/*
        Combined mark bbox (approx): x 14→52.5, y 7→50 → center ~(33.2, 28.5).
        ViewBox center is (28, 28), so nudge left ~5.2 and slightly up.
      */}
      <g transform="translate(-5.2, -0.5)">
        <text
          x="27"
          y="33"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          fontFamily="var(--font-display, 'Bebas Neue', sans-serif)"
          fontSize="44"
          fontWeight="700"
          letterSpacing="-1"
        >
          G
        </text>
        <path
          d="M42.5 7 L45.4 13.6 L52.5 16.5 L45.4 19.4 L42.5 26 L39.6 19.4 L32.5 16.5 L39.6 13.6 Z"
          fill="currentColor"
        />
      </g>
    </svg>
  )
}
