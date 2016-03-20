'use strict';

import { createError, IDB_ERROR } from '../../deps/errors';
import { DOC_STORE } from './util';

function createKeyRange(start, end, inclusiveEnd, key, descending) {
  try {
    if (start && end) {
      if (descending) {
        return IDBKeyRange.bound(end, start, !inclusiveEnd, false);
      } else {
        return IDBKeyRange.bound(start, end, false, !inclusiveEnd);
      }
    } else if (start) {
      if (descending) {
        return IDBKeyRange.upperBound(start);
      } else {
        return IDBKeyRange.lowerBound(start);
      }
    } else if (end) {
      if (descending) {
        return IDBKeyRange.lowerBound(end, !inclusiveEnd);
      } else {
        return IDBKeyRange.upperBound(end, !inclusiveEnd);
      }
    } else if (key) {
      return IDBKeyRange.only(key);
    }
  } catch (e) {
    return {error: e};
  }
  return null;
}

function handleKeyRangeError(opts, api, err, callback) {
  if (err.name === "DataError" && err.code === 0) {
    // data error, start is less than end
    return api.info().then(function(info) {
      return callback(null, {
        total_rows: info.doc_count,
        offset: opts.skip,
        rows: []
      });
    });
  }
  callback(createError(IDB_ERROR, err.name, err.message));
}

export default function(idb, api, opts, callback) {

  // TODO: Weird hack, I dont like it
  if (opts.limit === 0) {
    return api.info().then(function(info) {
      callback(null, {total_rows: info.doc_count, offset: opts.skip, rows: []});
    });
  }

  var results = [];

  var start = 'startkey' in opts ? opts.startkey : false;
  var end = 'endkey' in opts ? opts.endkey : false;
  var key = 'key' in opts ? opts.key : false;
  var skip = opts.skip || 0;
  var limit = typeof opts.limit === 'number' ? opts.limit : -1;
  var inclusiveEnd = opts.inclusive_end !== false;
  var descending = 'descending' in opts && opts.descending ? 'prev' : null;

  var keyRange = createKeyRange(start, end, inclusiveEnd, key, descending);
  if (keyRange && keyRange.error) {
    return handleKeyRangeError(opts, api, keyRange.error, callback);
  }

  var txn = idb.transaction([DOC_STORE], 'readonly');
  var docStore = txn.objectStore(DOC_STORE);

  var cursor = descending ?
    docStore.openCursor(keyRange, descending) :
    docStore.openCursor(keyRange);

  cursor.onsuccess = function(e) {
    var doc = e.target.result && e.target.result.value;
    if (!doc) { return; }

    var row = {
      id: doc.id,
      key: doc.id,
      value: {
        rev: doc.rev
      }
    };

    var deleted = doc.deleted;

    // TODO: I do not like this code
    if (opts.deleted === 'ok') {
      results.push(row);
      if (deleted) {
        row.value.deleted = true;
        row.doc = null;
      } else if (opts.include_docs) {
        row.doc = doc.data;
        row.doc._id = doc.id;
        row.doc._rev = doc.rev;
      }
    } else if (!deleted && skip-- <= 0) {
      results.push(row);
      if (opts.include_docs) {
        row.doc = doc.data;
        row.doc._id = doc.id;
        row.doc._rev = doc.rev;
      }
      if (--limit === 0) {
        return;
      }
    }
    e.target.result.continue();
  };

  txn.oncomplete = function () {
    // TODO: This is not done within the same transaction, may need fixing
    api.info().then(function(info) {
      callback(null, {
        total_rows: info.doc_count,
        offset: 0,
        rows: results
      });
    });
  };

};
