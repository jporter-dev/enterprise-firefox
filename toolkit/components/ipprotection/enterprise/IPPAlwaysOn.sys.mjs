/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPProtectionServerlist:
    "moz-src:///toolkit/components/ipprotection/IPProtectionServerlist.sys.mjs",
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyStates:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
  IPProtectionStates:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logConsole", () =>
  console.createInstance({
    prefix: "IPPAlwaysOn",
    maxLogLevel: Services.prefs.getBoolPref("browser.ipProtection.log", false)
      ? "Debug"
      : "Warn",
  })
);

/**
 * Keeps the proxy connection alive on enterprise builds where the
 * AccessConnector policy is active. Unlike IPPAutoStart, this class:
 *
 *  - Recovers from ERROR states by stopping and restarting immediately.
 *  - Restarts immediately when the proxy stops unexpectedly.
 *  - Switches to a new server when the server list is updated.
 *
 * Because this is policy-driven there is no user-facing toggle; the proxy
 * runs whenever the service is ready and the policy is set.
 */
class IPPAlwaysOnSingleton {
  #initialized = false;
  #shouldBeRunning = false;
  #startPending = false;

  constructor() {
    this.handleServiceEvent = this.#handleServiceEvent.bind(this);
    this.handleProxyEvent = this.#handleProxyEvent.bind(this);
    this.handleServerlistEvent = this.#handleServerlistEvent.bind(this);
  }

  /**
   * True when the AccessConnector policy is active.
   *
   * @returns {boolean}
   */
  get alwaysOnEnabled() {
    return !!Services.policies.getActivePolicies()?.AccessConnector;
  }

  init() {
    if (this.#initialized || !this.alwaysOnEnabled) {
      lazy.logConsole.debug(
        "init() skipped — initialized:",
        this.#initialized,
        "alwaysOnEnabled:",
        this.alwaysOnEnabled
      );
      return;
    }
    lazy.logConsole.info("Initialized");
    this.#initialized = true;

    lazy.IPProtectionService.addEventListener(
      "IPProtectionService:StateChanged",
      this.handleServiceEvent
    );
    lazy.IPPProxyManager.addEventListener(
      "IPPProxyManager:StateChanged",
      this.handleProxyEvent
    );
    lazy.IPProtectionServerlist.addEventListener(
      "IPProtectionServerlist:ListChanged",
      this.handleServerlistEvent
    );
  }

  initOnStartupCompleted() {}

  uninit() {
    if (!this.#initialized) {
      return;
    }
    this.#initialized = false;
    this.#shouldBeRunning = false;
    this.#startPending = false;

    lazy.IPProtectionService.removeEventListener(
      "IPProtectionService:StateChanged",
      this.handleServiceEvent
    );
    lazy.IPPProxyManager.removeEventListener(
      "IPPProxyManager:StateChanged",
      this.handleProxyEvent
    );
    lazy.IPProtectionServerlist.removeEventListener(
      "IPProtectionServerlist:ListChanged",
      this.handleServerlistEvent
    );
  }

  #tryStart() {
    if (this.#startPending) {
      return;
    }
    if (lazy.IPPProxyManager.state === lazy.IPPProxyStates.ACTIVE) {
      return;
    }
    if (!lazy.IPProtectionServerlist.hasList) {
      return;
    }
    lazy.logConsole.info("Starting proxy");
    this.#startPending = true;
    lazy.IPPProxyManager.start(
      false,
      PrivateBrowsingUtils.permanentPrivateBrowsing
    );
  }

  #handleServiceEvent() {
    const serviceState = lazy.IPProtectionService.state;
    switch (serviceState) {
      case lazy.IPProtectionStates.UNINITIALIZED:
      case lazy.IPProtectionStates.UNAVAILABLE:
      case lazy.IPProtectionStates.UNAUTHENTICATED:
        this.#shouldBeRunning = false;
        this.#startPending = false;
        break;

      case lazy.IPProtectionStates.READY:
        this.#shouldBeRunning = true;
        this.#tryStart();
        break;

      default:
        break;
    }
  }

  #handleProxyEvent() {
    if (!this.#shouldBeRunning) {
      return;
    }

    switch (lazy.IPPProxyManager.state) {
      case lazy.IPPProxyStates.ACTIVE:
        this.#startPending = false;
        break;

      case lazy.IPPProxyStates.READY:
        this.#startPending = false;
        this.#tryStart();
        break;

      case lazy.IPPProxyStates.ERROR:
        this.#startPending = false;
        lazy.IPPProxyManager.stop(false).then(
          () => {
            if (this.#shouldBeRunning) {
              this.#tryStart();
            }
          },
          e => lazy.logConsole.error("Failed to stop proxy:", e)
        );
        break;

      default:
        break;
    }
  }

  #handleServerlistEvent() {
    if (!lazy.IPProtectionServerlist.hasList) {
      // Serverlist was cleared (e.g. policy removed). Stop any active
      // connection so we don't try to connect to a server that no longer exists.
      const state = lazy.IPPProxyManager.state;
      if (
        state === lazy.IPPProxyStates.ACTIVE ||
        state === lazy.IPPProxyStates.ERROR
      ) {
        lazy.IPPProxyManager.stop(false);
      }
      return;
    }
    const state = lazy.IPPProxyManager.state;
    switch (state) {
      case lazy.IPPProxyStates.ACTIVE: {
        // Switch to a server from the updated list without dropping the connection.
        lazy.logConsole.debug("Switching to updated server");
        const { error } = lazy.IPPProxyManager.switch();
        if (error) {
          // switch() failed (e.g. new server is invalid); stop and restart.
          lazy.IPPProxyManager.stop(false).then(
            () => {
              if (this.#shouldBeRunning) {
                this.#tryStart();
              }
            },
            e => lazy.logConsole.error("Failed to stop proxy:", e)
          );
        }
        break;
      }

      case lazy.IPPProxyStates.ERROR:
        // A fresh server list may resolve the error; stop and restart immediately.
        if (this.#shouldBeRunning) {
          lazy.IPPProxyManager.stop(false).then(
            () => {
              if (this.#shouldBeRunning) {
                this.#tryStart();
              }
            },
            e => lazy.logConsole.error("Failed to stop proxy:", e)
          );
        }
        break;

      case lazy.IPPProxyStates.READY:
        if (this.#shouldBeRunning && !this.#startPending) {
          this.#tryStart();
        }
        break;

      default:
        break;
    }
  }
}

const IPPAlwaysOn = new IPPAlwaysOnSingleton();

/**
 * Registers the channel filter at startup to prevent data leaks before the
 * proxy connection is fully established in always-on mode. Mirrors
 * IPPEarlyStartupFilter from IPPAutoStart but uses the AlwaysOn policy check.
 */
class IPPAlwaysOnEarlyStartupFilter {
  #alwaysOnAtStartup = false;

  constructor() {
    this.handleEvent = this.#handleEvent.bind(this);
  }

  init() {
    if (!IPPAlwaysOn.alwaysOnEnabled) {
      return;
    }
    this.#alwaysOnAtStartup = true;

    lazy.IPPProxyManager.createChannelFilter();

    lazy.IPProtectionService.addEventListener(
      "IPProtectionService:StateChanged",
      this.handleEvent
    );
    lazy.IPPProxyManager.addEventListener(
      "IPPProxyManager:StateChanged",
      this.handleEvent
    );
  }

  initOnStartupCompleted() {}

  uninit() {
    if (!this.#alwaysOnAtStartup) {
      return;
    }
    this.#alwaysOnAtStartup = false;

    lazy.IPPProxyManager.removeEventListener(
      "IPPProxyManager:StateChanged",
      this.handleEvent
    );
    lazy.IPProtectionService.removeEventListener(
      "IPProtectionService:StateChanged",
      this.handleEvent
    );
  }

  #handleEvent() {
    switch (lazy.IPProtectionService.state) {
      case lazy.IPProtectionStates.UNAVAILABLE:
      case lazy.IPProtectionStates.UNAUTHENTICATED:
        lazy.IPPProxyManager.cancelChannelFilter();
        this.uninit();
        break;

      default:
        break;
    }

    if (lazy.IPPProxyManager.state === lazy.IPPProxyStates.ACTIVE) {
      this.uninit();
    }
  }
}

const IPPAlwaysOnHelpers = [IPPAlwaysOn, new IPPAlwaysOnEarlyStartupFilter()];

export { IPPAlwaysOnHelpers, IPPAlwaysOnSingleton };
