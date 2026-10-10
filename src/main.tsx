import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Flex,
  Spin,
  Tag,
  Typography,
} from "antd";
import "antd/dist/reset.css";
import { hello } from "./api";
import "./style.css";

function App() {
  const [greeting, setGreeting] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function loadGreeting() {
    setLoading(true);
    setError(undefined);

    try {
      setGreeting(await hello());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGreeting();
  }, []);

  return (
    <ConfigProvider>
      <main className="app-shell">
        <div className="app-layout">
          <header className="topbar">
            <a className="brand" href="#" aria-label="Velina home">
              <span className="brand-mark">V</span>
              <span>velina</span>
            </a>
            <Tag color="blue">LOCAL INSTANCE</Tag>
          </header>

          <section className="welcome" aria-labelledby="welcome-title">
            <Typography.Text className="eyebrow">
              YOUR MONOREPO COMMAND CENTER
            </Typography.Text>
            <Typography.Title id="welcome-title" level={1}>
              Keep your stack in sync.
            </Typography.Title>
            <Typography.Paragraph className="intro">
              Run your services side by side, keep their output close, and spend
              less time juggling terminal tabs.
            </Typography.Paragraph>

            <Card className="rpc-card" bordered={false}>
              <Flex justify="space-between" align="center" gap={16}>
                <div>
                  <Typography.Text strong>Connection check</Typography.Text>
                  <Typography.Paragraph className="card-description">
                    A quick hello from the Velina API.
                  </Typography.Paragraph>
                </div>
                <Tag color="purple">CAP’N WEB RPC</Tag>
              </Flex>

              <div className="rpc-result" role="status" aria-live="polite">
                {loading ? (
                  <Flex align="center" gap={10}>
                    <Spin size="small" />
                    <Typography.Text type="secondary">
                      Connecting to the API…
                    </Typography.Text>
                  </Flex>
                ) : error ? (
                  <Alert
                    type="error"
                    showIcon
                    message="Could not reach the API"
                    description={error}
                  />
                ) : (
                  <Typography.Title level={3} className="greeting">
                    {greeting}
                  </Typography.Title>
                )}
              </div>

              <Button
                type="primary"
                loading={loading}
                onClick={() => void loadGreeting()}
              >
                Try the connection again
              </Button>
            </Card>

            <Typography.Text className="footnote">
              A small first step toward a more peaceful development workflow.
            </Typography.Text>
          </section>
        </div>
      </main>
    </ConfigProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found");
}

createRoot(rootElement).render(<App />);
