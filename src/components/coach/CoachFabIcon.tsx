/**
 * Brand mark for the Coach FAB / sheet header: heavy "G" monogram + AI spark.
 * Color via `currentColor`. Decorative — always `aria-hidden`.
 * Glyph fills most of the viewBox so a 56px FAB reads as a solid brand mark.
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
      {/* Large G — optically centered, fills ~70% of the orb. */}
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
      {/* Spark sits tight to the G’s upper-trailing corner. */}
      <path
        d="M42.5 7 L45.4 13.6 L52.5 16.5 L45.4 19.4 L42.5 26 L39.6 19.4 L32.5 16.5 L39.6 13.6 Z"
        fill="currentColor"
      />
    </svg>
  )
}
