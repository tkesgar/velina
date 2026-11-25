import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Table,
  Text,
  VisuallyHidden,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  FiActivity,
  FiArrowDown,
  FiArrowUp,
  FiChevronRight,
  FiList,
  FiRefreshCw,
  FiSquare,
  FiTerminal,
  FiTrash2,
} from "react-icons/fi";
import { useSearchParams } from "react-router";

import type { LogType, ProcessInfo } from "../../../lib/api";
import { DataInspector } from "../components/data-inspector";
import { LogViewer } from "../components/log-viewer";
import { Sparkline } from "../components/sparkline";
import { useHostMetrics, useProcessLogs, useProcessMetrics, useProcesses } from "../lib/hooks";
import { useVelina } from "../lib/velina-context";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
  const { metrics, error: metricsError } = useProcessMetrics(selected?.id ?? null);
  const { metrics: hostMetrics } = useHostMetrics();

  const stopped = processes.filter((process) => process.state === "stopped");
  const cleanup = () => Promise.all(stopped.map((process) => api.deleteProcess(process.id)));

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
        <Box color="fg.error" mb="4">
          {processError ?? actionError}
        </Box>
      )}

      <HStack alignItems="start" gap="6" flexDirection={{ base: "column", lg: "row" }}>
        <Box minW="0" flex="none" w="full" maxW={{ base: undefined, lg: "30rem" }}>
          <HStack justify="flex-end" mb="2" minH="6">
            {stopped.length > 0 && (
              <Button
                size="xs"
                colorPalette="red"
                variant="outline"
                onClick={() => void run(cleanup)}
              >
                <HStack as="span" gap="1">
                  <FiTrash2 aria-hidden="true" />
                  Clean up ({stopped.length})
                </HStack>
              </Button>
            )}
          </HStack>

          <Table.Root size="sm" interactive>
            <Table.ColumnGroup>
              <Table.Column htmlWidth="8rem" />
              <Table.Column />
              <Table.Column htmlWidth="5rem" />
              <Table.Column htmlWidth="5rem" />
              <Table.Column htmlWidth="7rem" />
            </Table.ColumnGroup>
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
              {processes.map((process) => {
                const isSelected = process.id === selected?.id;
                const taskRunningElsewhere = processes.some(
                  (candidate) =>
                    candidate.taskName === process.taskName &&
                    candidate.state === "running" &&
                    candidate.id !== process.id,
                );
                return (
                  <Table.Row
                    key={process.id}
                    aria-selected={isSelected}
                    bg={isSelected ? "brand.subtle" : undefined}
                    cursor="pointer"
                    onClick={() => setSearchParams({ process: process.id })}
                  >
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Select process ${process.id}`}
                        title={`Select process ${process.id.slice(0, 8)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSearchParams({ process: process.id });
                        }}
                      >
                        <HStack as="span" gap="1" fontFamily="mono">
                          <FiChevronRight aria-hidden="true" />
                          {process.id.slice(0, 8)}
                        </HStack>
                      </Button>
                    </Table.Cell>
                    <Table.Cell>{process.taskName}</Table.Cell>
                    <Table.Cell>
                      <Badge colorPalette={process.state === "running" ? "brand" : "gray"}>
                        {process.state}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{process.exitCode ?? "—"}</Table.Cell>
                    <Table.Cell>
                      <Flex gap="1">
                        {process.state === "running" && (
                          <Button
                            size="xs"
                            colorPalette="orange"
                            variant="outline"
                            title="Stop process"
                            onClick={(event) => {
                              event.stopPropagation();
                              void run(() => api.stopProcess(process.id));
                            }}
                          >
                            <HStack as="span" gap="1">
                              <FiSquare aria-hidden="true" />
                              <VisuallyHidden>Stop</VisuallyHidden>
                            </HStack>
                          </Button>
                        )}
                        {!(process.state === "stopped" && taskRunningElsewhere) && (
                          <Button
                            size="xs"
                            colorPalette="brand"
                            title="Restart task"
                            onClick={(event) => {
                              event.stopPropagation();
                              void restart(process);
                            }}
                          >
                            <HStack as="span" gap="1">
                              <FiRefreshCw aria-hidden="true" />
                              <VisuallyHidden>Restart</VisuallyHidden>
                            </HStack>
                          </Button>
                        )}
                        {process.state === "stopped" && (
                          <Button
                            size="xs"
                            colorPalette="red"
                            variant="outline"
                            title="Clean up process"
                            onClick={(event) => {
                              event.stopPropagation();
                              void run(() => api.deleteProcess(process.id));
                            }}
                          >
                            <HStack as="span" gap="1">
                              <FiTrash2 aria-hidden="true" />
                              <VisuallyHidden>Clean up</VisuallyHidden>
                            </HStack>
                          </Button>
                        )}
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          {processes.length === 0 && <Text mt="2">No processes yet.</Text>}
        </Box>

        <Box minW="0" flex="auto">
          {selected ? (
            <>
              <Heading size="md" mb="3">
                {selected.taskName}
              </Heading>

              {/* Process metrics */}
              {selected.state === "running" && (
                <>
                  <Heading size="sm" mt="4" mb="2" display="flex" alignItems="center" gap="2">
                    <FiActivity aria-hidden="true" /> Metrics
                  </Heading>
                  {metricsError ? (
                    <Text color="fg.error" mb="4">
                      {metricsError}
                    </Text>
                  ) : metrics?.latest ? (
                    <Box mb="4">
                      <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="3" mb="3">
                        <Sparkline
                          label="CPU %"
                          value={
                            metrics.latest.cpuPercent === null
                              ? "—"
                              : `${metrics.latest.cpuPercent.toFixed(1)}%`
                          }
                          values={metrics.samples.map((sample) => sample.cpuPercent ?? 0)}
                          color="yellow.500"
                        />
                        <Sparkline
                          label="Memory"
                          value={formatBytes(metrics.latest.memoryBytes)}
                          values={metrics.samples.map((sample) => sample.memoryBytes)}
                          color="red.500"
                        />
                        <Sparkline
                          label="Disk read/s"
                          value={formatBytes(metrics.latest.diskReadBytesPerSecond)}
                          values={metrics.samples.map(
                            (sample) => sample.diskReadBytesPerSecond ?? 0,
                          )}
                          color="cyan.300"
                        />
                        <Sparkline
                          label="Disk write/s"
                          value={formatBytes(metrics.latest.diskWriteBytesPerSecond)}
                          values={metrics.samples.map(
                            (sample) => sample.diskWriteBytesPerSecond ?? 0,
                          )}
                          color="blue.600"
                        />
                      </Grid>

                      <Grid
                        templateColumns={{
                          base: "repeat(2, minmax(0, 1fr))",
                          lg: "repeat(4, minmax(0, 1fr))",
                        }}
                        gap="3"
                      >
                        <Box>
                          <Text fontSize="xs" color="fg.muted">
                            Threads
                          </Text>
                          <Text>{metrics.latest.threads ?? "—"}</Text>
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="fg.muted">
                            File descriptors
                          </Text>
                          <Text>{metrics.latest.openFiles ?? "—"}</Text>
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="fg.muted">
                            Children
                          </Text>
                          <Text>{metrics.latest.childProcesses}</Text>
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="fg.muted">
                            Host network
                          </Text>
                          <HStack gap="1" fontSize="xs">
                            <FiArrowDown aria-hidden="true" />
                            <Text>
                              {formatBytes(hostMetrics?.latest?.rxBytesPerSecond ?? null)}/s
                            </Text>
                          </HStack>
                          <HStack gap="1" fontSize="xs">
                            <FiArrowUp aria-hidden="true" />
                            <Text>
                              {formatBytes(hostMetrics?.latest?.txBytesPerSecond ?? null)}/s
                            </Text>
                          </HStack>
                        </Box>
                      </Grid>
                    </Box>
                  ) : (
                    <Text color="fg.muted" mb="4">
                      {metrics?.supported === false
                        ? "Metrics are unavailable on this platform."
                        : "Collecting metrics…"}
                    </Text>
                  )}
                </>
              )}

              {/* Process logs */}
              <Heading size="sm" mt="4" mb="2" display="flex" alignItems="center" gap="2">
                <FiTerminal aria-hidden="true" />
                Logs
              </Heading>
              <LogViewer
                lines={lines}
                error={logError}
                type={logType}
                onTypeChange={setLogType}
                height="80vh"
              />

              {/* Process information */}
              <Heading size="sm" mt="4" mb="2" display="flex" alignItems="center" gap="2">
                <FiList aria-hidden="true" />
                Details
              </Heading>
              <DataInspector value={selected} />
            </>
          ) : (
            <Text color="fg.muted">Select a process to see its details.</Text>
          )}
        </Box>
      </HStack>
    </Box>
  );
}
