'use strict';

export default function(api, openDatabases, idbChanges, callback) {

  idbChanges.removeAllListeners(api.metaData.name);

  function doDestroy() {
    var req = indexedDB.deleteDatabase(api.metaData.name);
    req.onsuccess = function() {
      delete openDatabases[api.metaData.name];
      callback(null, {ok: true});
    };
  }

  // If the database is open we need to close it
  if (api.metaData.name in openDatabases) {
    openDatabases[api.metaData.name].then(function(res) {
      res.idb.close();
      doDestroy();
    });
  } else {
    doDestroy();
  }

}
