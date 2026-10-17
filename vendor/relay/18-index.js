//#region lib/types/index.js
// 18-index.js — плагин целиком: Config, apply и надзор за слушателями.
/** Stable Cordis plugin name. */
const name = "relay";
/** The harness web server this relay fronts. */
const inject = ["webServer"];
/**
* The plugin object the Cordis loader registers, and the only reason this
* module has a default export.
*
* The loader normalizes a module's exports down to a single plugin object —
* `unwrapExports` is `exports.default ?? exports` — and then caches the
* configuration schema off **that** object, as `{ name, callback, fibers,
* Config: plugin.Config }`. The harness's settings plane reads it back with
* `entry.fiber.runtime.Config` to decide whether an entry is an editable
* namespace at all.
*
* A module that exports a bare `apply` **function** therefore has no `.Config`
* for anyone to find, and its entry is invisible to the Plugins page no matter
* how correct the rest is: the Host serves no namespace, and the browser card
* has nothing to attach to. Verified against dsh 0.1.7-rc.2, where this plugin
* with only the named exports contributes **zero** namespaces to
* `settings/describe`.
*/
var types_default = {
	name,
	inject,
	apply,
	Config
};
/** The relay's own logging, degraded to the console when no logger is mounted. */
function loggerFor(ctx) {
	const logger = ctx.get("logger");
	return {
		info: (message) => void (logger?.info?.(`[dsh-relay] ${message}`) ?? console.log(`[dsh-relay] ${message}`)),
		warn: (message) => void (logger?.warn?.(`[dsh-relay] ${message}`) ?? console.warn(`[dsh-relay] ${message}`))
	};
}
/**
* Mount the relay.
* @param ctx - plugin context; `ctx.webServer` is the harness listener to front.
* @param config - resolved configuration.
*/
function apply(ctx, config) {
	const initial = plainConfig(config);
	assertCoherent(initial);
	for (const entry of [...initial.trustedHosts, ...initial.publicHostnames]) assertTrustedAuthority(entry);
	if (ctx.webServer.host === "0.0.0.0") throw new Error("dsh-relay: the harness web server is bound to 0.0.0.0, so it is already reachable without authentication and this relay would protect nothing. Remove the webserver row override that sets host: 0.0.0.0 (the DSH Mobile LAN patch) and restart.");
	const log = loggerFor(ctx);
	ctx.effect(() => {
		const supervisor = new Supervisor(ctx, log);
		const read = () => plainConfig(config);
		followSettings(ctx, { onChange: () => {
			supervisor.apply(read());
		} });
		supervisor.apply(read());
		return async () => {
			await supervisor.stop();
		};
	}, "dsh-relay: listeners");
}
/**
* Keeps exactly one relay running across configuration changes.
*
* A settings edit replaces the whole resolved configuration, including the
* listen ports, so the response is to tear the listeners down and bind again.
* Every transition runs on one chain: overlapping edits would otherwise race
* to bind the same port, and re-listening before the previous close has
* settled fails with EADDRINUSE. A generation counter lets a superseded
* transition drop out instead of starting a relay nobody asked for.
*/
var Supervisor = class {
	ctx;
	log;
	#generation = 0;
	#chain = Promise.resolve();
	#running;
	#applied;
	/**
	* @param ctx - the plugin context passed through to each launch.
	* @param log - the relay's logging.
	*/
	constructor(ctx, log) {
		this.ctx = ctx;
		this.log = log;
	}
	/**
	* Run the relay under a new configuration, replacing any current one.
	*
	* An unusable configuration leaves the running relay alone rather than
	* taking it down: a typo in a settings form should not cost the operator
	* their remote access until they can reach the machine to fix it.
	* @param config - the newly resolved configuration.
	*/
	apply(config) {
		try {
			assertCoherent(config);
		} catch (error) {
			this.log.warn(`ignoring an unusable configuration, keeping the running one: ${String(error)}`);
			return;
		}
		const fingerprint = JSON.stringify(config);
		if (fingerprint === this.#applied) return;
		this.#applied = fingerprint;
		const mine = ++this.#generation;
		this.#chain = this.#chain.then(async () => {
			if (mine !== this.#generation) return;
			await this.#running?.stop();
			this.#running = void 0;
			if (mine !== this.#generation) return;
			try {
				this.#running = await start(this.ctx, config, this.log);
			} catch (error) {
				this.log.warn(`failed to start: ${String(error)}`);
			}
		}, () => void 0);
	}
	/**
	* Stop for good.
	* @returns resolution once the last transition has settled and the listeners are closed.
	*/
	async stop() {
		this.#generation += 1;
		await this.#chain;
		await this.#running?.stop();
		this.#running = void 0;
	}
};
/**
* Open the state store, load the certificate, and bind the listeners.
* @param ctx - plugin context.
* @param config - resolved configuration.
* @param log - the relay's logging.
* @returns the running relay.
*/
async function start(ctx, config, log) {
	const dir = relayStateDir(ctx, config.stateDir);
	const store = await RelayStore.open(dir);
	const auth = new Authenticator(store, config);
	const sans = certificateSans(config.publicHostnames);
	const material = await loadCertificate({
		mode: config.tls,
		dir,
		certPath: config.tlsCertPath,
		keyPath: config.tlsKeyPath,
		sans,
		existing: store.state.certificate
	});
	if (material !== void 0 && material.record.fingerprint !== store.state.certificate?.fingerprint) await store.update((draft) => {
		draft.certificate = material.record;
	});
	const resolver = HarnessSession.lazy(ctx);
	await resolver.current();
	if (!resolver.ready) log.info("no harness browser-session secret yet; forwarding unauthenticated until it appears. That is correct for a harness before 0.1.2. On 0.1.2 or later the harness writes that secret once it has started, and the relay picks it up on the next request without a reload.");
	const runtime = {
		auth,
		config,
		target: {
			host: "127.0.0.1",
			port: ctx.webServer.port,
			timeoutMs: config.proxyTimeoutMs,
			session: () => resolver.sync()
		},
		fingerprint: material?.record.fingerprint,
		log: (message) => {
			log.warn(message);
		}
	};
	const poll = setInterval(() => {
		if (resolver.ready) {
			clearInterval(poll);
			if (resolver.markRecovered()) log.info("harness browser session is available; proxied requests now authenticate");
			return;
		}
		resolver.current();
	}, 1e3);
	poll.unref?.();
	const authorities = relayAuthorities(config);
	const primary = await startListener({
		runtime,
		bind: config.bind,
		port: config.port,
		tls: material,
		authorities
	});
	const compat = config.compat.plainPort === 0 ? void 0 : await startListener({
		runtime,
		bind: config.bind,
		port: config.compat.plainPort,
		compat: true,
		authorities
	});
	if (compat !== void 0) runtime.plainPort = compat.port;
	const scheme = material === void 0 ? "http" : "https";
	const unroute = ctx.webServer.register({
		kind: "prefix",
		path: RELAY_PREFIX,
		handler: (req, res) => {
			const target = `${scheme}://${(typeof req.headers.host === "string" ? req.headers.host : "127.0.0.1").replace(/:\d+$/, "")}:${String(primary.port)}${req.url ?? RELAY_PREFIX}`;
			res.writeHead(302, {
				location: target,
				"cache-control": "no-store"
			});
			res.end();
		}
	});
	const untap = config.uiLink ? ctx.webServer.tapIndex(injectRelayLink) : () => void 0;
	const untapShim = ctx.webServer.tapIndex(injectSecureContextShim);
	const reachable = ["127.0.0.1", ...localAddresses()].map((address) => `${scheme}://${address}:${String(primary.port)}`).join(" ");
	log.info(`listening on ${reachable} (harness on 127.0.0.1:${String(ctx.webServer.port)})`);
	if (material === void 0) log.warn("serving plaintext: anything on the network path can read this traffic and the credentials on it");
	if (compat !== void 0) log.warn(`plain compatibility listener on port ${String(compat.port)}: DSH Mobile 0.5.0 only, no configuration access`);
	if (!auth.hasPassword) log.info(`no password set yet — open ${scheme}://127.0.0.1:${String(primary.port)}/relay/password on this machine to set one`);
	const unadvertise = config.mdns ? await advertise({
		port: primary.port,
		plainPort: compat?.port,
		tls: config.tls,
		fingerprint: material?.record.fingerprint,
		name: config.mdnsName
	}, (message) => {
		log.warn(message);
	}) : async () => void 0;
	return { stop: async () => {
		clearInterval(poll);
		untapShim();
		untap();
		unroute();
		await unadvertise();
		await compat?.close();
		await primary.close();
		auth.dispose();
		await store.close();
	} };
}

//#endregion
export { Config, apply, types_default as default, inject, name, plainConfig };
