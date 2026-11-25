import { Badge, Box, Button, Flex, Grid, Heading, HStack, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import { FiPlay, FiSquare, FiTerminal } from "react-icons/fi";
import { useSearchParams } from "react-router";

import type { LogType } from "../../../lib/api";
import { LogViewer } from "../components/log-viewer";
import { useConfig, useProcessLogs, useProcesses } from "../lib/hooks";
import { useVelina } from "../lib/velina-context";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TaskGroupsPage() {
  const { api } = useVelina();
  const { config, error: configError } = useConfig();
  const { processes, refresh, error: processError } = useProcesses();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logType, setLogType] = useState<LogType>("stdout");

  const groups = config?.resolved.taskGroup ?? {};
  const groupNames = Object.keys(groups).sort();
  const requestedName = searchParams.get("group");
  const selectedName = requestedName && requestedName in groups ? requestedName : groupNames[0];
  const members = selectedName ? groups[selectedName] : [];

  const runningFor = (name: string) =>
    processes.find((process) => process.taskName === name && process.state === "running");
  const chosenTaskName =
    selectedTaskName && members.includes(selectedTaskName) ? selectedTaskName : members[0];
  const runningProcess = chosenTaskName ? runningFor(chosenTaskName) : undefined;
  const { lines, error: logError } = useProcessLogs(runningProcess?.id ?? null, logType);

  async function act(action: () => Promise<unknown>) {
    try {
      setActionError(null);
      await action();
      await refresh();
    } catch (cause) {
      setActionError(describe(cause));
    }
  }

  const start = (name: string) => act(() => api.startTaskGroup(name));
  const stop = (name: string) => act(() => api.stopTaskGroup(name));

  return (
    <Box>
      <Heading size="lg" mb="4">
        Task Groups
      </Heading>

      {(configError || processError || actionError) && (
        <Box color="fg.error" mb="4">
          {configError ?? processError ?? actionError}
        </Box>
      )}

      <Grid templateColumns={{ base: "1fr", lg: "minmax(320px, 1fr) 2fr" }} gap="6">
        <Box>
          <Table.Root size="sm" interactive>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Group</Table.ColumnHeader>
                <Table.ColumnHeader>Tasks</Table.ColumnHeader>
                <Table.ColumnHeader>State</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groupNames.map((name) => {
                const groupTasks = groups[name];
                const runningCount = groupTasks.filter((taskName) => runningFor(taskName)).length;
                const allRunning = runningCount === groupTasks.length;
                return (
                  <Table.Row key={name}>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearchParams({ group: name })}
                      >
                        {name}
                      </Button>
                    </Table.Cell>
                    <Table.Cell>{groupTasks.length}</Table.Cell>
                    <Table.Cell>
                      <Badge
                        colorPalette={runningCount === 0 ? "gray" : allRunning ? "brand" : "orange"}
                      >
                        {runningCount === 0 ? "idle" : allRunning ? "running" : "partial"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex gap="1">
                        <Button
                          size="xs"
                          colorPalette="brand"
                          disabled={allRunning}
                          onClick={() => void start(name)}
                        >
                          <HStack as="span" gap="1">
                            <FiPlay aria-hidden="true" />
                            Start
                          </HStack>
                        </Button>
                        <Button
                          size="xs"
                          colorPalette="orange"
                          variant="outline"
                          disabled={runningCount === 0}
                          onClick={() => void stop(name)}
                        >
                          <HStack as="span" gap="1">
                            <FiSquare aria-hidden="true" />
                            Stop
                          </HStack>
                        </Button>
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          {groupNames.length === 0 && <Text mt="2">No task groups available.</Text>}
        </Box>

        <Box minW="0">
          {selectedName ? (
            <>
              <Heading size="md" mb="3">
                {selectedName}
              </Heading>

              <Table.Root size="sm" mb="4">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Task</Table.ColumnHeader>
                    <Table.ColumnHeader>State</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {members.map((taskName) => {
                    const process = runningFor(taskName);
                    return (
                      <Table.Row key={taskName}>
                        <Table.Cell>{taskName}</Table.Cell>
                        <Table.Cell>
                          <Badge colorPalette={process ? "brand" : "gray"}>
                            {process ? "running" : "idle"}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!process}
                            onClick={() => setSelectedTaskName(taskName)}
                          >
                            Logs
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>

              <Heading size="sm" mb="2" display="flex" alignItems="center" gap="2">
                <FiTerminal aria-hidden="true" />
                Logs
                {chosenTaskName ? ` — ${chosenTaskName}` : ""}
              </Heading>
              {runningProcess ? (
                <LogViewer
                  lines={lines}
                  error={logError}
                  type={logType}
                  onTypeChange={setLogType}
                />
              ) : (
                <Text color="fg.muted">Start a task to see its logs.</Text>
              )}
            </>
          ) : (
            <Text color="fg.muted">Select a group to see its tasks.</Text>
          )}
        </Box>
      </Grid>
    </Box>
  );
}
