/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * This class scores a query string against sets of keywords.  To refer to a
 * single set of keywords, we borrow the term "document" from search engine
 * terminology.  To use this class, first add your documents with `addDocument`,
 * and then call `score` with a query string.  `score` returns a sorted array of
 * document-score pairs.
 *
 * The scoring method is simple and is based on Levenshtein edit distance.
 * Therefore, lower scores indicate a better match than higher scores.  In
 * summary, we compute the mean edit distance between the query words and the
 * words in each document that best match the query words.  This mean edit
 * distance is the document's score.
 *
 * For example, if the query is a single word, then the distance between it and
 * a given document is the minimum distance between it and all words in the
 * document.  If the document contains the word exactly, then the distance is
 * zero.  If the query is two words, then the distance between it and the
 * document is the sum of the minimum distances between each query word and all
 * words in the document, divided by two.  For details, see `score`.
 *
 * As mentioned, `score` returns a sorted array of document-score pairs.  It's
 * up to you to filter the array to exclude scores above a certain threshold, or
 * to take the top scorer, etc.
 */
class QueryScorer {
  constructor() {
    this._documentsByWord = new Map();
  }

  /**
   * Adds a document to the scorer.
   *
   * @param {object} doc
   *   The document.
   * @param {string} doc.id
   *   The document's ID.
   * @param {array} doc.words
   *   The set of words in the document.
   */
  addDocument(doc) {
    doc.words = doc.words.map(word => word.toLocaleLowerCase());
    for (let word of doc.words) {
      let docs = this._documentsByWord.get(word) || new Set();
      docs.add(doc);
      this._documentsByWord.set(word, docs);
    }
  }

  /**
   * Scores a query string against the documents in the scorer.
   *
   * @param {string} searchString
   *   The query string to score.
   * @returns {array}
   *   An array of objects: { document, score }.  Each element in the array is a
   *   a document and its score against the query string.  The elements are
   *   ordered by score from low to high.  Scores represent edit distance, so
   *   lower scores are better.
   */
  score(searchString) {
    // For each word in the query string:
    //
    // 1. Get its edit distance from all words in all documents.  While we're
    //    doing that, keep track of the word's minimum distance per document.
    // 2. For each document, add the minimum distance computed in the previous
    //    step to a running sum.  This sum is the document's raw distance for
    //    the query string.
    //
    // Then for each document, convert its raw distance to a mean by dividing by
    // the number of words in the query string.

    let searchWords = searchString
      .trim()
      .split(/\s+/)
      .map(word => word.toLocaleLowerCase());
    let sumByDoc = new Map();
    for (let searchWord of searchWords) {
      let minDistanceByDoc = new Map();
      for (let [docWord, docs] of this._documentsByWord) {
        let distance = this._levenshtein(searchWord, docWord);
        for (let doc of docs) {
          minDistanceByDoc.set(
            doc,
            Math.min(
              distance,
              minDistanceByDoc.has(doc) ? minDistanceByDoc.get(doc) : Infinity
            )
          );
        }
      }
      for (let [doc, min] of minDistanceByDoc) {
        sumByDoc.set(doc, min + (sumByDoc.get(doc) || 0));
      }
    }
    let results = [];
    for (let [doc, sum] of sumByDoc) {
      let mean = sum / searchWords.length;
      results.push({ document: doc, score: mean });
    }
    results.sort((a, b) => a.score - b.score);
    return results;
  }

  /**
   * [Copied from toolkit/modules/NLP.jsm]
   *
   * Calculate the Levenshtein distance between two words.
   * The implementation of this method was heavily inspired by
   * http://locutus.io/php/strings/levenshtein/index.html
   * License: MIT.
   *
   * @param  {String} word1   Word to compare against
   * @param  {String} word2   Word that may be different
   * @param  {Number} costIns The cost to insert a character
   * @param  {Number} costRep The cost to replace a character
   * @param  {Number} costDel The cost to delete a character
   * @return {Number}
   */
  _levenshtein(word1 = "", word2 = "", costIns = 1, costRep = 1, costDel = 1) {
    if (word1 === word2) {
      return 0;
    }

    let l1 = word1.length;
    let l2 = word2.length;
    if (!l1) {
      return l2 * costIns;
    }
    if (!l2) {
      return l1 * costDel;
    }

    let p1 = new Array(l2 + 1);
    let p2 = new Array(l2 + 1);

    let i1, i2, c0, c1, c2, tmp;

    for (i2 = 0; i2 <= l2; i2++) {
      p1[i2] = i2 * costIns;
    }

    for (i1 = 0; i1 < l1; i1++) {
      p2[0] = p1[0] + costDel;

      for (i2 = 0; i2 < l2; i2++) {
        c0 = p1[i2] + (word1[i1] === word2[i2] ? 0 : costRep);
        c1 = p1[i2 + 1] + costDel;

        if (c1 < c0) {
          c0 = c1;
        }

        c2 = p2[i2] + costIns;

        if (c2 < c0) {
          c0 = c2;
        }

        p2[i2 + 1] = c0;
      }

      tmp = p1;
      p1 = p2;
      p2 = tmp;
    }

    c0 = p1[l2];

    return c0;
  }
}
