import { createRoot } from "react-dom/client";
import {
  ConfigProvider,
  Empty,
  Typography,
  Layout,
  Menu,
} from "antd";
import {
  HashRouter as Router,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router";

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

function App() {
  return (
    <ConfigProvider>
      <Router>
        <Routes>
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<Navigate to="/services" replace />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="*" element={<Navigate to="/services" replace />} />
          </Route>
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
