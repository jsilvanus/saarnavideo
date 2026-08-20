import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { transcriptionResultSchema, type TranscriptionProvider, type TranscriptionResult } from "@/domain/transcription";


export type PythonTranscriptionOptions = {
  python?: string;
  workerPath?: string;
  model?: string;
  device?: string;
  computeType?: string;
};

export class PythonTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly options: PythonTranscriptionOptions = {}) {}

  async transcribe(inputPath: string, language?: string): Promise<TranscriptionResult> {
    await access(inputPath);
    const python = this.options.python ?? "python3";
    const workerPath = this.options.workerPath ?? "transcription/transcribe.py";
    const request = JSON.stringify({
      input: inputPath,
      language,
      model: this.options.model ?? "small",
      device: this.options.device ?? "cpu",
      computeType: this.options.computeType ?? "int8",
    });

    return new Promise((resolve, reject) => {
      const child = spawn(python, [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Transcription worker failed (${code}): ${stderr.trim()}`));
          return;
        }
        try {
          resolve(transcriptionResultSchema.parse(JSON.parse(stdout)));
        } catch (error) {
          reject(new Error(`Invalid transcription worker output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.end(request);
    });
  }
}
