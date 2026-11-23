interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 32 }: BrandLogoProps) {
  const petals = Array.from({ length: 12 }, (_, idx) => idx * 30);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Board Sight"
    >
      {petals.map((angle) => (
        <g key={angle} transform={`rotate(${angle} 20 20)`}>
          <path
            d="M19.2 4.5C19.2 3.95 19.65 3.5 20.2 3.5H22.1C22.75 3.5 23.2 4.1 23.0 4.72L20.8 12.1C20.66 12.56 20.15 12.8 19.7 12.64L19.48 12.56C19.31 12.5 19.2 12.34 19.2 12.16V4.5Z"
            fill="#28A745"
          />
        </g>
      ))}
    </svg>
  );
}
