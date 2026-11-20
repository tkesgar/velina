import { Badge, Box, Button, Flex, Grid, Heading, HStack, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import { FiChevronRight, FiRefreshCw, FiTerminal, FiTrash2 } from "react-icons/fi";
import { useSearchParams } from "react-router";

import type { LogType, ProcessInfo } from "../../../lib/api";
import { ConfigView } from "../components/config-view";
import { LogViewer } from "../components/log-viewer";
import { useProcessLogs, useProcesses } from "../lib/hooks";
import { useVelina } from "../lib/velina-context";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProcessesPage() {
  const { api } = useVelina();
  const { processes, refresh, error: processError } = useProcesses();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [logType, setLogType] = useState<LogType>("stdout");

  const requestedId = searchParams.get("process");
  const selected = processes.find((process) => process.id === requestedId) ?? processes[0];
  const { lines, error: logError } = useProcessLogs(selected?.id ?? null, logType);

  async function run(action: () => Promise<unknown>) {
    try {
      setActionError(null);
      await action();
      await refresh();
    } catch (cause) {
      setActionError(describe(cause));
    }
  }

  function restart(process: ProcessInfo) {
    if (process.state === "running") {
      return run(async () => {
        await Promise.resolve(api.stopProcess(process.id));
        await Promise.resolve(api.startTask(process.taskName));
      });
    }

    return run(async () => {
      const running = processes.some(
        (candidate) => candidate.taskName === process.taskName && candidate.state === "running",
      );
      if (running) {
        throw new Error(`Task "${process.taskName}" already has a running process`);
      }
      await Promise.resolve(api.startTask(process.taskName));
    });
  }

  return (
    <Box>
      <Heading size="lg" mb="4">
        Processes
      </Heading>

      {(processError || actionError) && (
        <Box color="red.500" mb="4">
          {processError ?? actionError}
        </Box>
      )}

      <Grid templateColumns={{ base: "1fr", lg: "minmax(360px, 3fr) 2fr" }} gap="6">
        <Box minW="0">
          <Table.Root size="sm" interactive>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Process</Table.ColumnHeader>
                <Table.ColumnHeader>Task</Table.ColumnHeader>
                <Table.ColumnHeader>State</Table.ColumnHeader>
                <Table.ColumnHeader>Exit</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {processes.map((process) => (
                <Table.Row key={process.id}>
                  <Table.Cell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearchParams({ process: process.id })}
                    >
                      <HStack as="span" gap="1">
                        <FiChevronRight aria-hidden="true" />
                        {process.id.slice(0, 8)}
                      </HStack>
                    </Button>
                  </Table.Cell>
                  <Table.Cell>{process.taskName}</Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={process.state === "running" ? "green" : "gray"}>
                      {process.state}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{process.exitCode ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="1">
                      <Button
                        size="xs"
                        disabled={
                          process.state === "stopped" &&
                          processes.some(
                            (candidate) =>
                              candidate.taskName === process.taskName &&
                              candidate.state === "running",
                          )
                        }
                        onClick={() => void restart(process)}
                      >
                        <HStack as="span" gap="1">
                          <FiRefreshCw aria-hidden="true" />
                          Restart
                        </HStack>
                      </Button>
                      <Button
                        size="xs"
                        colorPalette="red"
                        variant="outline"
                        disabled={process.state === "running"}
                        onClick={() => void run(() => api.deleteProcess(process.id))}
                      >
                        <HStack as="span" gap="1">
                          <FiTrash2 aria-hidden="true" />
                          Clean up
                        </HStack>
                      </Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          {processes.length === 0 && <Text mt="2">No processes yet.</Text>}
        </Box>

        <Box minW="0">
          {selected ? (
            <>
              <Heading size="md" mb="3">
                {selected.taskName}
              </Heading>
              <ConfigView value={selected} />

              <Heading size="sm" mt="4" mb="2" display="flex" alignItems="center" gap="2">
                <FiTerminal aria-hidden="true" />
                Logs
              </Heading>
              <LogViewer lines={lines} error={logError} type={logType} onTypeChange={setLogType} />
            </>
          ) : (
            <Text color="fg.muted">Select a process to see its details.</Text>
          )}
        </Box>
      </Grid>
    </Box>
  );
}
