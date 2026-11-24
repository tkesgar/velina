import { Box, SegmentGroup } from "@chakra-ui/react";
import { useState } from "react";

import { ConfigTreeView } from "./config-tree-view";
import { ConfigView } from "./config-view";

type ViewMode = "yaml" | "tree";

const items = [
  { value: "yaml", label: "YAML" },
  { value: "tree", label: "Tree" },
];

export function ConfigInspector({ yaml, value }: { yaml: string; value: unknown }) {
  const [mode, setMode] = useState<ViewMode>("yaml");

  return (
    <Box borderWidth="1px" borderRadius="md" overflow="hidden">
      <Box px="2" py="1.5">
        <SegmentGroup.Root
          size="xs"
          value={mode}
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

      {/* Keep both views mounted: hiding the YAML pane avoids re-highlighting it. */}
      <Box display={mode === "yaml" ? "block" : "none"}>
        <ConfigView value={yaml} framed={false} />
      </Box>
      <Box display={mode === "tree" ? "block" : "none"}>
        <ConfigTreeView value={value} framed={false} />
      </Box>
    </Box>
  );
}
