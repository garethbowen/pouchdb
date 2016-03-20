'use strict';

import { createError, IDB_ERROR } from '../../deps/errors';

var DOC_STORE = 'docs';
var ATTACH_STORE = 'attach';
var META_STORE = 'meta';

function idbError(callback) {
  return function (evt) {
    var message = 'unknown_error';
    if (evt.target && evt.target.error) {
      message = evt.target.error.name || evt.target.error.message;
    }
    callback(createError(IDB_ERROR, message, evt.type));
  };
};

export {
  DOC_STORE,
  ATTACH_STORE,
  META_STORE,
  idbError
};
