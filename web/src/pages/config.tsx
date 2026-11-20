import { Box, Grid, Heading, Spinner, Text } from "@chakra-ui/react";

import { ConfigView } from "../components/config-view";
import { useConfig } from "../lib/hooks";

export function ConfigPage() {
  const { config, error } = useConfig();

  return (
    <Box>
      <Heading size="lg" mb="4">
        Config
      </Heading>

      {error && (
        <Text color="red.500" mb="4">
          {error}
        </Text>
      )}
      {!config && !error && <Spinner />}

      {config && (
        <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap="4">
          <Box>
            <Heading size="sm" mb="2">
              Provided
            </Heading>
            <ConfigView value={config.provided} />
          </Box>
          <Box>
            <Heading size="sm" mb="2">
              Resolved
            </Heading>
            <ConfigView value={config.resolved} />
          </Box>
        </Grid>
      )}
    </Box>
  );
}
