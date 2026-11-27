// Minimal stand-in for the "obsidian" module, enough for pure-logic tests.
export class TAbstractFile {
	path = "";
	name = "";
}
export class TFolder extends TAbstractFile {
	isRoot() {
		return this.path === "/";
	}
}
export class TFile extends TAbstractFile {
	extension = "md";
}
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/";
export const getAllTags = (c: { tags?: string[] }) => c?.tags ?? [];
