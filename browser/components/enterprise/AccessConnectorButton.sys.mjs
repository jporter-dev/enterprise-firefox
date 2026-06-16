/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPPrincipalRules:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
});

const BUTTON_ID = "access-connector-button";
const PANEL_ID = "panelUI-access-connector";

const PROXY_ERROR_CODES = new Set([
  "proxyConnectFailure",
  "proxyResolveFailure",
]);

/**
 * AccessConnectorButton manages the enterprise access connector urlbar button
 * for a single browser window.
 */
export class AccessConnectorButton {
  #window = null;
  #progressListener = null;
  #onClick = null;
  #wasError = false;

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
   *
   * @param {Event} _event
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
   * @returns {{ isProtected: boolean, isError: boolean, domain: string }}
   */
  #getStatus() {
    const browser = this.gBrowser?.selectedBrowser;
    const principal = browser?.contentPrincipal;

    const rule = lazy.IPPProxyManager.getPrincipalRule(principal);
    if (rule === lazy.IPPPrincipalRules.INCLUDED) {
      return { isProtected: true, isError: false, domain: "" };
    }

    // When the proxy is down, Firefox loads about:neterror with the error code
    // and original URL in the query string. principal.URI reflects the full page
    // URL including query params, so we can get the URI from there.
    const principalURI = principal?.URI;
    if (principalURI?.spec.startsWith("about:neterror")) {
      const params = new URLSearchParams(principalURI.query);
      const errorCode = params.get("e");
      if (
        PROXY_ERROR_CODES.has(errorCode) &&
        "AccessConnector" in Services.policies.getActivePolicies()
      ) {
        let domain = "";
        try {
          domain = new URL(params.get("u") ?? "").hostname;
        } catch {}
        return { isProtected: true, isError: true, domain };
      }
    }

    return { isProtected: false, isError: false, domain: "" };
  }

  /**
   * Shows the button when the page is protected by the access connector, and
   * applies error styling when the proxy is unavailable.
   *
   * @param {{ isProtected: boolean, isError: boolean, domain: string }} status
   */
  applyStatus({ isProtected, isError, domain }) {
    const button = this.#button;
    if (!button) {
      return;
    }

    button.hidden = !isProtected;

    if (isError) {
      button.setAttribute("error", "true");
    } else {
      button.removeAttribute("error");
    }

    const doc = this.#window?.get()?.document;
    if (doc) {
      doc.l10n.setAttributes(
        button,
        isError ? "access-connector-button-error" : "access-connector-button"
      );

      const panel = doc.getElementById(PANEL_ID);
      if (isError) {
        panel?.setAttribute("error", "true");
      } else {
        panel?.removeAttribute("error");
      }
    }

    // Record once per error transition. #wasError prevents re-firing on
    // every subsequent #update() call (tab switch, state change, etc.)
    if (isError && !this.#wasError) {
      Glean.accessConnector.proxyError.record({ domain });
      GleanPings.enterprise.submit();
    }
    this.#wasError = isError;
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
