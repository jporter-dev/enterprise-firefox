/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyStates:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  createEnterpriseLogger:
    "resource:///modules/enterprise/EnterpriseCommon.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return lazy.createEnterpriseLogger("AccessConnectorButton");
});

const BUTTON_ID = "access-connector-button";
const PANEL_ID = "panelUI-access-connector";

/**
 * AccessConnectorButton manages the enterprise access connector urlbar button
 * for a single browser window.
 */
export class AccessConnectorButton {
  #window = null;
  #progressListener = null;
  #onClick = null;

  /**
   * @param {Window} window - The chrome window that owns the button.
   */
  constructor(window) {
    const button = window.document.getElementById(BUTTON_ID);
    if (!button) {
      return;
    }

    this.#window = Cu.getWeakReference(window);
    this.handleEvent = this.#handleEvent.bind(this);
    this.#onClick = event => {
      this.#window.get()?.PanelUI.showSubView(PANEL_ID, this.#button, event);
    };
    button.addEventListener("click", this.#onClick);

    this.#addProgressListener();
    window.gBrowser.tabContainer.addEventListener("TabSelect", this);

    lazy.IPPProxyManager.addEventListener(
      "IPPProxyManager:StateChanged",
      this.handleEvent
    );

    this.#update();
  }

  get gBrowser() {
    return this.#window?.get()?.gBrowser ?? null;
  }

  /**
   * Resolves the button element on demand from the window.
   *
   * @returns {Element|null}
   */
  get #button() {
    return this.#window?.get()?.document.getElementById(BUTTON_ID) ?? null;
  }

  /**
   * Registers a progress listener that updates the button on top-level,
   * non-same-document navigations in the selected tab.
   */
  #addProgressListener() {
    const gBrowser = this.gBrowser;
    if (!gBrowser) {
      return;
    }
    this.#progressListener = {
      onLocationChange: (browser, webProgress, _request, _location, flags) => {
        if (!webProgress.isTopLevel) {
          return;
        }
        if (browser !== this.gBrowser?.selectedBrowser) {
          return;
        }
        const isSameDocument =
          flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
        if (isSameDocument) {
          return;
        }
        this.#update();
      },
    };

    gBrowser.addTabsProgressListener(this.#progressListener);
  }

  /**
   * Routes TabSelect and IPPProxyManager:StateChanged events to a status update.
   */
  #handleEvent(_event) {
    this.#update();
  }

  /**
   * Recomputes the button status and applies it.
   */
  #update() {
    this.applyStatus(this.#getStatus());
  }

  /**
   * Checks the current proxy status for the current page.
   *
   * @returns {boolean}
   *  Whether the current page is protected by the access connector.
   */
  #getStatus() {
    const isActive = lazy.IPPProxyManager.state === lazy.IPPProxyStates.ACTIVE;
    const principal = this.gBrowser?.selectedBrowser?.contentPrincipal;
    try {
      return isActive && principal
        ? (lazy.IPPProxyManager.channelFilter()?.shouldInclude({
            URI: principal.URI,
          }) ?? false)
        : false;
    } catch (e) {
      lazy.log.warn("Failed to check access connector state for URI: ", e);
      return false;
    }
  }

  /**
   * Shows the button only when the page is protected by the access connector.
   *
   * @param {boolean} isProtected - Whether the current page is protected.
   */
  applyStatus(isProtected) {
    const button = this.#button;
    if (button) {
      button.hidden = !isProtected;
    }
  }

  /**
   * Removes all listeners owned by this instance.
   */
  uninit() {
    if (!this.#window) {
      return;
    }
    this.#button?.removeEventListener("click", this.#onClick);
    const gBrowser = this.gBrowser;
    if (gBrowser) {
      gBrowser.removeTabsProgressListener(this.#progressListener);
      gBrowser.tabContainer.removeEventListener("TabSelect", this);
    }
    lazy.IPPProxyManager.removeEventListener(
      "IPPProxyManager:StateChanged",
      this.handleEvent
    );
  }
}
