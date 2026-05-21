/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyStates:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
  IPProtectionStates:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

/**
 * Registers an IPProxyManager channel filter at startup to prevent data leaks
 * before the proxy connection is fully established. Activates only when the
 * supplied predicate returns true at init() time, and unregisters itself once
 * the proxy reaches ACTIVE or the service reports it cannot start.
 *
 * @param {() => boolean} shouldActivate
 *   Called from init(). When false, the filter is not registered and the
 *   helper becomes a no-op for this session.
 */
export class IPPEarlyStartupFilter {
  #active = false;
  #shouldActivate;

  constructor(shouldActivate) {
    this.#shouldActivate = shouldActivate;
    this.handleEvent = this.#handleEvent.bind(this);
  }

  init() {
    if (!this.#shouldActivate()) {
      return;
    }
    this.#active = true;

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
    if (!this.#active) {
      return;
    }
    this.#active = false;

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
