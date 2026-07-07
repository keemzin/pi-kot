import {
  mkdir,
  open as fsOpen,
  readFile as fsReadFile,
  readdir,
  realpath,
  rename as fsRename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream, unlinkSync } from "node:fs";
import { once } from "node:events";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";

export class PathOutsideRootError extends Error {
  constructor(target: string, root: string) {
    super(`path outside project root: ${target} (root=${root})`);
    this.name = "PathOutsideRootError";
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`not found: ${path}`);
    this.name = "NotFoundError";
  }
}

export class NotAFileError extends Error {
  constructor(path: string) {
    super(`not a file: ${path}`);
    this.name = "NotAFileError";
  }
}

export class FileTooLargeError extends Error {
  readonly size: number;
  readonly limit: number;
  constructor(path: string, size: number, limit: number) {
    super(`file too large: ${path} (${size} > ${limit})`);
    this.name = "FileTooLargeError";
    this.size = size;
    this.limit = limit;
  }
}

export class DirectoryNotEmptyError extends Error {
  constructor(path: string) {
    super(`directory not empty: ${path}`);
    this.name = "DirectoryNotEmptyError";
  }
}

export class InvalidNameError extends Error {
  constructor(message = "invalid file name") {
    super(message);
    this.name = "InvalidNameError";
  }
}

export class ChecksumMismatchError extends Error {
  readonly target: string;
  readonly expected: string;
  readonly actual: string;
  constructor(target: string, expected: string, actual: string) {
    super(`checksum mismatch at ${target} (expected ${expected}, got ${actual})`);
    this.name = "ChecksumMismatchError";
    this.target = target;
    this.expected = expected;
    this.actual = actual;
  }
}

export class TargetExistsError extends Error {
  constructor(path: string) {
    super(`target already exists: ${path}`);
    this.name = "TargetExistsError";
  }
}

export const MAX_READ_BYTES = 5 * 1024 * 1024;

const TREE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".nuxt",
  "coverage",
  ".vite",
  ".turbo",
  ".cache",
]);

export const SEARCH_SKIP_DIRS: ReadonlySet<string> = TREE_SKIP_DIRS;

const DEFAULT_TREE_DEPTH = 32;

export function assertInsideRoot(target: string, root: string): string {
  if (target.includes("\0")) throw new PathOutsideRootError(target, root);
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  if (resolvedTarget === resolvedRoot) return resolvedTarget;
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel.length === 0 || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new PathOutsideRootError(target, root);
  }
  return resolvedTarget;
}

async function verifyPathSafe(target: string, root: string): Promise<string> {
  assertInsideRoot(target, root);
  const realRoot = await realpath(root);
  const lexicalTarget = resolve(target);
  let cursor = lexicalTarget;
  while (true) {
    try {
      const real = await realpath(cursor);
      assertInsideRoot(real, realRoot);
      return lexicalTarget;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new PathOutsideRootError(target, root);
      }
      cursor = parent;
    }
  }
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new InvalidNameError();
  }
  return trimmed;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  truncated?: boolean;
}

export interface GetTreeOptions {
  maxDepth?: number;
}

export async function getTree(rootPath: string, opts: GetTreeOptions = {}): Promise<TreeNode> {
  const root = resolve(rootPath);
  const st = await stat(root).catch(() => undefined);
  if (!st?.isDirectory()) {
    throw new NotFoundError(root);
  }
  const maxDepth = opts.maxDepth ?? DEFAULT_TREE_DEPTH;
  return walk(root, root, "", 0, maxDepth);
}

async function walk(
  dir: string,
  root: string,
  relPath: string,
  depth: number,
  maxDepth: number,
): Promise<TreeNode> {
  const name = relPath === "" ? "" : (relPath.split(sep).pop() ?? "");
  const node: TreeNode = {
    name,
    path: relPath,
    type: "directory",
    children: [],
  };
  if (depth >= maxDepth) {
    node.truncated = true;
    delete node.children;
    return node;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    node.truncated = true;
    delete node.children;
    return node;
  }
  entries.sort((a, b) => {
    const da = a.isDirectory() ? 0 : 1;
    const db = b.isDirectory() ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const ent of entries) {
    if (ent.isDirectory() && TREE_SKIP_DIRS.has(ent.name)) continue;
    const childRel = relPath === "" ? ent.name : `${relPath}${sep}${ent.name}`;
    const childAbs = join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = await walk(childAbs, root, childRel, depth + 1, maxDepth);
      node.children?.push(sub);
    } else if (ent.isFile()) {
      node.children?.push({
        name: ent.name,
        path: childRel,
        type: "file",
      });
    } else if (ent.isSymbolicLink()) {
      const linked = await safeLinkedStat(childAbs, root).catch(() => undefined);
      if (linked?.isDirectory()) {
        if (TREE_SKIP_DIRS.has(ent.name)) continue;
        const sub = await walk(childAbs, root, childRel, depth + 1, maxDepth);
        node.children?.push(sub);
      } else if (linked?.isFile()) {
        node.children?.push({
          name: ent.name,
          path: childRel,
          type: "file",
        });
      }
    }
  }
  return node;
}

async function safeLinkedStat(path: string, root: string) {
  await verifyPathSafe(path, root);
  return stat(path);
}

export async function listAllFiles(rootPath: string): Promise<string[]> {
  const root = resolve(rootPath);
  const st = await stat(root).catch(() => undefined);
  if (!st?.isDirectory()) throw new NotFoundError(root);
  const out: string[] = [];
  await walkFlat(root, root, "", out);
  return out;
}

async function walkFlat(dir: string, root: string, relPath: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (TREE_SKIP_DIRS.has(name)) continue;
      const dirRel = relPath === "" ? name : `${relPath}/${name}`;
      out.push(`${dirRel}/`);
      await walkFlat(join(dir, name), root, dirRel, out);
    } else if (entry.isFile()) {
      out.push(relPath === "" ? name : `${relPath}/${name}`);
    }
  }
}

export interface ReadResult {
  path: string;
  content: string;
  size: number;
  language: string;
  binary: boolean;
}

export async function readFile(absPath: string, root: string): Promise<ReadResult> {
  const resolved = await verifyPathSafe(absPath, root);
  const st = await stat(resolved).catch(() => undefined);
  if (st === undefined) throw new NotFoundError(resolved);
  if (!st.isFile()) throw new NotAFileError(resolved);
  if (st.size > MAX_READ_BYTES) throw new FileTooLargeError(resolved, st.size, MAX_READ_BYTES);
  const buf = await fsReadFile(resolved);
  const binary = looksBinary(buf);
  return {
    path: resolved,
    content: binary ? "" : buf.toString("utf8"),
    size: st.size,
    language: detectLanguage(resolved),
    binary,
  };
}

function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function writeFile(absPath: string, root: string, content: string): Promise<void> {
  const resolved = await verifyPathSafe(absPath, root);
  await mkdir(dirname(resolved), { recursive: true });
  const tmp = `${resolved}.${randomUUID()}.tmp`;
  await fsWriteFile(tmp, content, "utf8");
  await fsRename(tmp, resolved);
}

export async function downloadStream(
  absPath: string,
  root: string,
): Promise<
  | { kind: "file"; filename: string; size: number; stream: Readable }
  | { kind: "directory"; filename: string; stream: Readable }
> {
  const resolved = await verifyPathSafe(absPath, root);
  const st = await stat(resolved).catch(() => undefined);
  if (st === undefined) throw new NotFoundError(resolved);
  if (st.isFile()) {
    return {
      kind: "file",
      filename: basename(resolved),
      size: st.size,
      stream: createReadStream(resolved),
    };
  }
  if (st.isDirectory()) {
    const dirName = basename(resolved).length > 0 ? basename(resolved) : "project";
    const parentDir = dirname(resolved);
    const tmpZip = join(tmpdir(), `${dirName}-${randomUUID()}.zip`);
    // Build exclude patterns for directories we skip (node_modules, .git, etc.)
    const excludeArgs = Array.from(TREE_SKIP_DIRS).map((d) => `-x "${d}/*" "${d}"`).join(" ");
    execSync(`cd "${parentDir}" && zip -r "${tmpZip}" "${dirName}" ${excludeArgs}`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000, // 5 min for large dirs
    });
    const stream = createReadStream(tmpZip);
    stream.on("end", () => {
      try { unlinkSync(tmpZip); } catch { /* best-effort cleanup */ }
    });
    stream.on("error", () => {
      try { unlinkSync(tmpZip); } catch { /* best-effort cleanup */ }
    });
    return { kind: "directory", filename: `${dirName}.zip`, stream };
  }
  throw new NotFoundError(resolved);
}

export async function writeFileBytes(
  parentAbsPath: string,
  name: string,
  root: string,
  source: AsyncIterable<Buffer | Uint8Array>,
  opts?: { expectedSha256?: string; overwrite?: boolean },
): Promise<{ path: string; size: number; sha256: string }> {
  const parent = await verifyPathSafe(parentAbsPath, root);
  const trimmed = validateName(name);
  const target = await verifyPathSafe(join(parent, trimmed), root);
  const existing = await stat(target).catch(() => undefined);
  if (existing !== undefined) {
    if (opts?.overwrite !== true) throw new TargetExistsError(target);
    if (!existing.isFile()) throw new InvalidNameError("target is a directory");
  }
  await mkdir(parent, { recursive: true });
  const tmp = `${target}.${randomUUID()}.upload.tmp`;
  const hash = createHash("sha256");
  let size = 0;
  const out = createWriteStream(tmp);
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      size += buf.byteLength;
      if (!out.write(buf)) await once(out, "drain");
    }
    out.end();
    await once(out, "close");
  } catch (err) {
    out.destroy();
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  const actual = hash.digest("hex");
  const expected = opts?.expectedSha256?.toLowerCase();
  if (expected !== undefined && expected !== actual) {
    await unlink(tmp).catch(() => undefined);
    throw new ChecksumMismatchError(target, expected, actual);
  }
  await fsRename(tmp, target);
  return { path: target, size, sha256: actual };
}

export async function makeDirectory(
  parentAbsPath: string,
  root: string,
  name: string,
): Promise<string> {
  const trimmed = validateName(name);
  const parent = await verifyPathSafe(parentAbsPath, root);
  const target = await verifyPathSafe(join(parent, trimmed), root);
  const exists = await stat(target).catch(() => undefined);
  if (exists !== undefined) throw new TargetExistsError(target);
  await mkdir(target, { recursive: false });
  return target;
}

export async function renameEntry(absPath: string, root: string, newName: string): Promise<string> {
  const resolved = await verifyPathSafe(absPath, root);
  const trimmed = validateName(newName);
  const target = await verifyPathSafe(join(dirname(resolved), trimmed), root);
  const st = await stat(resolved).catch(() => undefined);
  if (st === undefined) throw new NotFoundError(resolved);
  if (resolved === target) return target;
  if (resolved.toLowerCase() === target.toLowerCase()) {
    const tmp = `${resolved}.casefix-${randomUUID()}`;
    await fsRename(resolved, tmp);
    try {
      const squatter = await stat(target).catch(() => undefined);
      if (squatter !== undefined) throw new TargetExistsError(target);
      await fsRename(tmp, target);
    } catch (err) {
      await fsRename(tmp, resolved).catch(() => undefined);
      throw err;
    }
    return target;
  }
  const exists = await stat(target).catch(() => undefined);
  if (exists !== undefined) throw new TargetExistsError(target);
  await fsRename(resolved, target);
  return target;
}

export async function moveEntry(
  srcAbsPath: string,
  destAbsPath: string,
  root: string,
): Promise<string> {
  const src = await verifyPathSafe(srcAbsPath, root);
  const dest = await verifyPathSafe(destAbsPath, root);
  const st = await stat(src).catch(() => undefined);
  if (st === undefined) throw new NotFoundError(src);
  if (st.isDirectory()) {
    const rel = relative(src, dest);
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`))) {
      throw new InvalidNameError("cannot move a directory into itself");
    }
  }
  const exists = await stat(dest).catch(() => undefined);
  if (exists !== undefined) throw new TargetExistsError(dest);
  await mkdir(dirname(dest), { recursive: true });
  await fsRename(src, dest);
  return dest;
}

export async function deleteEntry(
  absPath: string,
  root: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  const resolved = await verifyPathSafe(absPath, root);
  if (resolved === resolve(root)) {
    throw new PathOutsideRootError(absPath, root);
  }
  const st = await stat(resolved).catch(() => undefined);
  if (st === undefined) throw new NotFoundError(resolved);
  if (st.isDirectory()) {
    if (opts?.recursive === true) {
      await rm(resolved, { recursive: true, force: false });
      return;
    }
    try {
      await rmdir(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOTEMPTY") {
        throw new DirectoryNotEmptyError(resolved);
      }
      throw err;
    }
  } else {
    await rm(resolved, { force: false });
  }
}

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".go": "go",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "css",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".plist": "xml",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".sql": "sql",
  ".dockerfile": "dockerfile",
  ".jinja": "jinja2",
  ".jinja2": "jinja2",
  ".j2": "jinja2",
  ".env": "properties",
  ".ini": "properties",
  ".cfg": "properties",
  ".conf": "properties",
  ".properties": "properties",
  ".toml.lock": "toml",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".r": "r",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".diff": "diff",
  ".patch": "diff",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".scala": "scala",
  ".sc": "scala",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".cmake": "cmake",
  ".mk": "makefile",
};

function detectLanguage(absPath: string): string {
  const base = absPath.split(sep).pop() ?? absPath;
  if (base === "Dockerfile" || base.endsWith(".Dockerfile")) return "dockerfile";
  if (base === "Makefile" || base === "makefile" || base === "GNUmakefile") return "makefile";
  if (base === "nginx.conf") return "nginx";
  if (base === ".env" || base.startsWith(".env.")) return "properties";
  if (
    base === ".gitignore" ||
    base === ".dockerignore" ||
    base === ".npmignore" ||
    base === ".prettierignore" ||
    base === ".eslintignore"
  ) {
    return "properties";
  }
  if (base === "CMakeLists.txt") return "cmake";
  const ext = extname(base).toLowerCase();
  return LANG_BY_EXT[ext] ?? "plaintext";
}
