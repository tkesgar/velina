import { JsonTreeView } from "@ark-ui/react/json-tree-view";
import { Box } from "@chakra-ui/react";
import { FiChevronDown } from "react-icons/fi";

const MAX_STRING_PREVIEW = 80;

export function ConfigTreeView({ value, framed = true }: { value: unknown; framed?: boolean }) {
  return (
    <Box
      maxH="70vh"
      overflow="auto"
      borderWidth={framed ? "1px" : undefined}
      borderRadius={framed ? "md" : undefined}
      fontSize="xs"
      fontFamily="mono"
      py="2"
      css={{
        "& [data-part='branch-control'], & [data-part='item']": {
          alignItems: "center",
          borderRadius: "sm",
          cursor: "pointer",
          display: "flex",
          gap: "1",
          minH: "6",
          pl: "calc(0.5rem + (var(--depth) - 1) * 1rem)",
          pr: "2",
          py: "0.5",
          whiteSpace: "nowrap",
          "&:hover": { bg: "gray.subtle" },
          "&[data-focus]": {
            boxShadow: "inset 0 0 0 2px var(--chakra-colors-brand-focus-ring)",
          },
          "&[data-selected]": { bg: "brand.muted" },
        },
        "& [data-part='branch-indicator']": {
          alignItems: "center",
          display: "inline-flex",
          flexShrink: 0,
          transition: "transform 120ms ease",
          "&[data-state='closed']": { transform: "rotate(-90deg)" },
        },
        "& [data-part='branch-indent-guide']": {
          borderLeft: "1px solid",
          borderColor: "border.subtle",
          ml: "4",
        },
        "& [data-part='branch-text'], & [data-part='item-text']": {
          alignItems: "center",
          display: "inline-flex",
          gap: "1",
          minW: "0",
        },
        "& [data-kind='key']": { color: "brand.fg" },
        "& [data-kind='colon']": { color: "fg.muted", mr: "1" },
        "& [data-type='string']": { color: "fg.success" },
        "& [data-type='number'], & [data-type='boolean']": { color: "fg.warning" },
        "& [data-type='null'], & [data-type='undefined']": { color: "fg.muted" },
      }}
    >
      <JsonTreeView.Root
        data={value}
        defaultExpandedDepth={1}
        collapseStringsAfterLength={MAX_STRING_PREVIEW}
        groupArraysAfterLength={100}
        maxPreviewItems={5}
      >
        <JsonTreeView.Tree
          arrow={<FiChevronDown aria-hidden="true" />}
          renderValue={(node) => {
            // Generated file contents can be enormous; keep their rows compact
            // while leaving the full value available on hover.
            if (node.type !== "text" || typeof node.value !== "string") return undefined;
            if (!node.value.startsWith('"') || node.value.length <= MAX_STRING_PREVIEW) {
              return undefined;
            }

            return (
              <Box as="span" data-type="string" title={node.value}>
                {node.value.slice(0, MAX_STRING_PREVIEW)}…&quot;
              </Box>
            );
          }}
        />
      </JsonTreeView.Root>
    </Box>
  );
}
