//#region lib/types/paths.js
// 07-paths.js — каталог состояния relay и разбор DSH_HOME.
/** Directory name of the default harness home under the OS home directory. */
const DEFAULT_HOME_DIR = ".dsh";
/** Environment variable naming an explicit harness home. */
const HOME_ENV = "DSH_HOME";
/** Subdirectory of the harness home this plugin owns outright. */
const RELAY_DIR = "relay";
/**
* Expand the tilde prefixes the harness accepts in a configured path.
* @param path - configured path that may begin with `~`, `~/`, or `~\`.
* @returns the expanded path, or the original value when no prefix is present.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the directory holding this plugin's state, certificate, and key.
* @param ctx - plugin context, read for the optional `dshHomePath` service.
* @param configured - explicit override from plugin config; empty means unset.
* @returns the absolute directory path, not yet created on disk.
*/
function relayStateDir(ctx, configured) {
	if (configured !== void 0 && configured.trim().length > 0) return resolve(expandHomePath(configured));
	const provided = ctx.get("dshHomePath");
	if (typeof provided === "function") return provided(RELAY_DIR);
	const fromEnv = process.env[HOME_ENV];
	return join(resolve(expandHomePath(fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DEFAULT_HOME_DIR))), RELAY_DIR);
}

//#endregion
