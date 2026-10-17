//#region lib/types/settings-section.js
// 08-settings-section.js — раздел настроек relay в интерфейсе harness.
/**
* Publishing the relay's configuration to the harness settings plane, and
* following edits to it.
*
* **How this works on dsh 0.1.7, which is not how it worked before.**
*
* Through 0.1.5 a plugin registered a namespace imperatively —
* `ctx.settings.register(ns, schema, { base })` — and got back a scope to read
* and watch. That API is gone. On 0.1.7 the settings plane reads the schema off
* the **loader entry** itself (`entry.fiber.runtime.Config`) and serves the
* entry's own `id` as the namespace; writes land in the profile patch document
* and are re-resolved into the plugin's live config.
*
* So there is nothing to register here. The namespace is `relay`, which is the
* row id this bundle's patch declares, and it exists as soon as the row does —
* see the default export in `src/index.ts` for the half of that contract which
* is easy to miss and leaves no error behind.
*
* What is left to do is **follow the changes**. A `.volatile()` field resolves
* to a live handle rather than a copy, and a settings write swaps the value
* under the running plugin. The relay's listeners are built from that value, so
* a change has to reach {@link Supervisor.apply} — and taking a listener down
* is exactly the kind of side effect that must not happen while the plugin is
* unloading.
*
* @module dsh-relay/settings-section
*/
/**
* Value mirror of the `FiberState` members {@link isUnloading} compares
* against. A const enum has no runtime object to import, and the comparison
* happens at runtime.
*/
const FIBER_DISPOSED = 4;
const FIBER_UNLOADING = 5;
/** The settings namespace this plugin owns, in both halves. */
const RELAY_NAMESPACE = "relay";
/** Namespaces must be lowercase kebab-case, as the service brands them. */
const NAMESPACE_PATTERN = /^[a-z][\da-z]*(-[\da-z]+)*$/;
/**
* Whether the consumer's own fiber is tearing down, rather than merely losing
* the settings service.
*
* The distinction decides whether a change notification is useful or harmful:
* a provider detaching leaves the relay running, while the relay's own unload
* would have `onChange` rebuilding listeners over resources the teardown is
* releasing.
* @param ctx - the consumer's plugin context.
* @returns true while this plugin is unloading or disposed.
*/
function isUnloading(ctx) {
	const state = ctx.fiber.state;
	return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
/**
* Follow edits to the relay's configuration.
*
* A settings write on 0.1.7 re-resolves the entry's config and emits
* `settings/document-updated` with the entry id. The plugin's own `config`
* object is a set of live handles, so by the time the event arrives the new
* values are already readable through it — the only thing needed here is to
* tell the relay to rebuild from them.
*
* A deployment without a settings plane never fires this, and the relay simply
* runs under the configuration it was composed with.
*
* @param ctx - the relay's plugin context.
* @param hooks.onChange - called after every change to the configuration.
* @returns a disposer removing the subscription.
*/
function followSettings(ctx, hooks) {
	if (!NAMESPACE_PATTERN.test(RELAY_NAMESPACE)) throw new Error(`dsh-relay: settings namespace ${JSON.stringify(RELAY_NAMESPACE)} must be lowercase kebab-case`);
	ctx.inject(["settings", "configEditor"], (scoped) => {
		if (scoped.get("configEditor").documentPath === void 0) return;
		const off = scoped.on("settings/document-updated", (ns) => {
			if (isUnloading(ctx)) return;
			if (ns !== RELAY_NAMESPACE) return;
			hooks.onChange();
		});
		scoped.effect(() => () => {
			off();
		}, "dsh-relay: settings subscription");
	});
	return () => void 0;
}

//#endregion
