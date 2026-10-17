//#region lib/types/privileged.js
// 13-privileged.js — какие методы API доступны удалённому клиенту.
/**
* The harness methods the relay keeps to the machine running the harness.
*
* Through harness 0.1.1 this was a mirror. The harness pinned its own
* `PRIVILEGED_METHODS` list, re-checking each entry against an empty trusted
* list so only a genuine loopback caller reached them, and the relay's `Host`
* rewrite would have silently lifted that pin — so the relay re-imposed the
* same list before proxying.
*
* **Harness 0.1.2 deleted that list.** There is no method tier left upstream:
* the whole `/api` surface is authenticated uniformly, and possession of a
* browser session authorizes all of it — the same authority the web app has
* after creating a session. So this is no longer a mirror of anything. It is
* the relay's own policy, and the only thing standing between a paired phone
* and the operator's credential store.
*
* That difference matters for how the list is maintained. A mirror could be
* checked for drift against the harness; this cannot, because there is nothing
* to check it against. It is a judgement about which operations a *remote*
* device should reach, and it is deliberately conservative: an endpoint this
* list does not name is reachable by any paired device.
* @module dsh-relay/privileged
*/
/**
* Remote endpoints the relay serves only to loopback callers under
* `privilegedMethods: 'loopback-only'`.
*
* They are privileged for two different reasons. The settings and credential
* domains mutate the operator's configuration and secret store, and READING
* them is equally sensitive: `settings/describe` returns every exposed
* namespace and `credentials/describe` reports whether an arbitrary
* environment variable is configured and where from. `directoryPicker/*` and
* `session/openWorkspacePath` act on the host desktop. `llm/discoverModels`
* carries a draft credential and makes the host issue a request to a URL the
* caller chose, which probes whatever the host can reach and the client
* cannot. Agent-preset authoring names the plugins a session runs.
*
* Endpoint names are `namespace/method`, matching the 0.1.2 wire. The 0.1.1
* `domain.method` spelling is retained alongside each so one relay build keeps
* gating correctly against either harness — a name that no longer exists
* simply never matches.
*/
const PRIVILEGED_METHODS = new Set([
	"agentPresets/read",
	"agentPresets/copy",
	"agentPresets/deletePreset",
	"agentPreset.read",
	"agentPreset.copy",
	"agentPreset.openDocument",
	"agentPreset.remove",
	"directoryPicker/pick",
	"directoryPicker/list",
	"directoryPicker/createDirectory",
	"session/openWorkspacePath",
	"host.pickDirectory",
	"host.openPath",
	"host.listDirectory",
	"host.createDirectory",
	"settings/describe",
	"settings/update",
	"settings/replace",
	"settings/mutate",
	"settings/openSettingsDocument",
	"settings/openAgentPresetDirectory",
	"settings.describe",
	"settings.openDocument",
	"settings.update",
	"settings.replace",
	"settings.mutate",
	"credentials/describe",
	"credentials/set",
	"credentials/unset",
	"credentials.describe",
	"credentials.set",
	"credentials.unset",
	"llm/discoverModels",
	"llm.discoverModels"
]);
/**
* The `/api` endpoint a pathname addresses.
*
* Everything after `/api/`, not just the first segment: 0.1.2 endpoints carry
* two (`settings/update`), and taking only the first would have matched the
* whole `settings` namespace — including calls this list does not name.
* @param pathname - the request pathname, already decoded.
* @returns the endpoint name, or undefined when the path is not an `/api` call.
*/
function apiMethodOf(pathname) {
	return pathname.startsWith("/api/") ? pathname.slice(5) : void 0;
}
/**
* Whether a request must be refused because it addresses a pinned endpoint.
* @param pathname - the request pathname.
* @param allowed - whether this credential class may reach the pinned set.
* @returns true when the request must be refused before proxying.
*/
function isPinnedMethod(pathname, allowed) {
	if (allowed) return false;
	const method = apiMethodOf(pathname);
	return method !== void 0 && PRIVILEGED_METHODS.has(method);
}

//#endregion
