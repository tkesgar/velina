import { Box, Text } from "@chakra-ui/react";

interface SparklineProps {
  label: string;
  value: string;
  values: number[];
  color?: string;
}

export function Sparkline({ label, value, values, color = "brand.fg" }: SparklineProps) {
  const width = 160;
  const height = 36;
  const points = values.filter((entry) => Number.isFinite(entry));

  if (points.length < 2) {
    return (
      <Box>
        <Text fontSize="xs" color="fg.muted">
          {label}: {value}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          collecting…
        </Text>
      </Box>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coordinates = points
    .map((entry, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((entry - min) / span) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted">
        {label}: {value}
      </Text>
      <Box color={color} w="full">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} history`}
        >
          <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </Box>
    </Box>
  );
}
