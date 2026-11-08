"use client";

import { use } from "react";
import { WorkspaceProvider } from "@/components/workspace/useWorkspace";
import Sidebar from "@/components/workspace/Sidebar";
import Workspace from "@/components/workspace/Workspace";
import Modals from "@/components/workspace/Modals";
import WorkspaceStyles from "@/components/workspace/WorkspaceStyles";

/** Direct link to a specific project: opens the workspace pre-selected to this project. */
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <WorkspaceProvider initialProjectId={id}>
      <main className="app">
        <Sidebar />
        <Workspace />
        <Modals />
        <WorkspaceStyles />
      </main>
    </WorkspaceProvider>
  );
}
