'use strict';

import getArguments from 'argsarray';

import ChangesHandler from '../../changesHandler';

import setup from './setup';

// API implementations
import info from './info';
import get from './get';
import getAttachment from './getAttachment';
import bulkDocs from './bulkDocs';
import allDocs from './allDocs';
import changes from './changes';
import getRevisionTree from './getRevisionTree';
import destroy from './destroy';

var idbChanges = new ChangesHandler();

// A shared list of open database handles
var openDatabases = {};

function IdbPouch (opts, callback) {

  var api = this;

  // metaData is persisted data between instances, read from
  // the database at startup, set the name in case we delete
  // the database before calling setup
  api.metaData = {
    name: opts.name
  };

  // This is a wrapper function for any methods that need an
  // active database handle it will recall itself but with
  // the database handle as the first argument
  var $ = function(fun) {
    return getArguments(function (args) {
      setup(openDatabases, api, opts).then(function (res) {

        api.metaData = res.metaData;
        api.metaData.name = opts.name;
        api.metaData.revsLimit = opts.revs_limit;
        api.metaData.seq = ('seq' in api.metaData) ? api.metaData.seq : 0;

        args.unshift(res.idb);
        fun.apply(api, args);
      });
    });
  };

  api.type = function () { return 'idb-next'; };
  api._id = $(function(idb, cb) { cb(null, '123'); });

  api._info = $(function(idb, cb) {
    return info(idb, api, cb);
  });

  api._get = $(get);

  api._bulkDocs = $(function(idb, req, opts, callback) {
    return bulkDocs(idb, req, opts, api, idbChanges, callback);
  });

  api._allDocs = $(function (idb, opts, cb) {
    return allDocs(idb, api, opts, cb);
  });

  // This overwrides adapter.js's getAttachment
  api.getAttachment = $(function (idb, docId, attachId, opts, cb) {
    return getAttachment(idb, docId, attachId, opts, cb);
  });

  api._changes = $(function (idb, opts) {
    return changes(idb, idbChanges, api, opts);
  });

  api._getRevisionTree = $(getRevisionTree);

  api._doCompaction = $(function (db, id, revs, callback) {
  });

  api._destroy = function (opts, callback) {
    return destroy(api, openDatabases, idbChanges, callback);
  };

  api._close = $(function (db, cb) {
    delete openDatabases[api.metaData.name];
    db.close();
    cb();
  });

  // TODO: this setTimeout seems nasty, if its needed lets
  // figure out / explain why
  setTimeout(function() {
    callback(null, api);
  });
}

// TODO: this isnt really valid permanently, just being lazy to start
IdbPouch.valid = function () {
  return true;
};

export default IdbPouch;
