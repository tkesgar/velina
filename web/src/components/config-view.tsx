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

export function ConfigView({ value }: { value: unknown }) {
  const isYaml = typeof value === "string";
  const code = isYaml ? value : JSON.stringify(value, null, 2);

  return (
    <Box maxH="70vh" overflow="auto" borderWidth="1px" borderRadius="md" fontSize="xs">
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
