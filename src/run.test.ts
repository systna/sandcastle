import { describe, expect, it } from "vitest";
import {
  sanitizeBranchForFilename,
  USE_WORKTREE_MODE,
  type RunOptions,
  type RunResult,
} from "./run.js";

describe("RunResult", () => {
  it("includes logFilePath when logging to a file", () => {
    const result: RunResult = {
      iterationsRun: 1,
      wasCompletionSignalDetected: false,
      stdout: "",
      commits: [],
      branch: "main",
      logFilePath: "/path/to/sandcastle.log",
    };
    expect(result.logFilePath).toBe("/path/to/sandcastle.log");
  });

  it("allows logFilePath to be absent when logging to stdout", () => {
    const result: RunResult = {
      iterationsRun: 1,
      wasCompletionSignalDetected: false,
      stdout: "",
      commits: [],
      branch: "main",
    };
    expect(result.logFilePath).toBeUndefined();
  });
});

describe("RunOptions", () => {
  it("allows timeoutSeconds to be specified", () => {
    const opts: RunOptions = { prompt: "test", timeoutSeconds: 120 };
    expect(opts.timeoutSeconds).toBe(120);
  });

  it("allows timeoutSeconds to be omitted (uses default)", () => {
    const opts: RunOptions = { prompt: "test" };
    expect(opts.timeoutSeconds).toBeUndefined();
  });
});

describe("USE_WORKTREE_MODE", () => {
  it("is a boolean feature flag", () => {
    expect(typeof USE_WORKTREE_MODE).toBe("boolean");
  });
});

describe("sanitizeBranchForFilename", () => {
  it("passes through a simple branch name unchanged", () => {
    expect(sanitizeBranchForFilename("main")).toBe("main");
  });

  it("replaces forward slashes with dashes", () => {
    expect(sanitizeBranchForFilename("sandcastle/issue-87-log-file")).toBe(
      "sandcastle-issue-87-log-file",
    );
  });

  it("replaces backslashes with dashes", () => {
    expect(sanitizeBranchForFilename("feature\\branch")).toBe("feature-branch");
  });

  it("replaces all problematic filesystem characters", () => {
    expect(sanitizeBranchForFilename('feat:name*?"><|')).toBe(
      "feat-name------",
    );
  });

  it("handles nested slashes like a typical sandcastle branch", () => {
    expect(
      sanitizeBranchForFilename("sandcastle/issue-87-log-file-branch-name"),
    ).toBe("sandcastle-issue-87-log-file-branch-name");
  });
});
