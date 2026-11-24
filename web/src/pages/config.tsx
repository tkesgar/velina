import { Box, Grid, Heading, Spinner, Text } from "@chakra-ui/react";
import { FiCheckCircle, FiFileText, FiSettings } from "react-icons/fi";

import { ConfigInspector } from "../components/config-inspector";
import { useConfig, useYamlConfig } from "../lib/hooks";

export function ConfigPage() {
  const { config, error: configError } = useConfig();
  const { config: yamlConfig, error: yamlError } = useYamlConfig();
  const error = configError ?? yamlError;

  return (
    <Box>
      <Heading size="lg" mb="4" display="flex" alignItems="center" gap="2">
        <FiSettings aria-hidden="true" />
        Config
      </Heading>

      {error && (
        <Text color="fg.error" mb="4">
          {error}
        </Text>
      )}
      {!config && !yamlConfig && !error && <Spinner />}

      {config && yamlConfig && (
        <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap="4">
          <Box>
            <Heading size="sm" mb="2" display="flex" alignItems="center" gap="2">
              <FiFileText aria-hidden="true" />
              Provided
            </Heading>
            <ConfigInspector yaml={yamlConfig.provided} value={config.provided} />
          </Box>
          <Box>
            <Heading size="sm" mb="2" display="flex" alignItems="center" gap="2">
              <FiCheckCircle aria-hidden="true" />
              Resolved
            </Heading>
            <ConfigInspector yaml={yamlConfig.resolved} value={config.resolved} />
          </Box>
        </Grid>
      )}
    </Box>
  );
}
