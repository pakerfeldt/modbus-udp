'use strict';

exports.parseAsBoolean = function(argument) {
  if (typeof (argument) === 'boolean') {
    return argument;
  } else if (typeof (argument) === 'string') {
    if (argument.toLowerCase() === 'on') {
      return true;
    } else if (argument.toLowerCase() === 'off') {
      return false;
    } else {
      return JSON.parse(argument.toLowerCase());
    }
  } else if (typeof (argument) === 'number') {
    return argument !== 0;
  } else {
    return false;
  }
};

exports.readInt = function(bufferReader, length) {
  if (length == 1) {
    return bufferReader.readInt8(0);
  } else if (length == 2) {
    return bufferReader.readInt16(0);
  } else if (length == 4) {
    return bufferReader.readInt32(0);
  } else {
    console.log('Could not parse value in buffer reader as int.');
    return undefined;
  }
}

exports.convert = function(method, value) {
  if (method == 'tenths') {
    return tenths(value);
  }
}

var tenths = function(value) {
  return value / 10;
}
