/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/* import-globals-from ../../../src/QueryScorer.js */

"use strict";

// The path of the add-on file relative to `getTestFilePath`.
const ADDON_PATH = "urlbar_interventions-1.0.0.zip";

// Use SIGNEDSTATE_MISSING when testing an unsigned, in-development version of
// the add-on and SIGNEDSTATE_PRIVILEGED when testing the production add-on.
const EXPECTED_ADDON_SIGNED_STATE = AddonManager.SIGNEDSTATE_MISSING;
// const EXPECTED_ADDON_SIGNED_STATE = AddonManager.SIGNEDSTATE_PRIVILEGED;

const CUTOFF_SCORE = 1;

let documents = {
  fruits: "apple pear banana orange pomegranate",
  iceCreams: "chocolate vanilla butterscotch",
  animals: "aardvark badger hamster elephant",
};

let tests = [
  {
    query: "banana",
    matches: ["fruits"],
  },
  {
    query: "banan",
    matches: ["fruits"],
  },
  {
    query: "bana",
    matches: [],
  },
  {
    query: "banna",
    matches: ["fruits"],
  },
  {
    query: "banana apple",
    matches: ["fruits"],
  },
  {
    query: "banana appl",
    matches: ["fruits"],
  },
  {
    query: "banana app",
    matches: ["fruits"],
  },
  {
    query: "banana ap",
    matches: [],
  },

  {
    query: "vanilla",
    matches: ["iceCreams"],
  },
  {
    query: "vanill",
    matches: ["iceCreams"],
  },
  {
    query: "vanil",
    matches: [],
  },
  {
    query: "vanila",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscotch",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscotc",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscot",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla buttersco",
    matches: [],
  },

  {
    query: "aardvark",
    matches: ["animals"],
  },
  {
    query: "aardvar",
    matches: ["animals"],
  },
  {
    query: "aardva",
    matches: [],
  },
  {
    query: "ardvark",
    matches: ["animals"],
  },
  {
    query: "aardvark hamster",
    matches: ["animals"],
  },
  {
    query: "aardvark hamste",
    matches: ["animals"],
  },
  {
    query: "aardvark hamst",
    matches: ["animals"],
  },
  {
    query: "aardvark hams",
    matches: [],
  },

  {
    query: "banana aardvark",
    matches: [],
  },
];

add_task(async function init() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);
});

add_task(async function test() {
  await withAddon(async addon => {
    let fileURI = addon.getResourceURI("QueryScorer.js");
    Services.scriptloader.loadSubScript(fileURI.spec);

    let qs = new QueryScorer();

    for (let [id, words] of Object.entries(documents)) {
      qs.addDocument({ id, words: words.split(/\s+/) });
    }

    for (let { query, matches } of tests) {
      info(`Checking query: ${query}\n`);
      let actual = qs
        .score(query)
        .filter(result => result.score <= CUTOFF_SCORE)
        .map(result => result.document.id);
      Assert.deepEqual(actual, matches);
    }
  });
});
