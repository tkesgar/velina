import { Box } from "@chakra-ui/react";

export function ConfigView({ value }: { value: unknown }) {
  return (
    <Box
      as="pre"
      m="0"
      p="4"
      borderRadius="md"
      bg="gray.950"
      color="gray.100"
      fontFamily="mono"
      fontSize="xs"
      lineHeight="1.5"
      overflow="auto"
      maxH="70vh"
    >
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}
