'use strict';

import { DOC_STORE, readBlobData } from './util';

export default function(db, docId, attachId, cb) {

  var txn = db.transaction([DOC_STORE], 'readonly');

  txn.objectStore(DOC_STORE).get(docId).onsuccess = function (e) {
    var doc = e.target.result;
    cb(null, doc.attachments[attachId].data);
  }
}
