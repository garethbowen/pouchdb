'use strict';

import {
  createError,
  REV_CONFLICT,
  MISSING_DOC,
  BAD_ARG
} from '../../deps/errors';

import { parseDoc } from '../../deps/docs/parseDoc';
import md5 from '../../deps/md5';

import merge from '../../deps/merge/index';
import calculateWinningRev from '../../deps/merge/winningRev';

import binStringToBlobOrBuffer from '../../deps/binary/binaryStringToBlobOrBuffer';

import { META_STORE, DOC_STORE, ATTACH_STORE, idbError } from './util';

export default function(db, req, opts, api, idbChanges, callback) {

  var stores = [DOC_STORE, ATTACH_STORE, META_STORE];
  var txn = db.transaction(stores, 'readwrite');

  // TODO: I would prefer to get rid of these globals
  var results = [];
  var docs = [];

  var revsLimit = api.metaData.revsLimit || 1000;

  function rootIsMissing(doc) {
    return doc.rev_tree[0].ids[1].status === 'missing';
  }

  function parseBase64(data) {
    try {
      return atob(data);
    } catch (e) {
      return {
        error: createError(BAD_ARG, 'Attachment is not a valid base64 string')
      };
    }
  }

  // Reads the original doc from the store if available
  function fetchExistingDocs(txn, docs) {
    return new Promise(function (resolve) {
      var fetched = 0;
      var oldDocs = {};

      function readDone(e) {
        if (e.target.result) {
          oldDocs[e.target.result.id] = e.target.result;
        }
        if (++fetched === docs.length) {
          resolve(oldDocs);
        }
      }

      docs.forEach(function(doc) {
        txn.objectStore(DOC_STORE).get(doc.id).onsuccess = readDone;
      });
    });
  }

  function processDocs(txn, docs, oldDocs) {

    docs.forEach(function(doc, i) {
      var newDoc;

      // The first document write cannot be a deletion
      if ('was_delete' in opts && !(doc.id in oldDocs)) {
        newDoc = createError(MISSING_DOC, 'deleted');

      // Update the existing document
      } else if (doc.id in oldDocs) {
        newDoc = update(txn, doc, oldDocs[doc.id]);
        // The update can be rejected if it is an update to an existing
        // revision, if so skip it
        if (newDoc == false) {
          return;
        }

      // New document
      } else {
        // Ensure new documents are also stemmed
        var merged = merge([], doc.rev_tree[0], revsLimit);
        doc.rev_tree = merged.tree;
        doc.stemmedRevs = merged.stemmedRevs;
        newDoc = doc;
      }

      // First document write cannot have a revision
      // TODO: Pretty unclear implementation, revisit
      if (opts.new_edits && rootIsMissing(doc)) {
        newDoc = createError(REV_CONFLICT);
      }

      if (newDoc.error) {
        results[i] = newDoc;
      } else {
        oldDocs[newDoc.id] = newDoc;
        write(txn, newDoc, i);
      }
    });
  }

  // Converts from the format returned by parseDoc into the new format
  // we use to store
  function convertDocFormat(doc) {

    var newDoc = {
      id: doc.metadata.id,
      rev: doc.metadata.rev,
      rev_tree: doc.metadata.rev_tree,
      revs: doc.metadata.revs || {}
    };

    newDoc.revs[newDoc.rev] = {
      data: doc.data,
      deleted: doc.metadata.deleted
    }

    return newDoc;
  }

  function update(txn, doc, oldDoc) {

    // Ignore updates to existing revisions
    if (doc.rev in oldDoc.revs) {
      return false;
    }

    var isRoot = /^1-/.test(doc.rev);

    // Reattach first writes after a deletion to last deleted tree
    if (oldDoc.deleted && !doc.deleted && opts.new_edits && isRoot) {
      var tmp = doc.revs[doc.rev].data;
      tmp._rev = oldDoc.rev;
      tmp._id = oldDoc.id;
      doc = convertDocFormat(parseDoc(tmp, opts.new_edits));
    }

    var merged = merge(oldDoc.rev_tree, doc.rev_tree[0], revsLimit);
    doc.stemmedRevs = merged.stemmedRevs;
    doc.rev_tree = merged.tree;

    // Merge the old and new rev data
    var revs = oldDoc.revs;
    revs[doc.rev] = doc.revs[doc.rev];
    doc.revs = revs;

    var inConflict = opts.new_edits && (((oldDoc.deleted && doc.deleted) ||
       (!oldDoc.deleted && merged.conflicts !== 'new_leaf') ||
       (oldDoc.deleted && !doc.deleted && merged.conflicts === 'new_branch')));

    if (inConflict) {
      return createError(REV_CONFLICT);
    }

    return doc;
  }

  function write(txn, doc, i) {
    // We copy the data from the winning revision into the root
    // of the document so that it can be indexed
    var winningRev = calculateWinningRev(doc);
    doc.data = doc.revs[winningRev].data;
    doc.rev = winningRev;
    // .deleted needs to be an int for indexing
    doc.deleted = doc.revs[winningRev].deleted ? 1 : 0;

    // Bump the seq for every new revision written
    doc.seq = ++api.metaData.seq;

    // If there have been revisions stemmed when merging trees,
    // delete their data
    if (doc.stemmedRevs) {
      doc.stemmedRevs.forEach(function(rev) { delete doc.revs[rev]; });
    }
    delete doc.stemmedRevs;

    if (!doc.attachments) {
      doc.attachments = {};
    }

    if (doc.data._attachments) {
      for (var k in doc.data._attachments) {
        var attachment = doc.data._attachments[k];
        doc.attachments[k] = attachment;
        doc.data._attachments[k] = {
          stub: true,
          digest: attachment.digest
        };
      }
    }

    txn.objectStore(DOC_STORE).put(doc).onsuccess = function() {
      results[i] = {
        ok: true,
        id: doc.id,
        rev: doc.rev
      };
    };
  }

  function preProcessAttachment(attachment) {
    if (attachment.stub) {
      return Promise.resolve(attachment);
    }
    if (typeof attachment.data === 'string') {
      var asBinary = parseBase64(attachment.data);
      attachment.data =
        binStringToBlobOrBuffer(asBinary, attachment.content_type);
      attachment.length = asBinary.length;
      return md5(asBinary).then(function (result) {
        attachment.digest = 'md5-' + result;
        return attachment;
      });
    }
  }

  function preProcessAttachments() {
    var promises = docs.map(function(doc) {
      var data = doc.revs[doc.rev].data;
      if (!data._attachments) {
        return Promise.resolve(data);
      }
      var attachments = Object.keys(data._attachments).map(function(k) {
        data._attachments[k].name = k;
        return preProcessAttachment(data._attachments[k]);
      });

      return Promise.all(attachments).then(function(newAttachments) {
        var processed = {};
        newAttachments.forEach(function(attachment) {
          processed[attachment.name] = attachment;
          delete attachment.name;
        });
        data._attachments = processed;
        return data;
      });
    });
    return Promise.all(promises);
  }

  for (var i = 0, len = req.docs.length; i < len; i++) {
    var result;
    // TODO: We should get rid of throwing for invalid docs, also not sure
    // why this is needed in idb-next and not idb
    try {
      result = parseDoc(req.docs[i], opts.new_edits);
    } catch (err) {
      result = err;
    }
    if (result.error) {
      return callback(result);
    }

    // Ideally parseDoc would return data in this format, but it is currently
    // shared
    var newDoc = {
      id: result.metadata.id,
      rev: result.metadata.rev,
      rev_tree: result.metadata.rev_tree,
      revs: {}
    };

    newDoc.revs[newDoc.rev] = {
      data: result.data,
      deleted: result.metadata.deleted
    }

    docs.push(convertDocFormat(result));
  }

  txn.onabort = idbError(callback);
  txn.ontimeout = idbError(callback);

  txn.oncomplete = function() {
    idbChanges.notify(api.metaData.name);
    callback(null, results);
  };

  preProcessAttachments().then(function() {
    return fetchExistingDocs(txn, docs);
  }).then(function(oldDocs) {
    processDocs(txn, docs, oldDocs);
  });
};
