/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyStates:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
});

/**
 * EnterpriseAccessConnectorButton manages the access connector urlbar button
 * for a single browser window.
 *
 * Each instance:
 * - Tracks location changes via a progress listener
 * - Tracks tab switches
 * - Tracks proxy state changes
 * - Shows the button when the current page's URL is in the proxy's inclusion
 *   list, with distinct visual states for active, paused, and error proxy states
 */
export class EnterpriseAccessConnectorButton {
  #window = null;
  #button = null;
  #progressListener = null;
  #proxyStateListener = null;
  #tabSelectListener = null;
  #tabCloseListener = null;
  #unloadListener = null;

  /**
   * Tracks whether the current page URL in each browser tab is in the proxy's
   * inclusion list. Maps browserId → boolean.
   *
   * browserId is stable for the lifetime of a tab (unlike browsingContext.id,
   * which changes on cross-origin navigation/redirect in Fission).
   *
   * @type {Map<number, boolean>}
   */
  #tabProxied = new Map();

  /**
   * Tracks whether the current page in each browser tab encountered a proxy
   * connection error (e.g. proxy host unreachable). Maps browserId → boolean.
   *
   * @type {Map<number, boolean>}
   */
  #tabProxyError = new Map();

  /**
   * @param {Window} window - The chrome window this button belongs to.
   */
  constructor(window) {
    this.#window = Cu.getWeakReference(window);
    this.#button = window.document.getElementById("access-connector-button");

    this.#button.addEventListener("click", event => {
      window.PanelUI.showSubView(
        "panelUI-access-connector",
        this.#button,
        event
      );
    });

    this.#progressListener = {
      onLocationChange: (aBrowser, aWebProgress, _aRequest, aLocationURI, aFlags) => {
        if (!aWebProgress.isTopLevel) {
          return;
        }

        if (aFlags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) {
          return;
        }

        // Error pages don't represent new navigations; proxy error state is
        // set by onStateChange and should persist until the next real navigation.
        const filePath = aLocationURI?.filePath;
        if (
          aLocationURI?.scheme === "about" &&
          (filePath === "neterror" || filePath === "certerror")
        ) {
          if (aBrowser === window.gBrowser.selectedBrowser) {
            this.updateState();
          }
          return;
        }

        const browserId = aBrowser.browserId;
        this.#tabProxied.set(browserId, false);
        this.#tabProxyError.set(browserId, false);

        // Use the inclusion list as an immediate initial signal so the button
        // shows as soon as navigation begins, before any requests complete.
        const filter = lazy.IPPProxyManager.channelFilter();
        if (filter && aLocationURI) {
          this.#tabProxied.set(browserId, filter.shouldInclude({ URI: aLocationURI }));
        }

        if (aBrowser === window.gBrowser.selectedBrowser) {
          this.updateState();
        }
      },

      onStateChange: (aBrowser, aWebProgress, aRequest, aStateFlags, aStatus) => {
        if (!aWebProgress.isTopLevel) {
          return;
        }

        if (
          !(aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) ||
          !(aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK)
        ) {
          return;
        }

        const browserId = aBrowser.browserId;

        if (aStatus === Cr.NS_ERROR_UNKNOWN_PROXY_HOST) {
          this.#tabProxied.set(browserId, true);
          this.#tabProxyError.set(browserId, true);
          if (aBrowser === window.gBrowser.selectedBrowser) {
            this.updateState();
          }
        }
      },
    };

    this.#proxyStateListener = () => this.updateState();

    this.#tabSelectListener = () => this.updateState();

    this.#tabCloseListener = ({ target }) => {
      const browserId = window.gBrowser.getBrowserForTab(target)?.browserId;
      if (browserId != null) {
        this.#tabProxied.delete(browserId);
        this.#tabProxyError.delete(browserId);
      }
    };

    this.#unloadListener = () => this.uninit();

    window.gBrowser.addTabsProgressListener(this.#progressListener);
    lazy.IPPProxyManager.addEventListener(
      "IPPProxyManager:StateChanged",
      this.#proxyStateListener
    );
    window.gBrowser.tabContainer.addEventListener(
      "TabSelect",
      this.#tabSelectListener
    );
    window.gBrowser.tabContainer.addEventListener(
      "TabClose",
      this.#tabCloseListener
    );
    window.addEventListener("unload", this.#unloadListener, { once: true });

    this.updateState();
  }

  /**
   * Updates the button visibility and state classes based on whether the
   * current page was routed through the access connector proxy.
   */
  updateState() {
    const win = this.#window.get();
    if (!win) {
      return;
    }

    const selectedBrowser = win.gBrowser.selectedBrowser;
    const isPageProxied = this.#tabProxied.get(selectedBrowser.browserId) ?? false;

    this.#button.hidden = !isPageProxied;

    const proxyState = lazy.IPPProxyManager.state;
    const hasConnectionError =
      this.#tabProxyError.get(selectedBrowser.browserId) ?? false;
    const isError =
      isPageProxied && (proxyState === lazy.IPPProxyStates.ERROR || hasConnectionError);
    const isPaused = isPageProxied && proxyState === lazy.IPPProxyStates.PAUSED;

    this.#button.classList.toggle("access-connector-error", isError);
    this.#button.classList.toggle("access-connector-paused", isPaused && !isError);
  }

  /**
   * Removes all listeners and releases references.
   */
  uninit() {
    const win = this.#window.get();
    if (win) {
      win.gBrowser.removeTabsProgressListener(this.#progressListener);
      win.gBrowser.tabContainer.removeEventListener(
        "TabSelect",
        this.#tabSelectListener
      );
      win.gBrowser.tabContainer.removeEventListener(
        "TabClose",
        this.#tabCloseListener
      );
    }

    lazy.IPPProxyManager.removeEventListener(
      "IPPProxyManager:StateChanged",
      this.#proxyStateListener
    );

    this.#window = null;
    this.#button = null;
    this.#progressListener = null;
    this.#proxyStateListener = null;
    this.#tabSelectListener = null;
    this.#tabCloseListener = null;
    this.#unloadListener = null;
  }
}
