/**
 * Surface extension-contributed tools from the filesystem (no live
 * session needed). Mirrors pi-forge's discoverExtensionResources.
 *
 * Uses the pi SDK's DefaultPackageManager + discoverAndLoadExtensions
 * to enumerate all registered tools from installed packages.
 */
import {
	discoverAndLoadExtensions,
	DefaultPackageManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { config } from "./config.js";

export interface ExtensionToolInfo {
	/** Tool name as the agent sees it (<toolName> from registerTool). */
	name: string;
	/** User-visible package name (e.g. "pi-web-access", "@ayulab/pi-rewind"). */
	packageSource: string;
	/** Human-readable description from the tool definition. */
	description: string;
}

export interface ExtensionResources {
	tools: ExtensionToolInfo[];
	errors: { path: string; error: string }[];
}

/**
 * Resolve extension-contributed tools visible to a session in `cwd`.
 * Uses the SDK package manager to discover installed packages, then
 * loads each extension to enumerate its registered tools.
 *
 * Failures inside individual packages surface as `errors[]` rather
 * than throwing — a single broken extension must not block the
 * tools listing.
 */
export async function discoverExtensionResources(
	cwd: string,
): Promise<ExtensionResources> {
	const errors: { path: string; error: string }[] = [];

	let extensionPathToPackage: Map<string, string>;
	try {
		const settingsManager = SettingsManager.create(cwd, config.piConfigDir);
		await settingsManager.reload?.();
		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir: config.piConfigDir,
			settingsManager,
		});
		const resolved = await packageManager.resolve();

		extensionPathToPackage = new Map();
		for (const r of resolved.extensions) {
			if (!r.enabled) continue;
			const src = r.metadata.source;
			if (typeof src !== "string" || src.length === 0) continue;
			// Normalize: strip npm: prefix so packageSource matches
			// ext.package from the /extensions endpoint (e.g. both
			// become "pi-web-access" instead of "npm:pi-web-access").
			const normalized = src.replace(/^npm:/, "");
			extensionPathToPackage.set(r.path, normalized);
		}

		// Also surface tools from extensions in the legacy extensions dir
		// that aren't behind a package manager entry (e.g. hand-dropped
		// extensions). Use their resolved path as the source name.
		for (const r of resolved.extensions) {
			if (!r.enabled) continue;
			const src = r.metadata.source;
			if (typeof src === "string" && src.length > 0) continue; // already mapped
			// Unattributed extension — use its name as fallback
			const name =
				r.path
					.split(/[/\\]/)
					.pop()
					?.replace(/\.\w+$/, "") ?? r.path;
			if (!extensionPathToPackage.has(r.path)) {
				extensionPathToPackage.set(r.path, name);
			}
		}
	} catch (err) {
		errors.push({
			path: "<package-manager>",
			error: err instanceof Error ? err.message : String(err),
		});
		return { tools: [], errors };
	}

	if (extensionPathToPackage.size === 0) {
		return { tools: [], errors };
	}

	let loaded: Awaited<ReturnType<typeof discoverAndLoadExtensions>>;
	try {
		loaded = await discoverAndLoadExtensions(
			Array.from(extensionPathToPackage.keys()),
			cwd,
			config.piConfigDir,
		);
	} catch (err) {
		errors.push({
			path: "<discoverAndLoadExtensions>",
			error: err instanceof Error ? err.message : String(err),
		});
		return { tools: [], errors };
	}

	for (const e of loaded.errors) {
		errors.push({ path: e.path, error: e.error });
	}

	const tools: ExtensionToolInfo[] = [];
	for (const ext of loaded.extensions) {
		const pkgSource =
			extensionPathToPackage.get(ext.path) ??
			extensionPathToPackage.get(ext.resolvedPath);
		if (pkgSource === undefined) continue;

		for (const [, registered] of ext.tools) {
			const def = registered.definition;
			const info: ExtensionToolInfo = {
				name: def.name,
				packageSource: pkgSource,
				description:
					typeof def.description === "string" && def.description.length > 0
						? def.description
						: "",
			};
			tools.push(info);
		}
	}

	return { tools, errors };
}
