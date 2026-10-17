//#region lib/types/tls.js
// 17-tls.js — самоподписанный сертификат и его отпечаток.
/** Owner-only permissions. A no-op on Windows — see {@link loadCertificate}. */
const SECRET_MODE = 384;
/** File name of the generated certificate. */
const CERT_FILE = "relay-cert.pem";
/** File name of the generated private key. */
const KEY_FILE = "relay-key.pem";
/** How long a generated certificate stays valid. */
const VALIDITY_DAYS = 825;
/** subjectAltName type codes from RFC 5280, as `selfsigned` spells them. */
const SAN_DNS = 2;
const SAN_IP = 7;
/**
* SHA-256 of a certificate's DER SubjectPublicKeyInfo, base64.
*
* This is the value a pinning client compares, and it is deliberately the
* public key rather than the whole certificate: renewing with the same key
* then leaves every paired device working.
* @param certPem - the certificate, PEM encoded.
* @returns the base64 digest.
*/
function spkiFingerprint(certPem) {
	const spki = new X509Certificate(certPem).publicKey.export({
		type: "spki",
		format: "der"
	});
	return createHash("sha256").update(spki).digest("base64");
}
/**
* The names a generated certificate must cover.
* @param publicHostnames - names a forwarded deployment is reached by.
* @returns DNS names and IP literals, deduplicated.
*/
function certificateSans(publicHostnames) {
	return [...new Set([
		"localhost",
		"127.0.0.1",
		...localAddresses(),
		...publicHostnames
	])];
}
/**
* Generate a certificate and write it beside the state file.
* @param dir - the relay state directory.
* @param sans - subject alternative names to cover.
* @returns the generated material.
*/
async function generate(dir, sans) {
	const { default: selfsigned } = await import("selfsigned");
	const notBefore = /* @__PURE__ */ new Date();
	const notAfter = new Date(notBefore.getTime() + VALIDITY_DAYS * 864e5);
	const pems = await selfsigned.generate([{
		name: "commonName",
		value: "dsh-relay"
	}], {
		keyType: "ec",
		curve: "P-256",
		algorithm: "sha256",
		notBeforeDate: notBefore,
		notAfterDate: notAfter,
		extensions: [
			{
				name: "basicConstraints",
				cA: false,
				critical: true
			},
			{
				name: "keyUsage",
				digitalSignature: true,
				keyEncipherment: true,
				critical: true
			},
			{
				name: "extKeyUsage",
				serverAuth: true
			},
			{
				name: "subjectAltName",
				altNames: sans.map((value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? {
					type: SAN_IP,
					ip: value
				} : {
					type: SAN_DNS,
					value
				})
			}
		]
	});
	await mkdir(dir, {
		recursive: true,
		mode: 448
	});
	await writeFile(join(dir, CERT_FILE), pems.cert, { mode: SECRET_MODE });
	await writeFile(join(dir, KEY_FILE), pems.private, { mode: SECRET_MODE });
	return {
		cert: pems.cert,
		key: pems.private,
		record: {
			fingerprint: spkiFingerprint(pems.cert),
			sans: [...sans],
			generatedAt: notBefore.getTime(),
			expiresAt: notAfter.getTime()
		}
	};
}
/**
* Load the certificate for the configured posture, generating one if needed.
*
* A generated certificate is regenerated when it has expired or when the set
* of addresses it covers has changed — a laptop that moved networks would
* otherwise present a certificate naming an address it no longer has.
*
* The private key is written mode 0600. **That is a no-op on Windows**, where
* the file inherits the ACL of the harness home directory; a deployment that
* shares that directory should restrict it with `icacls` or point `tls` at
* files it manages itself.
* @param options.mode - the configured posture; `off` returns undefined.
* @param options.dir - the relay state directory.
* @param options.certPath - operator-supplied certificate, for `files`.
* @param options.keyPath - operator-supplied key, for `files`.
* @param options.sans - names a generated certificate must cover.
* @param options.existing - the certificate record from durable state, if any.
* @returns the material to hand `https.createServer`, or undefined for plaintext.
*/
async function loadCertificate(options) {
	if (options.mode === "off") return void 0;
	if (options.mode === "files") {
		const [cert, key] = await Promise.all([readFile(options.certPath, "utf8"), readFile(options.keyPath, "utf8")]);
		const parsed = new X509Certificate(cert);
		return {
			cert,
			key,
			record: {
				fingerprint: spkiFingerprint(cert),
				sans: [...options.sans],
				generatedAt: Date.parse(parsed.validFrom),
				expiresAt: Date.parse(parsed.validTo)
			}
		};
	}
	const wanted = [...options.sans].toSorted().join(",");
	const covered = options.existing !== void 0 && [...options.existing.sans].toSorted().join(",") === wanted;
	if (options.existing !== void 0 && covered && Date.now() < options.existing.expiresAt) try {
		const [cert, key] = await Promise.all([readFile(join(options.dir, CERT_FILE), "utf8"), readFile(join(options.dir, KEY_FILE), "utf8")]);
		await chmod(join(options.dir, KEY_FILE), SECRET_MODE).catch(() => void 0);
		return {
			cert,
			key,
			record: options.existing
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return generate(options.dir, options.sans);
}

//#endregion
