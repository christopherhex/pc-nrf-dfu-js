
import DfuTransportPrn from './DfuTransportPrn';

// FIXME: Should be `import {crc32} from 'crc'`, https://github.com/alexgorbatchev/node-crc/pull/50
// import * as crc from 'crc';
// const crc32 = crc.crc32;
// import {crc32} from 'crc';
// import crc32 from 'crc/src/crc32';


import * as slip from 'slip';

/**
 * Serial DFU transport.
 * This needs to be given a `serialport` instance when instantiating.
 * Will encode actual requests with SLIP
 */

export default class DfuTransportSerial extends DfuTransportPrn {
    constructor(serialPort, packetReceiveNotification = 16) {
        super(packetReceiveNotification);

        this._port = serialPort;
    }


    // Given a command (including opcode), perform SLIP encoding and send it
    // through the wire.
    _writeCommand(bytes) {
        let encoded = slip.encode(bytes);

        // Strip the heading 0xC0 character, as to avoid a bug in the nRF SDK implementation
        // of the SLIP encoding/decoding protocol
        encoded = encoded.subarray(1);

        // Cast the Uint8Array info a Buffer so it works on nodejs v6
        encoded = new Buffer(encoded);

        return new Promise((res, rej)=>{
            console.log(' send --> ', encoded);
            this._port.write(encoded, res);
        });
    }

    // Given some payload bytes, pack them into a 0x08 command.
    // The length of the bytes is guaranteed to be under this._mtu thanks
    // to the DfuTransportPrn functionality.
    _writeData(bytes) {
        const commandBytes = new Uint8Array(bytes.length + 1);
        commandBytes.set([0x08], 0); // "Write" opcode
        commandBytes.set(bytes, 1);
        return this._writeCommand(commandBytes);
    }

    // Opens the port, sets the PRN, requests the MTU.
    // Returns a Promise when initialization is done.
    _ready() {
        if (this._readyPromise) {
            return this._readyPromise;
        }

        return this._readyPromise = new Promise((res)=>{
            this._port.open(()=>{

                // Start listening for data, and pipe it all through a SLIP decoder.
                // This code will listen to events from the SLIP decoder instead
                // of from the serial port itself.
                this._slipDecoder = new slip.Decoder({
                    onMessage: this._onData.bind(this)
                });
//                 this._port.on('data', (data)=>this._slipDecoder.decode(data));

                this._port.on('data', (data)=>{
console.log(' recv <-- ', data);
//                     return this._slipDecoder.decode.bind(this._slipDecoder)(data);
                    return this._slipDecoder.decode(data);
                });

//                 this._port.on('data', this._slipDecoder.decode.bind(this._slipDecoder));


                // Ping
//                 let result = this._write(new Uint8Array([
//                     0x09,   // "Ping" opcode
//                     0xAB    // Ping ID
//                 ]))
//                 .then(this._read.bind(this))
//                 .then(this._assertPacket(0x09, 1))
//                 .then((bytes)=>{
//                     if (bytes[0] !== 0xAB) {
//                         throw new Error('Expected a ping ID of 0xAB, got ' + bytes + ' instead');
//                     }
//                 })

                // Set PRN
                let result = this._writeCommand(new Uint8Array([
                    0x02,  // "Set PRN" opcode
                    this._prn >> 0 & 0xFF, // PRN LSB
                    this._prn >> 8 & 0xFF, // PRN MSB
                ]))
                .then(this._read.bind(this))
                .then(this._assertPacket(0x02, 0))
                // Request MTU
                .then(()=>this._writeCommand(new Uint8Array([
                    0x07    // "Request serial MTU" opcode
                ])))
                .then(this._read.bind(this))
                .then(this._assertPacket(0x07, 2))
                .then((bytes)=>{
//                     console.log('Got MTU: ', bytes);

                    let mtu =
                        bytes[1] * 256 +
                        bytes[0];

                    // Convert wire MTU into max size of SLIP-decoded data:
                    this._mtu = Math.floor((mtu / 2) - 2);
console.log(`Wire MTU: ${mtu}; un-encoded data max size: ${this._mtu}`);
                });

                return res(result);
            });
        });
    }
}




