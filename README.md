# modbus-udp
A simple modbus (RTU) UDP proxy.

## Installation
Requires Node.js.
`npm install`
`npm run`

## Introduction
This was specifically designed to integrate modbus systems with the 
[eibPort](http://bab-tec.de/index.php/eibport_v3_en.html) but can be used for
other purposes as well. The proxy sends periodic updates over certain modbus
registers over UDP. It also listens for commands over UDP which is one of
`read` (to manually request a register update) or `write` (to write data).

It is possible to connect to multiple modbus networks if you have more than
one modbus adapters registered.

The important path is in the config.json, here's an example of that file with
inline comments. Note that this is not a valid configuration because of its
comments (proper json can't have comments).
```
{
  "localport": 51100,                       // Port used to listen for commands
  "host": "192.168.1.250",                  // Host of remote client
  "port": 51100,                            // Port of remote client
  "defaultPoll": "00 * * * * *",            // Cron pattern for default poll interval
  "modbusNetworks": [                       // Array of modbus networks, one per serial adapter
    {
      "name": "ftx",                        // Identifies the modbus network
      "serialport": "/dev/rs485",
      "options": {
        "baudrate": 9600,
        "parity": "none"
      },
      "registers": [{                       // Array of register objects
        "id": "temp_setpoint",              // Identifies the register, use only [a-zA-Z0-9_] characters
        "slaveid": 1,                       // The modbus slave owning the register
        "type": "holding",                  // Type of register (holding, input, coil, discrete)
        "address": 0,                       // Register address
        "converter": "tenths",              // [Optional] Converter method to use on the input data, see separate section in Readme.
        "length": 1,                        // [Optional] Defaults to 1 but some modbus slaves use two or more registers per value
      }
    ]
    },
    {
      "name": "alpha",
      "serialport": "/dev/ttyUSB3",
      "options": {
        "baudrate": 9600,
        "parity": "even"
      },
      "registers": [{
        "id": ["dhw_time", "dhw_setpoint"], // In case you want to read multiple adjacents registers, identify them in an array
        "slaveid": 3,
        "type": "input",
        "address": 206                      // This is now the starting address (of dhw_time in this case), dhw_Setpoint will be 207, etc.
      }, {
        "id": ["import_wh", "export_wh"],
        "slaveid": 4,
        "type": "input",
        "address": 72,
        "length": 2,
        "converter": "float32"              // Again, see separate section in Readme for converter methods.
      }
    ]
    }
  ]
}
```

## Listening for commands
The proxy listens for incoming UDP messages on the specified port. The format is `[register id] [command] [parameter]`. E.g. `temp_setpoint write 20`. Valid commands are `write` for writing values and `read` for manually requesting a register value. Read has no parameters, `temp_setpoint read`.

## Sending UDP messages
The proxy sends register values to the specified host and port using UDP. The format is `[register id] [value]`, e.g. `temp_setpoint 21`. Proxy polls modbus registers using the [crontab](https://github.com/ncb000gt/node-cron) pattern specified in `defaultPoll`. It can also poll a single specific register manually when receiving the `read` command over UDP.

## Reading registers
### Length
The `length` key is optional and defaults to 1. I.e. a value is stored in one (2 byte) register. Sometimes slaves stores values using two or more registers. E.g. a 4 byte value can be stored in two registers. Use `length` to specify how many registers are used per value.
### Converter methods
Often it is required for register values to be converted before sending them off to the receiver. Currently there are two converter methods. `tenths` for dividing the input with 10. E.g. if a register would represent a temperature value like 10.5 (°C) as 105. `float32` is used to convert two registers into a floating point value. This needs to be used in conjunction with `length: 2` since it requires 4 bytes for certain modbus slaves. 

Do you need a certain converter method for you slave? Create an [issue](https://github.com/pakerfeldt/modbus-udp/issues).

## eibPort
This proxy was written specifically for [eibPort](http://bab-tec.de/index.php/eibport_v3_en.html) although it can be used for other purposes as well. eibPort is a device that connects to your smart home and offers visualization and logical functions. It does not communicate directly with modbus, however it has support for receiving and transmitting UDP messages. modbus-udp integrates modbus networks with the eibPort.
