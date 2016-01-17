'use strict';

var winston = require('winston');
var SerialPort = require('serialport').SerialPort;
var modbus = require('h5.modbus');
var BufferReader = require('h5.buffers').BufferReader;
var dgram = require('dgram');
var server = dgram.createSocket('udp4');
var util = require('./util');
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

var reMsg = /(\w+)\s(read|write)\s?([\w\.]+)?/;
var host = config.host;
var port = config.port;
var defaultPollIntervalMs = config.defaultPollIntervalMs;
var modbusMasters = {};
var registersWithDefaultPollInterval = [];

var loglevel = 'info';
var args = process.argv.slice(2);
if (args.indexOf('-v') != -1) {
  loglevel = 'verbose';
} else if (args.indexOf('-vv') != -1) {
  loglevel = 'debug';
}

var logger = module.exports = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      colorize: 'all',
      level: loglevel
    })
  ]
});

function setUpNetwork(master) {
  var name = config.modbusNetworks[i].name;
  modbusMasters[name] = config.modbusNetworks[i];
  modbusMasters[name].connected = false;

  var serialPort = new SerialPort(config.modbusNetworks[i].serialport,
    config.modbusNetworks[i].options);

  modbusMasters[name].instance = modbus.createMaster({
    transport: {
      type: 'rtu',

      // End Of Frame Timeout - after any data is received, the RTU transport
      // waits eofTimeout milliseconds, and if no more data is received, then
      // an end of frame is assumed. If more data arrives before the eofTimeout
      // ms, then the end of frame timer is restarted. Workaround for
      // 'at least 3 1⁄2 character times of silence between frames'
      // in MODBUS RTU (see http://en.wikipedia.org/wiki/Modbus#Frame_format).
      eofTimeout: 500,
      connection: {
        type: 'serial',
        serialPort: serialPort
      }
    },
    suppressTransactionErrors: false,
    retryOnException: true,
    maxConcurrentRequests: 1,
    defaultUnit: 0,
    defaultMaxRetries: 1,
    defaultTimeout: 1000
  });

  modbusMasters[name].instance.on('error', function(err) {
    logger.log('error', 'Master error', err);
  }.bind(this));

  modbusMasters[name].instance.on('connected', function() {
    logger.log('info', modbusMasters[name].name + ' connected');
    modbusMasters[name].connected = true;
  });

  modbusMasters[name].instance.on('disconnected', function() {
    logger.log('info', modbusMasters[name].name + ' disconnected');
    modbusMasters[name].connected = false;
  });
}

function setUpRegisters(master) {
  for (var i in master.registers) {
    var register = master.registers[i];
    if (register.polling === undefined) {
      registersWithDefaultPollInterval.push({
        master: master.name,
        register: register
      });
    }
  }
}

for (var i in config.modbusNetworks) {
  setUpNetwork(config.modbusNetworks[i]);
  setUpRegisters(config.modbusNetworks[i]);
}

var CronJob = require('cron').CronJob;
var job = new CronJob(config.defaultPoll, function() {
  for (var i in registersWithDefaultPollInterval) {
    pollRegisters(registersWithDefaultPollInterval[i]);
  }
}, function() {
  /* This function is executed when the job stops */
}, true /* Start the job right now */);

function sendValue(id, value) {
  var msg = id + ' ' + value;
  server.send(msg, 0, msg.length, port, host, function() {
    logger.log('verbose', 'Sent ' + msg);
  });
}

function pollRegisters(conf) {
  var master = modbusMasters[conf.master];
  var register = conf.register;
  if (!master.connected) return;

  var transaction;
  var options = {
    unit: register.slaveid,
    maxRetries: 1,
    timeout: 600
  };

  var registers = [].concat(register.id);

  var onComplete = function(err, response) {
    if (err !== null) {
      logger.log('warn', 'Error reading register: ', err);
    }

    logger.log('debug', 'Raw response: ' + response);
    if (register.type == 'coil' || register.type == 'discrete') {
      for (i in registers) {
        sendValue(registers[i], response.isOn(i));
      }
    } else if (register.converter == 'float32') {
      var buffer = new BufferReader(response.values);
      var length = buffer.length / registers.length;
      for (var i in registers) {
        var value = buffer.readFloat(0, false);
        sendValue(registers[i], value);
        buffer.skip(length);
      }
    } else {
      var buffer = new BufferReader(response.values);
      var length = buffer.length / registers.length;
      for (var i in registers) {
        var value = util.readInt(buffer, length);
        if (register.converter !== undefined) {
          value = util.convert(register.converter, value);
        }

        sendValue(registers[i], value);
        buffer.skip(length);
      }
    }
  };

  options.onComplete = onComplete;

  var readLength = (register.length !== undefined ? register.length : 1) * registers.length;
  if (register.type == 'input') {
    transaction = master.instance.readInputRegisters(
      register.address, readLength, options);
  } else if (register.type == 'holding') {
    transaction = master.instance.readHoldingRegisters(
      register.address, readLength, options);
  } else if (register.type == 'coil') {
    transaction = master.instance.readCoils(
      register.address, readLength, options);
  } else if (register.type == 'discrete') {
    transaction = master.instance.readDiscreteInputs(
      register.address, readLength, options);
  } else {
    logger.log('error', 'No valid type for register', register);
    return;
  }
}

function findSingleRegisterConf(id) {
  for (var i in registersWithDefaultPollInterval) {
    var index = registersWithDefaultPollInterval[i].register.id.indexOf(id);
    if (index > -1) {
      var register = registersWithDefaultPollInterval[i].register;
      var readLength = (register.length !== undefined) ? register.length : 1;
      var conf = {};
      conf.master = registersWithDefaultPollInterval[i].master;
      conf.register = {};
      conf.register.id = id;
      conf.register.slaveid = register.slaveid
      conf.register.converter = register.converter;
      conf.register.address = register.address + (readLength * index);
      conf.register.type = register.type;
      return conf;
    }
  }
}

function read(id) {
  var conf = findSingleRegisterConf(id);
  if (conf !== undefined) {
    pollRegisters(conf);
  } else {
    logger.log('error', 'Unknown id ' + id);
  }
}

function writeSingleRegister(conf, value) {
  var master = modbusMasters[conf.master];
  var options = {
    unit: conf.register.slaveid,
    maxRetries: 1,
    timeout: 600
  };

  var onComplete = function(err, response) {
    if (err !== null) {
      logger.log('error', 'Error writing value to ' + conf.register.id + ' - ' + err);
      pollRegisters(conf);
      return;
    } else {
      logger.log('verbose', 'Wrote ' + response.value + ' to ' + conf.register.id);
      sendValue(conf.register.id, response.value);
    }
  };

  options.onComplete = onComplete;
  master.instance.writeSingleRegister(conf.register.address, value, options);
}

function write(id, value) {
  var conf = findSingleRegisterConf(id);
  if (conf !== undefined) {
    writeSingleRegister(conf, value);
  } else {
    logger.log('error', 'Unknown id ' + id);
  }
}

server.on('message', function(msg, rinfo) {
  var match = msg.toString().match(reMsg);
  if (match === null) {
    logger.log('error', 'Unknown message - ' + msg);
    return;
  };

  if (match[2] == 'read') read(match[1]);
  if (match[2] == 'write') write(match[1], match[3]);
});

server.bind(config.localport);
