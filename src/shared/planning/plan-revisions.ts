/**
 * # Plan revisions (find/replace hunks)
 *
 * Pure application logic behind the `revise_plan` tool: instead of
 * re-emitting the full plan text on every rework round (thousands of output
 * tokens), the model emits only the changed hunks and the harness applies
 * them to the plan it already holds.
 *
 * Matching contract mirrors the `edit` tool: every `find` must match the
 * current plan exactly once, and matched regions must not overlap. All
 * hunks are validated against the original text before any is applied, so
 * a failed revision changes nothing (atomic).
 */

export interface PlanRevisionChange {
	/** Exact text from the current plan. Must match exactly once. */
	readonly find: string
	/** Replacement text. Empty string deletes the matched text. */
	readonly replace: string
}

export type PlanRevisionResult = { ok: true; text: string } | { ok: false; error: string }

interface LocatedChange {
	readonly index: number
	readonly change: PlanRevisionChange
}

/**
 * Validate and apply a batch of find/replace hunks against `text`.
 *
 * Splicing is offset-based (not `String.replace`), so replacements cannot
 * disturb sibling hunks — e.g. a `replace` that introduces a copy of
 * another hunk's `find` cannot redirect that hunk's match.
 */
export function applyPlanChanges(text: string, changes: readonly PlanRevisionChange[]): PlanRevisionResult {
	if (changes.length === 0) return { ok: false, error: "No changes provided." }

	const located: LocatedChange[] = []
	for (let i = 0; i < changes.length; i++) {
		const change = changes[i]
		if (!change.find) return { ok: false, error: `Change ${i + 1}: "find" text is empty.` }
		const first = text.indexOf(change.find)
		if (first === -1) {
			return {
				ok: false,
				error: `Change ${i + 1}: "find" text does not appear in the plan. Quote it exactly as submitted (larger, unique context helps).`,
			}
		}
		if (text.indexOf(change.find, first + 1) !== -1) {
			return {
				ok: false,
				error: `Change ${i + 1}: "find" text matches multiple places in the plan. Expand it with more surrounding context so it matches exactly once.`,
			}
		}
		const overlaps = located.some(
			(other) =>
				(first >= other.index && first < other.index + other.change.find.length) ||
				(other.index >= first && other.index < first + change.find.length),
		)
		if (overlaps) {
			return {
				ok: false,
				error: `Change ${i + 1}: overlaps with an earlier change — merge overlapping edits into one hunk.`,
			}
		}
		located.push({ index: first, change })
	}

	// Splice descending so earlier offsets stay valid as the text shrinks/grows.
	const ordered = [...located].sort((a, b) => b.index - a.index)
	let out = text
	for (const { index, change } of ordered) {
		out = out.slice(0, index) + change.replace + out.slice(index + change.find.length)
	}
	return { ok: true, text: out }
}
