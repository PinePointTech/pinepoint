import type { SVGProps } from "react";

type PinePointMarkProps = SVGProps<SVGSVGElement> & { size?: number };

/** A tapered pinecone with broad, transparent geometric scales. */
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
        d="M12 1.5 16.6 5.8 19.8 11.5 20.8 16.1Q20.1 20.7 12 23 3.9 20.7 3.2 16.1L4.2 11.5 7.4 5.8Z M8.6 6.6h6.8L12 9.5Z M5.1 11.8h6L8.1 14.8Z M12.9 11.8h6l-3 3Z M7.2 17.1h9.6L12 21Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
