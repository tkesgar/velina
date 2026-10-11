/// <reference types="vite/client" />

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

interface Greeting {
  message: string;
  timestamp: string;
}

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:3011";

function App() {
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function callBackend() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(new URL("/api/hello", backendUrl));
      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }
      setGreeting(await response.json() as Greeting);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void callBackend();
  }, []);

  return (
    <main className="demo-page">
      <section className="demo-card">
        <p className="eyebrow">VELINA · TWO-APP SMOKE TEST</p>
        <h1>Frontend is running</h1>
        <p className="description">
          This React page calls <code>{backendUrl}/api/hello</code> from
          <code> apps/backend</code>.
        </p>
        <button type="button" disabled={loading} onClick={() => void callBackend()}>
          {loading ? "Calling backend…" : "Call backend again"}
        </button>
        <div className={`result ${error ? "result-error" : ""}`} role="status" aria-live="polite">
          {error ? (
            error
          ) : greeting ? (
            <>
              <strong>{greeting.message}</strong>
              <span>{new Date(greeting.timestamp).toLocaleString()}</span>
            </>
          ) : (
            "Connecting to the backend…"
          )}
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing frontend root element");

createRoot(root).render(<App />);
