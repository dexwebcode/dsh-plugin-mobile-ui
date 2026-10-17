//#region lib/types/auth/pairing.js
// 03-pairing.js — окно одноразового кода и содержимое QR.
/**
* The live pairing window.
*
* At most one code is outstanding: a second `issue()` replaces the first, so
* an operator who re-opens the pairing screen cannot accidentally leave a
* forgotten invitation valid behind them.
*/
var PairingWindow = class {
	#current;
	/**
	* Issue a fresh code, replacing any outstanding one.
	* @param digits - length of the numeric code.
	* @param windowMs - how long it stays claimable.
	* @param now - current epoch millis.
	* @returns the new code.
	*/
	issue(digits, windowMs, now) {
		let code = "";
		while (code.length < digits) code += String(randomInt(0, 10));
		this.#current = {
			code,
			expiresAt: now + windowMs
		};
		return this.#current;
	}
	/**
	* The outstanding code, if one is still claimable.
	* @param now - current epoch millis.
	* @returns the code, or undefined when none is outstanding or it expired.
	*/
	peek(now) {
		if (this.#current === void 0) return void 0;
		if (now >= this.#current.expiresAt) {
			this.#current = void 0;
			return;
		}
		return this.#current;
	}
	/**
	* Claim the outstanding code.
	*
	* Success consumes it, so a code intercepted in transit is worthless once
	* the intended device has used it — and an operator who sees an unexpected
	* "already paired" is being told the code leaked.
	* @param candidate - the code as presented.
	* @param now - current epoch millis.
	* @returns true when the code matched and has now been consumed.
	*/
	claim(candidate, now) {
		const current = this.peek(now);
		if (current === void 0) return false;
		if (!constantTimeEqual(candidate, current.code)) return false;
		this.#current = void 0;
		return true;
	}
	/** Withdraw any outstanding code. */
	clear() {
		this.#current = void 0;
	}
};
/**
* Build the payload a QR code or a copied link carries.
* @param parts - the relay's reachable origins, certificate identity, and live code.
* @returns the payload, ready to serialize.
*/
function pairingPayload(parts) {
	return {
		v: 1,
		kind: "dsh-relay-pair",
		url: parts.url,
		...parts.plainUrl !== void 0 && { plainUrl: parts.plainUrl },
		...parts.fingerprint !== void 0 && { fingerprint: parts.fingerprint },
		code: parts.code.code,
		expiresAt: parts.code.expiresAt
	};
}

//#endregion
