const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function test() {
    const tmpDir = path.join(__dirname, 'chrome_debug_profile');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new',
        '--remote-debugging-port=9222',
        '--window-size=390,844',
        `--user-data-dir=${tmpDir}`,
        '--no-first-run',
        '--no-default-browser-check'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const listRes = await fetch('http://127.0.0.1:9222/json/list');
        const pages = await listRes.json();
        console.log('Target pages:', pages);
    } catch (err) {
        console.error('Fetch error:', err);
    } finally {
        chrome.kill();
    }
}
test();
