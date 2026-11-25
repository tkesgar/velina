import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AppShell } from "./components/app-shell";
import { VelinaProvider } from "./lib/velina-context";
import { ConfigPage } from "./pages/config";
import { ProcessesPage } from "./pages/processes";
import { TaskGroupsPage } from "./pages/task-groups";
import { TasksPage } from "./pages/tasks";

export function App() {
  return (
    <VelinaProvider>
      <BrowserRouter basename="/ui">
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/tasks" replace />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="groups" element={<TaskGroupsPage />} />
            <Route path="processes" element={<ProcessesPage />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </VelinaProvider>
  );
}
