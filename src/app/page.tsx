"use client";

import { WorkspaceProvider } from "@/components/workspace/useWorkspace";
import Sidebar from "@/components/workspace/Sidebar";
import Workspace from "@/components/workspace/Workspace";
import Modals from "@/components/workspace/Modals";
import WorkspaceStyles from "@/components/workspace/WorkspaceStyles";

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <main className="app">
        <Sidebar />
        <Workspace />
        <Modals />
        <WorkspaceStyles />
      </main>
    </WorkspaceProvider>
  );
}
