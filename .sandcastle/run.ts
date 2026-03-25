import * as sandcastle from "sandcastle";

const hooks = {
  onSandboxReady: [{ command: "npm install && npm run build" }],
};

// Phase 1: Plan — orchestrator agent analyzes issues and picks parallelizable work
const plan = await sandcastle.run({
  hooks,
  maxIterations: 1,
  model: "claude-opus-4-6",
  promptFile: "./.sandcastle/plan-prompt.md",
});

const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
if (!planMatch) {
  throw new Error(
    "Orchestrator did not produce a <plan> tag.\n\n" + plan.stdout,
  );
}

const { issues } = JSON.parse(planMatch[1]) as {
  issues: { number: number; title: string; branch: string }[];
};

console.log(
  `Planning complete. ${issues.length} issue(s) to work in parallel:`,
);
for (const issue of issues) {
  console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
}

// Phase 2: Execute — spawn N agents in parallel, each on a separate branch
const results = await Promise.all(
  issues.map((issue) =>
    sandcastle.run({
      hooks,
      maxIterations: 100,
      model: "claude-opus-4-6",
      prompt: `Fix issue #${issue.number}: ${issue.title}\n\nWork on branch ${issue.branch}. Make commits, run tests, and close the issue when done.\n\nIf complete, output <promise>COMPLETE</promise>.`,
      branch: issue.branch,
    }),
  ),
);

const completedBranches = results
  .filter((r) => r.commits.length > 0)
  .map((r) => r.branch);

console.log(
  `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
);
for (const branch of completedBranches) {
  console.log(`  ${branch}`);
}

if (completedBranches.length === 0) {
  console.log("No commits produced. Nothing to merge.");
  process.exit(0);
}

// Phase 3: Merge — one agent merges all branches together
const mergePrompt = (
  await import("node:fs/promises").then((fs) =>
    fs.readFile("./.sandcastle/merge-prompt.md", "utf-8"),
  )
).replace("BRANCHES", completedBranches.map((b) => `- ${b}`).join("\n"));

await sandcastle.run({
  hooks,
  maxIterations: 10,
  model: "claude-opus-4-6",
  prompt: mergePrompt,
});

console.log("\nAll done. Branches merged.");
