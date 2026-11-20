import { Badge, Box, Button, Flex, Grid, Heading, HStack, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import { FiPlay, FiTerminal } from "react-icons/fi";
import { useSearchParams } from "react-router";

import type { LogType } from "../../../lib/api";
import { LogViewer } from "../components/log-viewer";
import { useConfig, useProcessLogs, useProcesses } from "../lib/hooks";
import { useVelina } from "../lib/velina-context";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TasksPage() {
  const { api } = useVelina();
  const { config, error: configError } = useConfig();
  const { processes, refresh, error: processError } = useProcesses();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [logType, setLogType] = useState<LogType>("stdout");

  const tasks = config?.resolved.tasks ?? {};
  const names = Object.keys(tasks).sort();
  const requestedName = searchParams.get("task");
  const selectedName = requestedName && requestedName in tasks ? requestedName : names[0];
  const selectedTask = selectedName ? tasks[selectedName] : undefined;

  const runningProcess = processes.find(
    (process) => process.taskName === selectedName && process.state === "running",
  );
  const { lines, error: logError } = useProcessLogs(runningProcess?.id ?? null, logType);

  async function start(name: string) {
    try {
      setActionError(null);
      await Promise.resolve(api.startTask(name));
      await refresh();
    } catch (cause) {
      setActionError(describe(cause));
    }
  }

  return (
    <Box>
      <Heading size="lg" mb="4">
        Tasks
      </Heading>

      {(configError || processError || actionError) && (
        <Box color="red.500" mb="4">
          {configError ?? processError ?? actionError}
        </Box>
      )}

      <Grid templateColumns={{ base: "1fr", lg: "minmax(280px, 1fr) 2fr" }} gap="6">
        <Box>
          <Table.Root size="sm" interactive>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Task</Table.ColumnHeader>
                <Table.ColumnHeader>State</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {names.map((name) => {
                const isRunning = processes.some(
                  (process) => process.taskName === name && process.state === "running",
                );
                return (
                  <Table.Row key={name}>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearchParams({ task: name })}
                      >
                        {name}
                      </Button>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge colorPalette={isRunning ? "green" : "gray"}>
                        {isRunning ? "running" : "idle"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Button size="xs" disabled={isRunning} onClick={() => void start(name)}>
                        <HStack as="span" gap="1">
                          <FiPlay aria-hidden="true" />
                          Start
                        </HStack>
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          {names.length === 0 && <Text mt="2">No tasks available.</Text>}
        </Box>

        <Box minW="0">
          {selectedName && selectedTask ? (
            <>
              <Flex align="center" gap="3" mb="3">
                <Heading size="md">{selectedName}</Heading>
                <Badge colorPalette={runningProcess ? "green" : "gray"}>
                  {runningProcess ? "running" : "idle"}
                </Badge>
                <Button
                  size="sm"
                  disabled={Boolean(runningProcess)}
                  onClick={() => void start(selectedName)}
                >
                  <HStack as="span" gap="1">
                    <FiPlay aria-hidden="true" />
                    Start
                  </HStack>
                </Button>
              </Flex>

              <Text mb="1">
                Command: {selectedTask.cmd} {selectedTask.args.join(" ")}
              </Text>
              <Text mb="1">Working directory: {selectedTask.cwd}</Text>
              <Text mb="4">Process ID: {runningProcess?.id ?? "none"}</Text>
              <Text mb="4">Files to write: {selectedTask.files.length}</Text>

              <Heading size="sm" mt="4" mb="2" display="flex" alignItems="center" gap="2">
                <FiTerminal aria-hidden="true" />
                Logs
              </Heading>
              {runningProcess ? (
                <LogViewer
                  lines={lines}
                  error={logError}
                  type={logType}
                  onTypeChange={setLogType}
                />
              ) : (
                <Text color="fg.muted">Start this task to see its logs.</Text>
              )}
            </>
          ) : (
            <Text color="fg.muted">Select a task to see its details.</Text>
          )}
        </Box>
      </Grid>
    </Box>
  );
}
