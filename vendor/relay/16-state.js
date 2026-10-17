//#region lib/types/state.js
// 16-state.js — файл состояния relay.
/** On-disk format version; a file stamped with anything else is refused. */
const STATE_VERSION = 1;
/** File name under the relay state directory. */
const STATE_FILE = "state.json";
/** Owner-only permissions for every file this module writes. */
const SECRET_MODE$1 = 384;
/** A fresh state with a new signing key and nothing enrolled. */
function emptyState() {
	return {
		version: STATE_VERSION,
		signingKey: randomBytes(32).toString("base64url"),
		devices: {},
		grants: {}
	};
}
/**
* The relay's state file.
*
* Reads are synchronous against the in-memory copy loaded at open. Every
* mutation goes through {@link update}, which applies the change in memory and
* persists the whole file before resolving, so an awaited mutation is durable.
*/
var RelayStore = class RelayStore {
	file;
	#state;
	#chain = Promise.resolve();
	#closed = false;
	constructor(file, state) {
		this.file = file;
		this.#state = state;
	}
	/**
	* Load the state file, creating it when absent.
	* @param dir - the relay state directory; created with owner-only permissions.
	* @returns the open store.
	* @throws {Error} when the file exists but is unparsable or carries another format version — a
	* corrupt credential store must fail loud rather than silently reset to "no password set".
	*/
	static async open(dir) {
		await mkdir(dir, {
			recursive: true,
			mode: 448
		});
		const file = join(dir, STATE_FILE);
		let state;
		try {
			const raw = await readFile(file, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed.version !== STATE_VERSION) throw new Error(`dsh-relay: ${file} has format version ${String(parsed.version)}, expected ${String(STATE_VERSION)}`);
			state = {
				...parsed,
				devices: parsed.devices ?? {},
				grants: parsed.grants ?? {}
			};
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			state = emptyState();
			await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: SECRET_MODE$1 });
		}
		return new RelayStore(file, state);
	}
	/**
	* Current state, synchronously from memory.
	* @returns the live state object; treat it as read-only and mutate through {@link update}.
	*/
	get state() {
		return this.#state;
	}
	/**
	* Apply one mutation and persist the result.
	* @param mutate - synchronous transform over a draft copy of the state.
	* @returns resolution after the new state is on disk.
	*/
	async update(mutate) {
		const task = this.#chain.then(async () => {
			if (this.#closed) throw new Error("dsh-relay: state store is closed");
			const draft = structuredClone(this.#state);
			mutate(draft);
			const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
			await writeFile(temp, `${JSON.stringify(draft, null, 2)}\n`, { mode: SECRET_MODE$1 });
			await rename(temp, this.file);
			this.#state = draft;
		});
		this.#chain = task.then(() => void 0, () => void 0);
		return task;
	}
	/**
	* Drain queued writes and refuse further ones.
	* @returns resolution after the last queued write has landed.
	*/
	async close() {
		const drained = this.#chain;
		this.#closed = true;
		await drained;
	}
};

//#endregion
