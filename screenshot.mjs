import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  
  console.log('Injecting lowlight warning...');
  await page.evaluate(() => {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.dataset.i18n = 'ui.lowlight_warning';
      statusEl.textContent = 'Low light detected. Targets are now easier to reach.'; // Hardcode expected EN string if i18n not accessible globally
      statusEl.style.display = 'block';
      statusEl.style.opacity = '1';
      statusEl.style.visibility = 'visible';
      statusEl.style.background = 'rgba(0,0,0,0.8)';
      statusEl.style.color = 'white';
      statusEl.style.padding = '20px';
      statusEl.style.position = 'absolute';
      statusEl.style.top = '20px';
      statusEl.style.left = '20px';
      statusEl.style.fontSize = '24px';
      statusEl.style.zIndex = '9999';
    }
  });

  // Wait a moment for rendering
  await new Promise(resolve => setTimeout(resolve, 500));

  const screenshotPath = 'screenshot.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to ${screenshotPath}`);
  
  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
