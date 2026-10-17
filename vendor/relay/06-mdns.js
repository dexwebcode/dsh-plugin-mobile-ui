//#region lib/types/mdns.js
// 06-mdns.js — объявление relay в локальной сети через mDNS.
/** The DNS-SD service type the relay publishes under. */
const SERVICE_TYPE = "dsh";
/**
* Publish the relay on the local network.
* @param advertisement - what to announce.
* @param onError - reports a failure to advertise; advertising is best-effort
* and must never take the relay down with it.
* @returns a disposer that withdraws the record.
*/
async function advertise(advertisement, onError) {
	let bonjour;
	try {
		bonjour = new (await (import("bonjour-service"))).Bonjour();
	} catch (error) {
		onError(`mDNS unavailable: ${String(error)}`);
		return async () => void 0;
	}
	try {
		bonjour.publish({
			name: advertisement.name === "" ? `DSH Relay on ${hostname()} (${String(advertisement.port)})` : advertisement.name,
			type: SERVICE_TYPE,
			port: advertisement.port,
			txt: {
				v: "1",
				relay: "dsh-relay",
				tls: advertisement.tls,
				...advertisement.plainPort !== void 0 && { plain: String(advertisement.plainPort) },
				...advertisement.fingerprint !== void 0 && { pin: advertisement.fingerprint }
			}
		}).on("error", (error) => {
			onError(`mDNS advertisement failed, continuing without it: ${String(error)}`);
		});
	} catch (error) {
		onError(`mDNS publish failed: ${String(error)}`);
		bonjour.destroy();
		return async () => void 0;
	}
	return async () => {
		await new Promise((resolve$1) => {
			bonjour.unpublishAll(() => {
				resolve$1();
			});
		});
		bonjour.destroy();
	};
}

//#endregion
