/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "localization", () => {
  return new Localization(
    ["browser/enterprise/enterprise.ftl", "branding/brand.ftl"],
    true
  );
});

ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  ConsoleClient: "resource:///modules/enterprise/ConsoleClient.sys.mjs",
  EnterpriseCommon: "resource:///modules/enterprise/EnterpriseCommon.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return console.createInstance({
    prefix: "EnterpriseHandler",
    maxLogLevelPref: lazy.EnterpriseCommon.ENTERPRISE_LOGLEVEL_PREF,
  });
});

const PROMPT_ON_SIGNOUT_PREF = "enterprise.promptOnSignout";
const LOGO_URL = "enterprise.logo_url";

export const EnterpriseHandler = {
  /**
   * @type {{name:string, email:string, pictureUrl:string} | null}
   */
  _signedInUser: null,

  /**
   * Whether the handler is initialized, meaning the user information
   * from the signed in user has been received from the console.
   */
  _isInitialized: false,

  /**
   * Set to true when signout has been explicitly authorized (user confirmed
   * the prompt, or promptOnSignout is false). Gates the appShutdown blocker
   * so that non-signout quits (e.g. restarts for updates) do not trigger a
   * signout.
   */
  _signoutAuthorized: false,

  /**
   * Handles the enterprise state for each new browser window.
   * On first call:
   *    - Make a request to the console to retrieve the user information of the signed in user.
   * On every call:
   *    - Hide FxA toolbar button and FxA item in app menu (hamburger menu)
   *
   * @param {Window} window chrome window
   */
  async init(window) {
    if (!this._isInitialized) {
      lazy.log.debug("Initializing...");
      await this.initUser();
      this.registerSignoutBlocker();
      this._isInitialized = true;
    }
    this.updateBadge(window);
    this.restrictEnterpriseView(window);
    this._initLockdownModeButton(window);
  },

  async initUser() {
    try {
      const { name, email, picture } =
        await lazy.ConsoleClient.getLoggedInUserInfo();
      this._signedInUser = { name, email, pictureUrl: picture };
    } catch (e) {
      // TODO: Bug 2000864 - Handle unsuccessful GET /WHOAMI
      console.warn(
        "EnterpriseHandler: Unable to initialize enterprise user: ",
        e
      );
    }
  },

  _initLockdownModeButton(window) {
    const button = window.document.getElementById("lockdown-mode-button");

    button.addEventListener("click", event => {
      window.PanelUI.showSubView("panelUI-lockdown-mode", button, event);
    });

    window.gBrowser.addProgressListener({
      onLocationChange(webProgress, _request, location) {
        if (!webProgress.isTopLevel) {
          return;
        }
        let isLockedDown = false;
        try {
          isLockedDown = !Services.policies.isAllowedForURI("jit", location);
        } catch (e) {
          lazy.log.warn("Failed to check lockdown state for URI: ", e);
        }
        button.hidden = !isLockedDown;
      },
    });
  },

  registerSignoutBlocker() {
    if (Services.felt.isFeltBrowser()) {
      lazy.AsyncShutdown.appShutdown.addBlocker(
        "EnterpriseHandler: signing out user on shutdown",
        () => this._signoutOnShutdown()
      );
    }
  },

  /**
   * Updates the user icon and badge logo
   *
   * @param {Window} window chrome window
   */
  updateBadge(window) {
    this._updateLogo(window);

    const userIcon = window.document.querySelector("#enterprise-user-icon");

    if (!this._signedInUser) {
      // Hide user icon from enterprise badge until we have user information
      userIcon.hidden = true;
      console.warn(
        "Unable to update user icon in badge without user information"
      );
      return;
    }
    userIcon.style.setProperty(
      "list-style-image",
      `url("${this._signedInUser.pictureUrl}")`
    );
  },

  openPanel(element, event) {
    const win = element.ownerGlobal;
    win.PanelUI.showSubView("panelUI-enterprise", element, event);
    const document = element.ownerDocument;
    const learnMoreLink = document.getElementById("enterprise-learn-more-link");

    if (!learnMoreLink.href) {
      const uri = lazy.ConsoleClient.learnMoreURI;
      learnMoreLink.setAttribute("href", uri);

      learnMoreLink.addEventListener("click", e => {
        let where = lazy.BrowserUtils.whereToOpenLink(e, false, false);
        if (where == "current") {
          where = "tab";
        }
        win.openTrustedLinkIn(uri, where);
        e.preventDefault();

        const panel = document
          .getElementById("panelUI-enterprise")
          .closest("panel");
        win.PanelMultiView.hidePopup(panel);
      });
    }

    const email = document.querySelector(".panelUI-enterprise__email");
    if (!this._signedInUser) {
      email.hidden = true;
      document.querySelector("#PanelUI-enterprise-email-separator").hidden =
        true;
      console.warn(
        "Unable to update email in enterprise panel without user information"
      );
      return;
    }

    if (!email.textContent) {
      email.textContent = this._signedInUser.email;
    }
  },

  /**
   * Hide away FxA appearances in the toolbar and the app menu (hamburger menu)
   *
   * @param {Window} window chrome window
   */
  restrictEnterpriseView(window) {
    // Hides fxa toolbar button
    Services.prefs.setBoolPref("identity.fxaccounts.toolbar.enabled", false);

    // Hides fxa item and separator in main view (hamburg menu)
    window.PanelUI.mainView.setAttribute("restricted-enterprise-view", true);
  },

  /**
   * Displays the signout confirmation prompt synchronously and processes the
   * result: saves the pref if the user unchecks it, and sets _signoutAuthorized
   * to allow the appShutdown blocker to perform the actual signout.
   *
   * If signout is already authorized (e.g. called again during a force-quit),
   * returns true immediately without re-prompting.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   * @returns {boolean} true if signout was authorized, false if the user cancelled.
   */
  showSignoutPrompt(window) {
    if (this._signoutAuthorized) {
      return true;
    }

    const shouldInformOnSignout = Services.prefs.getBoolPref(
      PROMPT_ON_SIGNOUT_PREF,
      true
    );

    if (!shouldInformOnSignout) {
      this._signoutAuthorized = true;
      return true;
    }

    const [title, message, checkLabel, signoutBtnLabel] =
      lazy.localization.formatValuesSync([
        { id: "enterprise-signout-prompt-title" },
        { id: "enterprise-signout-prompt-message" },
        { id: "enterprise-signout-prompt-checkbox-label" },
        { id: "enterprise-signout-prompt-primary-btn-label" },
      ]);

    const flags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
      Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
      Services.prompt.BUTTON_POS_0_DEFAULT;

    const checkState = { value: true };
    // buttonPressed will be 0 for Signout and 1 for Cancel
    const buttonPressed = Services.prompt.confirmEx(
      window,
      title,
      message,
      flags,
      signoutBtnLabel,
      null,
      null,
      checkLabel,
      checkState
    );

    if (buttonPressed === 1) {
      return false;
    }

    if (!checkState.value) {
      Services.prefs.setBoolPref(PROMPT_ON_SIGNOUT_PREF, checkState.value);
    }

    this._signoutAuthorized = true;
    return true;
  },

  /**
   * Initiates the signout flow from the enterprise panel. Shows the signout
   * confirmation prompt if needed, then triggers shutdown.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   * @returns {Promise<boolean>} Resolves to true if shutdown was triggered, false if cancelled.
   */
  async onSignOut(window) {
    if (!this.showSignoutPrompt(window)) {
      return false;
    }
    await this.initiateShutdown();
    return true;
  },

  async initiateShutdown() {
    // TODO: Bug 2001029 - Assert or force-enable session restore?
    // Reset _signoutAuthorized so the appShutdown blocker does not also call
    // signoutUser after we handle it directly here.
    this._signoutAuthorized = false;
    try {
      await lazy.ConsoleClient.signoutUser();
    } catch (e) {
      console.error(`Unable to signout the user: ${e}`);
    } finally {
      Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
    }
  },

  async _signoutOnShutdown() {
    if (!this._signoutAuthorized) {
      return;
    }
    try {
      await lazy.ConsoleClient.signoutUser();
    } catch (e) {
      console.error(`EnterpriseHandler: Unable to signout the user: ${e}`);
    }
  },

  uninit() {
    this._signedInUser = {};
    this._isInitialized = false;
    this._signoutAuthorized = false;
  },

  _updateLogo(window) {
    const logoUrl = Services.prefs.getStringPref(LOGO_URL, "");

    if (!logoUrl) {
      console.warn(`${LOGO_URL} pref is not set, skipping logo update`);
      return;
    }

    let validLogoUrl;
    try {
      validLogoUrl = new URL(logoUrl);
    } catch {
      throw new Error(`Invalid logo URL in pref: ${logoUrl}`);
    }

    if (validLogoUrl.protocol === "https:") {
      if (validLogoUrl.origin !== lazy.ConsoleClient.consoleBaseURI.origin) {
        throw new Error(`Logo URL must be hosted from the console: ${logoUrl}`);
      }
    } else if (
      !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(logoUrl)
    ) {
      throw new Error(`Invalid logo URL in pref: ${logoUrl}`);
    }

    const toolbarLogo = window.document.querySelector(
      "#enterprise-company-logo__wrapper > image"
    );
    toolbarLogo.style.setProperty(
      "list-style-image",
      `url("${validLogoUrl.href}")`
    );
  },
};
