//#region lib/types/auth/password.js
// 01-password.js — хеширование и проверка пароля через scrypt.
const scryptAsync = promisify(scrypt);
/**
* scrypt work factor. Raising it later stays verifiable because each record
* carries the cost it was written with.
*/
const DEFAULT_COST = 16384;
/** scrypt block size. */
const BLOCK_SIZE = 8;
/** scrypt parallelization. */
const PARALLELISM = 1;
/** Derived key length in bytes. */
const KEY_LENGTH = 64;
/** Bytes of salt per record. */
const SALT_BYTES = 16;
/**
* Node's default maxmem (32 MiB) is below what N=16384, r=8 needs; state the
* requirement rather than lowering the work factor to fit the default.
* @param cost - the scrypt N parameter.
* @returns the memory ceiling to pass to scrypt.
*/
function maxmemFor(cost) {
	return 256 * cost * BLOCK_SIZE * 2;
}
/**
* Hash a password for storage.
* @param password - the plaintext, as typed.
* @returns the record to persist; the plaintext is never retained.
*/
async function hashPassword(password) {
	const salt = randomBytes(SALT_BYTES);
	const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
		N: DEFAULT_COST,
		r: BLOCK_SIZE,
		p: PARALLELISM,
		maxmem: maxmemFor(DEFAULT_COST)
	});
	return {
		salt: salt.toString("hex"),
		hash: derived.toString("hex"),
		cost: DEFAULT_COST,
		updatedAt: Date.now()
	};
}
/**
* Verify a candidate password against a stored record.
* @param record - the stored credential.
* @param candidate - the plaintext to check.
* @returns true on a match; comparison is constant time in the hash length.
*/
async function verifyPassword(record, candidate) {
	const expected = Buffer.from(record.hash, "hex");
	const derived = await scryptAsync(candidate.normalize("NFKC"), Buffer.from(record.salt, "hex"), expected.length, {
		N: record.cost,
		r: BLOCK_SIZE,
		p: PARALLELISM,
		maxmem: maxmemFor(record.cost)
	});
	return derived.length === expected.length && timingSafeEqual(derived, expected);
}

//#endregion
