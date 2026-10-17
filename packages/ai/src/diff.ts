// Unified diff helpers for the planner.
// The planner may target only an added or changed line on the right side of the diff
// (plan section 8.1, rule 2). GitHub review comments use the same side and line numbers.

/** Right-side line numbers that the diff adds or changes, by file path. */
export type RightSideLines = Map<string, Set<number>>;

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reads a unified diff and returns, for each file, the set of right-side line numbers
 * that appear as `+` lines. Deleted files have no right side and are left out.
 */
export function rightSideLines(diff: string): RightSideLines {
  const result: RightSideLines = new Map();
  let path: string | null = null;
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith("diff --git ")) {
      path = null;
      inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).split("\t")[0]!;
      path = target === "/dev/null" ? null : target.replace(/^b\//, "");
      inHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === null) {
      continue;
    }
    if (line.startsWith("+")) {
      let lines = result.get(path);
      if (!lines) {
        lines = new Set();
        result.set(path, lines);
      }
      lines.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-") || line.startsWith("\\")) {
      // A removed line or "\ No newline at end of file": no right-side line.
    } else {
      // Context line (starts with a space, or is empty in some diffs).
      newLine += 1;
    }
  }
  return result;
}

/** True when `line` of `path` is an added or changed line on the right side of the diff. */
export function isRightSideLine(lines: RightSideLines, path: string, line: number): boolean {
  return lines.get(path)?.has(line) ?? false;
}

/** The paths that have a right side in the diff, in diff order. */
export function changedPaths(diff: string): string[] {
  return [...rightSideLines(diff).keys()];
}

/**
 * Rewrites the diff so that each right-side line carries its new line number.
 * The planner reads this to pick exact target lines. Removed lines keep a blank number.
 *
 *   @@ -30,12 +32,9 @@
 *   32       input: string,
 *   -        if (!(code in PERCENT_COUPONS)) {
 *   36  +    if (!(code in PERCENT_COUPONS) && !SHIPPING_COUPONS.has(code)) {
 */
export function annotateDiff(diff: string): string {
  const out: string[] = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith("diff --git ") || line.startsWith("+++ ") || line.startsWith("--- ")) {
      inHunk = false;
      out.push(line);
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      out.push(line);
      continue;
    }
    if (!inHunk) {
      out.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      out.push(`${String(newLine).padStart(5)} + ${line.slice(1)}`);
      newLine += 1;
    } else if (line.startsWith("-")) {
      out.push(`      - ${line.slice(1)}`);
    } else if (line.startsWith("\\")) {
      out.push(line);
    } else {
      out.push(`${String(newLine).padStart(5)}   ${line.slice(1)}`);
      newLine += 1;
    }
  }
  return out.join("\n");
}
