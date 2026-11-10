import { describe, expect, it } from "vitest"
import { applyPlanChanges } from "./plan-revisions.js"

describe("applyPlanChanges", () => {
	it("applies a single hunk", () => {
		const out = applyPlanChanges("# Plan\n\n## Goal\nOld goal\n", [{ find: "Old goal", replace: "New goal" }])
		expect(out).toEqual({ ok: true, text: "# Plan\n\n## Goal\nNew goal\n" })
	})

	it("applies multiple non-overlapping hunks", () => {
		const out = applyPlanChanges("alpha beta gamma", [
			{ find: "alpha", replace: "ALPHA" },
			{ find: "gamma", replace: "GAMMA" },
		])
		expect(out).toEqual({ ok: true, text: "ALPHA beta GAMMA" })
	})

	it("deletes with an empty replace", () => {
		const out = applyPlanChanges("keep drop keep", [{ find: " drop", replace: "" }])
		expect(out).toEqual({ ok: true, text: "keep keep" })
	})

	it("rejects an empty change list", () => {
		expect(applyPlanChanges("x", [])).toEqual({ ok: false, error: "No changes provided." })
	})

	it("rejects an empty find", () => {
		const out = applyPlanChanges("x", [{ find: "", replace: "y" }])
		expect(out.ok).toBe(false)
		if (!out.ok) expect(out.error).toContain('"find" text is empty')
	})

	it("rejects a missing replace instead of writing the literal 'undefined'", () => {
		// Providers can drop schema fields; params arrive via a bare cast.
		const out = applyPlanChanges("abc", [{ find: "b", replace: undefined as unknown as string }])
		expect(out.ok).toBe(false)
		if (!out.ok) expect(out.error).toContain('"replace" text is missing')
	})

	it("rejects a find that does not match", () => {
		const out = applyPlanChanges("real text", [{ find: "imaginary", replace: "x" }])
		expect(out.ok).toBe(false)
		if (!out.ok) expect(out.error).toContain("does not appear in the plan")
	})

	it("rejects a find that matches more than once", () => {
		const out = applyPlanChanges("dup dup", [{ find: "dup", replace: "x" }])
		expect(out.ok).toBe(false)
		if (!out.ok) expect(out.error).toContain("matches multiple places")
	})

	it("rejects overlapping hunks (containment in either direction)", () => {
		const inner = applyPlanChanges("abcdef", [
			{ find: "abcdef", replace: "X" },
			{ find: "cd", replace: "Y" },
		])
		expect(inner.ok).toBe(false)
		const outer = applyPlanChanges("abcdef", [
			{ find: "cd", replace: "Y" },
			{ find: "abcdef", replace: "X" },
		])
		expect(outer.ok).toBe(false)
	})

	it("rejects duplicate identical hunks as overlapping", () => {
		const out = applyPlanChanges("same target", [
			{ find: "target", replace: "a" },
			{ find: "target", replace: "b" },
		])
		expect(out.ok).toBe(false)
	})

	it("splice-by-offset: a replacement creating a copy of a sibling's find cannot redirect it", () => {
		// With String.replace, replacing "a"→"b" first would produce "bb" and the
		// second hunk's find ("b") would hit the newly created copy. Offset splicing
		// against the original text must yield "bc".
		const out = applyPlanChanges("ab", [
			{ find: "a", replace: "b" },
			{ find: "b", replace: "c" },
		])
		expect(out).toEqual({ ok: true, text: "bc" })
	})

	it("is atomic: an invalid later hunk leaves the original untouched", () => {
		const text = "valid here, missing there"
		const out = applyPlanChanges(text, [
			{ find: "valid", replace: "VALID" },
			{ find: "absent", replace: "x" },
		])
		expect(out.ok).toBe(false)
		// ok:false results carry no text — the caller keeps the stored original.
	})
})
