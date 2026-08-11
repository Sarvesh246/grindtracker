/**
 * Brand mark for the Coach FAB / sheet header: heavy "G" monogram + AI spark.
 * Color via `currentColor`. Decorative — always `aria-hidden`.
 */
export default function CoachFabIcon({
  size = 32,
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
      {/* Optical center: G slightly down so mass balances with the spark. */}
      <text
        x="28"
        y="34"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontFamily="var(--font-display, 'Bebas Neue', sans-serif)"
        fontSize="34"
        fontWeight="700"
        letterSpacing="-0.5"
      >
        G
      </text>
      {/* 4-point star, upper-trailing (~10% inset from rim). */}
      <path
        d="M44 8.5 L46.2 13.8 L51.8 16 L46.2 18.2 L44 23.5 L41.8 18.2 L36.2 16 L41.8 13.8 Z"
        fill="currentColor"
      />
    </svg>
  )
}
