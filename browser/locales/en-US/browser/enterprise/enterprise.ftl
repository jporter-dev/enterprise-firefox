# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Variables:
#   $datetime (number) - Timestamp of the time the browser will be restarted at.
enterprise-relaunch-warning-message = <strong>Your administrator requires { -brand-short-name } to restart.</strong> It will restart at { DATETIME($datetime, dateStyle: "short", timeStyle: "short") }. Tabs will reopen.

# Variables:
#   $minutes (number) - How many minutes are left before the browser restarts.
enterprise-relaunch-imminent-message =
    { $minutes ->
        [one] <strong>{ -brand-short-name } will restart in { $minutes } minute.</strong> Save your work now. Tabs will reopen.
       *[other] <strong>{ -brand-short-name } will restart in { $minutes } minutes.</strong> Save your work now. Tabs will reopen.
    }

enterprise-relaunch-restart-now = Restart now
