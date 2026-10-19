import type { SVGProps } from "react";

type PinePointMarkProps = SVGProps<SVGSVGElement> & { size?: number };

/** A familiar location pin with an evergreen at its center. */
export function PinePointMark({ size = 24, ...props }: PinePointMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m12 5.5-3.3 4.6h1.6l-2.5 3.3h3.4v1.8h1.6v-1.8h3.4l-2.5-3.3h1.6L12 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
