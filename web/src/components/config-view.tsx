import { Box } from "@chakra-ui/react";
import {
  ShikiHighlighter,
  createHighlighterCore,
  createJavaScriptRegexEngine,
} from "react-shiki/core";

const highlighter = await createHighlighterCore({
  themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
  langs: [import("@shikijs/langs/yaml"), import("@shikijs/langs/json")],
  engine: createJavaScriptRegexEngine(),
});

export function ConfigView({ value, framed = true }: { value: unknown; framed?: boolean }) {
  const isYaml = typeof value === "string";
  const code = isYaml ? value : JSON.stringify(value, null, 2);

  return (
    <Box
      maxH="70vh"
      overflow="auto"
      borderWidth={framed ? "1px" : undefined}
      borderRadius={framed ? "md" : undefined}
      fontSize="xs"
    >
      <ShikiHighlighter
        highlighter={highlighter}
        language={isYaml ? "yaml" : "json"}
        showLanguage={false}
        theme={{ light: "github-light", dark: "github-dark" }}
        defaultColor="light-dark()"
      >
        {code}
      </ShikiHighlighter>
    </Box>
  );
}
