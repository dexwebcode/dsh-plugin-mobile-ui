//#region lib/types/config.js
// 03-config.js — схема настроек relay и её согласованность.
/**
* The settings form's fields, and the reason each one carries `.volatile()`.
*
* On dsh 0.1.7 the Plugins page builds an entry's form with `volatileForm()`,
* which keeps **only** the fields whose nearest marked ancestor is volatile and
* returns `undefined` for a schema with none. `describe()` then drops any entry
* whose form came back `undefined`, so a schema with no `.volatile()` is a
* schema with no settings page at all — not an empty one, an absent one.
*
* `.volatile()` also makes the resolved value a **live handle** rather than a
* copy, which is why {@link plainConfig} reads through them on every use.
*
* The annotation is deliberately `z<ConfigSchema>` rather than left to
* inference: the inferred type is schemastery's internal `ObjectS`/`ObjectT`
* pair, which cannot be written down, and the two types it must line up with —
* `Config` for plugin code and `ConfigSchema` for the handles — are already
* declared. `@deepseek-ai/dsh-agent-default-model` reaches the same place by
* inferring throughout, which only works because it never needs the plain type.
*/
const Config = z.object({
	bind: z.string().default("0.0.0.0").description("Listen address of the primary (TLS) listener.").volatile(),
	port: z.natural().max(65535).default(3443).description("Listen port of the primary listener.").volatile(),
	stateDir: z.string().required(),
	trustedHosts: z.array(String).default([]).description("Extra authorities this relay answers to, beyond those derived from its bind.").volatile(),
	publicHostnames: z.array(String).default([]).description("Extra certificate names and pairing authorities, for a port-forwarded deployment.").volatile(),
	tls: z.union([
		"self-signed",
		"files",
		"off"
	]).default("self-signed").description("Transport posture of the primary listener.").volatile(),
	tlsCertPath: z.string().default("").description("Certificate path, required when tls is \"files\".").volatile(),
	tlsKeyPath: z.string().default("").description("Private key path, required when tls is \"files\".").volatile(),
	auth: z.union([
		"password",
		"device-token",
		"both"
	]).default("both").description("Credential classes the relay accepts.").volatile(),
	sessionTtlMs: z.natural().min(6e4).default(432e5).description("Lifetime of a browser sign-in cookie, in milliseconds.").volatile(),
	deviceTokenTtlMs: z.natural().min(6e4).default(2592e6).description("Lifetime of a paired device token, in milliseconds.").volatile(),
	pairingWindowMs: z.natural().min(1e4).default(3e5).description("How long a pairing code stays claimable, in milliseconds.").volatile(),
	pairingCodeLength: z.natural().min(6).max(12).default(8).description("Digits in a numeric pairing passcode.").volatile(),
	maxFailedAttempts: z.natural().min(1).default(5).description("Failed sign-ins from one address before it is locked out.").volatile(),
	lockoutMs: z.natural().min(1e3).default(9e5).description("Lockout duration after maxFailedAttempts, in milliseconds.").volatile(),
	rateLimitPerMinute: z.natural().min(1).default(600).description("Requests per minute per source address, across every path.").volatile(),
	privilegedMethods: z.union(["allow-authenticated", "loopback-only"]).default("allow-authenticated").description("Whether an authenticated remote client reaches the harness configuration plane.").volatile(),
	extraProxyPaths: z.array(String).default([]).description("Path prefixes proxied beyond the built-in set; each must start with \"/\".").volatile(),
	proxyTimeoutMs: z.natural().min(1e3).default(12e4).description("Upstream response deadline for a proxied request, in milliseconds.").volatile(),
	compat: z.object({
		addressGrants: z.boolean().default(true).description("Accept requests from an address a paired device was last seen on. Not authentication.").volatile(),
		addressGrantTtlMs: z.natural().min(6e4).default(864e5).description("Lifetime of one address grant, in milliseconds.").volatile(),
		plainPort: z.natural().max(65535).default(0).description("Extra plain-HTTP listener port for clients that cannot speak TLS. Zero disables it.").volatile()
	}),
	uiLink: z.boolean().default(true).description("Add a link to the relay pages into the harness web UI.").volatile(),
	mdns: z.boolean().default(true).description("Advertise _dsh._tcp over mDNS.").volatile(),
	mdnsName: z.string().default("").description("Service name used in the mDNS advertisement; empty derives one from the hostname.").volatile()
});
/**
* Read the live values out of a resolved {@link ConfigSchema}.
*
* Every `.volatile()` field resolves to a handle rather than a value, so the
* plugin's own code — which has no business knowing about handles — reads
* through them here, once, at the boundary. Calling this on every use is the
* point: it is what makes a settings edit visible to a running relay instead of
* frozen at the value the process started with.
*
* `stateDir` is the one plain field and is copied straight across.
*
* @param config - the resolved schema instance handed to `apply`.
* @returns a snapshot of the current configuration, in plain values.
*/
function plainConfig(config) {
	return {
		bind: config.bind.get(),
		port: config.port.get(),
		stateDir: config.stateDir,
		trustedHosts: [...config.trustedHosts.get()],
		publicHostnames: [...config.publicHostnames.get()],
		tls: config.tls.get(),
		tlsCertPath: config.tlsCertPath.get(),
		tlsKeyPath: config.tlsKeyPath.get(),
		auth: config.auth.get(),
		sessionTtlMs: config.sessionTtlMs.get(),
		deviceTokenTtlMs: config.deviceTokenTtlMs.get(),
		pairingWindowMs: config.pairingWindowMs.get(),
		pairingCodeLength: config.pairingCodeLength.get(),
		maxFailedAttempts: config.maxFailedAttempts.get(),
		lockoutMs: config.lockoutMs.get(),
		rateLimitPerMinute: config.rateLimitPerMinute.get(),
		privilegedMethods: config.privilegedMethods.get(),
		extraProxyPaths: [...config.extraProxyPaths.get()],
		proxyTimeoutMs: config.proxyTimeoutMs.get(),
		compat: {
			addressGrants: config.compat.addressGrants.get(),
			addressGrantTtlMs: config.compat.addressGrantTtlMs.get(),
			plainPort: config.compat.plainPort.get()
		},
		uiLink: config.uiLink.get(),
		mdns: config.mdns.get(),
		mdnsName: config.mdnsName.get()
	};
}
/**
* Reject a configuration whose fields contradict each other.
*
* Self-contained constraints the schema cannot express fail here, at load,
* rather than at the first request that trips over them.
* @param config - the resolved configuration.
* @throws {Error} naming the field pair that cannot hold together.
*/
function assertCoherent(config) {
	if (config.tls === "files" && (config.tlsCertPath === "" || config.tlsKeyPath === "")) throw new Error("dsh-relay: tls \"files\" requires both tlsCertPath and tlsKeyPath");
	if (config.compat.plainPort !== 0 && config.compat.plainPort === config.port) throw new Error("dsh-relay: compat.plainPort must differ from port");
	for (const path of config.extraProxyPaths) if (!path.startsWith("/")) throw new Error(`dsh-relay: extraProxyPaths entry ${JSON.stringify(path)} must start with "/"`);
}

//#endregion
