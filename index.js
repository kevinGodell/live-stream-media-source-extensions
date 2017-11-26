// jshint esversion: 6, globalstrict: true, strict: true, bitwise: true
'use strict';

//const allowedOrigins = "http://localhost:* http://127.0.0.1:*";//not sure if will need this

const app = require('express')();

const http = require('http').Server(app);

const io = require('socket.io')(http/*, {origins: allowedOrigins}*/);

const { spawn } = require('child_process');

const Mp4Segmenter = new require('./Mp4Segmenter');

const mp4segmenter = new Mp4Segmenter();

const ffmpeg = spawn('ffmpeg', ['-loglevel', 'debug', '-reorder_queue_size', '5', '-rtsp_transport', 'tcp', '-i', 'rtsp://192.168.1.22:554/user=admin_password=pass_channel=1_stream=0.sdp', '-an', '-c:v', 'copy', '-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-metadata', 'title="media source extensions"', 'pipe:1'], {stdio : ['ignore', 'pipe', 'inherit'/* change stdio[2] inherit to ignore to hide ffmpeg debug to stderr */]});

ffmpeg.on('error', (error) => {
    console.log('error', error);
});

ffmpeg.on('exit', (code, signal) => {
    console.log('exit', code, signal);
});

ffmpeg.stdio[1].pipe(mp4segmenter);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/flv.min.js', (req, res) => {
    res.sendFile(__dirname + '/node_modules/flv.js/dist/flv.min.js');
});

app.get('/test.mp4', (req, res) => {
    if (!mp4segmenter.initSegment) {
        res.status(503);
        res.end('service not available');
        return;
    }
    
    res.status(200);
    res.write(mp4segmenter.initSegment);
    ffmpeg.stdio[1].pipe(res);
    res.on('close', () => {
        ffmpeg.stdio[1].unpipe(res);
    });
});

app.get('/test2.mp4', (req, res) => {
    if (!mp4segmenter.initSegment) {
        res.status(503);
        res.end('service not available');
        return;
    }
    function writeSegment(data) {
        res.write(data);
    }
    res.status(200);
    res.write(mp4segmenter.initSegment);
    mp4segmenter.on('segment', writeSegment);
    res.on('close', () => {
        mp4segmenter.removeListener('segment', writeSegment);
    });
});

io.on('connection', (socket) => {
    console.log('A user connected');
    
    function start() {
        if (mp4segmenter.initSegment) {
            socket.emit('segment', mp4segmenter.initSegment);
            mp4segmenter.on('segment', emitSegment);
        } else {
            socket.emit('message', 'init segment not ready yet, reload page');
        }
    }
    
    function pause() {
        console.log('pause');
    }
    
    function resume() {
        console.log('resume');
    }
    
    function stop() {
        mp4segmenter.removeListener('segment', emitSegment);
    }
    
    function emitSegment(data) {
        socket.emit('segment', data);
    }
    
    socket.on('message', (msg) => {
        switch (msg) {
            case 'start' :
                start();
                break;
            case 'pause' :
                pause();
                break;
            case 'resume' :
                resume();
                break;
            case 'stop' :
                stop();
                break;
        }
    });

    socket.on('disconnect', () => {
        stop();
        console.log('A user disconnected');
    });
});

http.listen(3000, () => {
    console.log('listening on localhost:3000');
});