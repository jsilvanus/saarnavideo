import { describe, expect, it } from "vitest";
import { api, baseUrl, createProject, importVtt, uploadSource } from "./helpers";

// Cues: 0-2 and 2.5-4 are one paragraph; the 6 s pause before 10 starts a new one; 30 is far away.
const VTT = [
  "WEBVTT", "",
  "00:00:00.000 --> 00:00:02.000", "Hyvää huomenta", "",
  "00:00:02.500 --> 00:00:04.000", "ja  tervetuloa.", "",
  "00:00:10.000 --> 00:00:12.000", "Evankeliumi <Luuk.> & \"Ääköset\"", "",
  "00:00:30.000 --> 00:00:33.000", "Loppusanat", "",
].join("\n");

describe("plain-text transcript", () => {
  it("serves the whole transcript, a range and a run as text and html without timings", async () => {
    const project = await createProject("Transcript text");
    const source = await uploadSource(project.id, "green.mp4");
    const run = await importVtt(source.id, VTT);
    const url = (ext: string, query = "") => `${baseUrl}/api/sources/${source.id}/transcript.${ext}${query}`;

    // Whole recording (the first import auto-applies).
    const whole = await fetch(url("txt"));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(whole.headers.get("content-disposition")).toMatch(/^attachment; filename="green-transcript\.txt"$/);
    const wholeText = await whole.text();
    expect(wholeText).toBe("Hyvää huomenta ja tervetuloa.\n\nEvankeliumi <Luuk.> & \"Ääköset\"\n\nLoppusanat\n");
    expect(wholeText).not.toMatch(/\d\d:\d\d|-->/);

    // Range: segments whose start is inside [start, end). 2.5 is inside 2-11 although 0-2 began earlier.
    expect(await (await fetch(url("txt", "?start=2&end=11"))).text()).toBe("ja tervetuloa.\n\nEvankeliumi <Luuk.> & \"Ääköset\"\n");
    expect(await (await fetch(url("txt", "?start=11"))).text()).toBe("Loppusanat\n");
    // A wider gap threshold merges paragraphs; a title is added.
    expect(await (await fetch(url("txt", "?end=20&gap=10&title=Saarna"))).text()).toBe("Saarna\n\nHyvää huomenta ja tervetuloa. Evankeliumi <Luuk.> & \"Ääköset\"\n");

    // A specific run works the same way.
    expect(await (await fetch(url("txt", `?runId=${run.id}&start=30`))).text()).toBe("Loppusanat\n");

    // HTML variant.
    const html = await fetch(url("html", "?title=Saarna&end=20"));
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("content-disposition")).toContain("green-transcript.html");
    const htmlText = await html.text();
    expect(htmlText).toContain("<html lang=\"fi\">");
    expect(htmlText).toContain("<h1>Saarna</h1>");
    expect(htmlText).toContain("<p>Hyvää huomenta ja tervetuloa.</p>");
    expect(htmlText).toContain("<p>Evankeliumi &lt;Luuk.&gt; &amp; &quot;Ääköset&quot;</p>");
    expect(htmlText).not.toContain("Loppusanat");
  });

  it("reads pending runs by runId and leaves the active track alone", async () => {
    const project = await createProject("Transcript run");
    const source = await uploadSource(project.id, "green.mp4");
    await importVtt(source.id, "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nAktiivinen\n");
    const pending = await importVtt(source.id, "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOdottava\n", "sv");
    expect(pending.status).toBe("PENDING");
    expect(await (await fetch(`${baseUrl}/api/sources/${source.id}/transcript.txt`)).text()).toBe("Aktiivinen\n");
    expect(await (await fetch(`${baseUrl}/api/sources/${source.id}/transcript.txt?runId=${pending.id}`)).text()).toBe("Odottava\n");
    expect(await (await fetch(`${baseUrl}/api/sources/${source.id}/transcript.html?runId=${pending.id}`)).text()).toContain("<html lang=\"sv\">");
  });

  it("validates parameters and unknown ids, and returns an empty body for an empty range", async () => {
    const project = await createProject("Transcript errors");
    const source = await uploadSource(project.id, "green.mp4");
    await importVtt(source.id, VTT);
    const base = `${baseUrl}/api/sources/${source.id}/transcript.txt`;
    expect((await fetch(`${base}?start=5&end=5`)).status).toBe(400);
    expect((await fetch(`${base}?start=abc`)).status).toBe(400);
    expect((await fetch(`${base}?start=-1`)).status).toBe(400);
    expect((await fetch(`${base}?runId=nope`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/sources/nope/transcript.txt`)).status).toBe(404);
    const empty = await fetch(`${base}?start=100&end=200`);
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe("");
  });
});
