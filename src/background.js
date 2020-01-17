/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global QueryScorer */

// The possible study branches.
const BRANCHES = {
  CONTROL: "control",
  TREATMENT: "treatment",
};

// The possible tips to show.
const TIPS = {
  NONE: "",
  CLEAR: "clear",
  REFRESH: "refresh",

  // There's an update available, but the user's pref says we should ask them to
  // download and apply it.
  UPDATE_ASK: "update_ask",

  // The user's browser is up to date, but they triggered the update
  // intervention.  We show this special refresh intervention instead.
  UPDATE_REFRESH: "update_refresh",

  // There's an update and it's been downloaded and applied.  The user needs to
  // restart to finish.
  UPDATE_RESTART: "update_restart",

  // We can't update the browser or possibly even check for updates for some
  // reason, so the user should download the latest version from the web.
  UPDATE_WEB: "update_web",
};

// The search "documents" corresponding to each tip type.
const DOCUMENTS = {
  clear: [
    "cache firefox",
    "clear cache firefox",
    "clear cache in firefox",
    "clear cookies firefox",
    "clear firefox cache",
    "clear history firefox",
    "cookies firefox",
    "delete cookies firefox",
    "delete history firefox",
    "firefox cache",
    "firefox clear cache",
    "firefox clear cookies",
    "firefox clear history",
    "firefox cookie",
    "firefox cookies",
    "firefox delete cookies",
    "firefox delete history",
    "firefox history",
    "firefox not loading pages",
    "history firefox",
    "how to clear cache",
    "how to clear history",
  ],
  refresh: [
    "firefox crashing",
    "firefox keeps crashing",
    "firefox not responding",
    "firefox not working",
    "firefox refresh",
    "firefox slow",
    "how to reset firefox",
    "refresh firefox",
    "reset firefox",
  ],
  update: [
    "download firefox",
    "download mozilla",
    "firefox browser",
    "firefox download",
    "firefox for mac",
    "firefox for windows",
    "firefox free download",
    "firefox install",
    "firefox installer",
    "firefox latest version",
    "firefox mac",
    "firefox quantum",
    "firefox update",
    "firefox version",
    "firefox windows",
    "get firefox",
    "how to update firefox",
    "install firefox",
    "mozilla download",
    "mozilla firefox 2019",
    "mozilla firefox 2020",
    "mozilla firefox download",
    "mozilla firefox for mac",
    "mozilla firefox for windows",
    "mozilla firefox free download",
    "mozilla firefox mac",
    "mozilla firefox update",
    "mozilla firefox windows",
    "mozilla update",
    "update firefox",
    "update mozilla",
    "www.firefox.com",
  ],
};

// Our browser.urlbar provider name.
const URLBAR_PROVIDER_NAME = "interventions";

// Telemetry names.
const TELEMETRY_ROOT = "urlbarInterventionsExperiment";
const TELEMETRY_SHOWN_PART = "tipShownCount";
const TELEMETRY_SHOWN = `${TELEMETRY_ROOT}.${TELEMETRY_SHOWN_PART}`;
const TELEMETRY_PICKED_PART = "tipPickedCount";
const TELEMETRY_PICKED = `${TELEMETRY_ROOT}.${TELEMETRY_PICKED_PART}`;

// We open this survey web page in certain cases.
const SURVEY_URL = "https://qsurvey.mozilla.com/s3/Search-Interventions";

// We inject this content script in the survey page to listen for when the user
// starts the survey so that we don't bug them with it anymore.
const SURVEY_CONTENT_SCRIPT_PATH = "/content/survey.js";

// We open the survey web page a maximum of this number of times across all
// browser sessions.
const MAX_SURVEY_OPEN_COUNT = 3;

// The current study branch.
let studyBranch;

// The tip we should currently show.
let currentTip = TIPS.NONE;

// Object used to match the user's queries to tips.
let queryScorer = new QueryScorer({
  variations: new Map([
    // Recognize "fire fox", "fox fire", and "foxfire" as "firefox".
    ["firefox", ["fire fox", "fox fire", "foxfire"]],
    // Recognize "mozila" as "mozilla".  This will catch common mispellings
    // "mozila", "mozzila", and "mozzilla" (among others) due to the edit
    // distance threshold of 1.
    ["mozilla", ["mozila"]],
  ]),
});

// Tips shown in the current engagement (TIPS values).
let tipsShownInCurrentEngagement = new Set();

// Set to true when a tip is picked so that our onEngagement listener can know
// whether an engagement happens due to that.
let tipPicked = false;

// True when we've opened the survey during a browser session.
let openedSurveyInCurrentSession = false;

/**
 * browser.urlbar.onBehaviorRequested listener.
 */
async function onBehaviorRequested(query) {
  currentTip = TIPS.NONE;

  if (!query.searchString) {
    return "inactive";
  }

  // Get the scores and the top score.
  let docScores = queryScorer.score(query.searchString);
  let topDocScore = docScores[0];

  // Multiple docs may have the top score, so collect them all.
  let topDocIDs = new Set();
  if (topDocScore.score != Infinity) {
    for (let { score, document } of docScores) {
      if (score != topDocScore.score) {
        break;
      }
      topDocIDs.add(document.id);
    }
  }

  // Determine the tip to show, if any.  If there are multiple top-score docs,
  // prefer them in the following order.
  if (topDocIDs.has("update")) {
    // There are several update tips.  Figure out which one to show.
    let status = await browser.experiments.urlbar.getBrowserUpdateStatus();
    switch (status) {
      case "downloading":
      case "staging":
      case "readyForRestart":
        // Prompt the user to restart.
        currentTip = TIPS.UPDATE_RESTART;
        break;
      case "downloadAndInstall":
        // There's an update available, but the user's pref says we should ask
        // them to download and apply it.
        currentTip = TIPS.UPDATE_ASK;
        break;
      case "noUpdatesFound":
        // We show a special refresh tip when the browser is up to date.
        currentTip = TIPS.UPDATE_REFRESH;
        break;
      case "checking":
        // The browser is checking for an update.  There's not much we can do in
        // this case without implementing a decent self-updating progress UI, so
        // just don't show anything.
        return "inactive";
      default:
        // Give up and ask the user to download the latest version from the web.
        currentTip = TIPS.UPDATE_WEB;
        break;
    }
  } else if (
    topDocIDs.has("clear") &&
    !(await browser.windows.getLastFocused()).incognito
  ) {
    currentTip = TIPS.CLEAR;
  } else if (topDocIDs.has("refresh")) {
    currentTip = TIPS.REFRESH;
  } else {
    // No tip.
    return "inactive";
  }

  tipsShownInCurrentEngagement.add(currentTip);

  return studyBranch == BRANCHES.TREATMENT ? "active" : "inactive";
}

/**
 * browser.urlbar.onResultsRequested listener.
 */
async function onResultsRequested(query) {
  let result = {
    type: "tip",
    source: "local",
    suggestedIndex: 1,
    payload: {
      type: currentTip,
    },
  };

  switch (currentTip) {
    case TIPS.CLEAR:
      result.payload.text = "Clear Firefox’s cache, cookies, history and more.";
      result.payload.buttonText = "Choose What to Clear…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/delete-browsing-search-download-history-firefox";
      break;
    case TIPS.REFRESH:
      result.payload.text =
        "Restore default settings and remove old add-ons for optimal performance.";
      result.payload.buttonText = "Refresh Firefox…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/refresh-firefox-reset-add-ons-and-settings";
      break;
    case TIPS.UPDATE_ASK:
      result.payload.text = "A new version of Firefox is available.";
      result.payload.buttonText = "Install and Restart to Update";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
    case TIPS.UPDATE_REFRESH:
      result.payload.text =
        "Firefox is up to date. Trying to fix a problem? Restore default settings and remove old add-ons for optimal performance.";
      result.payload.buttonText = "Refresh Firefox…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/refresh-firefox-reset-add-ons-and-settings";
      break;
    case TIPS.UPDATE_RESTART:
      result.payload.text =
        "The latest Firefox is downloaded and ready to install.";
      result.payload.buttonText = "Restart to Update";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
    case TIPS.UPDATE_WEB:
      result.payload.text = "Get the latest Firefox browser.";
      result.payload.buttonText = "Download Now";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
  }

  return [result];
}

/**
 * browser.urlbar.onResultPicked listener.  Called when a tip button is picked.
 *
 * IMPORTANT: This function should not `await` anything before performing the
 * tip action, and for that reason it's not declared async.  See the IMPORTANT
 * comment below.
 */
function onResultPicked(payload) {
  let tip = payload.type;

  // Set tipPicked so our onEngagement listener knows a tip was picked.
  tipPicked = true;

  // Update picked-count telemetry.
  browser.telemetry.keyedScalarAdd(TELEMETRY_PICKED, tip, 1);

  // We open a survey 100% of the time a tip is picked.  If the browser will not
  // restart due to the user's picking the tip, we open the survey now (below).
  // If the browser will restart, we open the survey after restart (in enroll).

  // Determine whether the browser will restart.  REFRESH and UPDATE_REFRESH are
  // special cases.  We'll show the reset-profile dialog.  If the user cancels
  // it, nothing happens.  If they accept it, then the browser will restart and
  // all add-ons will be uninstalled, including this one.  So the only way they
  // would see a survey is if they cancel.  Therefore we open the survey now for
  // those tips.
  let willRestart = false;
  switch (tip) {
    case TIPS.UPDATE_ASK:
    case TIPS.UPDATE_RESTART:
      willRestart = true;
      break;
  }

  // If we're restarting, save the picked tip type in storage.
  if (willRestart) {
    browser.storage.local.set({ surveyToOpenOnStartup: tip });
  }

  // Do the tip action.
  //
  // IMPORTANT: Don't `await` anything before this!  Some of these functions we
  // are declared with `requireUserInput` and therefore must be called directly
  // by a click, keypress, etc.  That means they must be called on the same
  // stack as the initial user input event.  Otherwise they'll fail.
  switch (tip) {
    case TIPS.CLEAR:
      browser.experiments.urlbar.openClearHistoryDialog();
      break;
    case TIPS.REFRESH:
    case TIPS.UPDATE_REFRESH:
      browser.experiments.urlbar.resetBrowser();
      break;
    case TIPS.UPDATE_ASK:
      browser.experiments.urlbar.installBrowserUpdateAndRestart();
      break;
    case TIPS.UPDATE_RESTART:
      browser.experiments.urlbar.restartBrowser();
      break;
    case TIPS.UPDATE_WEB:
      browser.tabs.create({ url: "https://www.mozilla.org/firefox/new/" });
      break;
  }

  // If we're not restarting, open the survey now.
  if (!willRestart) {
    maybeOpenSurvey([tip], "picked");
  }
}

/**
 * browser.runtime.onMessage listener.  Called when our survey content script
 * sends a message.
 *
 * IMPORTANT: The WebExtensions doc says this listener should not be async.
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage
 */
function onContentScriptMessage(message, sender, sendResponse) {
  if (message != "submit") {
    console.debug(`Unexpected message: ${message}`);
    return;
  }

  // We only need to do this once, so remove the listener.
  browser.runtime.onMessage.removeListener(onContentScriptMessage);

  // Set the open count to the max.
  browser.storage.local.set({ surveyOpenedCount: MAX_SURVEY_OPEN_COUNT });
}

/**
 * We open a user survey web page in three cases:
 *
 * (1) Treatment: When the user picks a tip.
 * (2) Treatment: When the user is shown a tip but they don't pick it.
 * (3) Control: When the user would have been shown a tip.
 *
 * For (1), we open the survey 100% of the time.  For (2) and (3), we open it
 * only some of the time so that the number of users shown the survey in all
 * three cases is roughly the same.  Since we expect a pick rate of ~2%, we open
 * the survey in (2) and (3) only 2% of the time this method is called.
 *
 * @param {array} tips
 *   The tip type(s) that triggered the survey.
 * @param {string} action
 *   The reason for opening the survey:
 *     * "picked": The user picked a tip.
 *     * "ignored": One or more tips were shown in an engagement, but the user
 *       didn't pick any.
 *   On the control branch, the action should always be "ignored".
 */
async function maybeOpenSurvey(tips, action) {
  // Don't open the survey more than once per session.
  if (openedSurveyInCurrentSession) {
    return;
  }

  // Get the number of times we've opened the survey over all sessions.  If it's
  // the max, don't open it again.
  let storage = await browser.storage.local.get(null);
  let surveyOpenedCount = (storage && storage.surveyOpenedCount) || 0;
  if (surveyOpenedCount >= MAX_SURVEY_OPEN_COUNT) {
    return;
  }

  // Aside from the opened-count logic, if the user picked a tip, we always open
  // the survey.  If they ignored the tip or they're on control, we open the
  // survey only 2% of the time, but tests and QA can force it to open by
  // setting storage.forceSurvey.
  if (
    action != "picked" &&
    Math.random() > 0.02 &&
    (!storage || !storage.forceSurvey)
  ) {
    return;
  }

  // Open the survey.
  let spec = (storage && storage.surveyURL) || SURVEY_URL;
  let url = new URL(spec);
  url.searchParams.set("b", studyBranch);
  url.searchParams.set("action", action);
  for (let tip of tips) {
    url.searchParams.append("tip", tip);
  }
  let tab = await browser.tabs.create({ url: url.toString(), active: false });

  // Update the opened count.
  openedSurveyInCurrentSession = true;
  surveyOpenedCount++;
  await browser.storage.local.set({ surveyOpenedCount });

  // Inject our content script that listens for when the user starts the survey.
  // Note that since we open the survey no more than once per session, we don't
  // need to worry about adding our content script listener more than once.
  await browser.runtime.onMessage.addListener(onContentScriptMessage);
  await browser.tabs.executeScript(tab.id, {
    file: SURVEY_CONTENT_SCRIPT_PATH,
  });
}

/**
 * browser.urlbar.onEngagement listener.  Called when an engagement starts and
 * stops.
 */
async function onEngagement(state) {
  if (!tipsShownInCurrentEngagement.size) {
    return;
  }

  if (["engagement", "abandonment"].includes(state)) {
    let tips = Array.from(tipsShownInCurrentEngagement);
    for (let tip of tips) {
      browser.telemetry.keyedScalarAdd(TELEMETRY_SHOWN, tip, 1);
    }

    // Tips were shown during the engagement, but at this point we don't know
    // whether the user picked one (because onEngagement is fired before
    // onResultPicked, unfortunately).  So wait a bit to see if onResultPicked
    // is called and sets tipPicked.  If not, then the user ignored the tips,
    // and we may need to open the survey.
    tipPicked = false;
    setTimeout(() => {
      if (!tipPicked) {
        maybeOpenSurvey(tips, "ignored");
      }
    }, 200);
  }

  tipsShownInCurrentEngagement.clear();
}

/**
 * Resets all the state we set on enrollment in the study.
 */
async function unenroll() {
  await browser.experiments.urlbar.engagementTelemetry.clear({});
  await browser.urlbar.onBehaviorRequested.removeListener(onBehaviorRequested);
  await browser.urlbar.onResultsRequested.removeListener(onResultsRequested);
  await browser.urlbar.onResultPicked.removeListener(onResultPicked);
  await browser.urlbar.onEngagement.removeListener(onEngagement);
  await browser.runtime.onMessage.removeListener(onContentScriptMessage);
  sendTestMessage("unenrolled");
}

/**
 * Sets up all appropriate state for enrollment in the study.
 */
async function enroll() {
  await browser.normandyAddonStudy.onUnenroll.addListener(async () => {
    await unenroll();
  });

  // Add urlbar listeners.
  await browser.urlbar.onBehaviorRequested.addListener(
    onBehaviorRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultsRequested.addListener(
    onResultsRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultPicked.addListener(
    onResultPicked,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onEngagement.addListener(
    onEngagement,
    URLBAR_PROVIDER_NAME
  );

  // Enable urlbar engagement event telemetry.
  await browser.experiments.urlbar.engagementTelemetry.set({ value: true });

  // Register scalar telemetry.  We increment keyed scalars when we show a tip
  // and when the user picks a tip.
  await browser.telemetry.registerScalars(TELEMETRY_ROOT, {
    [TELEMETRY_SHOWN_PART]: {
      kind: "count",
      keyed: true,
      record_on_release: true,
    },
    [TELEMETRY_PICKED_PART]: {
      kind: "count",
      keyed: true,
      record_on_release: true,
    },
  });

  // Initialize the query scorer.
  for (let [id, phrases] of Object.entries(DOCUMENTS)) {
    queryScorer.addDocument({ id, phrases });
  }

  // Trigger a browser update check.  (This won't actually check if updates are
  // disabled for some reason, e.g., by policy.)
  await browser.experiments.urlbar.checkForBrowserUpdate();

  // If we need to open a survey on startup (see onResultPicked), do so now.
  let storage = await browser.storage.local.get(null);
  if (storage && storage.surveyToOpenOnStartup) {
    await maybeOpenSurvey([storage.surveyToOpenOnStartup], "picked");
    await browser.storage.local.remove("surveyToOpenOnStartup");
  }

  sendTestMessage("enrolled");
}

/**
 * Logs a debug message, which the test harness interprets as a message the
 * add-on is sending to the test.  See head.js for info.
 *
 * @param {string} msg
 *   The message.
 */
function sendTestMessage(msg) {
  console.debug(browser.runtime.id, msg);
}

(async function main() {
  // As a development convenience, act like we're enrolled in the treatment
  // branch if we're a temporary add-on.  onInstalled with details.temporary =
  // true will be fired in that case.  Add the listener now before awaiting the
  // study below to make sure we don't miss the event.
  let installPromise = new Promise(resolve => {
    browser.runtime.onInstalled.addListener(details => {
      resolve(details.temporary);
    });
  });

  // If we're enrolled in the study, set everything up, and then we're done.
  let study = await browser.normandyAddonStudy.getStudy();
  if (study) {
    // Sanity check the study.  This conditional should always be true.
    if (study.active && Object.values(BRANCHES).includes(study.branch)) {
      studyBranch = study.branch;
      await enroll();
    }
    sendTestMessage("ready");
    return;
  }

  // There's no study.  If installation happens, then continue with the
  // development convenience described above.
  installPromise.then(async isTemporaryInstall => {
    if (isTemporaryInstall) {
      console.debug("isTemporaryInstall");
      studyBranch = BRANCHES.TREATMENT;
      await enroll();
    }
    sendTestMessage("ready");
  });
})();
