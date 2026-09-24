const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
    const tmpDir = path.join(__dirname, 'chrome_profile_test2');
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
        const page = pages.find(p => p.type === 'page');

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

        let id = 1;
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const curId = id++;
            const handler = (evt) => {
                const msg = JSON.parse(evt.data);
                if (msg.id === curId) {
                    ws.removeEventListener('message', handler);
                    if (msg.error) reject(msg.error);
                    else resolve(msg.result);
                }
            };
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({ id: curId, method, params }));
        });

        await send('Page.enable');
        await send('Runtime.enable');

        await send('Page.navigate', { url: 'http://127.0.0.1:5500/monitor.html' });
        await new Promise(r => setTimeout(r, 1000));

        // Let's test the layout of .chart-scroll-container, wrapper, canvas directly
        const testRes = await send('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
                const wrapper = document.getElementById('inverterChartWrapper');
                const container = document.querySelector('.chart-scroll-container');
                const canvas = document.getElementById('inverterChart');

                // Let's simulate setting width to 750px
                wrapper.style.width = '750px';

                return {
                    containerClientWidth: container.clientWidth,
                    containerScrollWidth: container.scrollWidth,
                    wrapperClientWidth: wrapper.clientWidth,
                    wrapperComputedWidth: getComputedStyle(wrapper).width,
                    canvasClientWidth: canvas.clientWidth,
                    canvasComputedWidth: getComputedStyle(canvas).width,
                    containerOverflowX: getComputedStyle(container).overflowX,
                    containerOverflowY: getComputedStyle(container).overflowY
                };
            })()`
        });

        console.log('Result when wrapper.style.width = 750px:', testRes.result.value);

        ws.close();
    } catch (err) {
        console.error(err);
    } finally {
        chrome.kill();
    }
}
main();
