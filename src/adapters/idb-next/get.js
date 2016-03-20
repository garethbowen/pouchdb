'use strict';

import { createError, MISSING_DOC } from '../../deps/errors';
import { META_STORE, DOC_STORE, ATTACH_STORE } from './util';

export default function(db, id, opts, callback) {

  // We may be given a transaction object to reuse, if not create one
  var txn = opts.ctx;
  if (!txn) {
    var stores = [DOC_STORE, ATTACH_STORE, META_STORE];
    txn = db.transaction(stores, 'readonly');
  }

  txn.objectStore(DOC_STORE).get(id).onsuccess = function (e) {

    var doc = e.target.result;
    var rev = opts.rev || (doc && doc.rev);

    if (!doc || (doc.deleted && !opts.rev) || !(rev in doc.revs)) {
      callback(createError(MISSING_DOC, 'missing'));
      return;
    }

    var result = doc.revs[rev].data;
    result._id = doc.id;
    result._rev = rev;

    // WARNING: expecting possible old format
    callback(null, {
      doc: result,
      metadata: doc,
      ctx: txn
    });

  };
}
