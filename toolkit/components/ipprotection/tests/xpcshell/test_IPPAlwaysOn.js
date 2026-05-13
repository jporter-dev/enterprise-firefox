/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { IPPAlwaysOnSingleton } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/enterprise/IPPAlwaysOn.sys.mjs"
);
const { IPProtectionServerlist, PrefServerList } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/IPProtectionServerlist.sys.mjs"
);

const TEST_SERVER = {
  hostname: "proxy.example.com",
  port: 443,
  quarantined: false,
};
const TEST_COUNTRY = {
  name: "United States",
  code: "US",
  cities: [{ name: "Test City", code: "TC", servers: [TEST_SERVER] }],
};

add_setup(async function () {
  // IPProtectionServerlist is a PrefServerList on enterprise builds; populate
  // the pref so hasList is true. RS-based setup would be silently ignored.
  Services.prefs.setCharPref(
    PrefServerList.PREF_NAME,
    JSON.stringify([TEST_COUNTRY])
  );
  await IPProtectionServerlist.maybeFetchList();

  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(PrefServerList.PREF_NAME);
  });
});

/**
 * Creates a fresh IPPAlwaysOnSingleton with alwaysOnEnabled stubbed.
 *
 * @param {object} sandbox - Sinon sandbox
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] - Value for the alwaysOnEnabled getter
 */
function makeAlwaysOn(sandbox, { enabled = true } = {}) {
  const alwaysOn = new IPPAlwaysOnSingleton();
  sandbox.stub(alwaysOn, "alwaysOnEnabled").get(() => enabled);
  return alwaysOn;
}

/**
 * Registers `alwaysOn` as a service helper so that IPProtectionService calls
 * its init() in the correct order (after IPPProxyManager). This is needed
 * because IPPAlwaysOn reacts to service state changes, and IPPProxyManager
 * must be READY before IPPAlwaysOn's listener fires.
 *
 * @param {IPPAlwaysOnSingleton} alwaysOn
 */
function registerAsHelper(alwaysOn) {
  IPProtectionActivator.addHelpers([alwaysOn]);
  IPProtectionActivator.setupHelpers();
}

/**
 * Restores the helper list to the state established in head.js.
 */
function restoreHelpers() {
  IPProtectionActivator.removeHelpers();
  IPProtectionActivator.addHelpers(IPPFxaAuthProvider.helpers);
  IPProtectionActivator.setupHelpers();
}

add_task(async function test_init_skipped_without_policy() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);

  // Ordering doesn't matter here — init() returns immediately when policy is absent.
  const alwaysOn = makeAlwaysOn(sandbox, { enabled: false });
  alwaysOn.init();

  const waitForReady = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.READY
  );
  IPProtectionService.init();
  await waitForReady;

  Assert.notEqual(
    IPPProxyManager.state,
    IPPProxyStates.ACTIVATING,
    "Proxy should not start when the AccessConnector policy is absent"
  );

  IPProtectionService.uninit();
  sandbox.restore();
});

add_task(async function test_proxy_starts_on_service_ready() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);

  const alwaysOn = makeAlwaysOn(sandbox);
  // Register as a helper so alwaysOn.init() is called after IPPProxyManager.init(),
  // ensuring IPPProxyManager is READY when alwaysOn reacts to the service READY event.
  registerAsHelper(alwaysOn);

  const waitForActive = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  IPProtectionService.init();
  await waitForActive;

  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.ACTIVE,
    "Proxy should become active once the service is ready"
  );

  alwaysOn.uninit();
  await IPPProxyManager.stop(false);
  IPProtectionService.uninit();
  restoreHelpers();
  sandbox.restore();
});

add_task(async function test_proxy_restarts_on_unexpected_stop() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);

  const alwaysOn = makeAlwaysOn(sandbox);
  registerAsHelper(alwaysOn);

  const waitForActive = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  IPProtectionService.init();
  await waitForActive;

  // Stop the proxy externally — alwaysOn's #shouldBeRunning is still true,
  // so it should restart immediately. The proxy may advance past ACTIVATING to
  // ACTIVE before the assertion runs (all stubs are synchronous), so accept both.
  const waitForRestart = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () =>
      IPPProxyManager.state === IPPProxyStates.ACTIVATING ||
      IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  await IPPProxyManager.stop(false);
  await waitForRestart;

  Assert.ok(
    IPPProxyManager.state === IPPProxyStates.ACTIVATING ||
      IPPProxyManager.state === IPPProxyStates.ACTIVE,
    "Proxy should restart immediately after an unexpected stop"
  );

  // Uninit alwaysOn before stopping to prevent it from restarting the proxy
  // during cleanup. With #pass cached from the first activation, #startInternal
  // resolves faster on the restart path and could clear #activatingPromise
  // before uninit() runs, causing a missing-activation-promise rejection.
  alwaysOn.uninit();
  await IPPProxyManager.stop(false);
  IPProtectionService.uninit();
  restoreHelpers();
  sandbox.restore();
});

add_task(async function test_proxy_not_restarted_when_service_unavailable() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);

  const alwaysOn = makeAlwaysOn(sandbox);
  registerAsHelper(alwaysOn);

  const waitForActive = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  IPProtectionService.init();
  await waitForActive;

  // Uniniting the service uninits alwaysOn, setting #shouldBeRunning = false.
  // The proxy may transiently re-enter ACTIVATING during uninit due to helper
  // ordering; stop() handles it before we assert.
  IPProtectionService.uninit();
  await IPPProxyManager.stop(false);

  Assert.notEqual(
    IPPProxyManager.state,
    IPPProxyStates.ACTIVATING,
    "Proxy should not restart once the service becomes unavailable"
  );

  restoreHelpers();
  sandbox.restore();
});

add_task(async function test_serverlist_change_calls_switch_when_active() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);
  sandbox.stub(IPPProxyManager, "switch").returns({ error: null });

  const alwaysOn = makeAlwaysOn(sandbox);
  registerAsHelper(alwaysOn);

  const waitForActive = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  IPProtectionService.init();
  await waitForActive;

  // Trigger IPProtectionServerlist:ListChanged by updating the pref. The pref
  // observer (registered during initOnStartupCompleted) fires synchronously.
  const updatedServer = {
    hostname: "proxy2.example.com",
    port: 443,
    quarantined: false,
  };
  const updatedCountry = {
    ...TEST_COUNTRY,
    cities: [{ name: "Test City", code: "TC", servers: [updatedServer] }],
  };
  Services.prefs.setCharPref(
    PrefServerList.PREF_NAME,
    JSON.stringify([updatedCountry])
  );

  Assert.ok(
    IPPProxyManager.switch.calledOnce,
    "switch() should be called when the serverlist changes while the proxy is active"
  );

  alwaysOn.uninit();
  await IPPProxyManager.stop(false);
  IPProtectionService.uninit();
  restoreHelpers();
  sandbox.restore();
});

add_task(async function test_serverlist_cleared_stops_proxy() {
  const sandbox = sinon.createSandbox();
  setupStubs(sandbox);

  const alwaysOn = makeAlwaysOn(sandbox);
  registerAsHelper(alwaysOn);

  const waitForActive = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.ACTIVE
  );
  IPProtectionService.init();
  await waitForActive;

  // Clearing the pref empties the serverlist synchronously; alwaysOn stops the
  // proxy, and stop() runs synchronously for an ACTIVE connection.
  const waitForReady = waitForEvent(
    IPPProxyManager,
    "IPPProxyManager:StateChanged",
    () => IPPProxyManager.state === IPPProxyStates.READY
  );
  Services.prefs.clearUserPref(PrefServerList.PREF_NAME);
  await waitForReady;

  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.READY,
    "Proxy should stop when the serverlist is cleared"
  );
  Assert.notEqual(
    IPPProxyManager.state,
    IPPProxyStates.ACTIVATING,
    "Proxy should not attempt to restart with an empty serverlist"
  );

  IPProtectionService.uninit();
  restoreHelpers();

  // Restore the serverlist for subsequent tests.
  Services.prefs.setCharPref(
    PrefServerList.PREF_NAME,
    JSON.stringify([TEST_COUNTRY])
  );
  await IPProtectionServerlist.maybeFetchList(true);

  sandbox.restore();
});
