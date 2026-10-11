import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  ConfigProvider,
  Descriptions,
  Empty,
  Layout,
  Menu,
  Popconfirm,
  Row,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  type TreeDataNode,
} from "antd";
import {
  HashRouter as Router,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { newWebSocketRpcSession } from "capnweb";
import type { VelinaApi } from "#/velina";
import type {
  RunEnvironmentEntry,
  RunEvent,
  RunSnapshot,
  RunStatus,
  RunSummary,
} from "#/run-manager";
import useSWR from "swr";

const api = newWebSocketRpcSession<VelinaApi>("/api");
const MAX_LOG_CHARS = 256 * 1024;

function DashboardLayout() {
  const navigate = useNavigate();
  return (
    <Layout>
      <Layout.Header>
        <Menu
          mode="horizontal"
          items={[
            { key: "/apps", label: "Apps" },
            { key: "/runs", label: "Runs" },
            { key: "/config", label: "Config" },
          ]}
          onClick={({ key }) => {
            navigate(key)
          }}
        />
      </Layout.Header>
      <Layout.Content>
        <Outlet />
      </Layout.Content>
      <Layout.Footer>Velina</Layout.Footer>
    </Layout>
  );
}

function AppsPage() {
  const { data, error, isLoading } = useSWR("config", () => api.getConfig());
  const { data: runs = [] } = useSWR<RunSummary[]>("runs", () => api.getRuns(), {
    refreshInterval: 1000,
  });
  const navigate = useNavigate();
  const [startingScripts, setStartingScripts] = useState<Set<string>>(new Set());
  const [runError, setRunError] = useState<string | null>(null);

  async function startScript(appIndex: number, scriptName: string) {
    const key = `${appIndex}:${scriptName}`;
    setStartingScripts((current) => new Set(current).add(key));
    setRunError(null);

    try {
      const run = await api.startRun(appIndex, scriptName);
      navigate("/runs", { state: { runId: run.id } });
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStartingScripts((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Couldn't load apps"
        description={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  const apps = data?.resolved.apps ?? [];

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>Apps</Typography.Title>
          <Typography.Text type="secondary">
            Choose an app, then run one of its configured scripts.
          </Typography.Text>
        </div>
        <Tag color="blue">{apps.length} APPS</Tag>
      </div>

      {runError && (
        <Alert
          type="error"
          showIcon
          closable
          message="Couldn't start the script"
          description={runError}
          onClose={() => setRunError(null)}
        />
      )}

      {apps.length === 0 ? (
        <Empty description="No apps were found in the Velina configuration." />
      ) : (
        <Tabs
          items={apps.map((app, appIndex) => ({
            key: String(appIndex),
            label: app.name,
            children: (
              <div className="app-script-panel">
                <Typography.Text className="app-path" code>
                  {app.path}
                </Typography.Text>
                {Object.keys(app.scripts).length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No scripts are configured for this app."
                  />
                ) : (
                  <div className="script-list">
                    {Object.entries(app.scripts).map(([scriptName, script]) => {
                      const key = `${appIndex}:${scriptName}`;
                      const activeRun = runs.find(
                        (run) =>
                          run.appIndex === appIndex &&
                          run.scriptName === scriptName &&
                          isRunActive(run.status),
                      );
                      return (
                        <Card
                          key={scriptName}
                          size="small"
                          className="script-card"
                          title={
                            <Space>
                              <Typography.Text code>{scriptName}</Typography.Text>
                              <Tag color={script.type === "package-script" ? "blue" : "default"}>
                                {script.type === "package-script" ? "package script" : "command"}
                              </Tag>
                            </Space>
                          }
                          extra={
                            activeRun ? (
                              <Space>
                                <Tag color={statusColor(activeRun.status)}>{activeRun.status}</Tag>
                                <Button
                                  onClick={() =>
                                    navigate("/runs", { state: { runId: activeRun.id } })
                                  }
                                >
                                  View run
                                </Button>
                              </Space>
                            ) : (
                              <Button
                                type="primary"
                                loading={startingScripts.has(key)}
                                onClick={() => void startScript(appIndex, scriptName)}
                              >
                                Run
                              </Button>
                            )
                          }
                        >
                          <Typography.Text className="script-command" code>
                            {script.value}
                          </Typography.Text>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}

function isRunActive(status: RunStatus) {
  return status === "starting" || status === "running" || status === "stopping";
}

function isRunFinished(status: RunStatus) {
  return status === "succeeded" || status === "failed" || status === "stopped";
}

function statusColor(status: RunStatus) {
  switch (status) {
    case "running":
      return "green";
    case "starting":
    case "stopping":
      return "gold";
    case "succeeded":
      return "blue";
    case "failed":
      return "red";
    case "stopped":
      return "default";
  }
}

function RunDetails({
  run,
  onStop,
  onClean,
  onRestart,
  hasActiveDuplicate,
  isBusy,
}: {
  run: RunSummary;
  onStop: (runId: string) => void;
  onClean: (runId: string) => void;
  onRestart: (run: RunSummary) => void;
  hasActiveDuplicate: boolean;
  isBusy: boolean;
}) {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showSystemVariables, setShowSystemVariables] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<RunEvent> | undefined;
    setSnapshot(null);
    setStreamError(null);

    async function readEvents() {
      try {
        const stream = await api.watchRun(run.id);
        if (cancelled) {
          await stream.cancel();
          return;
        }

        reader = stream.getReader();
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value.type === "snapshot") {
            setSnapshot(value.run);
          } else if (value.type === "status") {
            setSnapshot((current) => current ? { ...current, ...value.run } : current);
          } else {
            setSnapshot((current) => {
              if (!current) return current;
              const next = `${current[value.stream]}${value.chunk}`;
              const truncated = next.length > MAX_LOG_CHARS;
              return {
                ...current,
                [value.stream]: truncated ? next.slice(-MAX_LOG_CHARS) : next,
                [value.stream === "stdout" ? "stdoutTruncated" : "stderrTruncated"]:
                  value.truncated || truncated,
              };
            });
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setStreamError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    void readEvents();
    return () => {
      cancelled = true;
      void reader?.cancel();
    };
  }, [run.id]);

  const details = snapshot;
  const runStatus = details?.status ?? run.status;
  const finished = isRunFinished(runStatus);
  const environment = details?.environment ?? [];
  const visibleEnvironment = environment.filter(
    (entry) => showSystemVariables || entry.source !== "process.env",
  );

  return (
    <Card
      className="run-detail-card"
      title={
        <Space wrap>
          <Typography.Text strong>{run.appName}</Typography.Text>
          <Typography.Text type="secondary">/</Typography.Text>
          <Typography.Text code>{run.scriptName}</Typography.Text>
          <Tag color={statusColor(runStatus)}>{runStatus}</Tag>
        </Space>
      }
      extra={
        <Space>
          {finished && !hasActiveDuplicate && (
            <Button type="primary" loading={isBusy} onClick={() => onRestart(run)}>
              Restart
            </Button>
          )}
          {finished ? (
            <Popconfirm
              title="Remove this run and its buffered output?"
              onConfirm={() => onClean(run.id)}
            >
              <Button danger type="text" loading={isBusy}>Remove</Button>
            </Popconfirm>
          ) : (
            <Button
              danger
              loading={isBusy || runStatus === "stopping"}
              disabled={runStatus === "stopping"}
              onClick={() => onStop(run.id)}
            >
              Stop
            </Button>
          )}
        </Space>
      }
    >
      {details ? (
        <>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              { key: "pid", label: "PID", children: details.pid ?? "—" },
              { key: "cwd", label: "Working directory", children: <Typography.Text code>{details.cwd}</Typography.Text> },
              { key: "started", label: "Started", children: new Date(details.startedAt).toLocaleString() },
              { key: "exit", label: "Exit code", children: details.exitCode ?? (finished ? "—" : "Running") },
            ]}
          />
          {details.error && <Alert type="error" showIcon message={details.error} />}
          {streamError && <Alert type="error" showIcon message="Log stream disconnected" description={streamError} />}

          <Tabs
            className="run-output-tabs"
            items={[
              {
                key: "stdout",
                label: "stdout",
                children: (
                  <RunOutput
                    text={details.stdout}
                    empty="No standard output yet."
                    truncated={details.stdoutTruncated}
                  />
                ),
              },
              {
                key: "stderr",
                label: "stderr",
                children: (
                  <RunOutput
                    text={details.stderr}
                    empty="No standard error output."
                    truncated={details.stderrTruncated}
                  />
                ),
              },
              {
                key: "environment",
                label: `Environment (${visibleEnvironment.length}/${environment.length})`,
                children: (
                  <div className="run-environment">
                    <div className="run-environment-toggle">
                      <Typography.Text type="secondary">
                        Show inherited process.env variables
                      </Typography.Text>
                      <Switch
                        checked={showSystemVariables}
                        onChange={setShowSystemVariables}
                        aria-label="Show inherited process environment variables"
                      />
                    </div>
                    <Table<RunEnvironmentEntry>
                      size="small"
                      rowKey="name"
                      pagination={false}
                      scroll={{ y: 360 }}
                      dataSource={visibleEnvironment}
                      columns={[
                        {
                          title: "Variable",
                          dataIndex: "name",
                          key: "name",
                          render: (name: string) => <Typography.Text code>{name}</Typography.Text>,
                        },
                        { title: "Value", dataIndex: "value", key: "value" },
                        {
                          title: "Source",
                          dataIndex: "source",
                          key: "source",
                          render: (source: RunEnvironmentEntry["source"]) => (
                            <Tag color={source === "app.env" ? "purple" : source === "config.env" ? "blue" : "default"}>
                              {source}
                            </Tag>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : (
        <Skeleton active paragraph={{ rows: 5 }} />
      )}
    </Card>
  );
}

function RunOutput({
  text,
  empty,
  truncated,
}: {
  text: string;
  empty: string;
  truncated: boolean;
}) {
  return (
    <div className="run-output-container">
      {truncated && (
        <Alert
          className="run-output-truncated"
          type="warning"
          showIcon
          message="Older output was discarded to limit memory use."
        />
      )}
      <pre className="run-output">{text || empty}</pre>
    </div>
  );
}

function RunsPage() {
  const {
    data: runs = [],
    error,
    isLoading,
    mutate,
  } = useSWR<RunSummary[]>("runs", () => api.getRuns(), { refreshInterval: 1000 });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationRunId = (location.state as { runId?: string } | null)?.runId;
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ??
    runs.find((run) => run.id === navigationRunId) ??
    runs[0];
  const finishedCount = runs.filter((run) =>
    run.status === "succeeded" || run.status === "failed" || run.status === "stopped",
  ).length;

  async function stopRun(runId: string) {
    setBusyRunId(runId);
    setActionError(null);
    try {
      await api.stopRun(runId);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRunId(null);
    }
  }

  async function cleanRun(runId: string) {
    setBusyRunId(runId);
    setActionError(null);
    try {
      await api.cleanRun(runId);
      if (selectedRunId === runId) setSelectedRunId(null);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRunId(null);
    }
  }

  async function cleanFinishedRuns() {
    setBusyRunId("all");
    setActionError(null);
    try {
      await api.cleanFinishedRuns();
      setSelectedRunId(null);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRunId(null);
    }
  }

  async function restartRun(run: RunSummary) {
    setBusyRunId(run.id);
    setActionError(null);
    try {
      const restarted = await api.startRun(run.appIndex, run.scriptName);
      setSelectedRunId(restarted.id);
      navigate("/runs", { state: { runId: restarted.id } });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRunId(null);
    }
  }

  const hasActiveDuplicate = selectedRun
    ? runs.some(
        (run) =>
          run.id !== selectedRun.id &&
          run.appIndex === selectedRun.appIndex &&
          run.scriptName === selectedRun.scriptName &&
          isRunActive(run.status),
      )
    : false;

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Couldn't load runs"
        description={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>Runs</Typography.Title>
          <Typography.Text type="secondary">
            Watch output, inspect the environment, and stop running processes.
          </Typography.Text>
        </div>
        <Popconfirm
          title={`Remove ${finishedCount} finished ${finishedCount === 1 ? "run" : "runs"}?`}
          description="This also clears their buffered output."
          onConfirm={() => void cleanFinishedRuns()}
          disabled={finishedCount === 0}
        >
          <Button danger disabled={finishedCount === 0} loading={busyRunId === "all"}>
            Clear finished ({finishedCount})
          </Button>
        </Popconfirm>
      </div>

      {actionError && (
        <Alert
          type="error"
          showIcon
          closable
          message={actionError}
          onClose={() => setActionError(null)}
        />
      )}

      {runs.length === 0 ? (
        <Empty description="No runs yet. Start a script from Apps." />
      ) : (
        <div className="runs-layout">
          <Card title={`Run history (${runs.length})`} className="run-list-card">
            <div className="run-list">
              {runs.map((run) => (
                <Card
                  key={run.id}
                  size="small"
                  hoverable
                  className={`run-list-item ${selectedRun?.id === run.id ? "selected" : ""}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className="run-list-heading">
                    <Typography.Text strong>{run.appName}</Typography.Text>
                    <Tag color={statusColor(run.status)}>{run.status}</Tag>
                  </div>
                  <Typography.Text code>{run.scriptName}</Typography.Text>
                  <Typography.Text className="run-list-time" type="secondary">
                    {new Date(run.startedAt).toLocaleTimeString()}
                  </Typography.Text>
                  {run.status === "succeeded" || run.status === "failed" || run.status === "stopped" ? (
                    <Popconfirm
                      title="Remove this run?"
                      description="Its buffered output will be cleared."
                      onConfirm={(event) => {
                        event?.stopPropagation();
                        void cleanRun(run.id);
                      }}
                    >
                      <Button
                        className="run-list-remove"
                        type="text"
                        danger
                        size="small"
                        loading={busyRunId === run.id}
                        onClick={(event) => event.stopPropagation()}
                      >
                        Remove
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Card>
              ))}
            </div>
          </Card>

          {selectedRun ? (
            <RunDetails
              key={selectedRun.id}
              run={selectedRun}
              onStop={(runId) => void stopRun(runId)}
              onClean={(runId) => void cleanRun(runId)}
              onRestart={(run) => void restartRun(run)}
              hasActiveDuplicate={hasActiveDuplicate}
              isBusy={busyRunId === selectedRun.id}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function createJsonTree(value: unknown, label: string, path: string): TreeDataNode {
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item, `${path}.${index}`] as const)
    : value !== null && typeof value === "object"
      ? Object.entries(value).map(([key, item]) => [key, item, `${path}.${encodeURIComponent(key)}`] as const)
      : [];
  const isContainer = value !== null && typeof value === "object";
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  return {
    key: path,
    title: (
      <span className="json-tree-title">
        <Typography.Text className="json-tree-key">{label}</Typography.Text>
        <Tag className="json-tree-type" color={isContainer ? "blue" : "default"}>
          {type}
        </Tag>
        {isContainer ? (
          null
        ) : (
          <Typography.Text className={`json-tree-value json-tree-value-${type}`}>
            {typeof value === "string" ? JSON.stringify(value) : String(value)}
          </Typography.Text>
        )}
      </span>
    ),
    children: entries.map(([childLabel, childValue, childPath]) =>
      createJsonTree(childValue, childLabel, childPath),
    ),
  };
}

function ConfigPage() {
  const { data } = useSWR("config", () =>
    api.getConfig(),
  );

  if (!data) {
    return <Empty description="No configuration data is available." />;
  }

  const items = [
    {
      key: 'resolved',
      label: 'Resolved configuration',
      children: <>
        <Tree
          blockNode
          defaultExpandAll
          selectable={false}
          showLine
          treeData={[createJsonTree(data.resolved, "config", "config")]}
        />
      </>,
    },
    {
      key: 'configFile',
      label: 'Configuration file',
      children: <>
      <div>
        cwd: {data.cwd}
      </div>
      <div>
        path: {data.path}
      </div>
      {data.partial ?
        <Tree
          blockNode
          defaultExpandAll
          selectable={false}
          showLine
          treeData={[createJsonTree(data.partial, "config", "config")]}
        /> : 'Configuration file not found'}
      </>,
    },
  ]

  return (
    <div style={{ padding: '1rem' }}>
      <Tabs items={items} />
    </div>
  );
}

function App() {
  return (
    <ConfigProvider>
      <Router>
        <Routes>
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<Navigate to="/apps" replace />} />
            <Route path="apps" element={<AppsPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="*" element={<Navigate to="/apps" replace />} />
          </Route>
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
