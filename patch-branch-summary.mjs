/**
 * Postinstall patch: fixes branch-summarization to handle forward navigation.
 * 
 * The SDK's collectEntriesForBranchSummary only handles backward navigation
 * (abandoned branch case). When oldLeaf is an ancestor of target (forward
 * navigation in the same branch), it returns 0 entries because there are
 * no abandoned entries. This patch collects entries BETWEEN oldLeaf and
 * target for forward navigation.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

// Use Node's module resolution to find the SDK file regardless of install structure
const require = createRequire(import.meta.url);
let target;
try {
  target = require.resolve('@earendil-works/pi-coding-agent/dist/core/compaction/branch-summarization.js');
} catch {
  // Fallback: walk up looking for node_modules (for edge cases)
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== resolve(dir, '..')) {
    const candidate = resolve(dir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core', 'compaction', 'branch-summarization.js');
    if (existsSync(candidate)) { target = candidate; break; }
    dir = resolve(dir, '..');
  }
  if (!target) {
    console.warn('⚠ Could not find @earendil-works/pi-coding-agent. Skipping patch.');
    process.exit(0);
  }
}

try {
  let code = readFileSync(target, 'utf-8');
  const marker = 'export function collectEntriesForBranchSummary(session, oldLeafId, targetId)';
  if (code.includes(marker) && !code.includes('// Handle forward navigation')) {
    // The patched version replaces the original function body.
    // Find the function start and replace until the closing brace of the return.
    const startIdx = code.indexOf(marker);
    const returnIdx = code.indexOf('return { entries, commonAncestorId };', startIdx);
    // Include up through the closing brace of the function (after the return statement)
    const endIdx = code.indexOf('\n}', returnIdx) + 2; // include newline + closing brace

    const patched = `export function collectEntriesForBranchSummary(session, oldLeafId, targetId) {
    // If no old position, nothing to summarize
    if (!oldLeafId) {
        return { entries: [], commonAncestorId: null };
    }
    // Find common ancestor (deepest node that's on both paths)
    const oldPath = new Set(session.getBranch(oldLeafId).map((e) => e.id));
    const targetPath = session.getBranch(targetId);
    // targetPath is root-first, so iterate backwards to find deepest common ancestor
    let commonAncestorId = null;
    for (let i = targetPath.length - 1; i >= 0; i--) {
        if (oldPath.has(targetPath[i].id)) {
            commonAncestorId = targetPath[i].id;
            break;
        }
    }
    // Collect entries from old leaf back to common ancestor (abandoned branch case)
    const entries = [];
    let current = oldLeafId;
    while (current && current !== commonAncestorId) {
        const entry = session.getEntry(current);
        if (!entry)
            break;
        entries.push(entry);
        current = entry.parentId;
    }
    // entries is currently in reverse-chronological order (oldest last).
    // Handle forward navigation (old leaf is ancestor of target, same branch):
    // when commonAncestor === oldLeafId and entries is empty (no abandoned branch),
    // collect entries BETWEEN oldLeaf and target (exclusive of both)
    // so the summarizer can describe what happened in the skipped-forward range.
    if (entries.length === 0 && commonAncestorId === oldLeafId && oldLeafId !== targetId) {
        // targetPath is root-first; find oldLeaf index and collect entries after it up to (but not including) targetId
        const oldIdx = targetPath.findIndex((e) => e.id === oldLeafId);
        const targetIdx = targetPath.findIndex((e) => e.id === targetId);
        if (oldIdx !== -1 && targetIdx !== -1 && targetIdx > oldIdx) {
            for (let i = oldIdx + 1; i < targetIdx; i++) {
                const entry = targetPath[i];
                if (entry) entries.push(entry);
            }
            // Forward-collected entries are already chronological (oldest first),
            // no reverse needed.
        } else {
            // Still no entries, reverse the empty array for consistency
            entries.reverse();
        }
    } else {
        // Backward navigation: entries are reverse-chronological, reverse to chronological
        entries.reverse();
    }
    return { entries, commonAncestorId };
}`;

    code = code.slice(0, startIdx) + patched + code.slice(endIdx);
    writeFileSync(target, code, 'utf-8');
    console.log('✓ Patched branch-summarization.js (forward navigation support)');
  } else if (code.includes('// Handle forward navigation')) {
    console.log('• branch-summarization.js already patched, skipping');
  } else {
    console.warn('⚠ Could not find function marker in branch-summarization.js');
  }
} catch (err) {
  console.warn('⚠ Failed to patch branch-summarization.js:', err.message);
}
