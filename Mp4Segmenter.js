// jshint esversion: 6, globalstrict: true, strict: true, bitwise: true
'use strict';

const { Transform } = require('stream');

class Mp4Segmenter extends Transform {
    constructor(options, callback) {
        super(options, callback);
        if (typeof callback === 'function') {
            this._callback = callback;
        }
        this._parseChunk = this._findFtyp;
    }

    get initSegment() {
        if (this._initSegment) {
            return this._initSegment;
        } else {
            return null;
            //throw new Error('init segment not created yet');
        }
    }

    set initSegment(value) {
        this._initSegment = value;
        console.log('init segment ready');
    }

    _findFtyp(chunk) {//todo done
        //console.log('findFtyp');
        if (chunk[4] !== 0x66 || chunk[5] !== 0x74 || chunk[6] !== 0x79 || chunk[7] !== 0x70) {
            throw new Error('cannot find ftyp');
        }
        const chunkLength = chunk.length;
        this._ftypLength = chunk.readUIntBE(0, 4);
        if (this._ftypLength < chunk.length) {
            this._ftyp = chunk.slice(0, this._ftypLength);
            this._parseChunk = this._findMoov;
            this._parseChunk(chunk.slice(this._ftypLength));
        } else if (this._ftypLength === chunk.length) {
            this._ftyp = chunk;
            this._parseChunk = this._findMoov;
        } else {
            //should not be possible to get here because ftyp is very small
            throw new Error('ftypLength greater than chunkLength');
        }
    }

    _findMoov(chunk) {//todo done
        //console.log('findMoov');
        if (chunk[4] !== 0x6D || chunk[5] !== 0x6F || chunk[6] !== 0x6F || chunk[7] !== 0x76) {
            throw new Error('cannot find moov');
        }
        const chunkLength = chunk.length;
        const moovLength = chunk.readUIntBE(0, 4);
        if (moovLength < chunkLength) {
            //console.log('moovLength < chunk.length');
            this.initSegment = Buffer.concat([this._ftyp, chunk], (this._ftypLength + moovLength));
            delete this._ftyp;
            delete this._ftypLength;
            this._parseChunk = this._findMoof;
            this._parseChunk(chunk.slice(moovLength));
        } else if (moovLength === chunkLength) {
            //console.log('moovLength === chunk.length');
            this.initSegment = Buffer.concat([this._ftyp, chunk], (this._ftypLength + moovLength));
            delete this._ftyp;
            delete this._ftypLength;
            this._parseChunk = this._findMoof;
        } else {
            //should not be possible to get here
            //if we do, will have to store chunk until size is big enough to have entire moov piece
            throw new Error('moovLength greater than chunkLength');
        }
    }
    
    _findMoof(chunk) {
        //console.log('findMoof');
        if (chunk[4] !== 0x6D || chunk[5] !== 0x6F || chunk[6] !== 0x6F || chunk[7] !== 0x66) {
            console.log(chunk.slice(0, 20).toString());
            throw new Error('cannot find moof');
        }
        const chunkLength = chunk.length;
        this._moofLength = chunk.readUIntBE(0, 4);
        if (this._moofLength < chunkLength) {
            //console.log('moofLength < chunkLength');
            this._moof = chunk.slice(0, this._moofLength);
            this._parseChunk = this._findMdat;
            this._parseChunk(chunk.slice(this._moofLength));
        } else if (this._moofLength === chunkLength) {
            //has not happened yet
            this._moof = chunk;
            this._parseChunk = this._findMdat;
        } else {
            //has not happened yet
            throw new Error('mooflength > chunklength');
        }
    }
    
    _findMdat(chunk) {
        //console.log('find mdat');
        if (this._mdatBuffer) {
            this._mdatBuffer.push(chunk);
            this._mdatBufferSize += chunk.length;
            if (this._mdatLength === this._mdatBufferSize) {
                //console.log('mdatLength === mdatBufferSize');
                const data = Buffer.concat([this._moof, ...this._mdatBuffer], (this._moofLength + this._mdatLength));
                delete this._moof;
                delete this._mdatBuffer;
                delete this._moofLength;
                delete this._mdatLength;
                delete this._mdatBufferSize;
                if (this._readableState.pipesCount > 0) {
                    this.push(data);
                }
                if (this._callback) {
                    this._callback(data);
                }
                if (this.listenerCount('segment') > 0) {
                    this.emit('segment', data);
                }
                this._parseChunk = this._findMoof;
            } else if (this._mdatLength < this._mdatBufferSize) {
                //console.log('mdatLength', this._mdatLength, '<', 'mdatBufferSize', this._mdatBufferSize);
                const data = Buffer.concat([this._moof, ...this._mdatBuffer], (this._moofLength + this._mdatLength));
                const sliceIndex = this._mdatBufferSize - this._mdatLength;
                delete this._moof;
                delete this._mdatBuffer;
                delete this._moofLength;
                delete this._mdatLength;
                delete this._mdatBufferSize;
                if (this._readableState.pipesCount > 0) {
                    this.push(data);
                }
                if (this._callback) {
                    this._callback(data);
                }
                if (this.listenerCount('segment') > 0) {
                    this.emit('segment', data);
                }
                this._parseChunk = this._findMoof;
                this._parseChunk(chunk.slice(sliceIndex));
            }
        } else {
            //console.log('mdat first pass');
            //first pass to ensure start of mdat and get its size, most likely chunk will not contain entire mdat
            if (chunk[4] !== 0x6D || chunk[5] !== 0x64 || chunk[6] !== 0x61 || chunk[7] !== 0x74) {
                console.log(chunk.slice(0, 20).toString());
                throw new Error('cannot find mdat');
            }
            const chunkLength = chunk.length;
            this._mdatLength = chunk.readUIntBE(0, 4);
            if (this._mdatLength > chunkLength) {
                //todo almost 100% guaranteed to exceed size of single chunk
                this._mdatBuffer = [chunk];
                this._mdatBufferSize = chunkLength;
            } else {
                console.log(this._mdatLength, chunkLength);
                throw new Error('mdatLength not greater than chunkLength');
            }
        }
    }

    _transform(chunk, encoding, callback) {
        this._parseChunk(chunk);
        callback();
    }

    _flush(callback) {
        this._parseChunk = this._findFtyp;
        callback();
    }
}

module.exports = Mp4Segmenter;

//ffmpeg mp4 fragmenting : -movflags +frag_keyframe+empty_moov+default_base_moof
//outputs file structure : ftyp+moov -> moof+mdat -> moof+mdat -> moof+mdat ...