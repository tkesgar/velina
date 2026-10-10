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
  Row,
  Skeleton,
  Space,
  Statistic,
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
  useNavigate,
} from "react-router";
import { newWebSocketRpcSession } from "capnweb";
import type { VelinaApi } from "#/velina";
import useSWR from "swr";

const api = newWebSocketRpcSession<VelinaApi>("/api");

function DashboardLayout() {
  const navigate = useNavigate();
  return (
    <Layout>
      <Layout.Header>
        <Menu
          mode="horizontal"
          items={[
            { key: "/services", label: "Services" },
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

function ServicesPage() {
  return (
    <div className="empty-state">
      <Empty
        description={<Typography.Text strong>No services yet</Typography.Text>}
      />
      <Typography.Text className="empty-hint" type="secondary">
        Configured services will appear here.
      </Typography.Text>
    </div>
  );
}

function RunsPage() {

  return (
    <div className="empty-state">
      <Empty
        description={<Typography.Text strong>No active runs</Typography.Text>}
      />
      <Typography.Text className="empty-hint" type="secondary">
        Processes you start will show up here.
      </Typography.Text>
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
            <Route index element={<Navigate to="/services" replace />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="*" element={<Navigate to="/services" replace />} />
          </Route>
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
