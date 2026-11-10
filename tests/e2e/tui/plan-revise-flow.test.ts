import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, Key, test } from "@microsoft/tui-test"
import { INPUT_TIMEOUT_MS, STARTUP_TIMEOUT_MS, STREAM_TIMEOUT_MS, waitForText } from "./support/assertions.js"
import { runKimchiSession, TUI_TEST_CONFIG } from "./support/kimchi-fixture.js"

test.use(TUI_TEST_CONFIG)

// Plan-mode rework with the revise_plan tool: the first submission opens the
// review dropdown; "Rework the plan" closes it; the follow-up turn applies
// find/replace hunks via revise_plan, which overwrites the same plan file and
// re-opens the dropdown. Dropdown option order (permissions/index.ts):
//   "Execute the plan" → "Rework the plan" → "Start as ferment".
test("plan revise flow: rework applies hunks and re-opens the review", async ({ terminal }) => {
	const planV1 =
		"# Revise Demo Plan\n\n" +
		"## Goal\nCreate example.txt with hello.\n\n" +
		"## Chunks\n\n" +
		"### Chunk 1: Create file\n- **Accept When**: file exists\n\n" +
		"## Verification Strategy\nRead the file.\n"
	const revisedGoal = "Create example.txt with goodbye."

	await runKimchiSession(
		terminal,
		{
			artifactName: "plan-revise-flow",
			gitInit: true,
			extraArgs: ["--plan=true"],
			responses: [
				// Turn 1: stream the plan, then submit_plan opens the review dropdown.
				{
					stream: ["The plan is ready for review."],
					toolCalls: [
						{
							id: "call_submit_plan",
							type: "function",
							function: { name: "submit_plan", arguments: JSON.stringify({ plan: planV1 }) },
						},
					],
				},
				// Turn 2 (after the user's rework note): revise_plan applies only the
				// changed hunks — the full plan text is never re-emitted.
				{
					stream: ["Applying the requested tweaks."],
					toolCalls: [
						{
							id: "call_revise_plan",
							type: "function",
							function: {
								name: "revise_plan",
								arguments: JSON.stringify({
									changes: [{ find: "Create example.txt with hello.", replace: revisedGoal }],
								}),
							},
						},
					],
				},
				// Turn 3: after Execute is picked on the re-opened review.
				{ stream: ["Plan executed. Ready for the next task."] },
			],
		},
		async (fixture, trace) => {
			await waitForText(terminal, /plan(?: → shift\+tab)? · basic\b/, { timeoutMs: STARTUP_TIMEOUT_MS })
			trace.step("status line confirms plan mode")

			// Stage 1: submit the request — model calls submit_plan, dropdown opens.
			terminal.submit("Plan out the example file.")
			await waitForText(terminal, "Execute the plan", { timeoutMs: STREAM_TIMEOUT_MS })
			await waitForText(terminal, "Rework the plan", { timeoutMs: INPUT_TIMEOUT_MS })
			trace.step("submit_plan opened the approval dropdown")

			// Stage 2: pick "Rework the plan" (one keyDown from the default
			// "Execute the plan"). The menu closes with no follow-up turn.
			terminal.keyDown()
			terminal.keyPress(Key.Enter)
			await waitForText(terminal, /ask anything or type/, { timeoutMs: STREAM_TIMEOUT_MS })
			trace.step("rework picked — dropdown closed, editor ready")

			// Stage 3: send the rework note — the follow-up turn calls revise_plan.
			terminal.submit("Change hello to goodbye.")
			// The generic tool renderer headers the block with the humanized name.
			await waitForText(terminal, "Revise Plan", { timeoutMs: STREAM_TIMEOUT_MS })
			trace.step("revise_plan tool call rendered")

			// Stage 4: the review re-opens with the reworked plan. The first menu
			// was dismissed at stage 2 (the placeholder replaced it), so "Execute
			// the plan" on screen again can only be the NEW menu — and waiting for
			// it proves revise_plan's execute completed. Selecting the default
			// proves the live menu consumes keys (a stale render cannot).
			await waitForText(terminal, "Execute the plan", { timeoutMs: STREAM_TIMEOUT_MS })
			trace.step("review re-opened with the revised plan")
			terminal.keyPress(Key.Enter)
			await waitForText(terminal, "auto → shift+tab", { timeoutMs: STREAM_TIMEOUT_MS })
			trace.step("re-opened review consumed Enter — plan mode released into auto")

			// Stage 5: the same plan file was overwritten in place with the hunk.
			const saved = readFileSync(join(fixture.workDir, ".kimchi", "plans", "revise-demo-plan.md"), "utf-8")
			expect(saved).toContain(revisedGoal)
			expect(saved).not.toContain("with hello.")
			trace.step("plan file overwritten in place with the revision")
		},
	)
})
