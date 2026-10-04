import { describe, expect, it } from "vitest";
import { addSourceSection } from "@/domain/templates";
import type { ProjectDefinition } from "@/domain/project";
import { api, averageColor, frameRgb, isGreen, probe, render, uploadSource, whiteShare } from "./helpers";

type Project = { id: string; templateKey: string; definition: ProjectDefinition };
type Choice = { kind: "builtin" | "saved"; key?: string; id?: string; name: string; sections: string[] };

const createFrom = (body: Record<string, unknown>, status?: number) => api<Project>("/api/projects", { method: "POST", json: { title: "Pääsiäisaamun jumalanpalvelus", ...body } }, status);
const getProject = (id: string) => api<Project>(`/api/projects/${id}`);

describe("project templates", () => {
  it("lists the built-in templates and seeds a new project from one", async () => {
    const { templates } = await api<{ templates: Choice[] }>("/api/templates");
    expect(templates.filter((template) => template.kind === "builtin").map((template) => template.key)).toEqual(["sermon", "liturgy", "vespers", "short-vertical"]);

    const project = await createFrom({ templateKey: "sermon", preacher: "Maija Mäkinen", gospelRef: "Joh. 20:1-18" });
    const { definition } = await getProject(project.id);
    expect(definition.template).toMatchObject({ key: "sermon", width: 1920, height: 1080, targetSeconds: 900 });
    expect(definition.variables).toEqual([
      { key: "otsikko", value: "Pääsiäisaamun jumalanpalvelus" },
      { key: "saarnaaja", value: "Maija Mäkinen" },
      { key: "evankeliumi", value: "Joh. 20:1-18" },
    ]);
    expect(definition.composition.items.map((item) => item.type)).toEqual(["slate", "slate"]);
  });

  it("uses the vertical size of the short template and keeps unknown keys working as a blank project", async () => {
    const short = await getProject((await createFrom({ templateKey: "short-vertical" })).id);
    expect(short.definition.template).toMatchObject({ width: 1080, height: 1920, presetKey: "youtube-shorts" });
    const blank = await getProject((await createFrom({ templateKey: "basic" })).id);
    expect(blank.definition.composition.items).toEqual([]);
  });

  it("renders the opening card, the sections and the ending card of a templated project", async () => {
    const project = await createFrom({ templateKey: "sermon", preacher: "Kari" });
    const green = await uploadSource(project.id, "green.mp4");
    // What the Structure step does when a section is added: the clip goes before the ending slate.
    const definition = addSourceSection((await getProject(project.id)).definition, { id: "saarna", label: "Saarna", sourceId: green.id, startSeconds: 0, endSeconds: 5 });
    await api(`/api/projects/${project.id}`, { method: "PATCH", json: { definition } });

    const { filePath } = await render(project.id);
    const info = await probe(filePath);
    // 4 s opening card + 5 s clip + 5 s ending card.
    expect(info.duration).toBeGreaterThan(13.7);
    expect(info.duration).toBeLessThan(14.4);
    expect(info.video).toMatchObject({ width: 1920, height: 1080 });
    const card = { x: 160, y: 360, w: 1600, h: 200 };
    expect(whiteShare(await frameRgb(filePath, 1, card))).toBeGreaterThan(0.01);
    expect(isGreen(averageColor(await frameRgb(filePath, 6)))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 12, card))).toBeGreaterThan(0.01);
  });

  it("saves a project as a template and starts new projects from it", async () => {
    const source = await createFrom({ templateKey: "vespers" });
    const name = `Oma iltahartaus ${Date.now()}`;
    const saved = await api<{ id: string; name: string; sections: string[] }>("/api/templates", { method: "POST", json: { projectId: source.id, name } }, 201);
    expect(saved.sections).toContain("Psalmi");
    expect((await api<{ error: string }>("/api/templates", { method: "POST", json: { projectId: source.id, name } }, 409)).error).toMatch(/already exists/);
    await api("/api/templates", { method: "POST", json: { projectId: "missing", name: "x" } }, 404);

    const { templates } = await api<{ templates: Choice[] }>("/api/templates");
    expect(templates.find((template) => template.kind === "saved" && template.id === saved.id)).toMatchObject({ name, sections: expect.arrayContaining(["Psalmi"]) });

    const child = await getProject((await createFrom({ userTemplateId: saved.id, preacher: "Pekka" })).id);
    const original = (await getProject(source.id)).definition;
    expect(child.definition.template).toMatchObject({ key: "vespers", width: 1920, height: 1080 });
    expect(child.definition.graphics.map((graphic) => graphic.name)).toEqual(original.graphics.map((graphic) => graphic.name));
    expect(child.definition.graphics.map((graphic) => graphic.id)).not.toContain(original.graphics[0].id);
    expect(child.definition.variables?.find((variable) => variable.key === "saarnaaja")?.value).toBe("Pekka");
    expect(child.definition.composition.items.every((item) => item.type === "slate" && !!item.graphicId && child.definition.graphics.some((graphic) => graphic.id === item.graphicId))).toBe(true);

    await api(`/api/templates/${saved.id}`, { method: "DELETE" });
    await api(`/api/templates/${saved.id}`, { method: "DELETE" }, 404);
    await createFrom({ userTemplateId: saved.id }, 404);
    expect((await getProject(child.id)).definition.graphics.length).toBeGreaterThan(0);
  });
});
