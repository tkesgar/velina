import { Box, SegmentGroup } from "@chakra-ui/react";
import { useState } from "react";

import { ConfigTreeView } from "./config-tree-view";
import { ConfigView } from "./config-view";

type ViewMode = "json" | "yaml" | "tree";

const yamlItems = [
  { value: "yaml", label: "YAML" },
  { value: "tree", label: "Tree" },
];

const jsonItems = [
  { value: "json", label: "JSON" },
  { value: "tree", label: "Tree" },
];

export function DataInspector({ value, yaml }: { value: unknown; yaml?: string }) {
  const hasYaml = yaml !== undefined;
  const [mode, setMode] = useState<ViewMode>(hasYaml ? "yaml" : "json");
  const items = hasYaml ? yamlItems : jsonItems;
  const activeMode = mode === (hasYaml ? "json" : "yaml") ? (hasYaml ? "yaml" : "json") : mode;

  return (
    <Box borderWidth="1px" borderRadius="md" overflow="hidden">
      <Box px="2" py="1.5">
        <SegmentGroup.Root
          size="xs"
          value={activeMode}
          onValueChange={(details) => setMode(details.value as ViewMode)}
          css={{
            "& [data-part='indicator']": { bg: "bg.panel", shadow: "sm" },
            "& [data-part='item'][data-state='checked']": {
              color: "brand.fg",
              fontWeight: "medium",
            },
          }}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items items={items} />
        </SegmentGroup.Root>
      </Box>

      {/* Keep both views mounted: hiding a pane avoids re-highlighting it. */}
      {hasYaml && (
        <Box display={activeMode === "yaml" ? "block" : "none"}>
          <ConfigView value={yaml} framed={false} />
        </Box>
      )}
      {!hasYaml && (
        <Box display={activeMode === "json" ? "block" : "none"}>
          <ConfigView value={value} framed={false} />
        </Box>
      )}
      <Box display={activeMode === "tree" ? "block" : "none"}>
        <ConfigTreeView value={value} framed={false} />
      </Box>
    </Box>
  );
}
