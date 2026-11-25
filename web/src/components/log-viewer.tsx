import { Box, Button, Flex, HStack, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { FiAlertCircle, FiPause, FiPlay, FiTerminal } from "react-icons/fi";

import type { LogEntry, LogType } from "../../../lib/api";

interface LogViewerProps {
  lines: LogEntry[];
  error: string | null;
  type: LogType;
  onTypeChange: (type: LogType) => void;
  height?: string;
}

export function LogViewer({ lines, error, type, onTypeChange, height = "360px" }: LogViewerProps) {
  const [follow, setFollow] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow) return;
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [lines, follow]);

  return (
    <Box>
      <HStack gap="2" mb="2">
        {(["stdout", "stderr"] as const).map((candidate) => {
          const Icon = candidate === "stdout" ? FiTerminal : FiAlertCircle;
          return (
            <Button
              key={candidate}
              size="xs"
              variant={candidate === type ? "solid" : "outline"}
              onClick={() => onTypeChange(candidate)}
            >
              <HStack as="span" gap="1">
                <Icon aria-hidden="true" />
                {candidate}
              </HStack>
            </Button>
          );
        })}
        <Button size="xs" variant="ghost" onClick={() => setFollow((value) => !value)}>
          <HStack as="span" gap="1">
            {follow ? <FiPause aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
            {follow ? "Following" : "Paused"}
          </HStack>
        </Button>
      </HStack>

      <Box
        ref={containerRef}
        h={height}
        overflowY="auto"
        borderRadius="md"
        bg="bg.subtle"
        color="fg"
        p="3"
        fontFamily="mono"
        fontSize="xs"
        whiteSpace="pre-wrap"
      >
        {lines.map((entry, index) => (
          <Flex key={index} gap="2">
            <Text as="span" color="fg.muted">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </Text>
            <Text as="span">{entry.line}</Text>
          </Flex>
        ))}
        {error && <Text color="fg.error">{error}</Text>}
      </Box>
    </Box>
  );
}
