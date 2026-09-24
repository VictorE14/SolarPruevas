const { exec, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
    const chrome = spawn(chromePath, [
        '--headless=new',
        '--remote-debugging-port=9222',
        '--window-size=390,844',
        '--user-data-dir=' + path.join(__dirname, 'chrome_tmp')
    ]);

    await new Promise(r => setTimeout(r, 1500));

    // Connect to CDP
    const versionRes = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
    console.log('Pages:', versionRes);

    const wsUrl = versionRes[0]?.webSocketDebuggerUrl;
    if (!wsUrl) {
        console.error('No wsUrl');
        chrome.kill();
        return;
    }

    const WebSocket = require('ws');
    // If ws not installed, we can use simpler method
}
