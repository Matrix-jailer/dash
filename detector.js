const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

const BUTTON_KEYWORDS = ['pay', 'checkout', 'subscribe', 'buy', 'purchase', 'order', 'billing'];
const STRIPE_KEYWORDS = [/^js\.stripe\.com$/, /^api\.stripe\.com$/, /^checkout\.stripe\.com$/, /^stripe\.network$/, /data-stripe/, /stripe-payment-element/, /stripe_card/, /payment_intent/, /client_secret/, /Stripe\(\s*['"]pk_(live|test)_[0-9a-zA-Z]+/];
const PAYPAL_KEYWORDS = [/^(paypal\.com|sdk\.paypal\.com|api(-m)?\.paypal\.com|paypalobjects\.com)$/, /data-paypal/, /paypal-button/, /paypal-checkout/, /client-id/, /paypal\.Buttons/];
const CF_KEYWORDS = [/^(cloudflare\.com|cdn\.cloudflare\.com|challenges\.cloudflare\.com)$/, /turnstile/, /cf-turnstile/, /cloudflare-web/];
const CAPTCHA_KEYWORDS = [/^(recaptcha\/api|google\.com\/recaptcha|hcaptcha\.com)$/, /grecaptcha/, /recaptcha/, /hcaptcha/, /data-sitekey/];
const THREE_DS_KEYWORDS = [/^(3ds|acs_url|verifiedbyvisa|mastercard\.securecode|acs\.stripe\.com)$/, /threeDS/, /3DSecure/];
const IGNORE_URLS = [/\.(css|js|png|jpg|jpeg|gif|woff2?|ttf|svg|ico)$/, /usercentrics\.eu/, /onetrust\.com/, /google-analytics\.com/, /facebook\.com/, /adservice\.google\.com/, /about/, /faq/, /login/, /contact/, /blog/];

async function emulateHuman(page) {
  try {
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 100 + 50);
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: Math.random() * window.innerWidth,
        clientY: Math.random() * window.innerHeight
      }));
    });
    await page.waitForTimeout(Math.random() * 2000 + 1000);
  } catch (e) {
    console.error(`[DEBUG] Error in emulateHuman: ${e}`);
  }
}

async function detect(url, jobId) {
  const results = {
    gateways: new Set(),
    cf: false,
    captcha: false,
    three_ds: false,
    urls: new Set(),
    error: null
  };

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'Chrome PDF Plugin' }] });
    });

    try {
      execSync(`mitmdump -s mitm_script.py --set url=${url} --set job_id=${jobId} &`, {
        stdio: 'ignore'
      });
    } catch (e) {
      console.error(`[DEBUG] Error starting mitmproxy: ${e}`);
      results.error = `mitmproxy failed: ${e.message}`;
    }

    await emulateHuman(page);

    try {
      await page.goto(url, { timeout: 30000 });
    } catch (e) {
      results.error = `Navigation failed: ${e.message}`;
      await browser.close();
      return results;
    }

    const content = await page.content();
    if (STRIPE_KEYWORDS.some(kw => (typeof kw === 'string' ? content.includes(kw) : kw.test(content))))
      results.gateways.add('Stripe');
    if (PAYPAL_KEYWORDS.some(kw => (typeof kw === 'string' ? content.includes(kw) : kw.test(content))))
      results.gateways.add('PayPal');
    if (CF_KEYWORDS.some(kw => (typeof kw === 'string' ? content.includes(kw) : kw.test(content))))
      results.cf = true;
    if (CAPTCHA_KEYWORDS.some(kw => (typeof kw === 'string' ? content.includes(kw) : kw.test(content))))
      results.captcha = true;
    if (THREE_DS_KEYWORDS.some(kw => (typeof kw === 'string' ? content.includes(kw) : kw.test(content))))
      results.three_ds = true;

    const buttons = await page.$$('button, a, input[type="submit"], input[type="button"]');
    for (const button of buttons) {
      try {
        const text = (await button.evaluate(el => el.innerText) || '').toLowerCase().trim();
        const attrs = await button.evaluate(el =>
          Object.fromEntries(Object.entries(el.attributes).map(([k, v]) => [k, v.value]))
        );
        const attrString = Object.values(attrs).join(' ').toLowerCase();

        if (BUTTON_KEYWORDS.some(kw => text.includes(kw) || attrString.includes(kw))) {
          await button.click();
          await emulateHuman(page);
        }
      } catch (e) {
        console.error(`[DEBUG] Error clicking button: ${e}`);
      }
    }

    const forms = await page.$$('form');
    for (const form of forms) {
      try {
        const innerHTML = await form.evaluate(el => el.innerHTML.toLowerCase());
        const hasKeyword = BUTTON_KEYWORDS.some(kw => innerHTML.includes(kw));
        if (hasKeyword) {
          await form.evaluate(el => el.submit());
          await emulateHuman(page);
        }
      } catch (e) {
        console.error(`[DEBUG] Error submitting form: ${e}`);
      }
    }

    const links = await page.$$('a[href]');
    const urls = (await Promise.all(links.map(link => link.evaluate(el => el.href))))
      .filter(href => !IGNORE_URLS.some(ig => (typeof ig === 'string' ? href.includes(ig) : ig.test(href))))
      .filter(href => BUTTON_KEYWORDS.some(kw => href.toLowerCase().includes(kw)))
      .slice(0, 5);

    for (const link of urls) {
      try {
        await page.goto(link, { timeout: 15000 });
        const linkContent = await page.content();

        if (STRIPE_KEYWORDS.some(kw => (typeof kw === 'string' ? linkContent.includes(kw) : kw.test(linkContent))))
          results.gateways.add('Stripe');
        if (PAYPAL_KEYWORDS.some(kw => (typeof kw === 'string' ? linkContent.includes(kw) : kw.test(linkContent))))
          results.gateways.add('PayPal');

        results.urls.add(link);
        await emulateHuman(page);
      } catch (e) {
        console.error(`[DEBUG] Error crawling ${link}: ${e}`);
      }
    }

    await browser.close();
  } catch (e) {
    console.error(`[DEBUG] Fatal error in detect: ${e}`);
    results.error = `Detection failed: ${e.message}`;
    if (browser) await browser.close();
  }

  return {
    ...results,
    gateways: Array.from(results.gateways),
    urls: Array.from(results.urls)
  };
}

// ✅ Handle uncaught exceptions and run module
process.on('uncaughtException', err => {
  console.error(JSON.stringify({ error: 'Uncaught Exception', detail: err.message }));
  process.exit(1);
});

process.on('unhandledRejection', err => {
  console.error(JSON.stringify({ error: 'Unhandled Promise Rejection', detail: err.message }));
  process.exit(1);
});

if (require.main === module) {
  const [,, url, jobId] = process.argv;

  detect(url, jobId)
    .then(result => {
      console.log(JSON.stringify(result));
    })
    .catch(err => {
      console.error(JSON.stringify({ error: 'Detection failed', detail: err.message }));
      process.exit(1);
    });
}

module.exports = { detect };
                                
