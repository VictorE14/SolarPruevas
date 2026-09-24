const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
    const tmpDir = path.join(__dirname, 'chrome_edge_profile_fixed');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const edge = spawn(edgePath, [
        '--headless=new',
        '--remote-debugging-port=9444',
        '--window-size=390,844',
        `--user-data-dir=${tmpDir}`,
        '--no-first-run',
        '--no-default-browser-check'
    ]);

    let list = null;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            list = await fetch('http://127.0.0.1:9444/json/list').then(r => r.json());
            if (list) break;
        } catch(e) {}
    }
    if (!list) { console.error('Edge failed to start'); edge.kill(); return; }

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
    await send('Runtime.enable');

    const techUser = {
        id: 'eb2f873c-5601-44f9-bb33-cb95dbe1d098',
        email: 'tuzdzidzv@gmail.com',
        nombre: 'Victor',
        rol: 'tecnico'
    };

    // Go to origin first so sessionStorage is set on origin
    await send('Page.navigate', { url: 'http://127.0.0.1:5500/index.html' });
    await new Promise(r => setTimeout(r, 800));

    // Inject session
    await send('Runtime.evaluate', {
        expression: `
            sessionStorage.setItem('crode_solar_session', JSON.stringify({
                user: ${JSON.stringify(techUser)},
                expiresAt: Date.now() + 86400000
            }));
            window.location.href = 'http://127.0.0.1:5500/monitor.html';
        `
    });

    console.log('Navigated to monitor.html with active session. Waiting for data load...');
    await new Promise(r => setTimeout(r, 4500));

    const evalResult = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
            const wrapper = document.getElementById('inverterChartWrapper');
            const container = document.querySelector('.chart-scroll-container');
            const canvas = document.getElementById('inverterChart');
            const card = document.querySelector('.chart-card');
            
            return {
                url: window.location.href,
                wrapperStyleWidth: wrapper ? wrapper.style.width : null,
                wrapperComputedWidth: wrapper ? getComputedStyle(wrapper).width : null,
                wrapperClientWidth: wrapper ? wrapper.clientWidth : null,
                containerClientWidth: container ? container.clientWidth : null,
                containerScrollWidth: container ? container.scrollWidth : null,
                containerComputedOverflowX: container ? getComputedStyle(container).overflowX : null,
                canvasWidthAttr: canvas ? canvas.width : null,
                canvasStyleWidth: canvas ? canvas.style.width : null,
                canvasClientWidth: canvas ? canvas.clientWidth : null,
                canvasComputedWidth: canvas ? getComputedStyle(canvas).width : null,
                kpiTotalInversores: document.querySelector('.kpi-value')?.textContent
            };
        })()`
    });

    console.log('DOM Evaluation:', JSON.stringify(evalResult.result.value, null, 2));

    const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.join(__dirname, 'mobile_screenshot_loaded.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));
    console.log('Screenshot saved to:', screenshotPath);

    ws.close();
    edge.kill();
}

main();
