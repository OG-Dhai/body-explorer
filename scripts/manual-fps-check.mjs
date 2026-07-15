import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files'
    ]
  });
  
  const page = await browser.newPage();
  
  // Clear old logs
  if (fs.existsSync('console_log.txt')) fs.unlinkSync('console_log.txt');
  const logStream = fs.createWriteStream('console_log.txt', { flags: 'a' });
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}\n`;
    logStream.write(text);
  });
  
  console.log('Navigating to http://localhost:5173/?debug=true...');
  await page.goto('http://localhost:5173/?debug=true', { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting for START button...');
  const startBtnSelector = '#btn-start';
  await page.waitForSelector(startBtnSelector, { visible: true });
  await page.click(startBtnSelector);
  console.log('Clicked START.');
  
  console.log('Beginning 20-second test cycle...');
  
  const fpsReadings = [];
  
  for (let i = 0; i <= 20; i += 2) {
    if (i > 0 && i % 5 === 0) {
      await page.screenshot({ path: `screenshot_${i}s.png` });
      console.log(`Saved screenshot_${i}s.png`);
    }
    
    try {
      const fpsText = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('div, span, p'));
        const el = els.find(e => e.textContent && e.textContent.includes('FPS: '));
        return el ? el.textContent : 'FPS counter not found';
      });
      fpsReadings.push(`[${i}s] ${fpsText}`);
      console.log(`[${i}s] ${fpsText}`);
    } catch (e) {
      fpsReadings.push(`[${i}s] Error reading FPS`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  logStream.end();
  await browser.close();
  
  fs.writeFileSync('fps_results.txt', fpsReadings.join('\n'));
  console.log('Test complete.');
})();
