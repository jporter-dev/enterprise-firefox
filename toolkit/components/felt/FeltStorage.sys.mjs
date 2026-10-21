/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  JSONFile: "resource://gre/modules/JSONFile.sys.mjs",
  OSKeyStore: "resource://gre/modules/OSKeyStore.sys.mjs",
});

const PENDING_URLS_VERSION = 1;
// The stored queue only has to outlive the restart that wrote it. Anything
// older is a leftover from a launch that never restored it, so it is dropped
// rather than reopened in a session that did not ask for it.
const PENDING_URLS_MAX_AGE_MS = 30 * 60 * 1000;
// The system clock can step backwards between the write and the restart (an
// NTP correction, for one), so a record from slightly in the future is kept.
const PENDING_URLS_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Storage helper for reading and writing felt-related data to felt.json
 */
export const FeltStorage = {
  _initialized: false,

  _feltStorage: null,

  /**
   * Bumped by clearPendingURLs() so a storePendingURLs() call that was
   * already encrypting when the queue was cleared can tell its result is
   * stale.
   *
   * @type {number}
   */
  _pendingURLsGeneration: 0,
  /**
   * Absolute path to the felt.json file in the user's app-data directory (UAppData).
   *
   * @type {string}
   */
  FELT_FILE_PATH: PathUtils.join(
    Services.dirsvc.get("UAppData", Ci.nsIFile).path,
    "felt.json"
  ),

  async init() {
    if (!this._initialized) {
      this._feltStorage = new lazy.JSONFile({
        path: this.FELT_FILE_PATH,
      });
      this._initialized = true;
    }
    await this._feltStorage.load();
  },

  async beginSession(email) {
    this._feltStorage.data.activeSessionEmail = email || "";
    await this._feltStorage._save();
  },

  async endSession() {
    delete this._feltStorage.data.activeSessionEmail;
    await this._feltStorage._save();
  },

  async recoverInterruptedSession() {
    if (!Object.hasOwn(this._feltStorage.data, "activeSessionEmail")) {
      return false;
    }
    const email = this._feltStorage.data.activeSessionEmail;
    if (email) {
      delete this._feltStorage.data.lockingTokens?.[email];
    } else {
      delete this._feltStorage.data.lockingTokens;
    }
    delete this._feltStorage.data.activeSessionEmail;
    await this._feltStorage._save();
    return true;
  },

  async flush() {
    await this._feltStorage._save();
  },

  /**
   * Gets the email that was used to signin the last time (if available)
   *
   * @returns {string | undefined} email
   */
  getLastSignedInUser() {
    return this._feltStorage.data?.lastSignedInUserEmail;
  },

  /**
   * Gets the device ID (generates a ID one if not available)
   *
   * @returns {string} email
   */
  getDeviceId() {
    let id = this._feltStorage.data?.deviceId;
    if (id) {
      return id;
    }
    id = globalThis.crypto.randomUUID();
    this._feltStorage.data.deviceId = id;
    this._feltStorage.saveSoon();
    return id;
  },

  /**
   * Updates the email that was used to sign in the last time
   *
   * @param {string} email
   */
  updateLastSignedInUserEmail(email) {
    if (this._feltStorage.data.lastSignedInUserEmail === email) {
      // Nothing changed.
      return;
    }
    this._feltStorage.data.lastSignedInUserEmail = email;
    this._feltStorage.saveSoon();
  },

  /**
   * Gets the enterprise console address entered in the console setup dialog
   * (if available). Only meaningful on generic builds, where the AutoConfig
   * file does not provide a real address.
   *
   * @returns {string | undefined} url
   */
  getConsoleAddress() {
    return this._feltStorage.data?.consoleAddress;
  },

  /**
   * Persists the enterprise console address, writing felt.json immediately.
   * Called from the pre-profile console setup dialog, which relaunches right
   * after, so the write cannot be deferred to saveSoon().
   *
   * @param {string} url
   */
  async persistConsoleAddress(url) {
    this._feltStorage.data.consoleAddress = url;
    await this._feltStorage._save();
  },

  /**
   * Whether a locked-session token is stored for the given user. Cheap and
   * synchronous, unlike getLockingToken, so callers that only need to know
   * whether a session can be unlocked should use this.
   *
   * @param {string} email
   * @returns {boolean}
   */
  hasLockingToken(email) {
    return this._feltStorage.data?.lockingTokens?.[email]?.token !== undefined;
  },

  /**
   * Gets and decrypts the stored refresh token for a locked session, if any.
   *
   * @param {string} email
   * @returns {Promise<string | undefined>} The plaintext refresh token, or
   *   undefined if none is stored.
   */
  async getLockingToken(email) {
    if (!this.hasLockingToken(email)) {
      return undefined;
    }
    const ciphertext = this._feltStorage.data.lockingTokens[email].token;
    return lazy.OSKeyStore.decrypt(ciphertext, "", false);
  },

  /**
   * Returns the user id stored alongside a locked-session token, if any.
   *
   * @param {string} email
   * @returns {string | undefined}
   */
  getLockingUserId(email) {
    return this._feltStorage.data?.lockingTokens?.[email]?.userId;
  },

  /**
   * Encrypts and stores the refresh token for a locked session, plus the user
   * id. Encryption is owned here so a plaintext token can never be persisted to
   * felt.json.
   *
   * @param {string} email
   * @param {string} token The plaintext refresh token.
   * @param {string} [userId] Preserves the existing one if omitted.
   * @returns {Promise<void>}
   */
  async setLockingToken(email, token, userId) {
    const existedBefore = this.hasLockingToken(email);
    const ciphertext = await lazy.OSKeyStore.encrypt(token);
    // A signout may have cleared the record while encrypt() was pending;
    // writing now would resurrect the credential.
    if (existedBefore && !this.hasLockingToken(email)) {
      return;
    }
    if (!this._feltStorage.data.lockingTokens) {
      this._feltStorage.data.lockingTokens = {};
    }
    const record = this._feltStorage.data.lockingTokens[email] ?? {};
    record.token = ciphertext;
    if (userId !== undefined) {
      record.userId = userId;
    }
    this._feltStorage.data.lockingTokens[email] = record;
    this._feltStorage.saveSoon();
  },

  /**
   * Removes any stored locked-session token for the given user.
   *
   * @param {string} email
   */
  clearLockingToken(email) {
    if (this._feltStorage.data.lockingTokens?.[email] !== undefined) {
      delete this._feltStorage.data.lockingTokens[email];
      this._feltStorage.saveSoon();
    }
  },

  /**
   * Encrypts and stores queued external URLs so an app restart can carry them
   * over. Encryption is owned here so felt.json can never hold the plaintext
   * addresses, matching how the locked-session token is stored. The version
   * and creation time sit beside the ciphertext so a launch can tell whether
   * the record is its own and still fresh without asking the keystore. If
   * clearPendingURLs() runs while the keystore is answering, the result is
   * dropped, so a signout cannot be undone by a write that started before it.
   *
   * @param {Array<object>} urls The pending URL payloads.
   * @returns {Promise<void>}
   */
  async storePendingURLs(urls) {
    if (!urls.length) {
      await this.clearPendingURLs();
      return;
    }
    const generation = this._pendingURLsGeneration;
    const createdAt = Date.now();
    const ciphertext = await lazy.OSKeyStore.encrypt(JSON.stringify(urls));
    if (generation !== this._pendingURLsGeneration) {
      return;
    }
    this._feltStorage.data.pendingURLs = {
      version: PENDING_URLS_VERSION,
      createdAt,
      ciphertext,
    };
    await this._feltStorage._save();
  },

  /**
   * Removes any stored external URLs.
   *
   * @returns {Promise<void>}
   */
  async clearPendingURLs() {
    this._pendingURLsGeneration++;
    if (
      !this._feltStorage?.dataReady ||
      this._feltStorage.data.pendingURLs === undefined
    ) {
      return;
    }
    delete this._feltStorage.data.pendingURLs;
    await this._feltStorage._save();
  },

  /**
   * Reads and removes the stored external URLs. The record is dropped
   * before it is decrypted, so a value that cannot be read is still consumed
   * rather than retried on every launch. A record with another version is
   * left alone, since a different build sharing felt.json may have written it.
   *
   * @returns {Promise<Array<object>>} The pending URL payloads, or an empty
   *   array when there is nothing usable stored.
   */
  async takePendingURLs() {
    const record = this._feltStorage.data?.pendingURLs;
    if (record === undefined) {
      return [];
    }
    if (
      Number.isInteger(record?.version) &&
      record.version !== PENDING_URLS_VERSION
    ) {
      return [];
    }
    delete this._feltStorage.data.pendingURLs;
    await this._feltStorage._save();

    const age = Date.now() - record?.createdAt;
    if (
      record?.version !== PENDING_URLS_VERSION ||
      typeof record.ciphertext !== "string" ||
      !Number.isFinite(record.createdAt) ||
      age < -PENDING_URLS_MAX_CLOCK_SKEW_MS ||
      age > PENDING_URLS_MAX_AGE_MS
    ) {
      return [];
    }
    const plaintext = await lazy.OSKeyStore.decrypt(
      record.ciphertext,
      "",
      false
    );
    const urls = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(plaintext, char => char.charCodeAt(0))
      )
    );
    return Array.isArray(urls) ? urls : [];
  },

  async uninit() {
    this._feltStorage = {};
    this._initialized = false;
  },
};
