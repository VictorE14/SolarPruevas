const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function test() {
    const tmpDir = path.join(__dirname, 'chrome_prof_real');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new',
        '--remote-debugging-port=9222',
        '--window-size=390,844',
        '--user-data-dir=' + tmpDir
    ]);

    await new Promise(r => setTimeout(r, 2000));
    try {
        const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
        const page = list.find(p => p.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);

        let id = 1;
        const send = (method, params = {}) => new Promise((resolve) => {
            const curId = id++;
            const h = (e) => {
                const m = JSON.parse(e.data);
                if (m.id === curId) { ws.removeEventListener('message', h); resolve(m.result); }
            };
            ws.addEventListener('message', h);
            ws.send(JSON.stringify({ id: curId, method, params }));
        });

        await send('Page.enable');
        await send('Page.navigate', { url: 'http://127.0.0.1:5500/monitor.html' });
        await new Promise(r => setTimeout(r, 500));

        await send('Runtime.evaluate', {
            expression: JSON.stringify(`
                sessionStorage.setItem('crode_solar_session', JSON.stringify({
                    user: {
                        id: 'eb2f873c-5601-44f9-bb33-cb95dbe1d098',
                        rol: 'tecnico',
                        nombre: 'Victor'
                    },
                    expiresAt: Date.now() + 86400000
                }));
            `)
        });

        // Actually execute that in page context
        await send('Runtime.evaluate', {
            expression: `
                sessionStorage.setItem('crode_solar_session', JSON.stringify({
                    user: {
                        id: 'eb2f873c-5601-44f9-bb33-cb95dbe1d098',
                        rol: 'tecnico',
                        nombre: 'Victor'
                    },
                    expiresAt: Date.now() + 86400000
                }));
                location.href = 'http://127.0.0.1:5500/monitor.html';
            `
        });

        await new Promise(r => setTimeout(r, 4000));

        const res = await send('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
                const w = document.getElementById('inverterChartWrapper');
                const c = document.querySelector('.chart-scroll-container');
                const canvas = document.getElementById('inverterChart');
                return {
                    url: location.href,
                    wOffsetWidth: w ? w.offsetWidth : null,
                    wStyleWidth: w ? w.style.width : null,
                    cScrollWidth: c ? c.scrollWidth : null,
                    cClientWidth: c ? c.clientWidth : null,
                    canvasWidth: canvas ? canvas.width : null,
                    canvasClientWidth: canvas ? canvas.clientWidth : null,
                    canvasStyleWidth: canvas ? canvas.style.width : null,
                    invertersLen: typeof inverters !== 'undefined' ? inverters.length : null,
                    hasChartInstance: typeof inverterChartInstance !== 'undefined' && Boolean(inverterChartInstance)
                };
            })()`
        });

        console.log('REAL RUN RESULT:', res.result.value);

        // Capture screenshot
        const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'real_run_screenshot.png'), Buffer.from(screenshotRes.data, 'base64'));
        console.log('Screenshot saved to real_run_screenshot.png');

        ws.close();
    } finally {
        chrome.kill();
    }
}
test();
