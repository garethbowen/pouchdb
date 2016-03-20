'use strict';

import { createError, MISSING_DOC } from '../../deps/errors';
import { META_STORE, DOC_STORE, ATTACH_STORE } from './util';

export default function(db, api, callback) {

  var txn = db.transaction([DOC_STORE], 'readwrite');
  var key = IDBKeyRange.only(0);
  var req = txn.objectStore(DOC_STORE).index('deleted').count(key);

  req.onsuccess = function(e) {
    callback(null, {
      doc_count: e.target.result,
      update_seq: api.metaData.seq
    });
  };

}
