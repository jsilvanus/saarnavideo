import { describe, expect, it } from "vitest";
import { captionKeyAction } from "./CaptionEditorDialog";

const none = { ctrl: false, shift: false, inText: false };

describe("captionKeyAction", () => {
  it("jumps 10 s with Ctrl and 3 s with Shift; Shift wins when both are held", () => {
    expect(captionKeyAction("ArrowLeft", { ...none, ctrl: true })).toEqual({ type: "seek", seconds: -10 });
    expect(captionKeyAction("ArrowRight", { ...none, ctrl: true })).toEqual({ type: "seek", seconds: 10 });
    expect(captionKeyAction("ArrowLeft", { ...none, shift: true })).toEqual({ type: "seek", seconds: -3 });
    expect(captionKeyAction("ArrowRight", { ...none, ctrl: true, shift: true })).toEqual({ type: "seek", seconds: 3 });
  });

  it("leaves plain arrows alone so typing and text selection keep working", () => {
    expect(captionKeyAction("ArrowLeft", none)).toBeNull();
    expect(captionKeyAction("ArrowRight", { ...none, inText: true })).toBeNull();
  });

  it("maps Ctrl+Down to end and Ctrl+Up to start", () => {
    expect(captionKeyAction("ArrowDown", { ...none, ctrl: true })).toEqual({ type: "setEnd" });
    expect(captionKeyAction("ArrowUp", { ...none, ctrl: true })).toEqual({ type: "setStart" });
    expect(captionKeyAction("ArrowDown", none)).toBeNull();
  });

  it("uses Enter for next or new, Shift+Enter for a newline, Ctrl+Enter for a new caption", () => {
    expect(captionKeyAction("Enter", { ...none, inText: true })).toEqual({ type: "next" });
    expect(captionKeyAction("Enter", { ...none, inText: true, shift: true })).toBeNull();
    expect(captionKeyAction("Enter", { ...none, inText: true, ctrl: true })).toEqual({ type: "newAfter" });
    expect(captionKeyAction("Enter", none)).toBeNull();
  });
});
