//#region lib/types/pages/views.js
// 03-views.js — страницы: вход, пароль, спаривание, устройства.
/** Render a relative timestamp the way a device list wants it. */
function since(timestamp, now) {
	if (timestamp === void 0) return "never";
	const seconds = Math.max(0, Math.round((now - timestamp) / 1e3));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${String(minutes)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${String(hours)} h ago`;
	return `${String(Math.round(hours / 24))} d ago`;
}
/**
* The sign-in page.
* @param options.error - message to show above the form.
* @param options.next - path to return to after a successful sign-in.
* @returns the full HTML document.
*/
function loginPage(options) {
	return page({
		title: "Sign in",
		body: `
  <h1>Sign in</h1>
  <p>This relay fronts a DeepSeek Harness on this machine.</p>
  ${options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`}
  <form method="post" action="/relay/login">
    <input type="hidden" name="next" value="${escapeHtml(options.next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="primary" type="submit">Sign in</button>
  </form>`
	});
}
/**
* The page that sets a password, or replaces the one already set.
*
* This is deliberately separate from the sign-in page. A request from the
* machine running the harness is already the operator — asking it for a
* password would be theatre, since whoever is there has a shell — so the
* sign-in page redirects it straight through. That left first-run setup with
* nowhere to happen, which is what this page is for.
* @param options.hasPassword - whether a password already exists.
* @param options.error - message to show above the form.
* @param options.next - path to return to afterwards.
* @returns the full HTML document.
*/
function passwordPage(options) {
	const notice = options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`;
	const heading = options.hasPassword ? "Change the password" : "Set a password";
	const lead = options.hasPassword ? "Replacing it does not sign anyone out. Use <a href=\"/relay/devices\">sign out everywhere</a> on the devices page for that." : "Nobody can sign in from the network until you set one. Anyone who does can run commands on this machine, because that is what the agent does.";
	return page({
		title: heading,
		body: `
  <h1>${escapeHtml(heading)}</h1>
  <p>${lead}</p>
  ${notice}
  <form method="post" action="/relay/password">
    <input type="hidden" name="next" value="${escapeHtml(options.next)}">
    <label for="password">${options.hasPassword ? "New password" : "Password"}</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="10" autofocus>
    <label for="confirm">Confirm</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="10">
    <button class="primary" type="submit">${options.hasPassword ? "Replace password" : "Set password"}</button>
  </form>
  <p class="caption">At least 10 characters. Only reachable from the machine running the harness${options.hasPassword ? ", or with an existing session" : ""}.</p>`
	});
}
/**
* The operator's pairing page: the QR, the code, and what a device does with them.
* @param options - the live invitation and the origins it points at.
* @returns the full HTML document.
*/
function pairPage(options) {
	const plain = options.plainUrl === void 0 ? "" : `<div class="notice tip">DSH Mobile 0.5.0 cannot use TLS, so it connects over the plain listener instead:
       <br><span class="mono">${escapeHtml(options.plainUrl)}</span></div>`;
	const pin = options.fingerprint === void 0 ? `<div class="notice warn">This relay is serving plaintext. Anything on the network path can read the traffic.</div>` : `<p class="caption fingerprint">Certificate pin (SHA-256/SPKI)<br><span class="mono">${escapeHtml(options.fingerprint)}</span></p>`;
	return page({
		wide: true,
		title: "Pair a device",
		body: `
  <h1>Pair a device</h1>
  <p>Scan this on the device, or open <span class="mono">${escapeHtml(options.url)}/relay/pair</span> there and type the code.</p>
  <div class="qr">${options.qrSvg}</div>
  <div class="code">${escapeHtml(options.code)}</div>
  <p class="caption">Expires in ${String(options.expiresInSeconds)} seconds, and works once.</p>
  ${plain}
  ${pin}
  <div class="actions">
    <form method="post" action="/relay/pair/new">
      <button class="outline" type="submit">New code</button>
    </form>
    <a class="btn outline" href="/relay/devices">Paired devices</a>
  </div>
  <div class="actions">
    <a class="btn ghost" href="/">Back to the harness</a>
  </div>`
	});
}
/**
* The device-facing enrolment form.
* @param options.error - message to show above the form.
* @param options.code - a code carried in the URL, prefilled.
* @returns the full HTML document.
*/
function claimPage(options) {
	return page({
		title: "Pair this device",
		body: `
  <h1>Pair this device</h1>
  <p>Enter the code shown on the machine running the harness.</p>
  ${options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`}
  <form method="post" action="/relay/pair">
    <label for="code">Pairing code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
           required value="${escapeHtml(options.code ?? "")}" ${options.code === void 0 ? "autofocus" : ""}>
    <label for="name">Device name</label>
    <input id="name" name="name" type="text" required maxlength="64" placeholder="Pixel 8"
           ${options.code === void 0 ? "" : "autofocus"}>
    <button class="primary" type="submit">Pair</button>
  </form>`
	});
}
/**
* Confirmation after a device enrols, carrying the token exactly once.
* @param options - the minted credential and the addresses it works from.
* @returns the full HTML document.
*/
function pairedPage(options) {
	const grant = options.granted ? `<div class="notice tip">This device's network address is now accepted for a limited time, so DSH Mobile 0.5.0 —
       which cannot send a credential of its own — can connect. It is not a substitute for the token: it stops working
       when the address changes, and it never reaches the harness settings or credentials.</div>` : "";
	const plain = options.plainUrl === void 0 ? "" : `<p class="caption">In DSH Mobile, connect to <span class="mono">${escapeHtml(options.plainUrl)}</span>.</p>`;
	return page({
		wide: true,
		title: "Device paired",
		body: `
  <h1>Paired</h1>
  <p><strong>${escapeHtml(options.deviceName)}</strong> is enrolled. Its token is shown once and never again — a client
     that supports it sends this as <span class="mono">Authorization: Bearer &lt;token&gt;</span>.</p>
  <div class="notice tip mono" style="word-break: break-all">${escapeHtml(options.token)}</div>
  ${grant}
  ${plain}
  <div class="actions">
    <a class="btn primary" href="/">Open the harness</a>
    <a class="btn outline" href="/relay/devices">Paired devices</a>
  </div>`
	});
}
/**
* The device list, with revocation.
* @param options - the enrolled devices and the relay's current posture.
* @returns the full HTML document.
*/
function devicesPage(options) {
	const rows = options.devices.length === 0 ? "<p class=\"caption\">Nothing paired yet.</p>" : options.devices.map((device) => `
    <div class="row">
      <div class="meta">
        <span class="name">${escapeHtml(device.name)}</span>
        <span class="sub">last seen ${escapeHtml(since(device.lastSeenAt, options.now))}${device.lastAddress === void 0 ? "" : ` &middot; ${escapeHtml(device.lastAddress)}`}</span>
      </div>
      <div class="end">
        <span class="dot ${device.lastSeenAt === void 0 ? "off" : "ok"}"></span>
        <form method="post" action="/relay/devices/revoke">
          <input type="hidden" name="deviceId" value="${escapeHtml(device.id)}">
          <button class="outline sm" type="submit">Revoke</button>
        </form>
      </div>
    </div>`).join("");
	const pin = options.fingerprint === void 0 ? "" : `<p class="caption fingerprint">Pin <span class="mono">${escapeHtml(options.fingerprint)}</span></p>`;
	const plain = options.plainUrl === void 0 ? "" : `<div class="row"><div class="meta"><span class="name">Plain listener</span>
       <span class="sub">${escapeHtml(options.plainUrl)} &middot; compatibility clients only</span></div>
       <span class="dot ok"></span></div>`;
	return page({
		wide: true,
		title: "Paired devices",
		body: `
  <h1>Paired devices</h1>
  <div class="rows">
    <div class="row">
      <div class="meta">
        <span class="name">Relay</span>
        <span class="sub">${escapeHtml(options.url)} &middot; TLS ${escapeHtml(options.tlsMode)}</span>
      </div>
      <span class="dot ok"></span>
    </div>
    ${plain}
  </div>
  ${pin}
  <div class="rows">${rows}</div>
  <div class="row">
    <div class="meta">
      <span class="name">Password sign-in</span>
      <span class="sub">${options.hasPassword ? "set" : "not set — nobody can sign in from the network"}</span>
    </div>
    <span class="dot ${options.hasPassword ? "ok" : "off"}"></span>
  </div>
  <div class="actions">
    <form method="post" action="/relay/pair/new">
      <button class="primary" type="submit">Pair a new device</button>
    </form>
  </div>
  <div class="actions">
    <a class="btn outline" href="/relay/password">${options.hasPassword ? "Change the password" : "Set a password"}</a>
    <form method="post" action="/relay/signout-everywhere">
      <button class="outline" type="submit">Sign out everywhere</button>
    </form>
  </div>
  <p class="caption">Signing out everywhere rotates the signing key: every paired device and every browser session stops working at once.</p>
  <div class="actions">
    <a class="btn ghost" href="/">Back to the harness</a>
  </div>`
	});
}
/**
* A standalone message, used for errors and confirmations.
* @param options.title - the heading and document title.
* @param options.message - body copy.
* @param options.kind - which notice styling to use.
* @returns the full HTML document.
*/
function messagePage(options) {
	return page({
		title: options.title,
		body: `
  <h1>${escapeHtml(options.title)}</h1>
  <div class="notice ${options.kind ?? "tip"}">${escapeHtml(options.message)}</div>
  <div class="actions">
    <a class="btn outline" href="/">Back</a>
  </div>`
	});
}

//#endregion
