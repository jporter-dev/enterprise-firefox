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
   * the prompt, or promptOnSignout is false). Gates the appShutdownConfirmed
   * blocker so that non-signout quits (e.g. restarts for updates) do not
   * trigger a signout.
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

  registerSignoutBlocker() {
    if (Services.felt.isFeltBrowser()) {
      lazy.AsyncShutdown.appShutdownConfirmed.addBlocker(
        "EnterpriseHandler: signing out user on shutdown",
        () => this._signoutOnShutdown()
      );
    }
  },

  /**
   * Updates the user icon
   *
   * @param {Window} window chrome window
   */
  updateBadge(window) {
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
      document.querySelector("#PanelUI-enterprise-separator").hidden = true;
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
   * Shows the signout confirmation prompt synchronously. Used as a gate in the
   * quit-application-requested observer to allow or block the quit before the
   * async shutdown blocker performs the actual signout.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   * @returns {boolean} true if the user confirmed signout, false if cancelled.
   */
  onSignOutSync(window) {
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
   * Shows the signout confirmation prompt and triggers shutdown if confirmed.
   * The actual signout is performed by the appShutdownConfirmed blocker.
   *
   * @param {Window} window - Chrome window to use as dialog parent.
   * @returns {Promise<boolean>} Resolves to true if shutdown was triggered, false if cancelled.
   */
  async onSignOut(window) {
    const shouldInformOnSignout = Services.prefs.getBoolPref(
      PROMPT_ON_SIGNOUT_PREF,
      true
    );

    if (!shouldInformOnSignout) {
      this.initiateShutdown();
      return true;
    }

    const [title, message, checkLabel, signoutBtnLabel] =
      await lazy.localization.formatValues([
        { id: "enterprise-signout-prompt-title" },
        { id: "enterprise-signout-prompt-message" },
        { id: "enterprise-signout-prompt-checkbox-label" },
        { id: "enterprise-signout-prompt-primary-btn-label" },
      ]);

    const flags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
      Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
      Services.prompt.BUTTON_POS_0_DEFAULT;

    // buttonPressed will be 0 for Signout and 1 for Cancel
    const result = await Services.prompt.asyncConfirmEx(
      window.browsingContext,
      Services.prompt.MODAL_TYPE_INTERNAL_WINDOW,
      title,
      message,
      flags,
      signoutBtnLabel,
      null,
      null,
      checkLabel,
      true // checkbox checked
    );

    if (result.get("buttonNumClicked") === 1) {
      // User canceled signout. Also ignore any checkbox toggling.
      return false;
    }

    if (!result.get("checked")) {
      // User unchecked the option to be prompted before signout
      Services.prefs.setBoolPref(PROMPT_ON_SIGNOUT_PREF, result.get("checked"));
    }

    await this.initiateShutdown();
    return true;
  },

  async initiateShutdown() {
    // TODO: Bug 2001029 - Assert or force-enable session restore?
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
  },
};
